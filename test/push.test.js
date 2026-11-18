import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createECDH, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { testStore, trackAwaits, reopenableTarget, tempDir } from './helpers.js';
import { createStore } from '../src/store.js';
import { createApp } from '../src/app.js';
import { createNotifier, loadVapidKeys } from '../src/push.js';

const require = createRequire(import.meta.url);
const ece = require('http_ece'); // bibliothèque indépendante pour vérifier le chiffrement
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Faux service de notifications (comme ceux de Google/Apple) qui déchiffre ce qu'il reçoit. */
async function fakePushService() {
  const received = [];
  let status = 201;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(status); res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, received, url: `http://127.0.0.1:${server.address().port}`, setStatus: (s) => { status = s; } };
}

function newBrowserKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}

async function setup() {
  let clock = 1_700_000_000_000;
  const store = await testStore({ now: () => clock });
  const awaited = trackAwaits(store);
  const push = await fakePushService();
  const vapid = await loadVapidKeys({ store, dataDir: mkdtempSync(path.join(tmpdir(), 'vapid-')), env: {} });
  // En production l'abonnement doit être en https : ici on remplace l'adresse par le faux service.
  const sent = [];
  const notifier = createNotifier({
    store: awaited.proxy, vapid, subject: 'mailto:test@example.com', logger: { error() {} }, now: () => clock,
    // Même chiffrement et même signature qu'en production (generateRequestDetails de web-push),
    // mais envoyé en HTTP simple au faux service local.
    send: async (sub, body, options) => {
      const webpush = (await import('web-push')).default;
      sent.push({ sub, body });
      const details = webpush.generateRequestDetails(sub, body, options);
      const res = await fetch(details.endpoint.replace('https://push.example', push.url), { method: details.method, headers: details.headers, body: details.body });
      if (res.status >= 400) throw Object.assign(new Error('push'), { statusCode: res.status });
      return res;
    },
  });
  const server = http.createServer(createApp({ store: awaited.proxy, publicDir, logger: { error() {} }, notifier, limits: { groupCreation: { max: 1e6 }, auth: { max: 1e6 } } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, cookie) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
    return { status: res.status, json: await res.json().catch(() => null), cookie: res.headers.getSetCookie()[0]?.split(';')[0] };
  };
  const close = async () => {
    await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => push.server.close(r))]);
    await store.close();
    // Oublier un await sur le store est une faille : on le vérifie à chaque test.
    assert.ok(awaited.pending.size === 0, [...awaited.pending].map((e) => `${e.name} : ${e.stack}`).join('\n'));
  };
  return { store, push, call, close, sent, advance: (ms) => { clock += ms; } };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('notifications : chiffrées, sans contenu, au bon destinataire, avec limite de fréquence', async () => {
  const { push, call, close, advance } = await setup();
  try {
    assert.match((await call('GET', '/api/push/key')).json.publicKey, /^[A-Za-z0-9_-]{80,}$/);
    const { adminToken } = (await call('POST', '/api/groups', { name: 'N', participants: ['Ana', 'Ben', 'Cy'] })).json;
    const view = (await call('GET', `/api/admin/${adminToken}`)).json;
    const people = {};
    for (const p of view.participants) {
      const { cookie } = await call('POST', `/api/p/${p.token}/setup`, { code: '1234' });
      const k = newBrowserKeys();
      const subscription = { endpoint: `https://push.example/${p.name}`, keys: k.keys };
      assert.equal((await call('POST', `/api/p/${p.token}/push`, { subscription }, cookie)).status, 200);
      people[p.name] = { ...p, cookie, k };
    }
    // Abonnement invalide refusé ; sans session refusé
    assert.equal((await call('POST', `/api/p/${people.Ana.token}/push`, { subscription: { endpoint: 'http://x', keys: people.Ana.k.keys } }, people.Ana.cookie)).status, 400);
    assert.equal((await call('POST', `/api/p/${people.Ana.token}/push`, { subscription: { endpoint: 'https://push.example/z', keys: people.Ana.k.keys } })).status, 401);

    // Tirage : tout le monde est prévenu
    await call('POST', `/api/admin/${adminToken}/draw`, {});
    await wait(300);
    assert.equal(push.received.length, 3);
    const decrypt = (rec, who) => JSON.parse(ece.decrypt(rec.body, { version: 'aes128gcm', privateKey: who.k.ecdh, authSecret: who.k.auth.toString('base64url') }).toString());
    for (const rec of push.received) {
      const who = people[rec.path.slice(1)];
      const msg = decrypt(rec, who);
      assert.equal(msg.title, '🎲 Le tirage a eu lieu !');
      assert.equal(msg.url, `/p/${who.token}`);
      assert.match(rec.headers.authorization, /^vapid t=/);
    }
    push.received.length = 0;

    // Ana écrit à la personne à qui elle offre : seule cette personne est prévenue, sans le texte ni le nom d'Ana
    const ana = (await call('GET', `/api/p/${people.Ana.token}`, undefined, people.Ana.cookie)).json;
    const target = people[ana.recipient.name];
    await call('POST', `/api/p/${people.Ana.token}/messages`, { conv: 'recipient', body: 'SECRET-CONTENU' }, people.Ana.cookie);
    await wait(300);
    assert.equal(push.received.length, 1);
    assert.equal(push.received[0].path, `/${ana.recipient.name}`);
    const raw = decrypt(push.received[0], target);
    assert.equal(raw.title, "🎅 Ton Père Noël secret t'a écrit !");
    assert.equal(raw.url, `/p/${target.token}?ouvrir=pere-noel`);
    const text = JSON.stringify(raw);
    assert.ok(!text.includes('SECRET-CONTENU') && !text.includes('Ana'), 'ni contenu ni nom du Père Noël');
    assert.ok(!push.received[0].body.includes(Buffer.from('SECRET')), 'contenu chiffré sur le réseau');

    // Limite : un 2e message dans la minute ne renvoie pas de notification
    await call('POST', `/api/p/${people.Ana.token}/messages`, { conv: 'recipient', body: 'encore' }, people.Ana.cookie);
    await wait(200);
    assert.equal(push.received.length, 1);
    advance(61_000);
    await call('POST', `/api/p/${people.Ana.token}/messages`, { conv: 'recipient', body: 'encore 2' }, people.Ana.cookie);
    await wait(300);
    assert.equal(push.received.length, 2);

    // La réponse va au Père Noël, avec le prénom de celui qui répond (le Père Noël le connaît)
    push.received.length = 0;
    await call('POST', `/api/p/${target.token}/messages`, { conv: 'santa', body: 'merci' }, target.cookie);
    await wait(300);
    assert.equal(push.received.length, 1);
    assert.equal(push.received[0].path, '/Ana');
    assert.equal(decrypt(push.received[0], people.Ana).title, '🎁 Tu as une réponse !');
    assert.ok(!JSON.stringify(decrypt(push.received[0], people.Ana)).includes(ana.recipient.name), 'aucun prénom sur l’écran verrouillé');

    // Abonnement expiré (410) : oublié automatiquement
    push.received.length = 0;
    push.setStatus(410);
    await call('POST', `/api/admin/${adminToken}/reveal`, { revealed: true });
    await wait(300);
    push.setStatus(201);
    await call('POST', `/api/admin/${adminToken}/reveal`, { revealed: true });
    await wait(300);
    assert.equal(push.received.length, 3, 'les 3 envois en 410');

    // Désabonnement
    const ben = people.Ben;
    await call('POST', `/api/p/${ben.token}/push`, { subscription: { endpoint: 'https://push.example/Ben', keys: ben.k.keys } }, ben.cookie);
    assert.equal((await call('DELETE', `/api/p/${ben.token}/push`, { endpoint: 'https://push.example/Ben' }, ben.cookie)).status, 200);
  } finally {
    await close();
  }
});

test('réinitialiser un code supprime les abonnements de cet appareil', async () => {
  const { store, call, close } = await setup();
  try {
    const { adminToken } = (await call('POST', '/api/groups', { name: 'N', participants: ['Dee', 'Eve', 'Fay'] })).json;
    const view = (await call('GET', `/api/admin/${adminToken}`)).json;
    const p = view.participants[0];
    const { cookie } = await call('POST', `/api/p/${p.token}/setup`, { code: '1234' });
    await call('POST', `/api/p/${p.token}/push`, { subscription: { endpoint: 'https://push.example/Dee', keys: newBrowserKeys().keys } }, cookie);
    assert.equal((await store.pushTargets(p.id)).length, 1);
    await call('POST', `/api/admin/${adminToken}/participants/${p.id}/reset-code`, {});
    assert.equal((await store.pushTargets(p.id)).length, 0);
  } finally {
    await close();
  }
});

test('clés des notifications : environnement, sinon gardées en base (le disque de Render est effacé)', async () => {
  const env = { VAPID_PUBLIC_KEY: 'pub-env', VAPID_PRIVATE_KEY: 'priv-env' };
  const target = await reopenableTarget();
  let store = await createStore(target);
  assert.deepEqual(await loadVapidKeys({ store, dataDir: tempDir(), env }), { publicKey: 'pub-env', privateKey: 'priv-env' });
  assert.equal(await store.getSetting('vapid'), null, 'les clés de l\'environnement ne sont pas recopiées');

  // Ancien fichier vapid.json (installation Docker existante) : repris dans la base.
  const oldDir = tempDir();
  const old = { publicKey: 'pub-fichier', privateKey: 'priv-fichier' };
  writeFileSync(path.join(oldDir, 'vapid.json'), JSON.stringify(old));
  assert.deepEqual(await loadVapidKeys({ store, dataDir: oldDir, env: {} }), old);
  await store.close();

  // Redémarrage sur un disque vide : mêmes clés, lues dans la base.
  store = await createStore(target);
  assert.deepEqual(await loadVapidKeys({ store, dataDir: tempDir(), env: {} }), old);
  assert.deepEqual(await loadVapidKeys({ store, dataDir: null, env: {} }), old);
  await store.close();

  // Base neuve, pas de fichier : nouvelles clés, créées une seule fois même en parallèle.
  const target2 = await reopenableTarget();
  store = await createStore(target2);
  const broken = tempDir();
  writeFileSync(path.join(broken, 'vapid.json'), '{pas du json');
  const [k1, k2] = await Promise.all([
    loadVapidKeys({ store, dataDir: broken, env: {} }),
    loadVapidKeys({ store, dataDir: null, env: {} }),
  ]);
  assert.deepEqual(k1, k2);
  assert.match(k1.publicKey, /^[A-Za-z0-9_-]{80,}$/);
  assert.match(k1.privateKey, /^[A-Za-z0-9_-]{40,}$/);
  await store.close();
  store = await createStore(target2);
  assert.deepEqual(await loadVapidKeys({ store, dataDir: null, env: {} }), k1, 'mêmes clés après redémarrage');
  await store.close();
});
