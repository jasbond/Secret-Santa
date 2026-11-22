import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testStore, trackAwaits } from './helpers.js';
import { createApp, createRateLimiter } from '../src/app.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

let server;
let baseUrl;
let store;
let clock = 1_700_000_000_000;
let awaited;

before(async () => {
  store = await testStore({ now: () => clock });
  awaited = trackAwaits(store);
  const limits = { groupCreation: { max: 1e6 }, auth: { max: 1e6 } };
  server = http.createServer(createApp({ store: awaited.proxy, publicDir, logger: { error() {} }, limits }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await store.close();
});

/** Petit client HTTP avec ses propres cookies (= un appareil). */
function device() {
  const jar = new Map();
  return async function request(method, url, body, { contentType = 'application/json' } = {}) {
    const headers = {};
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (method !== 'GET' && contentType) headers['content-type'] = contentType;
    const res = await fetch(baseUrl + url, {
      method,
      headers,
      body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body ?? {})),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (/Max-Age=0/.test(c) || value === '') jar.delete(name);
      else jar.set(name, value);
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* pas du JSON */
    }
    return { status: res.status, json, text, headers: res.headers };
  };
}

async function createGroup(names = ['Alice', 'Bob', 'Chloé', 'David']) {
  const d = device();
  const res = await d('POST', '/api/groups', { name: 'Noël', budget: '20 €', eventDate: '2026-12-24', participants: names });
  assert.equal(res.status, 201);
  const adminToken = res.json.adminToken;
  const view = (await d('GET', `/api/admin/${adminToken}`)).json;
  return { admin: d, adminToken, view };
}

test('pages HTML et en-têtes de sécurité', async () => {
  const d = device();
  for (const url of ['/', '/admin/abcdefghijklmnopqrstuvwx', '/p/abcdefghijklmnopqrstuvwx', '/static/app.css', '/static/participant.js']) {
    const res = await d('GET', url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  }
  assert.equal((await d('GET', '/static/../src/store.js')).status, 404);
  assert.equal((await d('GET', '/static/%2e%2e%2fsrc%2fstore.js')).status, 404);
  assert.equal((await d('GET', '/nimportequoi')).status, 404);
});

test('création de groupe : validations', async () => {
  const d = device();
  assert.equal((await d('POST', '/api/groups', { name: '' })).status, 400);
  assert.equal((await d('POST', '/api/groups', { name: 'X', eventDate: '2026-02-30' })).status, 400);
  assert.equal((await d('POST', '/api/groups', { name: 'X', participants: ['Léa', 'léa'] })).status, 400);
  assert.equal((await d('POST', '/api/groups', { name: 'X', participants: 'Léa' })).status, 400);
  assert.equal((await d('POST', '/api/groups', { name: 'X'.repeat(81) })).status, 400);
  assert.equal((await d('POST', '/api/groups', '{pas du json')).status, 400);
  assert.equal((await d('POST', '/api/groups', '[]')).status, 400);
  // Protection CSRF : un formulaire classique (text/plain, form-urlencoded) est refusé.
  assert.equal((await d('POST', '/api/groups', '{"name":"X"}', { contentType: 'text/plain' })).status, 415);
  assert.equal((await d('POST', '/api/groups', 'name=X', { contentType: 'application/x-www-form-urlencoded' })).status, 415);
  // Corps trop gros
  assert.equal((await d('POST', '/api/groups', { name: 'X', description: 'a'.repeat(70_000) })).status, 413);
  const ok = await d('POST', '/api/groups', { name: '  Famille  ', participants: [' Léa ', '', 'Tom'] });
  assert.equal(ok.status, 201);
  const view = (await d('GET', `/api/admin/${ok.json.adminToken}`)).json;
  assert.equal(view.group.name, 'Famille');
  assert.deepEqual(view.participants.map((p) => p.name), ['Léa', 'Tom']);
});

test('lien organisateur invalide', async () => {
  const d = device();
  assert.equal((await d('GET', '/api/admin/xxxxxxxxxxxxxxxxxxxxxxxx')).status, 404);
  assert.equal((await d('GET', '/api/admin/court')).status, 404);
  assert.equal((await d('POST', '/api/admin/xxxxxxxxxxxxxxxxxxxxxxxx/draw', {})).status, 404);
});

test('parcours complet : tirage, anonymat, messagerie, révélation', async () => {
  const { admin, adminToken, view } = await createGroup();
  const A = `/api/admin/${adminToken}`;
  const byName = Object.fromEntries(view.participants.map((p) => [p.name, p]));

  // Exclusion Alice ✕ Bob
  let res = await admin('POST', `${A}/exclusions`, { a: byName.Alice.id, b: byName.Bob.id });
  assert.equal(res.status, 200);
  assert.equal(res.json.exclusions.length, 1);
  assert.equal((await admin('POST', `${A}/exclusions`, { a: byName.Alice.id, b: byName.Alice.id })).status, 400);

  // Tirage : à 4 avec un couple exclu, seules 2 chaînes sont possibles (devinable)
  res = await admin('POST', `${A}/draw`, {});
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'predictable');
  res = await admin('POST', `${A}/draw`, { force: true });
  assert.equal(res.status, 200);
  assert.equal(res.json.group.drawn, true);
  assert.equal((await admin('POST', `${A}/draw`, {})).status, 409, 'pas de double tirage');
  assert.equal((await admin('POST', `${A}/participants`, { name: 'Zoé' })).status, 409, 'liste verrouillée');
  assert.equal((await admin('DELETE', `${A}/participants/${byName.Alice.id}`, {})).status, 409);

  // La vue organisateur ne contient aucune information sur le tirage
  const adminJson = JSON.stringify(res.json);
  assert.ok(!/receiver|giver|recipient|santa|assign/i.test(adminJson), adminJson);

  // Chaque participant active son lien sur son propre appareil
  const people = {};
  for (const p of view.participants) {
    const d = device();
    const url = `/api/p/${p.token}`;
    let s = await d('GET', url);
    assert.equal(s.status, 200);
    assert.deepEqual(s.json, { name: p.name, groupName: 'Noël', authenticated: false });
    assert.equal((await d('GET', `${url}/messages`)).status, 401);
    assert.equal((await d('POST', `${url}/setup`, { code: '123' })).status, 400, 'code trop court');
    res = await d('POST', `${url}/setup`, { code: `20${String(view.participants.indexOf(p)).padStart(2, '0')}26` });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie'), /HttpOnly/);
    assert.match(res.headers.get('set-cookie'), /SameSite=Lax/);
    s = await d('GET', url);
    assert.equal(s.json.authenticated, true);
    people[p.name] = { d, url, view: s.json, token: p.token, id: p.id };
  }

  // Le tirage est cohérent : dérangement complet, exclusion respectée
  const recipientOf = Object.fromEntries(Object.entries(people).map(([n, x]) => [n, x.view.recipient.name]));
  assert.equal(new Set(Object.values(recipientOf)).size, 4);
  for (const [giver, receiver] of Object.entries(recipientOf)) assert.notEqual(giver, receiver);
  assert.notEqual(recipientOf.Alice, 'Bob');
  assert.notEqual(recipientOf.Bob, 'Alice');
  const santaOf = Object.fromEntries(Object.entries(recipientOf).map(([g, r]) => [r, g]));

  // Liste de souhaits visible par le Père Noël
  const bobSanta = santaOf.Bob;
  assert.equal((await people.Bob.d('PUT', `${people.Bob.url}/wishlist`, { wishlist: '  Un livre\nDes chaussettes  ' })).json.wishlist, 'Un livre\nDes chaussettes');
  const santaView = (await people[bobSanta].d('GET', people[bobSanta].url)).json;
  assert.equal(santaView.recipient.name, 'Bob');
  assert.equal(santaView.recipient.wishlist, 'Un livre\nDes chaussettes');

  // Messagerie : le Père Noël de Bob écrit à Bob
  res = await people[bobSanta].d('POST', `${people[bobSanta].url}/messages`, { conv: 'recipient', body: 'Coucou Bob, sucré ou salé ?' });
  assert.equal(res.status, 201);
  assert.equal(res.json.message.mine, true);
  // Bob répond à son Père Noël
  res = await people.Bob.d('POST', `${people.Bob.url}/messages`, { conv: 'santa', body: 'Sucré !' });
  assert.equal(res.status, 201);

  const bobMsgs = (await people.Bob.d('GET', `${people.Bob.url}/messages`)).json.messages;
  const fromSanta = bobMsgs.filter((m) => m.conv === 'santa');
  assert.deepEqual(fromSanta.map((m) => [m.mine, m.body]), [[false, 'Coucou Bob, sucré ou salé ?'], [true, 'Sucré !']]);

  const santaMsgs = (await people[bobSanta].d('GET', `${people[bobSanta].url}/messages`)).json.messages;
  assert.deepEqual(santaMsgs.filter((m) => m.conv === 'recipient').map((m) => [m.mine, m.body]),
    [[true, 'Coucou Bob, sucré ou salé ?'], [false, 'Sucré !']]);

  // ANONYMAT : rien dans les réponses reçues par Bob ne trahit son Père Noël
  const santaIdentity = [bobSanta, people[bobSanta].id, people[bobSanta].token];
  const bobState = (await people.Bob.d('GET', people.Bob.url)).json;
  // (on retire la liste publique des participants, et le nom de la personne à qui
  // Bob offre : si le tirage forme une paire mutuelle, c'est légitimement le même nom)
  const bobRaw = JSON.stringify({ bobState: { ...bobState, participants: [], recipient: null }, bobMsgs });
  for (const secret of santaIdentity) assert.ok(!bobRaw.includes(secret), `fuite de « ${secret} » dans ${bobRaw}`);
  assert.deepEqual(Object.keys(bobState.recipient).sort(), ['name', 'wishlist']);
  for (const m of bobMsgs) assert.deepEqual(Object.keys(m).sort(), ['body', 'conv', 'createdAt', 'id', 'mine']);
  assert.equal(bobState.santaName, null);

  // Les autres participants ne voient pas cette conversation
  for (const [name, x] of Object.entries(people)) {
    if (name === 'Bob' || name === bobSanta) continue;
    const msgs = (await x.d('GET', `${x.url}/messages`)).json.messages;
    assert.ok(!msgs.some((m) => m.body.includes('sucré') || m.body.includes('Sucré')), `${name} voit un message qui ne le concerne pas`);
  }

  // Pagination : after=id
  const lastId = Math.max(...bobMsgs.map((m) => m.id));
  assert.deepEqual((await people.Bob.d('GET', `${people.Bob.url}/messages?after=${lastId}`)).json.messages, []);

  // Lu / non lu
  assert.equal((await people.Bob.d('POST', `${people.Bob.url}/read`, { conv: 'santa', lastId })).status, 200);
  assert.equal((await people.Bob.d('GET', people.Bob.url)).json.reads.santa, lastId);
  assert.equal((await people.Bob.d('POST', `${people.Bob.url}/read`, { conv: 'autre', lastId })).status, 400);

  // Validation des messages
  assert.equal((await people.Bob.d('POST', `${people.Bob.url}/messages`, { conv: 'santa', body: '   ' })).status, 400);
  assert.equal((await people.Bob.d('POST', `${people.Bob.url}/messages`, { conv: 'x', body: 'a' })).status, 400);
  assert.equal((await people.Bob.d('POST', `${people.Bob.url}/messages`, { conv: 'santa', body: 'a'.repeat(2001) })).status, 400);

  // Un autre appareil (ex : l'organisateur) avec le lien de Bob ne voit rien sans le code
  const intruder = device();
  const peek = await intruder('GET', people.Bob.url);
  assert.deepEqual(Object.keys(peek.json).sort(), ['authenticated', 'groupName', 'name']);
  assert.equal((await intruder('GET', `${people.Bob.url}/messages`)).status, 401);
  assert.equal((await intruder('POST', `${people.Bob.url}/setup`, { code: '666666' })).status, 401, 'mauvais code : compte comme un essai raté');
  // Le cookie d'un participant ne fonctionne pas sur la page d'un autre
  assert.equal((await people.Alice.d('GET', `${people.Bob.url}/messages`)).status, 401);

  // Révélation
  res = await admin('POST', `${A}/reveal`, { revealed: true });
  assert.equal(res.json.group.revealed, true);
  assert.equal((await people.Bob.d('GET', people.Bob.url)).json.santaName, bobSanta);
  res = await admin('POST', `${A}/reveal`, { revealed: false });
  assert.equal((await people.Bob.d('GET', people.Bob.url)).json.santaName, null);

  // Annulation du tirage : conversations effacées
  res = await admin('POST', `${A}/reset-draw`, {});
  assert.equal(res.json.group.drawn, false);
  assert.deepEqual((await people.Bob.d('GET', `${people.Bob.url}/messages`)).json.messages, []);
  assert.equal((await people.Bob.d('GET', people.Bob.url)).json.recipient, null);
  assert.equal((await people.Bob.d('POST', `${people.Bob.url}/messages`, { conv: 'santa', body: 'hey' })).status, 409);
  assert.equal((await admin('POST', `${A}/reveal`, { revealed: true })).status, 409);

  // Nouveau tirage possible
  assert.equal((await admin('POST', `${A}/draw`, { force: true })).status, 200);
  assert.ok((await people.Bob.d('GET', people.Bob.url)).json.recipient);
});

test('code secret : connexion, erreurs sans blocage (message pour Jason), déconnexion, réinitialisation', async () => {
  const { admin, adminToken, view } = await createGroup(['Emma', 'Hugo', 'Inès']);
  const emma = view.participants[0];
  const url = `/api/p/${emma.token}`;
  const phone = device();
  assert.equal((await phone('POST', `${url}/setup`, { code: '250012' })).status, 200);

  const laptop = device();
  assert.equal((await laptop('POST', `${url}/login`, { code: '100000' })).status, 401);
  assert.equal((await laptop('POST', `${url}/login`, { code: '250012' })).status, 200);
  assert.equal((await laptop('GET', url)).json.authenticated, true);

  // Déconnexion de l'ordinateur sans toucher au téléphone
  assert.equal((await laptop('POST', `${url}/logout`, {})).status, 200);
  assert.equal((await laptop('GET', url)).json.authenticated, false);
  assert.equal((await phone('GET', url)).json.authenticated, true);

  // Pas de blocage : « Code incorrect. », puis après plus de 3 erreurs, le message pour Jason.
  // (1 erreur déjà faite plus haut, effacée par la bonne connexion.)
  for (let i = 0; i < 3; i++) assert.equal((await laptop('POST', `${url}/login`, { code: `10000${i}` })).json.error, 'Code incorrect.');
  for (let i = 3; i < 12; i++) {
    const res = await laptop('POST', `${url}/login`, { code: `1000${String(i).padStart(2, '0')}` });
    assert.equal(res.status, 401);
    assert.match(res.json.error, /Demande à Jason de le réinitialiser/);
  }
  // Le bon code passe toujours, tout de suite
  assert.equal((await laptop('POST', `${url}/login`, { code: '250012' })).status, 200);

  // L'organisateur réinitialise le code : toutes les sessions sont fermées
  const A = `/api/admin/${adminToken}`;
  const res = await admin('POST', `${A}/participants/${emma.id}/reset-code`, {});
  assert.equal(res.json.participants[0].hasCode, false);
  assert.equal(res.json.participants[0].resetCount, 1, 'trace visible par l\'organisateur');
  // Rien n'est visible sans le code (on ne peut pas deviner qui a été réinitialisé)
  assert.deepEqual(Object.keys((await device()('GET', url)).json).sort(), ['authenticated', 'groupName', 'name']);
  // Impossible de « réinitialiser » un code jamais choisi (on ne pourrait rien cacher, mais ça n'a pas de sens)
  assert.equal((await admin('POST', `${A}/participants/${emma.id}/reset-code`, {})).status, 409);
  assert.equal((await phone('GET', url)).json.authenticated, false);
  assert.equal((await laptop('GET', `${url}/messages`)).status, 401);
  assert.equal((await phone('POST', `${url}/setup`, { code: '818181' })).status, 200);
  // Trace visible par le participant une fois entré, impossible à effacer
  const status = (await phone('GET', url)).json;
  assert.equal(status.resetCount, 1);
  assert.equal(status.lastResetAt, clock, 'date de la réinitialisation');
});

test('organisateur : participants, exclusions, paramètres, suppression', async () => {
  const { admin, adminToken, view } = await createGroup(['Jade', 'Karim']);
  const A = `/api/admin/${adminToken}`;
  assert.equal((await admin('POST', `${A}/draw`, {})).status, 400, 'au moins 3 participants');

  let res = await admin('POST', `${A}/participants`, { name: 'Lina' });
  assert.equal(res.status, 200);
  assert.equal(res.json.participants.length, 3);
  assert.equal((await admin('POST', `${A}/participants`, { name: 'LINA' })).status, 409, 'doublon');
  assert.equal((await admin('POST', `${A}/participants`, { name: '' })).status, 400);

  const [jade, karim, lina] = res.json.participants;
  res = await admin('PATCH', `${A}/participants/${karim.id}`, { name: 'Karim B.' });
  assert.equal(res.json.participants[1].name, 'Karim B.');
  assert.equal((await admin('PATCH', `${A}/participants/${karim.id}`, { name: 'jade' })).status, 409);

  // Exclusions rendant le tirage impossible
  await admin('POST', `${A}/exclusions`, { a: jade.id, b: karim.id });
  res = await admin('POST', `${A}/exclusions`, { a: lina.id, b: jade.id });
  assert.equal(res.json.exclusions.length, 2);
  res = await admin('POST', `${A}/draw`, {});
  assert.equal(res.status, 409);
  assert.match(res.json.error, /impossible/);
  res = await admin('DELETE', `${A}/exclusions`, { a: jade.id, b: lina.id });
  assert.equal(res.json.exclusions.length, 1);

  // Un participant d'un autre groupe ne peut pas être manipulé
  const other = await createGroup(['X1', 'X2', 'X3']);
  assert.equal((await admin('DELETE', `${A}/participants/${other.view.participants[0].id}`, {})).status, 404);
  assert.equal((await admin('POST', `${A}/exclusions`, { a: jade.id, b: other.view.participants[0].id })).status, 404);

  // Retrait d'un participant : ses exclusions disparaissent aussi
  res = await admin('DELETE', `${A}/participants/${karim.id}`, {});
  assert.equal(res.json.participants.length, 2);
  assert.equal(res.json.exclusions.length, 0);
  assert.equal((await admin('GET', `/api/p/${karim.token}`)).status, 404, 'lien du participant retiré invalide');

  // Paramètres
  res = await admin('PATCH', A, { name: 'Nouveau nom', budget: '30 €', eventDate: '', description: 'Chez moi' });
  assert.equal(res.json.group.name, 'Nouveau nom');
  assert.equal(res.json.group.budget, '30 €');
  assert.equal((await admin('PATCH', A, { name: ' ' })).status, 400);

  // Méthode non autorisée
  assert.equal((await admin('PUT', A, {})).status, 405);

  // Suppression
  res = await admin('DELETE', A, {});
  assert.equal(res.status, 200);
  assert.equal((await admin('GET', A)).status, 404);
  assert.equal((await admin('GET', `/api/p/${jade.token}`)).status, 404);
});

test('aucun blocage, et nombre d’essais ratés signalé à la connexion', async () => {
  const { view } = await createGroup(['Nora', 'Omar', 'Paul']);
  const url = `/api/p/${view.participants[0].token}`;
  const d = device();
  assert.equal((await d('POST', `${url}/setup`, { code: '240601' })).status, 200);
  const other = device();
  for (let i = 0; i < 10; i++) assert.equal((await other('POST', `${url}/login`, { code: '9999' + String(i).padStart(2, '0') })).status, 401);
  const ok = await other('POST', `${url}/login`, { code: '240601' });
  assert.equal(ok.status, 200, 'jamais bloqué');
  assert.equal(ok.json.failedAttempts, 10, 'le participant est prévenu des essais ratés');
  assert.equal((await other('POST', `${url}/logout`, {})).status, 200);
  assert.equal((await other('POST', `${url}/login`, { code: '240601' })).json.failedAttempts, 0);
});

test('les sessions anciennes sont purgées (10 max par participant)', async () => {
  const { view } = await createGroup(['Rita', 'Sam', 'Téo']);
  const url = `/api/p/${view.participants[0].token}`;
  const first = device();
  await first('POST', `${url}/setup`, { code: '121212' });
  for (let i = 0; i < 10; i++) {
    clock += 1;
    await device()('POST', `${url}/login`, { code: '121212' });
  }
  assert.equal((await first('GET', url)).json.authenticated, false, 'la plus ancienne session a été supprimée');
});

test('tirage devinable à cause des exclusions : avertissement puis tirage forcé', async () => {
  const { admin, adminToken, view } = await createGroup(['Ana', 'Ben', 'Cléa', 'Dan']);
  const A = `/api/admin/${adminToken}`;
  const [ana, , clea, dan] = view.participants;
  await admin('POST', `${A}/exclusions`, { a: ana.id, b: clea.id });
  await admin('POST', `${A}/exclusions`, { a: ana.id, b: dan.id });
  let res = await admin('POST', `${A}/draw`, {});
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'predictable');
  assert.match(res.json.error, /Ana/);
  res = await admin('POST', `${A}/draw`, { force: true });
  assert.equal(res.status, 200);
  assert.equal(res.json.group.drawn, true);
});

test('échange à deux inévitable : avertissement « mutual » puis tirage forcé', async () => {
  // 3 « centres » et 4 binômes : chaque binôme ne peut tirer qu'en lui-même ou vers un
  // centre. 4 binômes pour 3 centres : au moins un binôme s'offre mutuellement. Chacun a
  // au moins 4 personnes possibles, donc rien n'est « devinable » au sens habituel.
  const names = ['H1', 'H2', 'H3', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2'];
  const { admin, adminToken, view } = await createGroup(names);
  const A = `/api/admin/${adminToken}`;
  const pods = view.participants.filter((p) => !p.name.startsWith('H'));
  for (let i = 0; i < pods.length; i++) {
    for (let j = i + 1; j < pods.length; j++) {
      if (pods[i].name[0] !== pods[j].name[0]) await admin('POST', `${A}/exclusions`, { a: pods[i].id, b: pods[j].id });
    }
  }
  let res = await admin('POST', `${A}/draw`, {});
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'mutual');
  assert.match(res.json.error, /mutuellement/);
  assert.equal((await admin('GET', A)).json.group.drawn, false, 'rien d’enregistré');
  res = await admin('POST', `${A}/draw`, { force: true });
  assert.equal(res.status, 200);
  assert.equal(res.json.group.drawn, true);
});

test('Père Noël devinable avec deux personnes possibles (chaîne unique)', async () => {
  const names = ['Chloe', 'Dany', 'Jason', 'Jessy', 'Kalea', 'Kea', 'Miti', 'Reva', 'Salomé', 'Tom', 'Ugo', 'Veldea', 'Welma'];
  const { admin, adminToken, view } = await createGroup(names);
  const A = `/api/admin/${adminToken}`;
  const [chloe, ...others] = view.participants;
  for (const p of others.slice(0, 10)) await admin('POST', `${A}/exclusions`, { a: chloe.id, b: p.id });
  const res = await admin('POST', `${A}/draw`, {});
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'predictable');
  assert.match(res.json.error, /Chloe/);
  assert.doesNotMatch(res.json.error, /Veldea|Welma/);
});

test('pas de modification après un tirage concurrent (état relu en base)', async () => {
  const { adminToken } = await createGroup(['Eva', 'Fred', 'Gus']);
  const staleGroup = await store.groupByAdminToken(adminToken); // lu AVANT le tirage
  await store.draw(await store.groupByAdminToken(adminToken));
  await assert.rejects(store.addParticipant(staleGroup, 'Intrus'), /tirage a déjà eu lieu/);
  const ids = (await store.adminView(staleGroup)).participants.map((p) => p.id);
  await assert.rejects(store.removeParticipant(staleGroup, ids[0]), /tirage a déjà eu lieu/);
  await assert.rejects(store.addExclusion(staleGroup, ids[0], ids[1]), /tirage a déjà eu lieu/);
  assert.equal((await store.adminView(staleGroup)).participants.length, 3);
});

test('message refusé si le tirage a été refait entre-temps', async () => {
  const { admin, adminToken, view } = await createGroup(['Hana', 'Ivan', 'Jo']);
  const A = `/api/admin/${adminToken}`;
  const d = device();
  const url = `/api/p/${view.participants[0].token}`;
  await d('POST', `${url}/setup`, { code: '424242' });
  await admin('POST', `${A}/draw`, {});
  const oldDrawnAt = (await d('GET', url)).json.group.drawnAt;
  assert.equal((await d('POST', `${url}/messages`, { conv: 'santa', body: 'ok', drawnAt: oldDrawnAt })).status, 201);
  await admin('POST', `${A}/reset-draw`, {});
  clock += 1000;
  await admin('POST', `${A}/draw`, {});
  const res = await d('POST', `${url}/messages`, { conv: 'santa', body: 'trop tard', drawnAt: oldDrawnAt });
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'stale-draw');
});

test('noms invisibles ou sosies refusés', async () => {
  const d = device();
  const res = await d('POST', '/api/groups', { name: 'X', participants: ['Alice', 'Alice​'] });
  assert.equal(res.status, 400, 'Alice + espace invisible = doublon');
  const { admin, adminToken } = await createGroup(['Kim', 'Lou', 'Max']);
  assert.equal((await admin('POST', `/api/admin/${adminToken}/participants`, { name: '​⁠' })).status, 400);
  assert.ok((await admin('POST', `/api/admin/${adminToken}/participants`, { name: '‮abc' })).json.participants.some((p) => p.name === 'abc'));
});

test('participants rangés par ordre alphabétique (accents et majuscules ignorés)', async () => {
  const { admin, adminToken } = await createGroup(['Welma', 'salomé J', 'Éva', 'Cousine Salomé', 'Dany', 'Salomé M']);
  const expected = ['Cousine Salomé', 'Dany', 'Éva', 'salomé J', 'Salomé M', 'Welma'];
  const A = `/api/admin/${adminToken}`;
  const view = (await admin('GET', A)).json;
  assert.deepEqual(view.participants.map((p) => p.name), expected, 'page organisateur');
  assert.deepEqual((await device()('GET', `/api/g/${view.inviteToken}`)).json.participants.map((p) => p.name), expected, 'page « Qui es-tu ? »');
  // Un participant ajouté plus tard prend sa place dans l'ordre
  const added = (await admin('POST', `${A}/participants`, { name: 'Kea' })).json.participants.map((p) => p.name);
  assert.deepEqual(added, ['Cousine Salomé', 'Dany', 'Éva', 'Kea', 'salomé J', 'Salomé M', 'Welma']);
});

test('requêtes HEAD', async () => {
  const { adminToken, view } = await createGroup(['Noé', 'Pia', 'Quentin']);
  for (const url of [`/api/admin/${adminToken}`, `/api/p/${view.participants[0].token}`, '/', '/healthz']) {
    const res = await fetch(baseUrl + url, { method: 'HEAD' });
    assert.equal(res.status, 200, url);
  }
  assert.equal((await fetch(`${baseUrl}/api/p/${view.participants[0].token}/messages`, { method: 'HEAD' })).status, 401);
});

test('limiteur de requêtes', () => {
  let t = 0;
  const check = createRateLimiter({ max: 2, windowMs: 1000, now: () => t });
  check('a');
  check('a');
  assert.throws(() => check('a'), /Trop de requêtes/);
  check('b');
  t = 1001;
  check('a');
});

test('création de groupes limitée par adresse IP', async () => {
  const s2 = await testStore();
  const srv = http.createServer(createApp({ store: s2, publicDir, logger: { error() {} }, limits: { groupCreation: { max: 2 } } }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/api/groups`;
  const post = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"G"}' });
  assert.equal((await post()).status, 201);
  assert.equal((await post()).status, 201);
  assert.equal((await post()).status, 429);
  await new Promise((r) => srv.close(r));
  await s2.close();
});

test('suivi des cadeaux : le participant avance, l’organisateur ne voit que des totaux', async () => {
  const { admin, adminToken, view } = await createGroup(['Ali', 'Bea', 'Cyd', 'Dom']);
  const A = `/api/admin/${adminToken}`;
  const d = device();
  const url = `/api/p/${view.participants[0].token}`;
  await d('POST', `${url}/setup`, { code: '343434' });
  assert.equal((await d('PUT', `${url}/gift-status`, { status: 'idea' })).status, 409, 'avant le tirage');
  assert.equal((await admin('GET', A)).json.giftProgress, null);
  await admin('POST', `${A}/draw`, {});
  assert.equal((await d('PUT', `${url}/gift-status`, { status: 'nimporte' })).status, 400);
  assert.equal((await d('PUT', `${url}/gift-status`, { status: 'wrapped' })).json.giftStatus, 'wrapped');
  assert.equal((await d('GET', url)).json.me.giftStatus, 'wrapped');
  const progress = (await admin('GET', A)).json.giftProgress;
  assert.deepEqual(progress, { total: 4, searching: 3, idea: 0, bought: 0, wrapped: 1 });
  const adminJson = JSON.stringify((await admin('GET', A)).json);
  assert.ok(!/receiver|giver|recipient|santa|assign/i.test(adminJson));
  // Annuler le tirage remet l'avancement à zéro
  await admin('POST', `${A}/reset-draw`, {});
  assert.equal((await d('GET', url)).json.me.giftStatus, 'searching');
});

test('révélation complète et révélation automatique le lendemain de l’échange', async () => {
  const { admin, adminToken, view } = await createGroup(['Kai', 'Lea', 'Mia', 'Ned']);
  const A = `/api/admin/${adminToken}`;
  const d = device();
  const url = `/api/p/${view.participants[0].token}`;
  await d('POST', `${url}/setup`, { code: '777777' });
  assert.equal((await admin('PATCH', A, { autoReveal: true, eventDate: '' })).status, 400, 'date obligatoire');
  // Date de l'échange : 3 jours après « maintenant » (horloge de test)
  const day = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(clock + offset * 86400000));
  let res = await admin('PATCH', A, { eventDate: day(3), autoReveal: true });
  assert.equal(res.json.group.autoReveal, true);
  await admin('POST', `${A}/draw`, {});
  let me = (await d('GET', url)).json;
  assert.equal(me.group.revealed, false);
  assert.equal(me.reveal, null, 'pas de fuite avant le jour J');
  assert.equal(me.santaName, null);
  clock += 3 * 86400000;
  me = (await d('GET', url)).json;
  assert.equal(me.group.revealed, false, 'pas encore révélé le jour de l’échange (surprise de la soirée)');
  assert.equal(me.reveal, null);
  clock += 86400000;
  me = (await d('GET', url)).json;
  assert.equal(me.group.revealed, true, 'révélé automatiquement le lendemain');
  assert.equal(me.reveal.length, 4);
  // La chaîne est complète et cohérente : chacun donne et reçoit une fois
  assert.deepEqual(new Set(me.reveal.map((x) => x.giver)), new Set(['Kai', 'Lea', 'Mia', 'Ned']));
  assert.deepEqual(new Set(me.reveal.map((x) => x.receiver)), new Set(['Kai', 'Lea', 'Mia', 'Ned']));
  assert.equal(me.reveal.find((x) => x.receiver === 'Kai').giver, me.santaName);
  assert.equal(me.reveal.find((x) => x.giver === 'Kai').receiver, me.recipient.name);
  const revealedAt = me.group.firstRevealedAt;
  // Masquer désactive la révélation automatique ; la trace de la révélation reste
  res = await admin('POST', `${A}/reveal`, { revealed: true });
  assert.ok(res.json.group.firstRevealedAt);
  res = await admin('POST', `${A}/reveal`, { revealed: false });
  assert.equal(res.json.group.revealed, false);
  assert.equal(res.json.group.autoReveal, false);
  assert.ok(res.json.group.firstRevealedAt, 'trace visible par l’organisateur');
  me = (await d('GET', url)).json;
  assert.equal(me.reveal, null);
  assert.ok(me.group.firstRevealedAt, 'trace visible par les participants');
  assert.ok(revealedAt, 'une révélation automatique laisse aussi une trace définitive');
});

test('aucun réglage ne révèle en cachette (fuseau horaire, date) ; masquer laisse une trace', async () => {
  const { admin, adminToken } = await createGroup(['Sam', 'Tia', 'Uma', 'Vic']);
  const A = `/api/admin/${adminToken}`;
  const dayIn = (tz, offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(clock + offset * 86400000));
  await admin('POST', `${A}/draw`, {});
  // Révélation automatique prévue dans le futur (fuseau du groupe = Europe/Paris)
  let res = await admin('PATCH', A, { autoReveal: true, eventDate: dayIn('Europe/Paris', 2) });
  assert.equal(res.status, 200);
  assert.equal(res.json.group.revealed, false);
  const tz = res.json.group.timeZone;
  // Astuce du fuseau : après le tirage, le fuseau est figé, le changement est ignoré, rien n'est révélé.
  res = await admin('PATCH', A, { timeZone: 'Pacific/Kiritimati' });
  assert.equal(res.status, 200);
  assert.equal(res.json.group.timeZone, tz, 'le fuseau ne change plus après le tirage');
  assert.equal(res.json.group.revealed, false, 'changer de fuseau ne révèle pas');
  assert.equal((await admin('GET', `${A}/souvenirs.zip`)).status, 409);
  res = await admin('GET', A);
  assert.equal(res.json.group.revealed, false);
  assert.equal(res.json.group.firstRevealedAt, null);
  // Avancer la date d'échange dans le passé (autoReveal actif) est refusé : pas de révélation par la bande.
  assert.equal((await admin('PATCH', A, { eventDate: dayIn('Europe/Paris', -1) })).status, 400, 'reculer la date ne révèle pas');
  // Une vraie révélation automatique laisse une trace, à l'heure de la révélation (minuit local).
  clock += 3 * 86400000;
  res = await admin('GET', A);
  assert.equal(res.json.group.revealed, true);
  const trace = res.json.group.firstRevealedAt;
  assert.ok(trace, 'trace dès la révélation automatique');
  // La trace porte l'heure de la révélation (minuit le lendemain de l'échange), pas celle du regard.
  assert.ok(trace < clock, 'la trace est antérieure au moment où on la consulte');
  res = await admin('PATCH', A, { autoReveal: false });
  assert.equal(res.json.group.revealed, false);
  assert.equal(res.json.group.firstRevealedAt, trace, 'la trace reste après avoir masqué par les réglages');
});

test('téléchargements de l’organisateur complets (photo lourde, archive), sans double réponse', async () => {
  const { admin, adminToken, view } = await createGroup(['Abe', 'Bea', 'Cal']);
  const A = `/api/admin/${adminToken}`;
  const p = view.participants[0];
  const setup = await fetch(`${baseUrl}/api/p/${p.token}/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: '292929' }) });
  const cookie = setup.headers.getSetCookie()[0].split(';')[0];
  await admin('POST', `${A}/draw`, {});
  await admin('POST', `${A}/reveal`, { revealed: true });
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2_900_000, 9)]);
  const up = await fetch(`${baseUrl}/api/p/${p.token}/album/photo`, { method: 'PUT', headers: { 'content-type': 'image/jpeg', cookie }, body: big });
  assert.equal(up.status, 200);
  // Lecture lente, comme sur un téléphone avec un mauvais réseau
  const slowGet = (url) => new Promise((resolve, reject) => {
    http.get(baseUrl + url, (res) => {
      res.pause();
      const chunks = [];
      setTimeout(() => {
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ res, body: Buffer.concat(chunks), complete: res.complete }));
        res.on('error', reject);
        res.resume();
      }, 300);
    }).on('error', reject);
  });
  const photo = await slowGet(`${A}/album/photo/${p.id}`);
  assert.equal(photo.complete, true);
  assert.equal(Number(photo.res.headers['content-length']), big.length);
  assert.deepEqual(photo.body, big, 'photo complète');
  const zip = await slowGet(`${A}/souvenirs.zip`);
  assert.equal(zip.complete, true);
  assert.equal(zip.body.length, Number(zip.res.headers['content-length']));
  const files = readZip(zip.body);
  assert.ok(Object.values(files).some((b) => b.length === big.length), 'photo complète dans l’archive');
  const duos = await slowGet(`${A}/assignments`);
  assert.equal(JSON.parse(duos.body.toString()).assignments.length, 3);
});

test('enregistrer les paramètres depuis un autre fuseau ne révèle ni ne masque rien', async () => {
  const { admin, adminToken } = await createGroup(['Noa', 'Oria', 'Poe', 'Rai']);
  const A = `/api/admin/${adminToken}`;
  const dayIn = (tz, offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(clock + offset * 86400000));
  await admin('POST', `${A}/draw`, {});
  await admin('PATCH', A, { autoReveal: true, eventDate: dayIn('Europe/Paris', 3) });
  // L'organisateur renomme le groupe depuis un navigateur réglé très à l'est (Kiritimati, UTC+14) :
  // la date d'échange y est peut-être « déjà passée », mais le fuseau du groupe ne change pas, donc 200.
  const res = await admin('PATCH', A, { name: 'Noël chez Mamie', timeZone: 'Pacific/Kiritimati', autoReveal: true, eventDate: dayIn('Europe/Paris', 3) });
  assert.equal(res.status, 200, 'renommer depuis un autre fuseau ne doit pas être refusé');
  assert.equal(res.json.group.name, 'Noël chez Mamie');
  assert.equal(res.json.group.revealed, false, "l'enregistrement ne révèle pas");
  assert.equal(res.json.group.firstRevealedAt, null);
  assert.equal(res.json.group.timeZone, 'Europe/Paris', 'le fuseau reste celui du tirage');
});

test('révélation automatique : jamais de révélation immédiate par erreur', async () => {
  const { admin, adminToken } = await createGroup(['Ora', 'Pat', 'Quy', 'Rob']);
  const A = `/api/admin/${adminToken}`;
  const day = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(clock + offset * 86400000));
  // Date passée : refusé (aujourd'hui est accepté : la révélation aura lieu demain)
  let res = await admin('PATCH', A, { eventDate: day(-1), autoReveal: true });
  assert.equal(res.status, 400);
  assert.equal((await admin('PATCH', A, { eventDate: day(0), autoReveal: true })).status, 200);
  // Date future : accepté
  assert.equal((await admin('PATCH', A, { eventDate: day(2), autoReveal: true })).status, 200);
  // Avancer la date dans le passé avec la révélation auto active : refusé
  assert.equal((await admin('PATCH', A, { eventDate: day(-1) })).status, 400);
  // Modifier le nom une fois la date passée reste possible
  clock += 3 * 86400000;
  assert.equal((await admin('PATCH', A, { name: 'Nouveau' })).status, 200);
  // Tirage alors que la date de révélation auto est passée : refusé
  res = await admin('POST', `${A}/draw`, {});
  assert.equal(res.status, 409);
  assert.match(res.json.error, /révélation automatique/);
  // Après avoir décoché : tirage possible, non révélé
  await admin('PATCH', A, { autoReveal: false });
  res = await admin('POST', `${A}/draw`, {});
  assert.equal(res.status, 200);
  assert.equal(res.json.group.revealed, false);
  // Annuler le tirage garde la révélation automatique si la date n'est pas passée
  await admin('PATCH', A, { eventDate: day(5), autoReveal: true });
  res = await admin('POST', `${A}/reset-draw`, {});
  assert.equal(res.json.group.autoReveal, true);
});

test('la discussion de groupe n’existe plus', async () => {
  const { view } = await createGroup(['Wes', 'Xia', 'Yan']);
  const d = device();
  const url = `/api/p/${view.participants[0].token}`;
  await d('POST', `${url}/setup`, { code: '404040' });
  assert.equal((await d('GET', `${url}/group-messages`)).status, 404);
  assert.equal((await d('POST', `${url}/group-messages`, { body: 'x' })).status, 404);
  assert.equal((await d('POST', `${url}/read`, { conv: 'group', lastId: 1 })).status, 400);
  assert.deepEqual(Object.keys((await d('GET', url)).json.reads).sort(), ['recipient', 'santa']);
});

test('exclusion en double refusée avec un message clair', async () => {
  const { admin, adminToken, view } = await createGroup(['Abe', 'Bo', 'Cy']);
  const [a, b] = view.participants;
  const A = `/api/admin/${adminToken}`;
  assert.equal((await admin('POST', `${A}/exclusions`, { a: a.id, b: b.id })).status, 200);
  const res = await admin('POST', `${A}/exclusions`, { a: b.id, b: a.id });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /déjà exclus/);
  // Message en bon français (on retire l'exclusion : à 3, elle rendrait le tirage impossible)
  await admin('DELETE', `${A}/exclusions`, { a: a.id, b: b.id });
  assert.equal((await admin('POST', `${A}/draw`, {})).status, 200);
  assert.match((await admin('POST', `${A}/participants`, { name: 'Zed' })).json.error, /impossible d'ajouter un participant/);
});

test('impossible de deviner, de l’extérieur, qui est déjà venu (seul l’organisateur le sait)', async () => {
  const { admin, adminToken, view } = await createGroup(['Dee', 'Eve', 'Fox']);
  const [dee, eve] = view.participants;
  const venu = `/api/p/${dee.token}`;
  const pasVenu = `/api/p/${eve.token}`;
  await device()('POST', `${venu}/enter`, { code: '313131' });
  const strip = (j) => JSON.stringify({ ...j, name: '', groupName: '' });
  // Page vue sans code : même réponse, que la personne soit venue ou non
  assert.equal(strip((await device()('GET', venu)).json), strip((await device()('GET', pasVenu)).json));
  // Code avec des lettres ou trop long : refusé, même réponse dans les deux cas
  for (const bad of ['abcd', '12ab', '12 34', '1234567890123']) {
    const r1 = await device()('POST', `${venu}/enter`, { code: bad });
    const r2 = await device()('POST', `${pasVenu}/enter`, { code: bad });
    assert.equal(r1.status, 400, bad);
    assert.deepEqual([r1.status, r1.json.error], [r2.status, r2.json.error], bad);
  }
  assert.match((await device()('POST', `${venu}/enter`, { code: 'abcd' })).json.error, /que des chiffres/);
  // Code trop court : même réponse dans les deux cas
  const short1 = await device()('POST', `${venu}/enter`, { code: '12' });
  const short2 = await device()('POST', `${pasVenu}/enter`, { code: '12' });
  assert.equal(short1.status, 400);
  assert.deepEqual([short1.status, short1.json.error], [short2.status, short2.json.error]);
  // Aucun appel « gratuit » pour sonder : /login sur une page jamais ouverte ne répond plus « aucun code »
  // (elle enregistre le code), et /setup sur une page déjà prise compte comme un essai raté.
  const fox = view.participants[2];
  const login = await device()('POST', `/api/p/${fox.token}/login`, { code: '565656' });
  assert.equal(login.status, 200);
  assert.equal(login.json.created, true);
  const probe = await device()('POST', `${venu}/setup`, { code: '909090' });
  assert.equal(probe.status, 401);
  // La vraie personne est prévenue de l'essai à sa prochaine connexion
  const back = await device()('POST', `${venu}/enter`, { code: '313131' });
  assert.equal(back.json.failedAttempts, 1);
  assert.equal(back.json.created, false);
  // L'organisateur, lui, voit qui est venu
  const adminView = (await admin('GET', `/api/admin/${adminToken}`)).json;
  assert.deepEqual(adminView.participants.map((p) => p.hasCode), [true, false, true]);
});

test('l’organisateur peut afficher qui est le Père Noël de qui (sur demande)', async () => {
  const { admin, adminToken, view } = await createGroup(['Gus', 'Hal', 'Ida', 'Jo']);
  const A = `/api/admin/${adminToken}`;
  assert.equal((await admin('GET', `${A}/assignments`)).status, 409, 'pas avant le tirage');
  const drawn = await admin('POST', `${A}/draw`, {});
  // La vue normale de l'organisateur ne contient toujours pas le tirage
  assert.ok(!/receiver|giver|assign/i.test(JSON.stringify(drawn.json)));
  const res = await admin('GET', `${A}/assignments`);
  assert.equal(res.status, 200);
  const list = res.json.assignments;
  assert.equal(list.length, 4);
  assert.deepEqual(new Set(list.map((x) => x.giver)), new Set(['Gus', 'Hal', 'Ida', 'Jo']));
  assert.deepEqual(new Set(list.map((x) => x.receiver)), new Set(['Gus', 'Hal', 'Ida', 'Jo']));
  // Conforme à ce que voit chaque participant
  for (const p of view.participants) {
    const d = device();
    await d('POST', `/api/p/${p.token}/setup`, { code: '515151' });
    const me = (await d('GET', `/api/p/${p.token}`)).json;
    assert.equal(list.find((x) => x.giver === p.name).receiver, me.recipient.name);
  }
  // Mauvais lien organisateur : refusé
  assert.equal((await admin('GET', '/api/admin/xxxxxxxxxxxxxxxxxxxxxxxx/assignments')).status, 404);
});

test('lien unique du groupe : liste des prénoms, statut, sans fuite du tirage', async () => {
  const { admin, adminToken, view } = await createGroup(['Kim', 'Leo', 'Mo', 'Nat']);
  const A = `/api/admin/${adminToken}`;
  const inviteToken = (await admin('GET', A)).json.inviteToken;
  assert.match(inviteToken, /^[A-Za-z0-9_-]{24}$/);
  const d = device();
  let res = await d('GET', `/api/g/${inviteToken}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.participants.map((p) => p.name), ['Kim', 'Leo', 'Mo', 'Nat']);
  assert.deepEqual(res.json.participants.map((p) => p.token), view.participants.map((p) => p.token));
  // Un participant active son lien : la page du groupe n'en dit rien (seul l'organisateur le sait)
  const before = JSON.stringify(res.json.participants);
  await d('POST', `/api/p/${view.participants[0].token}/setup`, { code: '123123' });
  await admin('POST', `${A}/draw`, {});
  res = await device()('GET', `/api/g/${inviteToken}`);
  assert.equal(JSON.stringify(res.json.participants), before, 'rien ne change quand quelqu’un est venu');
  assert.equal((await admin('GET', A)).json.participants[0].hasCode, true, 'l’organisateur, lui, le voit');
  assert.equal(res.json.group.budget, undefined, 'pas de budget sur la page du groupe');
  assert.equal(res.json.group.drawn, true);
  // Rien sur le tirage dans la page du groupe
  assert.ok(!/receiver|giver|recipient|santa|assign/i.test(JSON.stringify(res.json)));
  assert.deepEqual(Object.keys(res.json.participants[0]).sort(), ['name', 'token']);
  // Le lien de groupe ne donne pas accès à une page sans le code
  assert.equal((await device()('GET', `/api/p/${view.participants[0].token}/messages`)).status, 401);
  // Liens invalides
  assert.equal((await d('GET', '/api/g/xxxxxxxxxxxxxxxxxxxxxxxx')).status, 404);
  assert.equal((await d('GET', '/api/g/court')).status, 404);
  assert.equal((await d('GET', `/g/${inviteToken}`)).status, 200);
});

test('fuseau horaire du groupe (Tahiti) et date limite de la liste', async () => {
  const d = device();
  // Fuseau invalide ignoré
  let res = await d('POST', '/api/groups', { name: 'TZ', participants: ['Ua', 'Va', 'Wa'], timeZone: 'Pas/Un/Fuseau' });
  assert.equal(res.status, 201);
  assert.equal((await d('GET', `/api/admin/${res.json.adminToken}`)).json.group.timeZone, 'Europe/Paris');
  res = await d('POST', '/api/groups', { name: 'Tahiti', participants: ['Ua', 'Va', 'Wa'], timeZone: 'Pacific/Tahiti' });
  const A = `/api/admin/${res.json.adminToken}`;
  assert.equal((await d('GET', A)).json.group.timeZone, 'Pacific/Tahiti');
  // L'échange a lieu « aujourd'hui » à Tahiti : la révélation automatique est acceptée
  // et n'a pas lieu tant que le lendemain n'est pas arrivé À TAHITI (même si Paris y est déjà).
  const tahitiDay = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Tahiti' }).format(new Date(clock + offset * 86400000));
  assert.equal((await d('PATCH', A, { eventDate: tahitiDay(0), autoReveal: true })).status, 200);
  assert.equal((await d('POST', `${A}/draw`, {})).status, 200);
  // Avance jusqu'à 23 h 30 à Tahiti le jour de l'échange (déjà le lendemain à Paris)
  const tahitiNow = new Date(clock).toLocaleString('en-US', { timeZone: 'Pacific/Tahiti', hour12: false, hour: '2-digit', minute: '2-digit' });
  const [hh, mm] = tahitiNow.split(':').map(Number);
  const before = clock;
  clock += ((23 - hh) * 60 + (30 - mm)) * 60000;
  const parisDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(clock));
  assert.ok(parisDay > tahitiDay(0), 'à Paris on est déjà le lendemain');
  assert.equal((await d('GET', A)).json.group.revealed, false, 'pas encore révélé à Tahiti');
  clock += 60 * 60000; // minuit et demi à Tahiti
  assert.equal((await d('GET', A)).json.group.revealed, true, 'révélé le lendemain à Tahiti');
  clock = before + 2 * 86400000;
  // Date limite de la liste de souhaits
  res = await d('PATCH', A, { wishlistDeadline: '2026-12-10' });
  assert.equal(res.json.group.wishlistDeadline, '2026-12-10');
  assert.equal((await d('PATCH', A, { wishlistDeadline: '2026-13-40' })).status, 400);
  assert.equal((await d('PATCH', A, { wishlistDeadline: '' })).json.group.wishlistDeadline, '');
});

/** Lit les noms et contenus d'une archive ZIP « stockée » (sans compression). */
function readZip(buf) {
  const files = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extra = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extra;
    files[name] = buf.subarray(start, start + size);
    i = start + size;
  }
  return files;
}

test('album souvenir et téléchargements (après la révélation seulement)', async () => {
  const { admin, adminToken, view } = await createGroup(['Ama', 'Bob', 'Cid', 'Dia']);
  const A = `/api/admin/${adminToken}`;
  const people = {};
  for (const p of view.participants) {
    const d = device();
    await d('POST', `/api/p/${p.token}/setup`, { code: '111111' });
    people[p.name] = { ...p, d, url: `/api/p/${p.token}` };
  }
  await admin('POST', `${A}/draw`, {});
  const ama = people.Ama;
  const amaView = (await ama.d('GET', ama.url)).json;
  await ama.d('POST', `${ama.url}/messages`, { conv: 'recipient', body: 'Coucou, sucré ou salé ?' });
  // Avant la révélation : tout est fermé
  assert.equal((await ama.d('GET', `${ama.url}/album`)).status, 409);
  assert.equal((await ama.d('GET', `${ama.url}/conversations.txt`)).status, 409);
  assert.equal((await admin('GET', `${A}/souvenirs.zip`)).status, 409, "l'organisateur ne peut pas lire les discussions avant la révélation");
  await admin('POST', `${A}/reveal`, { revealed: true });

  // Photo : JPEG seulement, taille limitée, session obligatoire
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]);
  const put = (d, url, body, type = 'image/jpeg') => fetch(baseUrl + url, { method: 'PUT', headers: { 'content-type': type, cookie: d.cookie }, body });
  // (le client de test garde les cookies en interne : on passe par une requête brute)
  const cookieOf = async (p) => {
    const res = await fetch(`${baseUrl}${p.url}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: '111111' }) });
    return res.headers.getSetCookie()[0].split(';')[0];
  };
  const bob = people.Bob;
  const bobCookie = await cookieOf(bob);
  const putPhoto = (cookie, body, type = 'image/jpeg') => fetch(`${baseUrl}${bob.url}/album/photo`, { method: 'PUT', headers: { 'content-type': type, ...(cookie ? { cookie } : {}) }, body });
  assert.equal((await putPhoto(null, jpeg)).status, 401);
  assert.equal((await putPhoto(bobCookie, Buffer.from('pas une image'.repeat(20)))).status, 415);
  assert.equal((await putPhoto(bobCookie, jpeg, 'text/plain')).status, 415);
  assert.equal((await putPhoto(bobCookie, Buffer.concat([jpeg, Buffer.alloc(3 * 1024 * 1024)]))).status, 413);
  assert.equal((await putPhoto(bobCookie, jpeg)).status, 200);
  assert.equal((await bob.d('PUT', `${bob.url}/album/note`, { note: '  Merci beaucoup !  ' })).json.note, 'Merci beaucoup !');

  // Tout le monde voit l'album
  const album = (await ama.d('GET', `${ama.url}/album`)).json.entries;
  const bobEntry = album.find((e) => e.name === 'Bob');
  assert.equal(bobEntry.hasPhoto, true);
  assert.equal(bobEntry.note, 'Merci beaucoup !');
  assert.ok(bobEntry.giverName);
  const photo = await fetch(`${baseUrl}${ama.url}/album/photo/${bob.id}?telecharger`, { headers: { cookie: await cookieOf(ama) } });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/jpeg');
  assert.match(photo.headers.get('content-disposition'), /^attachment; filename="Cadeau de .* pour Bob\.jpg"$/);
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), jpeg);
  // Un autre groupe ne peut pas voir cette photo
  const other = await createGroup(['Zed', 'Yan', 'Xo']);
  const od = device();
  await od('POST', `/api/p/${other.view.participants[0].token}/setup`, { code: '111111' });
  assert.equal((await od('GET', `/api/p/${other.view.participants[0].token}/album/photo/${bob.id}`)).status, 409);
  await other.admin('POST', `/api/admin/${other.adminToken}/draw`, {});
  await other.admin('POST', `/api/admin/${other.adminToken}/reveal`, { revealed: true });
  assert.equal((await od('GET', `/api/p/${other.view.participants[0].token}/album/photo/${bob.id}`)).status, 404, 'photo d’un autre groupe introuvable');
  assert.equal((await other.admin('GET', `/api/admin/${other.adminToken}/album/photo/${bob.id}`)).status, 404);

  // Mes discussions (texte) : seulement les miennes
  const txt = await ama.d('GET', `${ama.url}/conversations.txt`);
  assert.equal(txt.status, 200);
  assert.match(txt.text, /Coucou, sucré ou salé \?/);
  assert.match(txt.headers.get('content-disposition'), /Mes discussions/);
  assert.equal((txt.text.match(/Discussion entre/g) || []).length, 2);

  // Archive du participant : album + ses 2 discussions
  const zipRes = await fetch(`${baseUrl}${ama.url}/souvenirs.zip`, { headers: { cookie: await cookieOf(ama) } });
  assert.equal(zipRes.headers.get('content-type'), 'application/zip');
  const mine = readZip(Buffer.from(await zipRes.arrayBuffer()));
  const names = Object.keys(mine);
  assert.ok(names.some((n) => n.startsWith('photos/') && n.endsWith('pour Bob.jpg')));
  assert.ok(names.includes('Les petits mots.txt') && names.includes('Album.html'));
  assert.equal(names.filter((n) => n.startsWith('discussions/')).length, 2);
  assert.match(mine['Les petits mots.txt'].toString(), /Merci beaucoup/);

  // Archive de l'organisateur : toutes les discussions, avec les prénoms
  const all = readZip(Buffer.from(await (await fetch(`${baseUrl}${A}/souvenirs.zip`)).arrayBuffer()));
  assert.equal(Object.keys(all).filter((n) => n.startsWith('discussions/')).length, 4);
  const amaConv = Object.entries(all).find(([n]) => n.startsWith(`discussions/Ama (Père Noël) et ${amaView.recipient.name}`));
  assert.ok(amaConv, 'discussion d’Ama nommée avec les prénoms');
  assert.match(amaConv[1].toString(), /Ama \(Père Noël\) : Coucou/);
  // HTML de l'album échappé
  await bob.d('PUT', `${bob.url}/album/note`, { note: '<script>alert(1)</script>' });
  const all2 = readZip(Buffer.from(await (await fetch(`${baseUrl}${A}/souvenirs.zip`)).arrayBuffer()));
  assert.ok(!all2['Album.html'].toString().includes('<script>alert'));

  // Supprimer sa photo
  assert.equal((await bob.d('DELETE', `${bob.url}/album/photo`, {})).status, 200);
  assert.equal((await ama.d('GET', `${ama.url}/album`)).json.entries.find((e) => e.name === 'Bob').hasPhoto, false);
  // Annuler le tirage vide l'album
  await admin('POST', `${A}/reset-draw`, {});
  await admin('POST', `${A}/draw`, {});
  await admin('POST', `${A}/reveal`, { revealed: true });
  assert.equal((await ama.d('GET', `${ama.url}/album`)).json.entries.find((e) => e.name === 'Bob').note, '');
});

test('noms de fichiers : accents, emoji, ʻeta tahitien, et prénoms qui se ressemblent', async () => {
  // Prénoms avec accents, emoji, ʻeta tahitien, et deux noms qui donnent le même fichier.
  const names = ['Ève 🇵🇫', 'Hinaʻ', 'Jo/Ann', 'Jo Ann', '🎅'];
  const { admin, adminToken, view } = await createGroup(names);
  const A = `/api/admin/${adminToken}`;
  const people = {};
  for (const p of view.participants) {
    const d = device();
    await d('POST', `/api/p/${p.token}/setup`, { code: '111111' });
    people[p.name] = { ...p, d, url: `/api/p/${p.token}` };
  }
  await admin('POST', `${A}/draw`, {});
  // Chacun écrit un message pour qu'il y ait des discussions dans l'archive.
  for (const p of Object.values(people)) await p.d('POST', `${p.url}/messages`, { conv: 'recipient', body: 'coucou' });
  await admin('POST', `${A}/reveal`, { revealed: true });
  const cookieOf = async (p) => {
    const r = await fetch(`${baseUrl}${p.url}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: '111111' }) });
    return r.headers.getSetCookie()[0].split(';')[0];
  };

  // En-tête de l'archive : jamais de nom vide, l'emoji seul devient « sans nom ».
  const eve = people['Ève 🇵🇫'];
  const cdEve = (await fetch(`${baseUrl}${eve.url}/conversations.txt`, { headers: { cookie: await cookieOf(eve) } })).headers.get('content-disposition');
  assert.match(cdEve, /filename="Mes discussions - Eve\.txt"/, cdEve);
  const santa = people['🎅'];
  const cdSanta = (await fetch(`${baseUrl}${santa.url}/souvenirs.zip`, { headers: { cookie: await cookieOf(santa) } })).headers.get('content-disposition');
  assert.match(cdSanta, /filename="Souvenirs Secret Santa - sans nom\.zip"/, cdSanta);

  // Archive de l'organisateur : chaque fichier a un nom unique (Jo/Ann et Jo Ann ne s'écrasent pas).
  const all = readZip(Buffer.from(await (await fetch(`${baseUrl}${A}/souvenirs.zip`)).arrayBuffer()));
  const discussions = Object.keys(all).filter((n) => n.startsWith('discussions/'));
  assert.equal(discussions.length, 5, 'cinq discussions distinctes');
  assert.equal(new Set(discussions.map((n) => n.toLowerCase())).size, 5, 'aucun nom de fichier en double');
  assert.ok(Object.keys(all).some((n) => /Hina[ʻ'’]/.test(n)), "le ʻeta tahitien est conservé dans l'archive");
});

test('cache des fichiers (ETag, 304) et duos triés par personne qui reçoit', async () => {
  const d = device();
  const first = await fetch(`${baseUrl}/static/app.css`);
  const etag = first.headers.get('etag');
  assert.ok(etag);
  assert.equal((await fetch(`${baseUrl}/static/app.css`, { headers: { 'if-none-match': etag } })).status, 304);
  assert.match((await fetch(`${baseUrl}/static/nunito-400.woff2`)).headers.get('cache-control'), /immutable/);
  const { admin, adminToken } = await createGroup(['Zoé', 'Yann', 'Xavier', 'Wendy', 'Victor']);
  await admin('POST', `/api/admin/${adminToken}/draw`, {});
  const list = (await admin('GET', `/api/admin/${adminToken}/assignments`)).json.assignments.map((a) => a.receiver);
  assert.deepEqual(list, [...list].sort((a, b) => a.localeCompare(b, 'fr')));
  void d;
});

test('dernière visite : visible par l’organisateur seulement, écrite au plus une fois par minute', async () => {
  const { admin, adminToken, view } = await createGroup(['Ana', 'Ben', 'Cid']);
  const A = `/api/admin/${adminToken}`;
  const ana = view.participants.find((p) => p.name === 'Ana');
  const url = `/api/p/${ana.token}`;
  const seenOf = async () => (await admin('GET', A)).json.participants.find((p) => p.name === 'Ana').lastSeenAt;
  assert.equal(await seenOf(), null, 'jamais venue');
  // Une visite sans code ne compte pas
  await device()('GET', url);
  assert.equal(await seenOf(), null);
  const d = device();
  await d('POST', `${url}/enter`, { code: '4321' });
  const first = await seenOf();
  assert.equal(first, clock, 'visite enregistrée à l’entrée du code');
  // Moins d'une minute après : pas de nouvelle écriture
  clock += 30 * 1000;
  await d('GET', url);
  assert.equal(await seenOf(), first);
  // Plus d'une minute après : mise à jour
  clock += 31 * 1000;
  await d('GET', `${url}/messages`);
  assert.equal(await seenOf(), clock);
  // L'heure du serveur est fournie à l'organisateur, et personne d'autre ne voit la dernière visite
  assert.equal((await admin('GET', A)).json.serverNow, clock);
  const other = view.participants.find((p) => p.name === 'Ben');
  const bd = device();
  await bd('POST', `/api/p/${other.token}/enter`, { code: '5555' });
  assert.ok(!JSON.stringify((await bd('GET', `/api/p/${other.token}`)).json).includes('lastSeen'));
  assert.ok(!JSON.stringify((await device()('GET', `/api/g/${(await admin('GET', A)).json.inviteToken}`)).json).includes('lastSeen'));
});

test('chaque appel au store fait par le serveur est attendu (await)', () => {
  assert.ok(awaited.pending.size === 0, [...awaited.pending].map((e) => `${e.name} : ${e.stack}`).join('\n'));
});

test('cadeau de la découverte : ouvert une seule fois par personne, sur tous ses appareils', async () => {
  const { admin, adminToken, view } = await createGroup(['Ana', 'Ben', 'Cid']);
  const A = `/api/admin/${adminToken}`;
  const ana = view.participants.find((p) => p.name === 'Ana');
  const url = `/api/p/${ana.token}`;
  const phone = device();
  await phone('POST', `${url}/enter`, { code: '1234' });
  assert.equal((await phone('POST', `${url}/gift-opened`, {})).status, 409, 'pas avant le tirage');
  await admin('POST', `${A}/draw`, {});
  assert.equal((await phone('GET', url)).json.giftOpened, false);
  assert.equal((await device()('POST', `${url}/gift-opened`, {})).status, 401, 'pas sans le code');
  assert.equal((await phone('POST', `${url}/gift-opened`, {})).status, 200);
  // Sur un autre appareil : déjà ouvert
  const laptop = device();
  await laptop('POST', `${url}/enter`, { code: '1234' });
  assert.equal((await laptop('GET', url)).json.giftOpened, true, 'déjà ouvert sur un autre appareil');
  // Nouveau tirage : à ouvrir de nouveau
  await admin('POST', `${A}/reset-draw`, {});
  await admin('POST', `${A}/draw`, {});
  assert.equal((await laptop('GET', url)).json.giftOpened, false, 'nouveau tirage : nouveau cadeau');
  // Cadeau vu pendant l'ancien tirage (refait pendant l'animation) : le nouveau reste à ouvrir.
  const now = (await laptop('GET', url)).json.group.drawnAt;
  assert.equal((await laptop('POST', `${url}/gift-opened`, { drawnAt: 'ancien' })).status, 409);
  assert.equal((await laptop('GET', url)).json.giftOpened, false);
  assert.equal((await laptop('POST', `${url}/gift-opened`, { drawnAt: now })).status, 200);
  assert.equal((await phone('GET', url)).json.giftOpened, true);
});

test('création : la date limite de la liste de souhaits est enregistrée tout de suite', async () => {
  const d = device();
  const res = await d('POST', '/api/groups', { name: 'Noël', eventDate: '2026-12-19', wishlistDeadline: '2026-11-29', participants: ['Ana', 'Ben', 'Cid'] });
  assert.equal(res.status, 201);
  assert.equal((await d('GET', `/api/admin/${res.json.adminToken}`)).json.group.wishlistDeadline, '2026-11-29');
});

test('« Je suis l’organisateur » depuis le lien du groupe, avec le code organisateur', async () => {
  const d = device();
  const created = await d('POST', '/api/groups', { name: 'Secret Santa', participants: ['Ana', 'Ben', 'Cid'], adminCode: '246810' });
  assert.equal(created.status, 201);
  const A = `/api/admin/${created.json.adminToken}`;
  const view = (await d('GET', A)).json;
  assert.equal(view.hasAdminCode, true);
  const invite = view.inviteToken;
  const G = `/api/g/${invite}/organisateur`;
  // Rien sur le code dans la page du groupe
  assert.ok(!/admin|code/i.test(JSON.stringify((await device()('GET', `/api/g/${invite}`)).json.group)));
  // Format : chiffres uniquement
  assert.equal((await device()('POST', G, { code: 'abcd' })).status, 400);
  // Bon code : accès organisateur propre à cet appareil
  const ok = await device()('POST', G, { code: '246810' });
  assert.equal(ok.status, 200);
  assert.match(ok.json.adminToken, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(ok.json.adminToken, created.json.adminToken);
  const viaCode = (await device()('GET', `/api/admin/${ok.json.adminToken}`)).json;
  assert.equal(viaCode.inviteToken, invite, 'même groupe');
  assert.equal((await device()('GET', A)).status, 200, 'le lien organisateur d’origine marche toujours');
  // Mauvais codes : avertissement puis blocage, même avec le bon code
  const bad = device();
  for (let i = 0; i < 2; i++) assert.equal((await bad('POST', G, { code: '000000' })).json.error, 'Code incorrect.');
  assert.match((await bad('POST', G, { code: '000001' })).json.error, /Encore 2 essais/);
  await bad('POST', G, { code: '000002' });
  const locked = await bad('POST', G, { code: '000003' });
  assert.equal(locked.status, 429);
  assert.equal((await bad('POST', G, { code: '246810' })).status, 429, 'bloqué même avec le bon code');
  clock += 5 * 60 * 1000 + 1;
  assert.equal((await bad('POST', G, { code: '246810' })).status, 200);
  // L'organisateur change le code depuis ses paramètres
  assert.equal((await d('PATCH', A, { adminCode: '2468' })).status, 200);
  assert.equal((await device()('POST', G, { code: '246810' })).status, 401);
  assert.equal((await device()('POST', G, { code: '2468' })).status, 200);
  // Groupe sans code organisateur : message clair
  const plain = await createGroup(['Dee', 'Eve', 'Fox']);
  assert.equal((await device()('POST', `/api/g/${plain.view.inviteToken}/organisateur`, { code: '1234' })).status, 409);
});

test('adresse courte du lien de groupe (ex. /noel) choisie par l’organisateur', async () => {
  const { admin, adminToken, view } = await createGroup();
  const other = await createGroup(['Eve', 'Fred', 'Gus']);
  const A = `/api/admin/${adminToken}/short-name`;
  const go = (url) => fetch(baseUrl + url, { redirect: 'manual' });
  // Pas encore choisie : page introuvable
  assert.equal((await go('/noel')).status, 404);
  // Formats refusés, noms réservés refusés
  for (const bad of ['ab', 'Noël', 'no el', '-noel', 'admin', 'api', 'x'.repeat(31)]) {
    assert.equal((await admin('PUT', A, { shortName: bad })).status, 400, bad);
  }
  // Seul l'organisateur peut la choisir
  assert.equal((await device()('PUT', '/api/admin/abcdefghijklmnopqrstuvwx/short-name', { shortName: 'noel' })).status, 404);
  const set = await admin('PUT', A, { shortName: 'Noel' });
  assert.equal(set.status, 200);
  assert.equal(set.json.shortName, 'noel', 'en minuscules');
  // Redirection vers le lien du groupe, avec ou sans « / » final, majuscules comprises
  for (const url of ['/noel', '/noel/']) {
    const res = await go(url);
    assert.equal(res.status, 302, url);
    assert.equal(res.headers.get('location'), `/g/${view.inviteToken}`);
  }
  assert.equal((await go('/NOEL')).status, 404, 'adresse en minuscules uniquement');
  // Déjà prise par un autre groupe
  assert.equal((await other.admin('PUT', `/api/admin/${other.adminToken}/short-name`, { shortName: 'noel' })).status, 409);
  // Les autres pages ne sont pas touchées
  assert.equal((await go('/healthz')).status, 200);
  assert.equal((await go('/')).status, 200);
  // Retirer l'adresse courte
  assert.equal((await admin('PUT', A, { shortName: '' })).json.shortName, null);
  assert.equal((await go('/noel')).status, 404);
});
