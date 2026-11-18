import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStore } from '../src/store.js';
import { startFakeTurso } from './fake-turso.js';

/**
 * Moteur utilisé par les tests (npm test : node:sqlite en mémoire). npm run test:libsql
 * refait tout avec le client de Turso : TEST_DB=libsql (fichier temporaire), puis
 * TEST_DB=libsql-http (client en ligne, face à un faux serveur Turso local).
 */
export const backend = ['libsql', 'libsql-http'].includes(process.env.TEST_DB) ? process.env.TEST_DB : 'local';

const dirs = [];
process.on('exit', () => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix = 'santa-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** Adresse file: d'une base libSQL neuve. */
export const tempLibsqlUrl = () => pathToFileURL(path.join(tempDir('santa-libsql-'), 'test.db')).href;

/** Faux serveur Turso sur une base neuve ; ne retient pas la fin des tests. */
export async function fakeTurso() {
  const server = await startFakeTurso({ file: path.join(tempDir('santa-turso-'), 'turso.db') });
  return { ...server, target: { url: server.url, authToken: server.token } };
}

export async function testStore(options) {
  if (backend === 'libsql') return createStore({ url: tempLibsqlUrl() }, options);
  if (backend === 'libsql-http') {
    const turso = await fakeTurso();
    const store = await createStore(turso.target, options);
    const close = store.close;
    store.close = async () => {
      await close();
      await turso.close();
    };
    return store;
  }
  return createStore(':memory:', options);
}

/**
 * Enveloppe le store et note chaque appel dont le résultat (une promesse) n'est jamais
 * attendu : oublier un await est une faille (une promesse est toujours « vraie »).
 */
export function trackAwaits(store) {
  const pending = new Set();
  const proxy = new Proxy(store, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = value.apply(target, args);
        if (!(result instanceof Promise)) return result;
        const entry = { name: String(prop), stack: new Error().stack.split('\n').slice(2, 4).join(' | ') };
        pending.add(entry);
        const seen = () => pending.delete(entry);
        return {
          then(onOk, onErr) { seen(); return result.then(onOk, onErr); },
          catch(onErr) { seen(); return result.catch(onErr); },
          finally(fn) { seen(); return result.finally(fn); },
        };
      };
    },
  });
  return { proxy, pending };
}

/** Une base qu'on peut fermer puis rouvrir (fichier local, ou fichier libSQL). */
export async function reopenableTarget() {
  if (backend === 'libsql-http') return (await fakeTurso()).target;
  if (backend === 'libsql') return { url: tempLibsqlUrl() };
  return path.join(tempDir(), 'santa.sqlite');
}
