import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Accès à la base, identique pour les deux moteurs :
 *  - « local » : fichier SQLite (node:sqlite), pour Docker / un serveur à soi ;
 *  - « libsql » : base Turso (gratuite, en ligne), pour un hébergeur sans disque (Render).
 *
 * Tout est asynchrone : exec(sql), get(sql, ...args), all(sql, ...args),
 * run(sql, ...args) → { changes, lastInsertRowid }, transaction(async (t) => …).
 * Les lignes sont des objets simples (nombres en Number, BLOB en Buffer).
 *
 * Une seule opération à la fois (verrou) : une transaction garde le verrou du BEGIN
 * au COMMIT, et les requêtes des autres visiteurs attendent leur tour. Sans ça, avec
 * node:sqlite (une seule connexion), la requête d'un autre visiteur s'exécuterait
 * au milieu de la transaction (et verrait, ou annulerait, un travail à moitié fait).
 */

const BUSY_RETRIES = 5;
// Délai maximal d'une requête vers Turso. Une requête sans réponse (connexion perdue)
// garderait le verrou, et tout le site attendrait avec elle (jusqu'à 5 min) : on
// l'abandonne avant. Large : une photo (3 Mo au plus) arrive bien plus vite.
const TURSO_TIMEOUT_MS = Number(process.env.TURSO_TIMEOUT_MS) || 15_000;

function createLock() {
  let tail = Promise.resolve();
  return async function withLock(fn) {
    let release;
    const turn = new Promise((resolve) => { release = resolve; });
    const previous = tail;
    tail = previous.then(() => turn);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Base occupée par une autre connexion (un autre serveur, ou Turso) : on peut réessayer. */
function isBusy(err) {
  const text = `${err?.code ?? ''} ${err?.rawCode ?? ''} ${err?.message ?? ''}`;
  return /SQLITE_BUSY|database is locked/i.test(text);
}

/** Valeur lue en base → même forme que node:sqlite (Number, Buffer pour les BLOB). */
function fromDb(value) {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return value;
}

function plainRow(row) {
  if (!row) return undefined;
  const out = {};
  for (const key of Object.keys(row)) out[key] = fromDb(row[key]);
  return out;
}

/**
 * Enveloppe commune : verrou, transactions, et requêtes lancées depuis l'intérieur
 * d'une transaction (même chaîne asynchrone) qui passent par la transaction au lieu
 * d'attendre le verrou (sinon interblocage).
 */
function wrap({ kind, direct, begin, close }) {
  const withLock = createLock();
  const current = new AsyncLocalStorage();
  const inTx = () => {
    const t = current.getStore();
    return t && t.open ? t : null;
  };

  const plain = (name) => (sql, ...args) => {
    const t = inTx();
    if (t) return t[name](sql, ...args);
    return withLock(() => direct[name](sql, ...args));
  };

  async function transaction(fn) {
    const outer = inTx();
    // Transaction imbriquée : elle fait partie de la transaction en cours.
    if (outer) return fn(outer);
    return withLock(async () => {
      for (let attempt = 1; ; attempt += 1) {
        let handle;
        try {
          handle = await begin();
        } catch (err) {
          if (isBusy(err) && attempt < BUSY_RETRIES) { await sleep(50 * attempt); continue; }
          throw err;
        }
        const t = { open: true };
        const guard = (name) => async (...a) => {
          if (!t.open) throw new Error('Transaction déjà terminée.');
          return handle[name](...a);
        };
        for (const name of ['exec', 'get', 'all', 'run']) t[name] = guard(name);
        try {
          const result = await current.run(t, () => fn(t));
          t.open = false;
          await handle.commit();
          return result;
        } catch (err) {
          t.open = false;
          try {
            await handle.rollback();
          } catch {
            // L'erreur d'origine est plus utile que celle de l'annulation.
          }
          if (isBusy(err) && attempt < BUSY_RETRIES) { await sleep(50 * attempt); continue; }
          throw err;
        }
      }
    });
  }

  return {
    kind,
    exec: plain('exec'),
    get: plain('get'),
    all: plain('all'),
    run: plain('run'),
    transaction,
    close: () => withLock(close),
  };
}

// ---------------------------------------------------------------------------
// Fichier SQLite local (node:sqlite)
// ---------------------------------------------------------------------------

export function openLocal(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename);
  if (filename !== ':memory:') sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = sqlite.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  const ops = {
    exec: async (sql) => { sqlite.exec(sql); },
    get: async (sql, ...args) => plainRow(stmt(sql).get(...args)),
    all: async (sql, ...args) => stmt(sql).all(...args).map(plainRow),
    run: async (sql, ...args) => {
      const r = stmt(sql).run(...args);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
  };
  return wrap({
    kind: 'local',
    direct: ops,
    begin: async () => {
      sqlite.exec('BEGIN IMMEDIATE');
      return {
        ...ops,
        commit: async () => sqlite.exec('COMMIT'),
        rollback: async () => {
          // Toujours tenter le ROLLBACK (isTransaction n'existe qu'à partir de Node 22.16) :
          // une transaction restée ouverte ferait échouer toutes les suivantes.
          try { sqlite.exec('ROLLBACK'); } catch { /* aucune transaction ouverte (SQLite l'a déjà annulée) */ }
        },
      };
    },
    close: async () => sqlite.close(),
  });
}

// ---------------------------------------------------------------------------
// Turso / libSQL (@libsql/client) : libsql://, https:// … ou file: (pour les tests)
// ---------------------------------------------------------------------------

/** Les entiers partent comme des entiers (sinon libSQL les enverrait en nombres à virgule). */
const toDb = (v) => (Number.isSafeInteger(v) ? BigInt(v) : v);

function rowsOf(rs) {
  return rs.rows.map((row) => {
    const out = {};
    rs.columns.forEach((name, i) => { out[name] = fromDb(row[i]); });
    return out;
  });
}

export async function openLibsql({ url, authToken, timeoutMs = TURSO_TIMEOUT_MS }) {
  // En ligne : client 100 % JavaScript (rien à compiler dans l'image Docker).
  // file: : client avec SQLite intégré, pour essayer ce moteur sans compte Turso.
  const { createClient } = url.startsWith('file:')
    ? await import('@libsql/client')
    : await import('@libsql/client/web');
  // Chaque requête HTTP vers Turso a une limite de temps (voir TURSO_TIMEOUT_MS) : en
  // échec, la transaction est annulée et le verrou rendu aux autres visiteurs.
  const fetchWithTimeout = (input, init = {}) => {
    const limit = AbortSignal.timeout(timeoutMs);
    return fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, limit]) : limit });
  };
  const client = createClient({ url, authToken, intMode: 'number', ...(url.startsWith('file:') ? {} : { fetch: fetchWithTimeout }) });

  const opsOn = (target) => ({
    exec: async (sql) => { await target.executeMultiple(sql); },
    get: async (sql, ...args) => rowsOf(await target.execute({ sql, args: args.map(toDb) }))[0],
    all: async (sql, ...args) => rowsOf(await target.execute({ sql, args: args.map(toDb) })),
    run: async (sql, ...args) => {
      const rs = await target.execute({ sql, args: args.map(toDb) });
      return { changes: rs.rowsAffected, lastInsertRowid: Number(rs.lastInsertRowid ?? 0) };
    },
  });

  // Hors transaction : une requête refusée car la base est occupée n'a rien fait, on réessaie.
  const base = opsOn(client);
  const direct = {};
  for (const [name, fn] of Object.entries(base)) {
    direct[name] = async (...a) => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await fn(...a);
        } catch (err) {
          if (!isBusy(err) || attempt >= BUSY_RETRIES) throw err;
          await sleep(50 * attempt);
        }
      }
    };
  }

  const db = wrap({
    kind: 'libsql',
    direct,
    begin: async () => {
      const tx = await client.transaction('write');
      let closed = false;
      const end = () => { if (!closed) { closed = true; tx.close(); } };
      return {
        ...opsOn(tx),
        commit: async () => { try { await tx.commit(); } finally { end(); } },
        rollback: async () => {
          try {
            if (!tx.closed) await tx.rollback();
          } catch {
            // Connexion perdue : Turso annule de lui-même la transaction.
          } finally {
            end();
          }
        },
      };
    },
    close: async () => client.close(),
  });
  // Vérifie tout de suite l'adresse et le jeton (message clair au démarrage).
  await db.get('SELECT 1 AS ok');
  return db;
}

/** Turso si une adresse est donnée, sinon fichier local (ou base en mémoire). */
export async function openDatabase({ url, authToken, file, timeoutMs } = {}) {
  if (url) return openLibsql({ url, authToken, timeoutMs });
  return openLocal(file ?? ':memory:');
}
