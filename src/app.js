import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { HttpError, isBrandName } from './store.js';
import { createZip, safeFileName } from './zip.js';

const MAX_BODY_BYTES = 64 * 1024;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 an

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; " +
    "font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  // Les liens contiennent des jetons secrets : ne jamais les transmettre à d'autres sites.
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

function send(res, status, body, headers = {}) {
  // Content-Length : un transfert coupé apparaît comme un échec, pas comme un fichier abîmé.
  const length = body === undefined || body === null ? 0 : Buffer.byteLength(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'Content-Length': length, ...headers });
  res.end(body);
}

function sendJson(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', ...headers });
}

async function readJson(req) {
  const type = String(req.headers['content-type'] || '');
  // Exiger du JSON bloque les requêtes inter-sites (CSRF) : un formulaire
  // d'un autre site ne peut pas envoyer ce type de contenu sans autorisation CORS.
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    throw new HttpError(415, 'Requête invalide (JSON attendu).');
  }
  const declared = Number(req.headers['content-length']);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'Requête trop volumineuse.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Requête trop volumineuse.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'JSON invalide.');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new HttpError(400, 'JSON invalide.');
  return data;
}

/** Corps binaire (photo JPEG), jusqu'à `max` octets. */
async function readImage(req, max) {
  const type = String(req.headers['content-type'] || '');
  // Un formulaire d'un autre site ne peut pas envoyer ce type de contenu (protection CSRF).
  if (!/^image\/jpeg\s*(;|$)/i.test(type)) throw new HttpError(415, 'Photo attendue au format JPEG.');
  if (Number(req.headers['content-length']) > max) throw new HttpError(413, 'Photo trop lourde (3 Mo maximum).');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, 'Photo trop lourde (3 Mo maximum).');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Forme ASCII d'un texte (sans accents ni emoji) pour l'en-tête de téléchargement. */
function asciiFold(text) {
  return String(text)
    .replace(/[\u2019\u2018\u02bb\u02bc]/g, "'").replace(/[\u00ab\u00bb\u201c\u201d]/g, '').replace(/[\u2013\u2014]/g, '-')
    .normalize('NFD')
    // Accents, emoji (drapeaux, teintes de peau, ZWJ, VS16 compris) et autres symboles non ASCII.
    .replace(/(?![\x20-\x7e])[\p{M}\p{S}\p{Cf}]/gu, '')
    .replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')
    .replace(/\s+/g, ' ').trim();
}

/** Prénom ou nom de groupe pour un nom de fichier, avec un repli si tout a disparu. */
const fileLabel = (name) => asciiFold(name) || 'sans nom';

/** En-tête de téléchargement (nom de fichier sans accents, compris partout). */
function attachment(filename) {
  // Le nom est déjà construit à partir de fileLabel() ; on nettoie la ponctuation résiduelle.
  const ascii = asciiFold(filename).replace(/ (\.[a-z0-9]+)$/i, '$1').trim();
  // Nom sans accents uniquement : certains navigateurs ignorent le nom quand la forme
  // encodée (filename*) est présente.
  return `attachment; filename="${ascii}"`;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!key || key in out) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

const isHttps = (req, trustProxy) =>
  Boolean(req.socket.encrypted) ||
  (trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');

const hasBody = (req) => req.method !== 'GET' && req.method !== 'HEAD';

function clientIp(req, trustProxy) {
  if (trustProxy) {
    // Dernière adresse de la liste : celle ajoutée par notre proxy (les précédentes
    // peuvent être inventées par le client).
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean).pop();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'inconnu';
}

/** Limiteur simple en mémoire : au plus `max` actions par fenêtre de `windowMs`, par clé. */
export function createRateLimiter({ max, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return function check(key) {
    const t = now();
    let entry = hits.get(key);
    if (!entry || entry.reset <= t) {
      entry = { count: 0, reset: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
    }
    if (entry.count > max) {
      const minutes = Math.ceil((entry.reset - t) / 60000);
      throw new HttpError(429, `Trop de requêtes. Réessaie dans ${minutes} minute${minutes > 1 ? 's' : ''}.`);
    }
  };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sessionCookieName = (participant) => `ss_${participant.id}`;

function sessionCookie(req, participant, value, { trustProxy, forceSecure, maxAge = COOKIE_MAX_AGE }) {
  const parts = [
    `${sessionCookieName(participant)}=${value}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (forceSecure || isHttps(req, trustProxy)) parts.push('Secure');
  return parts.join('; ');
}

export function createApp({
  store,
  publicDir,
  trustProxy = true,
  forceSecureCookies = false,
  logger = console,
  limits = {},
  notifier = null,
}) {
  const notify = (pid, payload, opts) => notifier?.fire(pid, payload, opts);
  // Ne bloque jamais la réponse : le tirage (ou la révélation) est déjà enregistré.
  const notifyGroup = (groupId, payload) => {
    if (!notifier) return;
    (async () => {
      for (const pid of await store.groupParticipantIds(groupId)) notifier.fire(pid, payload);
    })().catch((err) => logger.error?.(err));
  };
  const fileCache = new Map();
  const cookieOptions = { trustProxy, forceSecure: forceSecureCookies };
  const groupCreationLimit = createRateLimiter({ max: 20, windowMs: 60 * 60 * 1000, ...limits.groupCreation });
  const authLimit = createRateLimiter({ max: 30, windowMs: 10 * 60 * 1000, ...limits.auth });

  async function serveFile(res, relative, req = null) {
    const file = path.join(publicDir, relative);
    if (!file.startsWith(publicDir + path.sep)) throw new HttpError(404, 'Introuvable.');
    let cached = fileCache.get(file);
    if (!cached) {
      let content;
      try {
        content = await readFile(file);
      } catch {
        throw new HttpError(404, 'Introuvable.');
      }
      cached = { content, etag: `"${createHash('sha1').update(content).digest('base64url')}"` };
      fileCache.set(file, cached);
    }
    const ext = path.extname(file);
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Polices : ne changent jamais. Le reste : revalidé à chaque visite (réponse 304 si inchangé).
      'Cache-Control': ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
      ETag: cached.etag,
    };
    if (req && req.headers['if-none-match'] === cached.etag) {
      res.writeHead(304, { ...SECURITY_HEADERS, ...headers });
      res.end();
      return;
    }
    send(res, 200, cached.content, headers);
  }

  // ----- Album : photo et archive souvenir ---------------------------------

  function sendPhoto(req, res, { photo, name, giverName }) {
    const download = new URL(req.url, 'http://x').searchParams.has('telecharger');
    send(res, 200, photo, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, no-store',
      ...(download ? { 'Content-Disposition': attachment(`Cadeau de ${fileLabel(giverName)} pour ${fileLabel(name)}.jpg`) } : {}),
    });
  }

  async function sendSouvenirs(res, groupId, conversations, filename) {
    const entries = await store.albumView(groupId);
    const files = [];
    const mots = [];
    const html = [];
    // Deux prénoms peuvent donner le même nom de fichier après nettoyage : on rend chaque nom unique.
    const used = new Set();
    const unique = (dir, base, ext) => {
      let name = `${dir}${base}${ext}`;
      for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${dir}${base} (${n})${ext}`;
      used.add(name.toLowerCase());
      return name;
    };
    for (const e of entries) {
      const label = `Cadeau de ${e.giverName} pour ${e.name}`;
      let img = '';
      if (e.hasPhoto) {
        const photoName = unique('photos/', safeFileName(label), '.jpg');
        files.push({ name: photoName, data: (await store.albumPhoto(groupId, e.id)).photo });
        img = `<img src="${escapeHtml(photoName.split('/').map(encodeURIComponent).join('/'))}" alt="">`;
      }
      if (e.note || e.hasPhoto) {
        mots.push(`${label}\n${e.note ? `« ${e.note} »` : '(pas de mot)'}\n`);
        html.push(`<figure>${img}<figcaption><strong>${escapeHtml(label)}</strong>${e.note ? `<p>${escapeHtml(e.note)}</p>` : ''}</figcaption></figure>`);
      }
    }
    files.push({ name: 'Les petits mots.txt', data: mots.length ? mots.join('\n') : "Personne n'a encore ajouté de photo ni de mot.\n" });
    for (const c of conversations) {
      files.push({ name: unique('discussions/', safeFileName(`${c.giver} (Père Noël) et ${c.receiver}`), '.txt'), data: c.text });
    }
    const groupName = escapeHtml((await store.groupInfo(groupId)).name);
    files.push({
      name: 'Album.html',
      data: `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Album souvenir · ${groupName}</title>`
        + '<style>body{font-family:system-ui,sans-serif;background:#0a1a33;color:#fff7ec;margin:0;padding:24px 16px}h1{text-align:center}main{max-width:900px;margin:auto;display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));align-items:start}figure{margin:0;background:#fffdfa;color:#241c1f;border-radius:18px;overflow:hidden}img{width:100%;display:block;aspect-ratio:4/3;object-fit:cover;background:#f6f0e8}figcaption{padding:12px 14px}figcaption strong{display:block}p{margin:.4em 0 0;white-space:pre-wrap}</style>'
        + `<h1>🎁 Album souvenir · ${groupName}</h1><main>${html.join('') || '<p>Album vide.</p>'}</main></html>`,
    });
    send(res, 200, createZip(files), { 'Content-Type': 'application/zip', 'Content-Disposition': attachment(filename) });
  }

  // ----- Organisateur ------------------------------------------------------

  const admin = (handler) => async (req, res, [token, ...rest]) => {
    // Lire le corps AVANT de charger le groupe : sinon l'état du groupe pourrait
    // dater d'avant une autre requête (ex. un tirage) traitée pendant la lecture.
    const body = hasBody(req) ? await readJson(req) : {};
    const group = await store.groupByAdminToken(token);
    const result = await handler({ group, body, params: rest, req, res });
    // Le gestionnaire a déjà répondu (téléchargements, album, duos) : ne rien renvoyer de plus.
    if (res.headersSent) return result;
    if (result === undefined) {
      // Renvoie la vue à jour après toute modification.
      const fresh = await store.groupByAdminToken(token);
      return sendJson(res, 200, await store.adminView(fresh));
    }
    return result;
  };

  // ----- Participant -------------------------------------------------------

  const participantSession = (req, participant) => parseCookies(req.headers.cookie)[sessionCookieName(participant)];

  /** Exige que le participant soit connecté sur cet appareil. */
  const participant = (handler) => async (req, res, [token]) => {
    const body = hasBody(req) ? await readJson(req) : {};
    const p = await store.participantByToken(token);
    if (!(await store.hasSession(p, participantSession(req, p)))) {
      throw new HttpError(401, 'Session expirée : entre ton code secret.');
    }
    return handler({ p, body, req, res });
  };

  const routes = [
    // Pages
    ['GET', /^\/$/, (req, res) => serveFile(res, 'index.html', req)],
    ['GET', /^\/admin\/([A-Za-z0-9_-]+)\/?$/, (req, res) => serveFile(res, 'admin.html', req)],
    ['GET', /^\/p\/([A-Za-z0-9_-]+)\/?$/, (req, res) => serveFile(res, 'participant.html', req)],
    ['GET', /^\/g\/([A-Za-z0-9_-]+)\/?$/, (req, res) => serveFile(res, 'group.html', req)],
    ['GET', /^\/static\/([a-z0-9-]+\.(?:css|js|svg|png|ico|webmanifest|woff2))$/, (req, res, [name]) => serveFile(res, name, req)],
    // Service worker (notifications) : servi à la racine pour couvrir tout le site.
    ['GET', /^\/sw\.js$/, (req, res) => serveFile(res, 'sw.js', req)],
    ['GET', /^\/api\/push\/key$/, (req, res) => {
      if (!notifier) throw new HttpError(404, 'Notifications indisponibles.');
      sendJson(res, 200, { publicKey: notifier.publicKey });
    }],
    ['GET', /^\/favicon\.ico$/, (req, res) => serveFile(res, 'favicon.svg', req)],
    ['GET', /^\/healthz$/, (req, res) => sendJson(res, 200, { ok: true })],

    // API organisateur
    ['POST', /^\/api\/groups$/, async (req, res) => {
      const body = await readJson(req);
      groupCreationLimit(clientIp(req, trustProxy));
      const { adminToken } = await store.createGroup(body);
      sendJson(res, 201, { adminToken });
    }],
    ['GET', /^\/api\/admin\/([^/]+)$/, admin(() => undefined)],
    ['PATCH', /^\/api\/admin\/([^/]+)$/, admin(async ({ group, body }) => { await store.updateGroup(group, body); })],
    ['DELETE', /^\/api\/admin\/([^/]+)$/, admin(async ({ group, res }) => {
      await store.deleteGroup(group);
      return sendJson(res, 200, { deleted: true });
    })],
    ['POST', /^\/api\/admin\/([^/]+)\/participants$/, admin(async ({ group, body }) => { await store.addParticipant(group, body.name); })],
    ['PATCH', /^\/api\/admin\/([^/]+)\/participants\/([A-Za-z0-9_-]+)$/, admin(async ({ group, body, params: [pid] }) => {
      await store.renameParticipant(group, pid, body.name);
    })],
    ['DELETE', /^\/api\/admin\/([^/]+)\/participants\/([A-Za-z0-9_-]+)$/, admin(async ({ group, params: [pid] }) => {
      await store.removeParticipant(group, pid);
    })],
    ['POST', /^\/api\/admin\/([^/]+)\/participants\/([A-Za-z0-9_-]+)\/reset-code$/, admin(async ({ group, params: [pid] }) => {
      await store.resetParticipantCode(group, pid);
    })],
    ['POST', /^\/api\/admin\/([^/]+)\/exclusions$/, admin(async ({ group, body }) => { await store.addExclusion(group, body.a, body.b); })],
    ['DELETE', /^\/api\/admin\/([^/]+)\/exclusions$/, admin(async ({ group, body }) => { await store.removeExclusion(group, body.a, body.b); })],
    ['GET', /^\/api\/admin\/([^/]+)\/assignments$/, admin(async ({ group, res }) => {
      sendJson(res, 200, { assignments: await store.adminAssignments(group) });
    })],
    ['POST', /^\/api\/admin\/([^/]+)\/draw$/, admin(async ({ group, body }) => {
      await store.draw(group, { force: body.force === true });
      notifyGroup(group.id, { title: '🎲 Le tirage a eu lieu !', body: 'Découvre à qui tu offres un cadeau.', tag: 'tirage' });
    })],
    ['POST', /^\/api\/admin\/([^/]+)\/reset-draw$/, admin(async ({ group }) => { await store.resetDraw(group); })],
    ['POST', /^\/api\/admin\/([^/]+)\/reveal$/, admin(async ({ group, body }) => {
      await store.setRevealed(group, body.revealed);
      if (body.revealed === true) notifyGroup(group.id, { title: '🎉 Révélation !', body: 'Découvre qui était ton Père Noël secret.', tag: 'revelation' });
    })],

    // API participant
    // « Je suis l'organisateur » depuis le lien du groupe, avec le code organisateur.
    ['POST', /^\/api\/g\/([^/]+)\/organisateur$/, async (req, res, [token]) => {
      const body = await readJson(req);
      authLimit(clientIp(req, trustProxy));
      sendJson(res, 200, await store.organiserEnter(token, body.code));
    }],
    ['GET', /^\/api\/g\/([^/]+)$/, async (req, res, [token]) => {
      sendJson(res, 200, await store.inviteView(token));
    }],
    ['GET', /^\/api\/p\/([^/]+)$/, async (req, res, [token]) => {
      const p = await store.participantByToken(token);
      const authenticated = await store.hasSession(p, participantSession(req, p));
      if (authenticated !== true) return sendJson(res, 200, { ...(await store.participantStatus(p)), authenticated: false });
      return sendJson(res, 200, { ...(await store.participantStatus(p, { authenticated: true })), authenticated: true, ...(await store.participantView(p)) });
    }],
    // Entrée unique (première visite ou retour) : la réponse ne dit jamais, avant le bon
    // code, si la personne était déjà venue. /setup et /login sont gardés comme alias.
    ['POST', /^\/api\/p\/([^/]+)\/(?:enter|setup|login)$/, async (req, res, [token]) => {
      const body = await readJson(req);
      authLimit(clientIp(req, trustProxy));
      const p = await store.participantByToken(token);
      const { session, failedAttempts, created } = await store.enter(p, body.code);
      sendJson(res, 200, { ok: true, failedAttempts, created }, { 'Set-Cookie': sessionCookie(req, p, session, cookieOptions) });
    }],
    ['POST', /^\/api\/p\/([^/]+)\/logout$/, async (req, res, [token]) => {
      await readJson(req);
      const p = await store.participantByToken(token);
      await store.logout(participantSession(req, p));
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, p, '', { ...cookieOptions, maxAge: 0 }) });
    }],
    ['PUT', /^\/api\/p\/([^/]+)\/wishlist$/, participant(async ({ p, body, res }) => {
      sendJson(res, 200, { wishlist: await store.updateWishlist(p, body.wishlist) });
    })],
    ['GET', /^\/api\/p\/([^/]+)\/messages$/, participant(async ({ p, req, res }) => {
      const after = Number(new URL(req.url, 'http://x').searchParams.get('after') || 0);
      sendJson(res, 200, { messages: await store.listMessages(p, after) });
    })],
    ['POST', /^\/api\/p\/([^/]+)\/messages$/, participant(async ({ p, body, res }) => {
      const message = await store.postMessage(p, body.conv, body.body, body.drawnAt);
      // Prévient l'autre personne, sans jamais révéler qui écrit ni le contenu.
      if (body.conv === 'recipient') {
        notify(await store.messageTarget(p, 'recipient'), {
          title: "🎅 Ton Père Noël secret t'a écrit !", body: 'Ouvre ta page pour lire son message.', tag: 'conv-santa', query: '?ouvrir=pere-noel',
        }, { throttleKey: 'santa' });
      } else {
        notify(await store.messageTarget(p, 'santa'), {
          // Aucun prénom : l'écran verrouillé ne doit pas révéler à qui tu offres.
          title: '🎁 Tu as une réponse !', body: "La personne à qui tu offres t'a répondu.", tag: 'conv-recipient', query: '?ouvrir=destinataire',
        }, { throttleKey: 'recipient' });
      }
      sendJson(res, 201, { message });
    })],
    ['POST', /^\/api\/p\/([^/]+)\/gift-opened$/, participant(async ({ p, body, res }) => {
      await store.markGiftOpened(p, body.drawnAt);
      sendJson(res, 200, { ok: true });
    })],
    ['PUT', /^\/api\/p\/([^/]+)\/gift-status$/, participant(async ({ p, body, res }) => {
      sendJson(res, 200, { giftStatus: await store.setGiftStatus(p, body.status) });
    })],
    // ----- Album souvenir et téléchargements (après la révélation) -----
    ['GET', /^\/api\/p\/([^/]+)\/album$/, participant(async ({ p, res }) => {
      sendJson(res, 200, { entries: await store.albumView(p.group_id), me: p.id });
    })],
    ['PUT', /^\/api\/p\/([^/]+)\/album\/note$/, participant(async ({ p, body, res }) => {
      sendJson(res, 200, { note: await store.setAlbumNote(p, body.note) });
    })],
    ['PUT', /^\/api\/p\/([^/]+)\/album\/photo$/, async (req, res, [token]) => {
      const p = await store.participantByToken(token);
      if (!(await store.hasSession(p, participantSession(req, p)))) throw new HttpError(401, 'Session expirée : entre ton code secret.');
      const image = await readImage(req, 3 * 1024 * 1024);
      await store.setAlbumPhoto(p, image);
      sendJson(res, 200, { ok: true });
    }],
    ['DELETE', /^\/api\/p\/([^/]+)\/album\/photo$/, participant(async ({ p, res }) => {
      await store.deleteAlbumPhoto(p);
      sendJson(res, 200, { ok: true });
    })],
    ['GET', /^\/api\/p\/([^/]+)\/album\/photo\/([A-Za-z0-9_-]+)$/, async (req, res, [token, pid]) => {
      const p = await store.participantByToken(token);
      if (!(await store.hasSession(p, participantSession(req, p)))) throw new HttpError(401, 'Session expirée : entre ton code secret.');
      sendPhoto(req, res, await store.albumPhoto(p.group_id, pid));
    }],
    ['GET', /^\/api\/p\/([^/]+)\/conversations\.txt$/, participant(async ({ p, res }) => {
      const convs = await store.conversationsExport(p.group_id, p.id);
      send(res, 200, convs.map((c) => c.text).join('\n\n'), {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': attachment(`Mes discussions - ${fileLabel(p.name)}.txt`),
      });
    })],
    ['GET', /^\/api\/p\/([^/]+)\/souvenirs\.zip$/, participant(async ({ p, res }) => {
      await sendSouvenirs(res, p.group_id, await store.conversationsExport(p.group_id, p.id), `Souvenirs Secret Santa - ${fileLabel(p.name)}.zip`);
    })],
    ['GET', /^\/api\/admin\/([^/]+)\/album$/, admin(async ({ group, res }) => {
      sendJson(res, 200, { entries: await store.albumView(group.id) });
    })],
    ['GET', /^\/api\/admin\/([^/]+)\/album\/photo\/([A-Za-z0-9_-]+)$/, admin(async ({ group, params: [pid], req, res }) => {
      sendPhoto(req, res, await store.albumPhoto(group.id, pid));
    })],
    ['GET', /^\/api\/admin\/([^/]+)\/souvenirs\.zip$/, admin(async ({ group, res }) => {
      // Toutes les discussions avec les prénoms : seulement après la révélation (vérifié par le store).
      await sendSouvenirs(res, group.id, await store.conversationsExport(group.id, null), isBrandName(group.name) ? 'Souvenirs Secret Santa.zip' : `Souvenirs Secret Santa - ${fileLabel(group.name)}.zip`);
    })],
    ['POST', /^\/api\/p\/([^/]+)\/push$/, participant(async ({ p, body, res }) => {
      await store.savePushSubscription(p, body.subscription);
      sendJson(res, 200, { ok: true });
    })],
    ['DELETE', /^\/api\/p\/([^/]+)\/push$/, participant(async ({ p, body, res }) => {
      await store.deletePushSubscription(p, body.endpoint);
      sendJson(res, 200, { ok: true });
    })],
    ['POST', /^\/api\/p\/([^/]+)\/read$/, participant(async ({ p, body, res }) => {
      await store.markRead(p, body.conv, body.lastId);
      sendJson(res, 200, { ok: true });
    })],
    // Adresse courte choisie par l'organisateur (ex. PUT {"shortName":"noel"} ; vide pour la retirer).
    ['PUT', /^\/api\/admin\/([^/]+)\/short-name$/, admin(async ({ group, body }) => { await store.setShortName(group, body.shortName); })],
    // Lien personnel court (ex. /noel/chloe) : renvoie vers la page de la personne (protégée par son code).
    ['GET', /^\/([a-z0-9-]{3,30})\/([^/]{1,80})\/?$/, async (req, res, [name, person]) => {
      let token = null;
      try { token = await store.participantTokenByShortName(name, person); } catch { token = null; }
      if (!token) throw new HttpError(404, 'Page introuvable.');
      res.writeHead(302, { Location: `/p/${token}`, 'Cache-Control': 'no-store' });
      res.end();
    }],
    // Adresse courte (ex. /noel) : renvoie vers le lien du groupe. En dernier, après toutes les autres pages.
    ['GET', /^\/([a-z0-9-]{3,30})\/?$/, async (req, res, [name]) => {
      const invite = await store.inviteTokenByShortName(name);
      if (!invite) throw new HttpError(404, 'Page introuvable.');
      res.writeHead(302, { Location: `/g/${invite}`, 'Cache-Control': 'no-store' });
      res.end();
    }],
  ];

  return async function handler(req, res) {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      return send(res, 400, 'Requête invalide.', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const isApi = pathname.startsWith('/api/');
    try {
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      let pathMatched = false;
      for (const [m, re, fn] of routes) {
        const match = re.exec(pathname);
        if (!match) continue;
        pathMatched = true;
        if (m !== method) continue;
        return await fn(req, res, match.slice(1));
      }
      if (pathMatched) throw new HttpError(405, 'Méthode non autorisée.');
      throw new HttpError(404, 'Page introuvable.');
    } catch (err) {
      if (res.headersSent) {
        // Réponse déjà terminée : on note l'erreur sans couper la connexion.
        if (!res.writableEnded) res.destroy();
        else logger?.error?.(err);
        return;
      }
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof HttpError ? err.message : 'Erreur interne du serveur.';
      if (status === 500) logger.error(err);
      const extra = status === 413 ? { Connection: 'close' } : {};
      if (isApi) return sendJson(res, status, err?.code ? { error: message, code: err.code } : { error: message }, extra);
      return send(res, status, message, { 'Content-Type': 'text/plain; charset=utf-8', ...extra });
    }
  };
}
