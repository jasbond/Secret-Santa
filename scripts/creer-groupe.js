// Crée le groupe décrit dans groupe.json sur un serveur en ligne et affiche
// le lien organisateur et le lien personnel de chaque participant.
// Utilisation : npm run creer-groupe -- https://adresse-du-site
import { readFile } from 'node:fs/promises';

const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/]+/.test(base)) {
  console.error('Utilisation : npm run creer-groupe -- https://adresse-du-site');
  process.exit(1);
}
const file = process.argv[3] || 'groupe.json';
const group = JSON.parse(await readFile(file, 'utf8'));

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Erreur HTTP ${res.status}`);
  return data;
}

try {
  const { wishlistDeadline, ...creation } = group;
  // Code organisateur (« Je suis l'organisateur » dans le lien du groupe) : donné au lancement,
  // jamais écrit dans les fichiers du projet. Ex. : CODE_ORGANISATEUR=123456 npm run creer-groupe -- https://…
  if (process.env.CODE_ORGANISATEUR) creation.adminCode = process.env.CODE_ORGANISATEUR.trim();
  const { adminToken } = await call('POST', '/api/groups', creation);
  // La date limite de la liste de souhaits se règle juste après la création.
  if (wishlistDeadline) await call('PATCH', `/api/admin/${adminToken}`, { wishlistDeadline });
  const view = await call('GET', `/api/admin/${adminToken}`);
  console.log(`\n✅ Groupe « ${view.group.name} » créé avec ${view.participants.length} participants.`);
  if (view.group.eventDate) console.log(`   Échange des cadeaux : ${view.group.eventDate}`);
  if (view.group.wishlistDeadline) console.log(`   Listes de souhaits à remplir avant le : ${view.group.wishlistDeadline}`);
  console.log(view.hasAdminCode ? "   Code organisateur : choisi ✓ (« 🎩 Je suis l'organisateur » dans le lien du groupe)" : '   Pas de code organisateur (CODE_ORGANISATEUR=… pour en choisir un).');
  console.log('\n🔑 Lien organisateur (à garder secret, à mettre en favori) :');
  console.log(`   ${base}/admin/${adminToken}\n`);
  console.log('📣 Lien du groupe, à coller dans la conversation Messenger :');
  console.log(`   ${base}/g/${view.inviteToken}\n`);
  console.log('Ensuite : attends que tout le monde ait choisi son code (page organisateur), puis clique sur « Lancer le tirage ».\n');
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
