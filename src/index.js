import http from 'node:http';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { createApp } from './app.js';
import { loadVapidKeys, createNotifier } from './push.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
// Mettre TRUST_PROXY=0 si le serveur est exposé directement sans proxy HTTPS.
const trustProxy = process.env.TRUST_PROXY !== '0';
// Mettre FORCE_SECURE_COOKIES=1 si le site est toujours servi en HTTPS mais que
// le proxy n'envoie pas l'en-tête X-Forwarded-Proto.
const forceSecureCookies = process.env.FORCE_SECURE_COOKIES === '1';

// Base de données : Turso (gratuit, en ligne) si TURSO_DATABASE_URL est donnée,
// sinon un fichier SQLite dans DATA_DIR (Docker, serveur à soi).
const tursoUrl = (process.env.TURSO_DATABASE_URL || '').trim();
const tursoToken = (process.env.TURSO_AUTH_TOKEN || '').trim();
let store;
let where;
if (tursoUrl) {
  if (!tursoToken && !tursoUrl.startsWith('file:')) {
    console.error('❌ TURSO_DATABASE_URL est donnée mais pas TURSO_AUTH_TOKEN (le jeton de la base Turso).');
    process.exit(1);
  }
  try {
    store = await createStore({ url: tursoUrl, authToken: tursoToken || undefined });
    where = `Turso (${new URL(tursoUrl).host || tursoUrl})`;
  } catch (err) {
    console.error(`❌ Impossible d'ouvrir la base Turso : ${err.message}`);
    console.error('   Vérifie TURSO_DATABASE_URL (libsql://…) et TURSO_AUTH_TOKEN.');
    process.exit(1);
  }
} else {
  try {
    mkdirSync(dataDir, { recursive: true });
    store = await createStore(path.join(dataDir, 'secret-santa.sqlite'));
    where = dataDir;
  } catch (err) {
    console.error(`❌ Impossible d'ouvrir la base de données dans ${dataDir} : ${err.message}`);
    console.error('   Vérifie que ce dossier existe et est accessible en écriture (variable DATA_DIR).');
    process.exit(1);
  }
}
// Notifications : clés lues dans l'environnement (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY),
// sinon gardées dans la base (créées au premier démarrage).
const notifier = createNotifier({
  store,
  vapid: await loadVapidKeys({ store, dataDir }),
  subject: process.env.VAPID_SUBJECT || 'mailto:pere-noel-secret@example.com',
});
const app = createApp({ store, publicDir: path.join(root, 'public'), trustProxy, forceSecureCookies, notifier });

const server = http.createServer(app);
server.requestTimeout = 30_000;
server.headersTimeout = 20_000;

server.listen(port, host, () => {
  console.log(`🎅 Secret Santa démarré sur http://localhost:${port} (données : ${where})`);
});

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} reçu, arrêt…`);
  server.close(() => {
    store.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
