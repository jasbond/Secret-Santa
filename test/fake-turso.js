import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/**
 * Petit serveur qui parle comme Turso (protocole Hrana v2 sur HTTP, en JSON), avec
 * une vraie base SQLite derrière. Il sert à tester, sans compte ni Internet, le
 * client @libsql/client « en ligne » (celui utilisé avec libsql://…turso.io) :
 * requêtes, transactions (baton), BLOB, entiers, erreurs, jeton d'accès.
 * stallNext() : la prochaine requête reste sans réponse (connexion perdue) ; si elle
 * appartenait à une transaction, celle-ci est annulée, comme Turso le fait de lui-même.
 */
export async function startFakeTurso({ file, token = 'jeton-de-test' }) {
  const streams = new Map(); // baton → { db, sqls }
  let requests = 0;
  let stalls = 0;
  const stalled = []; // réponses jamais envoyées

  const toSqlite = (v) => {
    if (!v || v.type === 'null') return null;
    if (v.type === 'integer') return BigInt(v.value);
    if (v.type === 'float') return Number(v.value);
    if (v.type === 'text') return v.value;
    if (v.type === 'blob') return Buffer.from(v.base64 ?? '', 'base64');
    throw new Error(`valeur inconnue ${v.type}`);
  };
  const fromSqlite = (v) => {
    if (v === null || v === undefined) return { type: 'null' };
    if (typeof v === 'bigint') return { type: 'integer', value: String(v) };
    if (typeof v === 'number') return { type: 'float', value: v };
    if (typeof v === 'string') return { type: 'text', value: v };
    if (v instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(v).toString('base64').replace(/=+$/, '') };
    throw new Error('valeur SQLite inattendue');
  };
  const sqliteCodes = { 1: 'SQLITE_ERROR', 5: 'SQLITE_BUSY', 6: 'SQLITE_LOCKED', 19: 'SQLITE_CONSTRAINT' };
  const errorOf = (err) => ({ message: err.errstr ? `${err.errstr}: ${err.message}` : err.message, code: sqliteCodes[err.errcode] ?? 'SQLITE_ERROR' });

  function execute(stream, stmt) {
    const sql = stmt.sql ?? stream.sqls.get(stmt.sql_id);
    const s = stream.db.prepare(sql);
    s.setReadBigInts(true);
    const args = (stmt.args ?? []).map(toSqlite);
    const cols = s.columns();
    if (cols.length) {
      s.setReturnArrays(true);
      const rows = s.all(...args);
      return { cols: cols.map((c) => ({ name: c.name, decltype: c.type })), rows: rows.map((r) => r.map(fromSqlite)), affected_row_count: 0, last_insert_rowid: null };
    }
    const r = s.run(...args);
    return { cols: [], rows: [], affected_row_count: Number(r.changes), last_insert_rowid: String(r.lastInsertRowid) };
  }

  function evalCond(stream, cond, results, errors) {
    if (!cond) return true;
    switch (cond.type) {
      case 'ok': return results[cond.step] != null;
      case 'error': return errors[cond.step] != null;
      case 'not': return !evalCond(stream, cond.cond, results, errors);
      case 'and': return cond.conds.every((c) => evalCond(stream, c, results, errors));
      case 'or': return cond.conds.some((c) => evalCond(stream, c, results, errors));
      case 'is_autocommit': return !stream.db.isTransaction;
      default: throw new Error(`condition inconnue ${cond.type}`);
    }
  }

  function handle(stream, req) {
    switch (req.type) {
      case 'execute': return { type: 'execute', result: execute(stream, req.stmt) };
      case 'batch': {
        const results = [];
        const errors = [];
        req.batch.steps.forEach((step, i) => {
          results[i] = null;
          errors[i] = null;
          if (!evalCond(stream, step.condition, results, errors)) return;
          try {
            results[i] = execute(stream, step.stmt);
          } catch (err) {
            errors[i] = errorOf(err);
          }
        });
        return { type: 'batch', result: { step_results: results, step_errors: errors } };
      }
      case 'sequence': stream.db.exec(req.sql ?? stream.sqls.get(req.sql_id)); return { type: 'sequence' };
      case 'store_sql': stream.sqls.set(req.sql_id, req.sql); return { type: 'store_sql' };
      case 'close_sql': stream.sqls.delete(req.sql_id); return { type: 'close_sql' };
      case 'get_autocommit': return { type: 'get_autocommit', is_autocommit: !stream.db.isTransaction };
      case 'close': return { type: 'close' };
      default: throw new Error(`requête inconnue ${req.type}`);
    }
  }

  const closeStream = (baton) => {
    const stream = streams.get(baton);
    if (!stream) return;
    streams.delete(baton);
    if (stream.db.isTransaction) stream.db.exec('ROLLBACK');
    stream.db.close();
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const reply = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.headers.authorization !== `Bearer ${token}`) return reply(401, { message: 'Unauthorized' });
      if (req.method !== 'POST' || req.url !== '/v2/pipeline') return reply(404, { message: 'Not found' });
      requests += 1;
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (stalls > 0) {
        stalls -= 1;
        stalled.push(res);
        if (body.baton) closeStream(body.baton);
        return undefined;
      }
      let stream;
      if (body.baton) {
        stream = streams.get(body.baton);
        if (!stream) return reply(400, { message: 'Stream expired' });
        streams.delete(body.baton);
      } else {
        const db = new DatabaseSync(file);
        db.exec('PRAGMA busy_timeout = 5000');
        stream = { db, sqls: new Map() };
      }
      const results = [];
      let closed = false;
      for (const r of body.requests) {
        try {
          results.push({ type: 'ok', response: handle(stream, r) });
          if (r.type === 'close') closed = true;
        } catch (err) {
          results.push({ type: 'error', error: errorOf(err) });
        }
      }
      let baton = null;
      if (closed) {
        if (stream.db.isTransaction) stream.db.exec('ROLLBACK');
        stream.db.close();
      } else {
        baton = randomBytes(12).toString('hex');
        streams.set(baton, stream);
      }
      return reply(200, { baton, base_url: null, results });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    token,
    requests: () => requests,
    stallNext: () => { stalls += 1; },
    close: () => new Promise((resolve) => {
      for (const baton of [...streams.keys()]) closeStream(baton);
      for (const res of stalled) res.destroy();
      server.close(resolve);
      server.closeAllConnections();
    }),
  };
}
