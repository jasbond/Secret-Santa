import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { openDatabase } from '../src/db.js';
import { createStore, HttpError } from '../src/store.js';
import { backend, fakeTurso, tempDir, tempLibsqlUrl, testStore } from './helpers.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Les mêmes vérifications pour chaque moteur.
const engines = {
  'node:sqlite en mémoire': () => openDatabase(),
  'node:sqlite (fichier)': () => openDatabase({ file: path.join(tempDir(), 'a.sqlite') }),
  'libSQL (fichier, même client que Turso)': () => openDatabase({ url: tempLibsqlUrl() }),
  'libSQL en ligne (faux serveur Turso)': async () => openDatabase((await fakeTurso()).target),
};

const SETUP = 'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, n INTEGER, s TEXT, b BLOB); CREATE TABLE c (k TEXT PRIMARY KEY, v INTEGER NOT NULL);';

test('le moteur choisi pour les tests est bien celui demandé', async () => {
  const store = await testStore();
  assert.equal(store.db.kind, backend === 'local' ? 'local' : 'libsql');
  await store.close();
});

for (const [label, open] of Object.entries(engines)) {
  test(`${label} : lignes, nombres, BLOB`, async () => {
    const db = await open();
    await db.exec(SETUP);
    const blob = Buffer.from([0xff, 0xd8, 0xff, 0, 1, 2, 250]);
    const r1 = await db.run('INSERT INTO t (n, s, b) VALUES (?, ?, ?)', 1_700_000_000_123, 'élan ✨', blob);
    assert.deepEqual(r1, { changes: 1, lastInsertRowid: 1 });
    const r2 = await db.run('INSERT INTO t (n, s, b) VALUES (?, ?, ?)', 2, null, null);
    assert.equal(r2.lastInsertRowid, 2);
    const row = await db.get('SELECT * FROM t WHERE id = ?', 1);
    assert.deepEqual({ ...row, b: null }, { id: 1, n: 1_700_000_000_123, s: 'élan ✨', b: null });
    assert.ok(Buffer.isBuffer(row.b), 'BLOB rendu en Buffer');
    assert.ok(row.b.equals(blob));
    assert.equal(typeof row.n, 'number');
    assert.equal(typeof (await db.get('SELECT n FROM t WHERE id = 2')).n, 'number');
    assert.equal(await db.get('SELECT * FROM t WHERE id = ?', 99), undefined);
    const rows = await db.all('SELECT id, b IS NOT NULL AS has_b FROM t ORDER BY id');
    assert.deepEqual(rows.map((r) => ({ ...r })), [{ id: 1, has_b: 1 }, { id: 2, has_b: 0 }]);
    assert.equal((await db.run('UPDATE t SET s = ? WHERE id > ?', 'x', 0)).changes, 2);
    // Un entier passé en paramètre reste un entier (LIMIT refuse les nombres à virgule).
    assert.equal((await db.all('SELECT id FROM t ORDER BY id LIMIT ?', 1)).length, 1);
    if (db.kind === 'libsql') assert.equal((await db.get('SELECT typeof(?) AS ty', 5)).ty, 'integer');
    await db.close();
  });

  test(`${label} : transaction validée ou annulée en entier`, async () => {
    const db = await open();
    await db.exec(SETUP);
    const out = await db.transaction(async (t) => {
      await t.run('INSERT INTO t (n) VALUES (?)', 1);
      await t.run('INSERT INTO t (n) VALUES (?)', 2);
      return (await t.get('SELECT COUNT(*) AS n FROM t')).n;
    });
    assert.equal(out, 2);
    await assert.rejects(db.transaction(async (t) => {
      await t.run('INSERT INTO t (n) VALUES (?)', 3);
      throw new HttpError(409, 'non');
    }), /non/);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM t')).n, 2, 'annulée');
    // Erreur SQL au milieu : annulée aussi.
    await assert.rejects(db.transaction(async (t) => {
      await t.run('INSERT INTO t (n) VALUES (?)', 4);
      await t.run('INSERT INTO pas_de_table VALUES (1)');
    }));
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM t')).n, 2);
    // La transaction terminée ne peut plus servir.
    let saved;
    await db.transaction(async (t) => { saved = t; });
    await assert.rejects(saved.get('SELECT 1'), /Transaction déjà terminée/);
    // La base reste utilisable après tout ça.
    await db.run('INSERT INTO t (n) VALUES (?)', 5);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM t')).n, 3);
    await db.close();
  });

  test(`${label} : une seule opération à la fois (rien ne s'intercale dans une transaction)`, async () => {
    const db = await open();
    await db.exec(SETUP);
    const seen = [];
    const slow = db.transaction(async (t) => {
      await t.run('INSERT INTO t (n) VALUES (?)', 1);
      await sleep(40); // pendant ce temps, d'autres requêtes arrivent
      await t.run('INSERT INTO t (n) VALUES (?)', 2);
    });
    const reader = (async () => { seen.push((await db.get('SELECT COUNT(*) AS n FROM t')).n); })();
    const failing = db.transaction(async (t) => {
      await t.run('INSERT INTO t (n) VALUES (?)', 3);
      await sleep(20);
      throw new Error('annule');
    });
    const reader2 = (async () => { seen.push((await db.get('SELECT COUNT(*) AS n FROM t')).n); })();
    await Promise.all([slow, reader, failing.catch(() => {}), reader2]);
    assert.deepEqual(seen, [2, 2], 'jamais un état à moitié écrit, ni une écriture annulée');
    await db.close();
  });

  test(`${label} : lire-vérifier-écrire en parallèle sans perte`, async () => {
    const db = await open();
    await db.exec(SETUP);
    await db.run("INSERT INTO c (k, v) VALUES ('x', 0)");
    await Promise.all(Array.from({ length: 25 }, () => db.transaction(async (t) => {
      const { v } = await t.get("SELECT v FROM c WHERE k = 'x'");
      await sleep(1);
      await t.run("UPDATE c SET v = ? WHERE k = 'x'", v + 1);
    })));
    assert.equal((await db.get("SELECT v FROM c WHERE k = 'x'")).v, 25);
    await db.close();
  });

  test(`${label} : requête ordinaire ou transaction imbriquée depuis une transaction (pas d'interblocage)`, async () => {
    const db = await open();
    await db.exec(SETUP);
    const result = await Promise.race([
      db.transaction(async (t) => {
        await t.run('INSERT INTO t (n) VALUES (?)', 7);
        // Appel « ordinaire » par oubli : il passe par la transaction en cours.
        const inside = (await db.get('SELECT COUNT(*) AS n FROM t')).n;
        await db.transaction(async (t2) => { await t2.run('INSERT INTO t (n) VALUES (?)', 8); });
        return inside;
      }),
      sleep(2000).then(() => 'bloqué'),
    ]);
    assert.equal(result, 1);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM t')).n, 2);
    // Une imbrication qui échoue annule toute la transaction.
    await assert.rejects(db.transaction(async () => {
      await db.run('INSERT INTO t (n) VALUES (?)', 9);
      await db.transaction(async () => { throw new Error('dedans'); });
    }), /dedans/);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM t')).n, 2);
    await db.close();
  });
}

test('migration : une base existante est reprise (fichier local puis réouverture)', async () => {
  const file = path.join(tempDir(), 'santa.sqlite');
  const s1 = await createStore(file);
  const { adminToken } = await s1.createGroup({ name: 'G', participants: ['A', 'B', 'C'] });
  await s1.initSetting('k', 'v1');
  await s1.close();
  const s2 = await createStore(file);
  const g = await s2.groupByAdminToken(adminToken);
  assert.equal((await s2.adminView(g)).participants.length, 3);
  assert.equal(await s2.initSetting('k', 'v2'), 'v1', 'un réglage enregistré ne change plus');
  assert.equal(await s2.getSetting('absent'), null);
  await s2.close();
});

test('libSQL : la base persiste entre deux démarrages (comme Turso)', async () => {
  const url = tempLibsqlUrl();
  const s1 = await createStore({ url });
  const { adminToken } = await s1.createGroup({ name: 'G', participants: ['A', 'B', 'C'] });
  await s1.close();
  const s2 = await createStore({ url });
  assert.equal((await s2.adminView(await s2.groupByAdminToken(adminToken))).participants.length, 3);
  await s2.close();
});

test('supprimer un groupe ou un participant efface tout ce qui le concerne', async () => {
  const store = await testStore();
  const { adminToken } = await store.createGroup({ name: 'G', participants: ['Ana', 'Ben', 'Cy', 'Dee'] });
  const group = await store.groupByAdminToken(adminToken);
  const people = (await store.adminView(group)).participants;
  const dee = people.find((p) => p.name === 'Dee');
  const ana = people.find((p) => p.name === 'Ana');
  await store.addExclusion(group, dee.id, ana.id);
  const deeRow = await store.participantByToken(dee.token);
  await store.enter(deeRow, '1234');
  await store.savePushSubscription(deeRow, { endpoint: 'https://push.example/dee', keys: { p256dh: 'abc', auth: 'def' } });
  await store.removeParticipant(group, dee.id);
  for (const table of ['sessions', 'push_subscriptions', 'exclusions']) {
    assert.equal((await store.db.get(`SELECT COUNT(*) AS n FROM ${table}`)).n, 0, table);
  }
  await store.draw(group);
  const anaRow = await store.participantByToken(ana.token);
  await store.enter(anaRow, '1234');
  await store.postMessage(anaRow, 'recipient', 'coucou');
  await store.markRead(anaRow, 'recipient', 1);
  await store.setRevealed(group, true);
  await store.setAlbumNote(anaRow, 'merci');
  await store.deleteGroup(group);
  for (const table of ['groups', 'participants', 'sessions', 'assignments', 'exclusions', 'messages', 'reads', 'album_entries', 'push_subscriptions']) {
    assert.equal((await store.db.get(`SELECT COUNT(*) AS n FROM ${table}`)).n, 0, table);
  }
  await store.close();
});

test('entrées simultanées : compteur d\'essais exact, un seul premier code', async () => {
  let clock = 1_700_000_000_000;
  const store = await testStore({ now: () => clock });
  const { adminToken } = await store.createGroup({ name: 'G', participants: ['Ana', 'Ben', 'Cy'] });
  const [ana, ben] = (await store.adminView(await store.groupByAdminToken(adminToken))).participants;
  // Deux appareils choisissent un premier code en même temps : un seul est enregistré.
  const benRow = await store.participantByToken(ben.token);
  const firsts = await Promise.allSettled([store.enter(benRow, '1111'), store.enter(benRow, '2222')]);
  const created = firsts.filter((r) => r.status === 'fulfilled' && r.value.created);
  assert.equal(created.length, 1);
  const loser = firsts.find((r) => !(r.status === 'fulfilled' && r.value.created));
  assert.equal(loser.status, 'rejected');
  assert.equal(loser.reason.status, 401, 'l\'autre code est vérifié (et compté comme un essai)');
  // Cinq mauvais codes en même temps : tous comptés, blocage au 5e.
  const anaRow = await store.participantByToken(ana.token);
  await store.enter(anaRow, '424242');
  const tries = await Promise.allSettled(Array.from({ length: 5 }, () => store.enter(anaRow, '000000')));
  const statuses = tries.map((r) => r.reason?.status).sort();
  assert.deepEqual(statuses, [401, 401, 401, 401, 429]);
  const row = await store.db.get('SELECT failed_attempts, locked_until FROM participants WHERE id = ?', ana.id);
  assert.equal(row.failed_attempts, 5);
  assert.equal(row.locked_until, clock + 5 * 60 * 1000);
  // Bloqué : même le bon code est refusé, sans changer le compteur.
  await assert.rejects(store.enter(anaRow, '424242'), (err) => err.status === 429);
  clock += 5 * 60 * 1000 + 1;
  const ok = await store.enter(anaRow, '424242');
  assert.equal(ok.failedAttempts, 5, 'la personne est prévenue des essais ratés');
  assert.equal((await store.db.get('SELECT failed_attempts FROM participants WHERE id = ?', ana.id)).failed_attempts, 0);
  await store.close();
});

test('tirages et modifications simultanés : un seul tirage, liste figée', async () => {
  const store = await testStore();
  const { adminToken } = await store.createGroup({ name: 'G', participants: ['Ana', 'Ben', 'Cy', 'Dee'] });
  const group = await store.groupByAdminToken(adminToken);
  const results = await Promise.allSettled([
    store.addParticipant(group, 'Eve'), store.draw(group), store.draw(group), store.addParticipant(group, 'Fay'), store.draw(group),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2, 'un tirage + l\'ajout passé avant');
  const n = (await store.adminView(group)).participants.length;
  assert.equal((await store.db.get('SELECT COUNT(*) AS n FROM assignments')).n, n, 'chacun a exactement un destinataire');
  await assert.rejects(store.addParticipant(group, 'Zoé'), /tirage a déjà eu lieu/);
  // Le fuseau horaire reste figé après le tirage, même avec un groupe lu avant.
  await store.updateGroup(group, { timeZone: 'Pacific/Tahiti' });
  assert.equal((await store.db.get('SELECT time_zone FROM groups')).time_zone, '');
  await store.close();
});

test('Turso : adresse ou jeton faux → erreur claire dès l\'ouverture', async () => {
  const turso = await fakeTurso();
  await assert.rejects(openDatabase({ url: turso.url, authToken: 'mauvais' }), /401|Unauthorized|auth/i);
  await assert.rejects(openDatabase({ url: 'pas-une-adresse', authToken: 'x' }));
  const db = await openDatabase(turso.target);
  assert.equal((await db.get('SELECT 41 + 1 AS n')).n, 42);
  await db.close();
  await turso.close();
});

test('Turso : une requête sans réponse est abandonnée, le site n\'attend pas avec elle', async () => {
  const turso = await fakeTurso();
  const db = await openDatabase({ ...turso.target, timeoutMs: 300 });
  try {
    await db.exec(SETUP);
    await db.run('INSERT INTO t (n) VALUES (?)', 1);
    // Garde-fou : sans limite de temps, tout resterait bloqué ~5 min (verrou unique).
    const within = (p) => Promise.race([p, sleep(5000).then(() => { throw new Error('bloqué'); })]);

    // Requête simple perdue : elle échoue vite, celle d'un autre visiteur passe ensuite.
    turso.stallNext();
    const lost = db.get('SELECT COUNT(*) AS n FROM t');
    const other = db.get('SELECT COUNT(*) AS n FROM t');
    const started = Date.now();
    await assert.rejects(within(lost), (err) => err.message !== 'bloqué');
    assert.equal((await within(other)).n, 1);
    assert.ok(Date.now() - started < 3000, 'abandonnée au bout de la limite');

    // Requête perdue au milieu d'une transaction : annulée en entier, verrou rendu.
    await assert.rejects(within(db.transaction(async (t) => {
      await t.run('INSERT INTO t (n) VALUES (?)', 2);
      turso.stallNext();
      await t.run('INSERT INTO t (n) VALUES (?)', 3);
    })), (err) => err.message !== 'bloqué');
    assert.equal((await within(db.get('SELECT COUNT(*) AS n FROM t'))).n, 1, 'rien d\'écrit à moitié');
    await within(db.transaction(async (t) => { await t.run('INSERT INTO t (n) VALUES (?)', 4); }));
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM t')).n, 2, 'les écritures suivantes passent');
  } finally {
    await turso.close(); // coupe aussi les requêtes restées sans réponse
    await db.close();
  }
});

test('node:sqlite : l\'annulation ne dépend pas d\'API récentes (Node 22.13 annule aussi)', async () => {
  // isTransaction n'existe qu'à partir de Node 22.16 : sur 22.13–22.15 il vaut undefined,
  // l'annulation n'aurait jamais lieu et toutes les transactions suivantes échoueraient.
  const source = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.isTransaction\b/);
  const db = await openDatabase();
  await db.exec(SETUP);
  await assert.rejects(db.transaction(async (t) => {
    await t.run('INSERT INTO t (n) VALUES (?)', 1);
    throw new HttpError(409, 'refusé');
  }), /refusé/);
  await db.transaction(async (t) => { await t.run('INSERT INTO t (n) VALUES (?)', 2); });
  assert.deepEqual((await db.all('SELECT n FROM t')).map((r) => r.n), [2]);
  await db.close();
});
