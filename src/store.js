import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { drawDetailed, guessableIds } from './draw.js';
import { openDatabase } from './db.js';

export class HttpError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const LIMITS = {
  groupName: 80,
  participantName: 40,
  budget: 40,
  description: 1000,
  wishlist: 3000,
  message: 2000,
  maxParticipants: 100,
  minParticipantsForDraw: 3,
  codeMin: 4,
  codeMax: 12,
  failedAttemptsBeforeLock: 5,
  lockMs: 5 * 60 * 1000,
  maxLockMs: 24 * 60 * 60 * 1000,
  maxSessionsPerParticipant: 10,
  messagesPerPage: 500,
  albumNote: 500,
  albumPhotoBytes: 3 * 1024 * 1024,
  defaultTimeZone: 'Europe/Paris', // si le navigateur de l'organisateur n'en donne pas
};

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

const newToken = () => randomBytes(18).toString('base64url'); // 24 caractères, 144 bits
const newId = () => randomBytes(9).toString('base64url');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function hashCode(code) {
  const salt = randomBytes(16);
  const hash = scryptSync(code, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function verifyCode(code, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = scryptSync(code, Buffer.from(saltB64, 'base64url'), expected.length);
  return timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// Validation des entrées
// ---------------------------------------------------------------------------

const charLength = (s) => [...s].length;

function cleanText(value, label, max, { required = false, multiline = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new HttpError(400, `${label} : valeur invalide.`);
  let v = value.normalize('NFC').replace(/\r\n?/g, '\n');
  // Retire les caractères de contrôle et d'inversion de sens d'écriture ; pour
  // les champs d'une ligne (noms…), retire aussi les caractères invisibles
  // (espaces de largeur nulle, etc.) qui permettraient des noms vides ou sosies.
  v = v.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
  v = multiline
    ? v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    : v.replace(/\p{Cf}/gu, '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ');
  v = v.trim();
  if (required && !v) throw new HttpError(400, `${label} : champ obligatoire.`);
  if (charLength(v) > max) throw new HttpError(400, `${label} : ${max} caractères maximum.`);
  return v;
}

function cleanDate(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, 'Date invalide.');
  }
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new HttpError(400, 'Date invalide.');
  }
  return value;
}

/** Fuseau horaire IANA (ex. « Pacific/Tahiti ») envoyé par le navigateur ; invalide = ignoré. */
function cleanTimeZone(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^[A-Za-z_+\-/0-9]+$/.test(value)) return '';
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value;
  } catch {
    return '';
  }
}

/** Code secret : uniquement des chiffres, de 4 à 12 (comme un code de téléphone). */
function cleanCode(value) {
  if (typeof value !== 'string' || !/^[0-9]*$/.test(value)) {
    throw new HttpError(400, 'Le code secret ne doit contenir que des chiffres.');
  }
  if (value.length < LIMITS.codeMin) throw new HttpError(400, `Le code secret doit faire au moins ${LIMITS.codeMin} chiffres.`);
  if (value.length > LIMITS.codeMax) throw new HttpError(400, `Le code secret doit faire au plus ${LIMITS.codeMax} chiffres.`);
  return value;
}

const nameKey = (name) => name.toLocaleLowerCase('fr');

/** Le groupe s'appelle-t-il simplement « Secret Santa » (ou « Père Noël secret ») ? */
export function isBrandName(name) {
  const n = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s-]+/g, ' ').trim();
  return n === 'secret santa' || n === 'pere noel secret';
}

/** Étapes du suivi de cadeau (côté Père Noël). */
export const GIFT_STEPS = ['searching', 'idea', 'bought', 'wrapped'];

function cleanConv(value) {
  if (value !== 'recipient' && value !== 'santa') throw new HttpError(400, 'Conversation inconnue.');
  return value;
}

// ---------------------------------------------------------------------------
// Schéma
// ---------------------------------------------------------------------------

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS groups (
  id               TEXT PRIMARY KEY,
  admin_token_hash TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  budget           TEXT NOT NULL DEFAULT '',
  event_date       TEXT NOT NULL DEFAULT '',
  description      TEXT NOT NULL DEFAULT '',
  drawn_at         INTEGER,
  revealed_at      INTEGER,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id              TEXT PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  token           TEXT NOT NULL UNIQUE,
  wishlist        TEXT NOT NULL DEFAULT '',
  code_hash       TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    INTEGER NOT NULL DEFAULT 0,
  reset_count     INTEGER NOT NULL DEFAULT 0,
  last_reset_at   INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS participants_group ON participants(group_id);

CREATE TABLE IF NOT EXISTS exclusions (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  a_id     TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  b_id     TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, a_id, b_id),
  CHECK (a_id < b_id)
);

CREATE TABLE IF NOT EXISTS assignments (
  group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  giver_id    TEXT NOT NULL PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  receiver_id TEXT NOT NULL UNIQUE REFERENCES participants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS assignments_group ON assignments(group_id);

-- Une conversation = un couple (donneur -> receveur), identifiée par giver_id.
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  giver_id   TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  from_santa INTEGER NOT NULL CHECK (from_santa IN (0, 1)),
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_giver ON messages(giver_id, id);
CREATE INDEX IF NOT EXISTS messages_group ON messages(group_id);

-- Album souvenir (après la révélation) : la photo du cadeau reçu et un petit mot.
CREATE TABLE IF NOT EXISTS album_entries (
  participant_id TEXT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  group_id       TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  note           TEXT NOT NULL DEFAULT '',
  photo          BLOB,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS album_group ON album_entries(group_id);

-- Abonnements aux notifications (un par appareil).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint       TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  p256dh         TEXT NOT NULL,
  auth           TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_participant ON push_subscriptions(participant_id);

CREATE TABLE IF NOT EXISTS reads (
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  conv           TEXT NOT NULL CHECK (conv IN ('recipient', 'santa')),
  last_id        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (participant_id, conv)
);

-- Accès organisateur ouverts avec le code organisateur (un par appareil).
CREATE TABLE IF NOT EXISTS admin_tokens (
  token_hash TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_tokens_group ON admin_tokens(group_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash     TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_participant ON sessions(participant_id);

-- Réglages du serveur (clés des notifications…) : gardés en base, car le disque
-- d'un hébergeur gratuit est effacé à chaque redémarrage.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Ouvre la base et renvoie le store. Toutes ses fonctions sont asynchrones.
 * target : nom de fichier SQLite (ou ':memory:'), { url, authToken } pour Turso,
 * ou une base déjà ouverte avec openDatabase().
 *
 * Chaque suite « lire, vérifier, écrire » se fait dans une transaction : sinon une
 * autre requête pourrait passer entre la vérification et l'écriture.
 */
export async function createStore(target = ':memory:', { now = () => Date.now() } = {}) {
  const db = typeof target === 'string'
    ? await openDatabase({ file: target })
    : (typeof target?.transaction === 'function' ? target : await openDatabase(target));
  await db.exec(SCHEMA);
  // Migration des bases créées avant l'ajout de ces colonnes.
  const columnsOf = async (table) => new Set((await db.all(`PRAGMA table_info(${table})`)).map((c) => c.name));
  const columns = await columnsOf('participants');
  if (!columns.has('reset_count')) await db.exec('ALTER TABLE participants ADD COLUMN reset_count INTEGER NOT NULL DEFAULT 0');
  if (!columns.has('last_reset_at')) await db.exec('ALTER TABLE participants ADD COLUMN last_reset_at INTEGER');
  if (!columns.has('gift_status')) await db.exec('ALTER TABLE participants ADD COLUMN gift_status INTEGER NOT NULL DEFAULT 0');
  const groupColumns = await columnsOf('groups');
  // La discussion de groupe a été retirée : on efface ses éventuels anciens messages.
  await db.exec('DROP TABLE IF EXISTS group_messages');
  if (!groupColumns.has('first_revealed_at')) await db.exec('ALTER TABLE groups ADD COLUMN first_revealed_at INTEGER');
  if (!columns.has('code_set_at')) await db.exec('ALTER TABLE participants ADD COLUMN code_set_at INTEGER');
  if (!columns.has('last_seen_at')) await db.exec('ALTER TABLE participants ADD COLUMN last_seen_at INTEGER');
  // Tirage (drawn_at) pour lequel la personne a ouvert son cadeau : une seule fois par personne, sur tous ses appareils.
  if (!columns.has('gift_opened_draw')) await db.exec('ALTER TABLE participants ADD COLUMN gift_opened_draw INTEGER');
  // Code organisateur : « Je suis l'organisateur » depuis le lien du groupe (haché, avec blocage).
  if (!groupColumns.has('admin_code_hash')) await db.exec('ALTER TABLE groups ADD COLUMN admin_code_hash TEXT');
  if (!groupColumns.has('admin_failed')) await db.exec('ALTER TABLE groups ADD COLUMN admin_failed INTEGER NOT NULL DEFAULT 0');
  if (!groupColumns.has('admin_locked_until')) await db.exec('ALTER TABLE groups ADD COLUMN admin_locked_until INTEGER NOT NULL DEFAULT 0');
  if (!groupColumns.has('auto_reveal')) await db.exec('ALTER TABLE groups ADD COLUMN auto_reveal INTEGER NOT NULL DEFAULT 0');
  if (!groupColumns.has('time_zone')) await db.exec("ALTER TABLE groups ADD COLUMN time_zone TEXT NOT NULL DEFAULT ''");
  if (!groupColumns.has('wishlist_deadline')) await db.exec("ALTER TABLE groups ADD COLUMN wishlist_deadline TEXT NOT NULL DEFAULT ''");
  // Lien unique du groupe (à partager dans une conversation de groupe).
  if (!groupColumns.has('invite_token')) await db.exec('ALTER TABLE groups ADD COLUMN invite_token TEXT');
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS groups_invite ON groups(invite_token)');
  for (const g of await db.all('SELECT id FROM groups WHERE invite_token IS NULL')) {
    await db.run('UPDATE groups SET invite_token = ? WHERE id = ?', newToken(), g.id);
  }
  // Adresse courte du lien de groupe (ex. /noel), choisie par l'organisateur.
  if (!groupColumns.has('short_name')) await db.exec('ALTER TABLE groups ADD COLUMN short_name TEXT');
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS groups_short_name ON groups(short_name)');

  /** Date du jour (AAAA-MM-JJ) dans le fuseau de l'échange. */
  // Date du jour dans le fuseau du groupe (celui de l'organisateur, ex. Pacific/Tahiti).
  const today = (timeZone) => new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || LIMITS.defaultTimeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now()));

  /**
   * Révélé manuellement par l'organisateur, ou automatiquement le LENDEMAIN de
   * l'échange (révéler dès minuit le jour J gâcherait la surprise de la soirée).
   */
  const isRevealed = (g) => Boolean(g.drawn_at) && (
    Boolean(g.revealed_at) || (Boolean(g.auto_reveal) && Boolean(g.event_date) && today(g.time_zone) > g.event_date)
  );

  /** Instant (ms) du minuit local qui suit dateStr (AAAA-MM-JJ) dans timeZone. */
  function midnightAfter(dateStr, timeZone) {
    const tz = timeZone || LIMITS.defaultTimeZone;
    const [y, m, d] = dateStr.split('-').map(Number);
    const wall = Date.UTC(y, m - 1, d + 1); // minuit « mural » du lendemain, lu comme UTC
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    const offset = (t) => {
      const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
    };
    // Deux passes suffisent pour tenir compte du décalage horaire (changement d'heure compris).
    let t = wall - offset(wall);
    t = wall - offset(t);
    return t;
  }

  /** Instant où la révélation a réellement eu lieu (manuelle ou automatique le lendemain). */
  const revealMoment = (g) => (g.revealed_at ? g.revealed_at
    : (g.auto_reveal && g.event_date ? midnightAfter(g.event_date, g.time_zone) : now()));

  // Les fonctions ci-dessous prennent `q` : la base (db) ou la transaction en cours (t).

  // --- Lecture ------------------------------------------------------------

  // Ordre alphabétique (à la française : accents et majuscules ne comptent pas),
  // partout : page « Qui es-tu ? », page organisateur, infos pratiques.
  const byName = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
  const listParticipants = async (groupId, q = db) =>
    (await q.all('SELECT * FROM participants WHERE group_id = ? ORDER BY created_at, rowid', groupId))
      .sort((a, b) => byName.compare(a.name, b.name));

  const requireParticipantInGroup = async (group, participantId, q = db) => {
    if (typeof participantId !== 'string') throw new HttpError(400, 'Participant invalide.');
    const p = await q.get('SELECT * FROM participants WHERE id = ? AND group_id = ?', participantId, group.id);
    if (!p) throw new HttpError(404, 'Participant introuvable.');
    return p;
  };

  const requireNotDrawn = async (group, action, q = db) => {
    // Relit l'état en base : le groupe passé en paramètre peut dater d'avant un tirage concurrent.
    const fresh = await q.get('SELECT drawn_at FROM groups WHERE id = ?', group.id);
    if (!fresh || fresh.drawn_at) {
      throw new HttpError(409, `Le tirage a déjà eu lieu : impossible ${action}. Annule d'abord le tirage.`);
    }
  };

  /** Le groupe tel qu'il est en base maintenant (celui reçu peut dater d'avant une autre requête). */
  const freshGroup = async (group, q = db) => {
    const g = await q.get('SELECT * FROM groups WHERE id = ?', group.id);
    if (!g) throw new HttpError(404, 'Groupe introuvable. Vérifie le lien organisateur.');
    return g;
  };

  const assertUniqueName = async (groupId, name, exceptId = null, q = db) => {
    const key = nameKey(name);
    for (const p of await listParticipants(groupId, q)) {
      if (p.id !== exceptId && nameKey(p.name) === key) {
        throw new HttpError(409, `Il y a déjà un participant nommé « ${p.name} ».`);
      }
    }
  };

  const insertParticipant = async (groupId, name, q = db) => {
    const p = { id: newId(), token: newToken() };
    await q.run(
      'INSERT INTO participants (id, group_id, name, token, created_at) VALUES (?, ?, ?, ?, ?)',
      p.id, groupId, name, p.token, now(),
    );
    return p;
  };

  // --- Groupes (organisateur) ----------------------------------------------

  async function createGroup(input = {}) {
    const name = cleanText(input.name, 'Nom du groupe', LIMITS.groupName, { required: true });
    const budget = cleanText(input.budget, 'Budget', LIMITS.budget);
    const eventDate = cleanDate(input.eventDate);
    const description = cleanText(input.description, 'Message', LIMITS.description, { multiline: true });

    let names = input.participants ?? [];
    if (!Array.isArray(names)) throw new HttpError(400, 'Liste de participants invalide.');
    names = names
      .map((n) => cleanText(n, 'Nom du participant', LIMITS.participantName))
      .filter(Boolean);
    if (names.length > LIMITS.maxParticipants) {
      throw new HttpError(400, `${LIMITS.maxParticipants} participants maximum.`);
    }
    const seen = new Map();
    for (const n of names) {
      const k = nameKey(n);
      if (seen.has(k)) throw new HttpError(400, `Le nom « ${n} » apparaît deux fois. Ajoute une initiale pour les distinguer.`);
      seen.set(k, n);
    }

    const adminCodeHash = input.adminCode ? hashCode(cleanCode(String(input.adminCode))) : null;
    const adminToken = newToken();
    const groupId = newId();
    await db.transaction(async (t) => {
      await t.run(
        `INSERT INTO groups (id, admin_token_hash, invite_token, name, budget, event_date, description, time_zone, created_at, admin_code_hash, wishlist_deadline)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        groupId, sha256(adminToken), newToken(), name, budget, eventDate, description, cleanTimeZone(input.timeZone), now(), adminCodeHash,
        input.wishlistDeadline ? cleanDate(input.wishlistDeadline) : '',
      );
      for (const n of names) await insertParticipant(groupId, n, t);
    });
    return { adminToken };
  }

  async function groupByAdminToken(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new HttpError(404, 'Groupe introuvable.');
    const h = sha256(token);
    const g = await db.get('SELECT * FROM groups WHERE admin_token_hash = ?', h)
      ?? await db.get('SELECT g.* FROM admin_tokens a JOIN groups g ON g.id = a.group_id WHERE a.token_hash = ?', h);
    if (!g) throw new HttpError(404, 'Groupe introuvable. Vérifie le lien organisateur.');
    return g;
  }

  /**
   * Trace définitive de toute révélation, y compris automatique : dès que le groupe
   * est révélé, first_revealed_at est fixé. Masquer ensuite ne l'efface pas, pour que
   * personne ne puisse « jeter un œil » en cachette.
   */
  async function traceReveal(g, q = db) {
    if (g && !g.first_revealed_at && isRevealed(g)) {
      // La trace porte l'heure de la révélation (minuit local pour une révélation
      // automatique), pas celle où quelqu'un l'a regardée ou masquée.
      const at = revealMoment(g);
      await q.run('UPDATE groups SET first_revealed_at = COALESCE(first_revealed_at, ?) WHERE id = ?', at, g.id);
      g.first_revealed_at = (await q.get('SELECT first_revealed_at FROM groups WHERE id = ?', g.id))?.first_revealed_at ?? at;
    }
    return g;
  }

  const groupPublic = async (g, q = db) => (await traceReveal(g, q)) && ({
    name: g.name,
    budget: g.budget,
    eventDate: g.event_date,
    description: g.description,
    drawn: Boolean(g.drawn_at),
    drawnAt: g.drawn_at ?? null,
    revealed: isRevealed(g),
    autoReveal: Boolean(g.auto_reveal),
    // Une révélation automatique a lieu le lendemain de l'échange.
    // Trace d'une révélation déjà faite (même masquée ensuite).
    firstRevealedAt: g.first_revealed_at ?? null,
    wishlistDeadline: g.wishlist_deadline || '',
    timeZone: g.time_zone || LIMITS.defaultTimeZone,
  });

  /**
   * Vue organisateur. Ne contient pas qui offre à qui : l'organisateur doit le
   * demander explicitement (adminAssignments), pour ne pas se gâcher la surprise
   * par accident s'il participe aussi.
   */
  async function adminView(group) {
    const people = await listParticipants(group.id);
    const participants = people.map((p) => ({
      id: p.id,
      name: p.name,
      token: p.token,
      hasCode: Boolean(p.code_hash),
      hasWishlist: p.wishlist.length > 0,
      resetCount: p.reset_count,
      lastSeenAt: p.last_seen_at ?? null,
    }));
    const exclusions = (await db.all('SELECT a_id, b_id FROM exclusions WHERE group_id = ?', group.id)).map((e) => ({
      a: e.a_id,
      b: e.b_id,
    }));
    // Avancement des cadeaux : uniquement des totaux, jamais « qui offre à qui ».
    let giftProgress = null;
    if (group.drawn_at) {
      giftProgress = { total: 0, searching: 0, idea: 0, bought: 0, wrapped: 0 };
      for (const p of people) {
        giftProgress.total += 1;
        giftProgress[GIFT_STEPS[p.gift_status] ?? 'searching'] += 1;
      }
    }
    return {
      group: await groupPublic(group),
      // Heure du serveur : la page organisateur calcule « en ligne / vu il y a… » sans
      // dépendre de l'horloge du téléphone.
      serverNow: now(),
      hasAdminCode: Boolean(group.admin_code_hash),
      inviteToken: group.invite_token,
      shortName: group.short_name || null,
      participants,
      exclusions,
      giftProgress,
      limits: { maxParticipants: LIMITS.maxParticipants, minParticipantsForDraw: LIMITS.minParticipantsForDraw },
    };
  }

  async function updateGroup(staleGroup, input = {}) {
    // Le hachage (lent) du nouveau code organisateur est préparé avant la transaction.
    const adminCodeHash = input.adminCode ? hashCode(cleanCode(String(input.adminCode))) : null;
    await db.transaction(async (t) => {
      // Relu dans la transaction : un tirage fait entre-temps fige le fuseau horaire.
      const group = await freshGroup(staleGroup, t);
      const name = input.name === undefined ? group.name : cleanText(input.name, 'Nom du groupe', LIMITS.groupName, { required: true });
      const budget = input.budget === undefined ? group.budget : cleanText(input.budget, 'Budget', LIMITS.budget);
      const eventDate = input.eventDate === undefined ? group.event_date : cleanDate(input.eventDate);
      const description = input.description === undefined
        ? group.description
        : cleanText(input.description, 'Message', LIMITS.description, { multiline: true });
      // Le fuseau suit le navigateur de l'organisateur avant le tirage. Après le tirage,
      // il ne change plus : un simple enregistrement ne doit ni révéler ni masquer par la bande.
      const timeZone = group.drawn_at ? group.time_zone : (cleanTimeZone(input.timeZone) || group.time_zone);
      let autoReveal = group.auto_reveal;
      if (input.autoReveal !== undefined) {
        if (typeof input.autoReveal !== 'boolean') throw new HttpError(400, 'Valeur invalide.');
        autoReveal = input.autoReveal ? 1 : 0;
      }
      if (autoReveal && !eventDate) {
        throw new HttpError(400, "Indique la date de l'échange pour activer la révélation automatique.");
      }
      // Activer la révélation automatique (ou changer sa date) avec une date d'échange
      // déjà passée révélerait tout immédiatement : on refuse.
      const autoChanged = autoReveal && (!group.auto_reveal || eventDate !== group.event_date);
      if (autoChanged && eventDate < today(timeZone)) {
        throw new HttpError(400,
          "La date de l'échange est déjà passée : la révélation automatique se ferait tout de suite. Pour révéler maintenant, utilise le bouton « Révélation pour tout le monde ».");
      }
      // Après le tirage, aucun réglage (date, fuseau horaire, révélation automatique) ne
      // doit pouvoir révéler les Pères Noël par la bande : seul le bouton le fait.
      const wasRevealed = isRevealed(group);
      const willBeRevealed = isRevealed({ ...group, event_date: eventDate, auto_reveal: autoReveal, time_zone: timeZone });
      if (!wasRevealed && willBeRevealed) {
        throw new HttpError(400,
          "Ce réglage révélerait tout de suite les Pères Noël. Pour révéler maintenant, utilise le bouton « Révélation pour tout le monde ».");
      }
      const wishlistDeadline = input.wishlistDeadline === undefined ? (group.wishlist_deadline || '') : cleanDate(input.wishlistDeadline);
      // Si un réglage masque une révélation déjà faite, la trace reste.
      if (wasRevealed) await traceReveal(group, t);
      await t.run(
        'UPDATE groups SET name = ?, budget = ?, event_date = ?, description = ?, auto_reveal = ?, wishlist_deadline = ?, time_zone = ? WHERE id = ?',
        name, budget, eventDate, description, autoReveal, wishlistDeadline, timeZone, group.id,
      );
      if (adminCodeHash) {
        // Nouveau code organisateur : les essais ratés repartent de zéro.
        await t.run('UPDATE groups SET admin_code_hash = ?, admin_failed = 0, admin_locked_until = 0 WHERE id = ?', adminCodeHash, group.id);
      }
    });
  }

  /**
   * Efface un participant et tout ce qui le concerne. Fait à la main plutôt que par
   * ON DELETE CASCADE : avec Turso, chaque requête peut passer par une connexion où
   * les clés étrangères ne sont pas activées.
   */
  async function deleteParticipantRows(t, participantId) {
    for (const sql of [
      'DELETE FROM sessions WHERE participant_id = ?',
      'DELETE FROM reads WHERE participant_id = ?',
      'DELETE FROM push_subscriptions WHERE participant_id = ?',
      'DELETE FROM album_entries WHERE participant_id = ?',
    ]) await t.run(sql, participantId);
    await t.run('DELETE FROM messages WHERE giver_id = ?', participantId);
    await t.run('DELETE FROM assignments WHERE giver_id = ? OR receiver_id = ?', participantId, participantId);
    await t.run('DELETE FROM exclusions WHERE a_id = ? OR b_id = ?', participantId, participantId);
    await t.run('DELETE FROM participants WHERE id = ?', participantId);
  }

  async function deleteGroup(group) {
    await db.transaction(async (t) => {
      const inGroup = 'SELECT id FROM participants WHERE group_id = ?';
      await t.run(`DELETE FROM sessions WHERE participant_id IN (${inGroup})`, group.id);
      await t.run(`DELETE FROM reads WHERE participant_id IN (${inGroup})`, group.id);
      await t.run(`DELETE FROM push_subscriptions WHERE participant_id IN (${inGroup})`, group.id);
      await t.run('DELETE FROM admin_tokens WHERE group_id = ?', group.id);
      for (const table of ['album_entries', 'messages', 'assignments', 'exclusions', 'participants']) {
        await t.run(`DELETE FROM ${table} WHERE group_id = ?`, group.id);
      }
      await t.run('DELETE FROM groups WHERE id = ?', group.id);
    });
  }

  async function addParticipant(group, rawName) {
    const name = cleanText(rawName, 'Nom du participant', LIMITS.participantName, { required: true });
    return db.transaction(async (t) => {
      await requireNotDrawn(group, "d'ajouter un participant", t);
      const count = (await t.get('SELECT COUNT(*) AS n FROM participants WHERE group_id = ?', group.id)).n;
      if (count >= LIMITS.maxParticipants) throw new HttpError(400, `${LIMITS.maxParticipants} participants maximum.`);
      await assertUniqueName(group.id, name, null, t);
      return { id: (await insertParticipant(group.id, name, t)).id };
    });
  }

  async function renameParticipant(group, participantId, rawName) {
    await db.transaction(async (t) => {
      const p = await requireParticipantInGroup(group, participantId, t);
      const name = cleanText(rawName, 'Nom du participant', LIMITS.participantName, { required: true });
      await assertUniqueName(group.id, name, p.id, t);
      await t.run('UPDATE participants SET name = ? WHERE id = ?', name, p.id);
    });
  }

  async function removeParticipant(group, participantId) {
    await db.transaction(async (t) => {
      await requireNotDrawn(group, 'de retirer un participant', t);
      const p = await requireParticipantInGroup(group, participantId, t);
      await deleteParticipantRows(t, p.id);
    });
  }

  /**
   * Réinitialise le code d'un participant (code oublié). Laisse une trace
   * indélébile (compteur + date) affichée au participant et sur la page
   * organisateur : l'organisateur ne peut donc pas utiliser une réinitialisation
   * pour consulter discrètement la page de quelqu'un.
   */
  async function resetParticipantCode(group, participantId) {
    await db.transaction(async (t) => {
      const p = await requireParticipantInGroup(group, participantId, t);
      if (!p.code_hash) throw new HttpError(409, `${p.name} n'a pas encore choisi de code : rien à réinitialiser.`);
      await t.run(
        `UPDATE participants SET code_hash = NULL, failed_attempts = 0, locked_until = 0,
           reset_count = reset_count + 1, last_reset_at = ? WHERE id = ?`,
        now(), p.id,
      );
      await t.run('DELETE FROM sessions WHERE participant_id = ?', p.id);
      // Les appareils de l'ancien code ne reçoivent plus les notifications.
      await t.run('DELETE FROM push_subscriptions WHERE participant_id = ?', p.id);
    });
  }

  async function addExclusion(group, aId, bId) {
    await db.transaction(async (t) => {
      await requireNotDrawn(group, 'de modifier les exclusions', t);
      const a = await requireParticipantInGroup(group, aId, t);
      const b = await requireParticipantInGroup(group, bId, t);
      if (a.id === b.id) throw new HttpError(400, 'Choisis deux personnes différentes.');
      const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      const res = await t.run('INSERT OR IGNORE INTO exclusions (group_id, a_id, b_id) VALUES (?, ?, ?)', group.id, x, y);
      if (res.changes === 0) throw new HttpError(409, `${a.name} et ${b.name} sont déjà exclus l'un de l'autre.`);
    });
  }

  async function removeExclusion(group, aId, bId) {
    if (typeof aId !== 'string' || typeof bId !== 'string') throw new HttpError(400, 'Exclusion invalide.');
    const [x, y] = aId < bId ? [aId, bId] : [bId, aId];
    await db.transaction(async (t) => {
      await requireNotDrawn(group, 'de modifier les exclusions', t);
      await t.run('DELETE FROM exclusions WHERE group_id = ? AND a_id = ? AND b_id = ?', group.id, x, y);
    });
  }

  async function draw(group, { force = false } = {}) {
    await db.transaction(async (t) => {
      const fresh = await t.get('SELECT drawn_at, auto_reveal, event_date, time_zone FROM groups WHERE id = ?', group.id);
      if (!fresh) throw new HttpError(404, 'Groupe introuvable. Vérifie le lien organisateur.');
      if (fresh.drawn_at) throw new HttpError(409, 'Le tirage a déjà eu lieu.');
      if (fresh.auto_reveal && fresh.event_date && fresh.event_date < today(fresh.time_zone)) {
        throw new HttpError(409,
          "La date de révélation automatique est déjà atteinte : tout le monde verrait son Père Noël tout de suite. Change la date de l'échange ou décoche la révélation automatique dans les paramètres.");
      }
      const people = await listParticipants(group.id, t);
      const ids = people.map((p) => p.id);
      if (ids.length < LIMITS.minParticipantsForDraw) {
        throw new HttpError(400, `Il faut au moins ${LIMITS.minParticipantsForDraw} participants pour faire le tirage.`);
      }
      const exclusions = (await t.all('SELECT a_id, b_id FROM exclusions WHERE group_id = ?', group.id)).map((e) => [e.a_id, e.b_id]);
      const result = drawDetailed(ids, exclusions);
      if (!result) {
        throw new HttpError(409, 'Tirage impossible avec ces exclusions : retires-en quelques-unes et réessaie.');
      }
      if (!force) {
        const names = new Map(people.map((p) => [p.id, p.name]));
        const predictable = guessableIds(ids, exclusions).map((id) => names.get(id));
        const warnings = [];
        if (predictable.length) {
          warnings.push(`le tirage serait devinable pour : ${predictable.join(', ')} (en voyant à qui elles offrent, elles devineraient qui est leur Père Noël)`);
        }
        if (result.mutualPairs.length) {
          const pairs = result.mutualPairs.map(([a, b]) => `${names.get(a)} et ${names.get(b)}`).join(', ');
          warnings.push(`impossible de faire une seule chaîne : des personnes s'offriraient mutuellement leur cadeau, par exemple ${pairs} (leur Père Noël serait la personne à qui elles offrent)`);
        }
        if (warnings.length) {
          throw new HttpError(409,
            `Avec ces exclusions, ${warnings.join(' ; et ')}. Retire des exclusions, ou confirme pour tirer quand même.`,
            predictable.length ? 'predictable' : 'mutual');
        }
      }
      for (const [giver, receiver] of result.assignments) {
        await t.run('INSERT INTO assignments (group_id, giver_id, receiver_id) VALUES (?, ?, ?)', group.id, giver, receiver);
      }
      await t.run('UPDATE groups SET drawn_at = ?, revealed_at = NULL WHERE id = ?', now(), group.id);
    });
  }

  async function resetDraw(staleGroup) {
    await db.transaction(async (t) => {
      const group = await freshGroup(staleGroup, t);
      await t.run('DELETE FROM messages WHERE group_id = ?', group.id);
      await t.run('DELETE FROM album_entries WHERE group_id = ?', group.id);
      await t.run('DELETE FROM reads WHERE participant_id IN (SELECT id FROM participants WHERE group_id = ?)', group.id);
      await t.run('DELETE FROM assignments WHERE group_id = ?', group.id);
      await t.run('UPDATE participants SET gift_status = 0, gift_opened_draw = NULL WHERE group_id = ?', group.id);
      // Désactive aussi la révélation automatique : un nouveau tirage après la date
      // serait sinon révélé à tout le monde dès sa création.
      // La révélation automatique n'est gardée que si la date de l'échange n'est pas
      // passée (sinon un nouveau tirage serait révélé dès sa création). La trace d'une
      // révélation passée est effacée : un nouveau tirage rend l'ancien sans valeur.
      await t.run(
        `UPDATE groups SET drawn_at = NULL, revealed_at = NULL, first_revealed_at = NULL,
           auto_reveal = CASE WHEN event_date <> '' AND event_date >= ? THEN auto_reveal ELSE 0 END
         WHERE id = ?`,
        today(group.time_zone), group.id,
      );
    });
  }

  async function setRevealed(staleGroup, revealed) {
    if (typeof revealed !== 'boolean') throw new HttpError(400, 'Valeur invalide.');
    await db.transaction(async (t) => {
      const group = await freshGroup(staleGroup, t);
      if (!group.drawn_at) throw new HttpError(409, "Le tirage n'a pas encore eu lieu.");
      // Masquer désactive aussi la révélation automatique, sinon elle réapparaîtrait aussitôt.
      // La première révélation laisse une trace définitive (first_revealed_at), visible par
      // tous même si l'organisateur masque ensuite : impossible de « jeter un œil » en cachette.
      if (revealed) {
        await t.run('UPDATE groups SET revealed_at = ?, first_revealed_at = COALESCE(first_revealed_at, ?) WHERE id = ?', now(), now(), group.id);
      } else {
        // Une révélation automatique déjà effective laisse aussi sa trace avant d'être masquée.
        await traceReveal(group, t);
        await t.run('UPDATE groups SET revealed_at = NULL, auto_reveal = 0 WHERE id = ?', group.id);
      }
    });
  }

  // --- Participants ---------------------------------------------------------

  /**
   * Page « Qui es-tu ? » du lien de groupe : liste des prénoms, avec pour chacun le
   * lien personnel (inutilisable sans le code secret) et s'il a déjà été activé.
   */
  /** Adresse courte (ex. « noel ») : 3 à 30 lettres minuscules, chiffres ou tirets. */
  const SHORT_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/;
  const RESERVED_SHORT_NAMES = new Set(['admin', 'api', 'static', 'healthz', 'sw', 'favicon', 'robots', 'index']);

  /** L'organisateur choisit (ou retire, avec une valeur vide) l'adresse courte du lien de groupe. */
  async function setShortName(group, value) {
    const name = String(value ?? '').trim().toLowerCase();
    if (!name) {
      await db.run('UPDATE groups SET short_name = NULL WHERE id = ?', group.id);
      return null;
    }
    if (!SHORT_NAME_RE.test(name) || RESERVED_SHORT_NAMES.has(name)) {
      throw new HttpError(400, 'Adresse courte : 3 à 30 lettres minuscules, chiffres ou tirets (ex. « noel »).');
    }
    const other = await db.get('SELECT id FROM groups WHERE short_name = ?', name);
    if (other && other.id !== group.id) throw new HttpError(409, 'Cette adresse courte est déjà prise.');
    await db.run('UPDATE groups SET short_name = ? WHERE id = ?', name, group.id);
    return name;
  }

  /** Lien de groupe derrière une adresse courte, ou null. */
  async function inviteTokenByShortName(value) {
    const name = String(value ?? '').toLowerCase();
    if (!SHORT_NAME_RE.test(name)) return null;
    const g = await db.get('SELECT invite_token FROM groups WHERE short_name = ?', name);
    return g ? g.invite_token : null;
  }

  async function inviteView(inviteToken) {
    if (typeof inviteToken !== 'string' || !TOKEN_RE.test(inviteToken)) throw new HttpError(404, 'Lien invalide.');
    const g = await db.get('SELECT * FROM groups WHERE invite_token = ?', inviteToken);
    if (!g) throw new HttpError(404, "Ce lien de groupe n'existe pas ou plus. Demande le bon lien à l'organisateur.");
    return {
      group: { name: g.name, eventDate: g.event_date, drawn: Boolean(g.drawn_at) },
      // Seulement les prénoms : la page est vue par tout le groupe, elle ne doit rien dire
      // de qui est déjà venu (seul l'organisateur le voit, sur sa page).
      participants: (await listParticipants(g.id)).map((p) => ({ name: p.name, token: p.token })),
    };
  }

  async function participantByToken(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new HttpError(404, 'Lien invalide.');
    const p = await db.get('SELECT * FROM participants WHERE token = ?', token);
    if (!p) throw new HttpError(404, "Ce lien n'existe pas ou plus. Demande ton lien à l'organisateur.");
    return p;
  }

  const createSession = async (participantId, q = db) => {
    const sessionToken = newToken();
    await q.run('UPDATE participants SET last_seen_at = ? WHERE id = ?', now(), participantId);
    await q.run('INSERT INTO sessions (token_hash, participant_id, created_at) VALUES (?, ?, ?)', sha256(sessionToken), participantId, now());
    // Garde seulement les sessions les plus récentes de ce participant.
    await q.run(
      `DELETE FROM sessions WHERE participant_id = ? AND token_hash NOT IN (
         SELECT token_hash FROM sessions WHERE participant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
      participantId, participantId, LIMITS.maxSessionsPerParticipant,
    );
    return sessionToken;
  };

  async function hasSession(participant, sessionToken) {
    if (typeof sessionToken !== 'string' || !TOKEN_RE.test(sessionToken)) return false;
    const ok = Boolean(await db.get(
      'SELECT 1 AS ok FROM sessions WHERE token_hash = ? AND participant_id = ?',
      sha256(sessionToken), participant.id,
    ));
    if (ok) await markSeen(participant.id);
    return ok;
  }

  /**
   * Dernière visite, montrée à l'organisateur seulement (« En ligne », « Vu il y a 5 min »).
   * Écrite au plus une fois par minute pour ne pas écrire à chaque rafraîchissement.
   * Une seule requête conditionnelle : atomique sans transaction.
   */
  const SEEN_EVERY_MS = 60 * 1000;
  async function markSeen(participantId) {
    const t = now();
    await db.run('UPDATE participants SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at <= ?)',
      t, participantId, t - SEEN_EVERY_MS);
  }

  /** Enregistre le premier code (dans une transaction ouverte). null si un code existe déjà. */
  async function firstCode(t, participantId, hash) {
    // Mise à jour conditionnelle : si deux appareils définissent le code en
    // même temps, un seul gagne.
    const res = await t.run('UPDATE participants SET code_hash = ?, code_set_at = ?, failed_attempts = 0, locked_until = 0 WHERE id = ? AND code_hash IS NULL', hash, now(), participantId);
    if (res.changes !== 1) return null;
    return createSession(participantId, t);
  }

  async function setupCode(participant, rawCode) {
    const code = cleanCode(rawCode);
    const hash = hashCode(code);
    return db.transaction(async (t) => {
      const session = await firstCode(t, participant.id, hash);
      if (!session) throw new HttpError(409, 'Un code secret a déjà été choisi pour ce lien. Entre ton code.');
      return session;
    });
  }

  /**
   * Vérifie le code (dans une transaction ouverte). Renvoie { error } au lieu de lever
   * l'erreur : le compteur d'essais ratés doit être enregistré (COMMIT), pas annulé.
   */
  async function checkCode(t, participantId, rawCode) {
    const p = await t.get('SELECT * FROM participants WHERE id = ?', participantId);
    if (!p) return { error: new HttpError(404, "Ce lien n'existe pas ou plus. Demande ton lien à l'organisateur.") };
    if (!p.code_hash) return { error: new HttpError(409, "Aucun code secret n'a encore été choisi pour ce lien.") };
    const t0 = now();
    if (p.locked_until > t0) {
      const minutes = Math.ceil((p.locked_until - t0) / 60000);
      const wait = minutes >= 120 ? `${Math.ceil(minutes / 60)} heures` : `${minutes} minute${minutes > 1 ? 's' : ''}`;
      return { error: new HttpError(429, `Trop d'essais. Réessaie dans ${wait}.`) };
    }
    const ok = typeof rawCode === 'string' && charLength(rawCode) <= LIMITS.codeMax && verifyCode(rawCode, p.code_hash);
    if (!ok) {
      const failed = p.failed_attempts + 1;
      // Blocage croissant : 5 min, 10 min, 20 min… (24 h maximum).
      const level = Math.floor(failed / LIMITS.failedAttemptsBeforeLock);
      const lockedUntil = failed % LIMITS.failedAttemptsBeforeLock === 0
        ? t0 + Math.min(LIMITS.lockMs * 2 ** (level - 1), LIMITS.maxLockMs)
        : p.locked_until;
      await t.run('UPDATE participants SET failed_attempts = ?, locked_until = ? WHERE id = ?', failed, lockedUntil, p.id);
      const left = LIMITS.failedAttemptsBeforeLock - (failed % LIMITS.failedAttemptsBeforeLock);
      if (left === LIMITS.failedAttemptsBeforeLock) {
        const minutes = Math.ceil((lockedUntil - t0) / 60000);
        const wait = minutes >= 120 ? `${Math.ceil(minutes / 60)} heures` : `${minutes} minute${minutes > 1 ? 's' : ''}`;
        return { error: new HttpError(429, `Code incorrect. Trop d'essais : réessaie dans ${wait}.`) };
      }
      return {
        error: new HttpError(401, left <= 2
          ? `Code incorrect. Encore ${left} essai${left > 1 ? 's' : ''} avant un blocage temporaire.`
          : 'Code incorrect.'),
      };
    }
    await t.run('UPDATE participants SET failed_attempts = 0, locked_until = 0 WHERE id = ?', p.id);
    return { session: await createSession(p.id, t), failedAttempts: p.failed_attempts };
  }

  async function login(participant, rawCode) {
    const outcome = await db.transaction((t) => checkCode(t, participant.id, rawCode));
    if (outcome.error) throw outcome.error;
    return outcome;
  }

  /**
   * Une seule porte d'entrée, identique que la personne soit déjà venue ou non :
   * première visite → le code est enregistré ; sinon → il est vérifié. Personne ne
   * peut savoir, en ouvrant la page de quelqu'un d'autre, s'il est déjà venu.
   * Toute vérification ratée compte comme un essai (blocage + avertissement à la
   * personne), donc tester la page de quelqu'un d'autre ne se fait pas en douce.
   */
  async function enter(participant, rawCode) {
    // Même règle de format dans les deux cas : la réponse à un code trop court ne doit
    // pas dépendre de l'existence d'un code.
    cleanCode(rawCode);
    // Le hachage (lent) d'un premier code est préparé avant la transaction.
    const before = await db.get('SELECT code_hash FROM participants WHERE id = ?', participant.id);
    const hash = before && !before.code_hash ? hashCode(rawCode) : null;
    const outcome = await db.transaction(async (t) => {
      const p = await t.get('SELECT code_hash FROM participants WHERE id = ?', participant.id);
      if (p && !p.code_hash) {
        const session = await firstCode(t, participant.id, hash ?? hashCode(rawCode));
        if (session) return { session, failedAttempts: 0, created: true };
      }
      // Déjà venu (ou un autre appareil vient de choisir le code au même moment) : on vérifie le code.
      return { ...(await checkCode(t, participant.id, rawCode)), created: false };
    });
    if (outcome.error) throw outcome.error;
    return outcome;
  }

  /**
   * « Je suis l'organisateur » depuis le lien du groupe : le bon code ouvre un accès
   * organisateur propre à cet appareil. Blocage croissant après 5 essais ratés.
   */
  async function organiserEnter(inviteToken, rawCode) {
    if (typeof inviteToken !== 'string' || !TOKEN_RE.test(inviteToken)) throw new HttpError(404, 'Lien invalide.');
    cleanCode(rawCode);
    const outcome = await db.transaction(async (t) => {
      const g = await t.get('SELECT * FROM groups WHERE invite_token = ?', inviteToken);
      if (!g) return { error: new HttpError(404, "Ce lien de groupe n'existe pas ou plus.") };
      if (!g.admin_code_hash) return { error: new HttpError(409, "Aucun code organisateur n'a encore été choisi pour ce groupe. Utilise le lien organisateur.") };
      const t0 = now();
      const waitText = (until) => {
        const minutes = Math.ceil((until - t0) / 60000);
        return minutes >= 120 ? `${Math.ceil(minutes / 60)} heures` : `${minutes} minute${minutes > 1 ? 's' : ''}`;
      };
      if (g.admin_locked_until > t0) return { error: new HttpError(429, `Trop d'essais. Réessaie dans ${waitText(g.admin_locked_until)}.`) };
      if (!verifyCode(rawCode, g.admin_code_hash)) {
        const failed = g.admin_failed + 1;
        const level = Math.floor(failed / LIMITS.failedAttemptsBeforeLock);
        const lockedUntil = failed % LIMITS.failedAttemptsBeforeLock === 0
          ? t0 + Math.min(LIMITS.lockMs * 2 ** (level - 1), LIMITS.maxLockMs)
          : g.admin_locked_until;
        await t.run('UPDATE groups SET admin_failed = ?, admin_locked_until = ? WHERE id = ?', failed, lockedUntil, g.id);
        const left = LIMITS.failedAttemptsBeforeLock - (failed % LIMITS.failedAttemptsBeforeLock);
        if (left === LIMITS.failedAttemptsBeforeLock) return { error: new HttpError(429, `Code incorrect. Trop d'essais : réessaie dans ${waitText(lockedUntil)}.`) };
        return { error: new HttpError(401, left <= 2 ? `Code incorrect. Encore ${left} essai${left > 1 ? 's' : ''} avant un blocage temporaire.` : 'Code incorrect.') };
      }
      await t.run('UPDATE groups SET admin_failed = 0, admin_locked_until = 0 WHERE id = ?', g.id);
      const adminToken = newToken();
      await t.run('INSERT INTO admin_tokens (token_hash, group_id, created_at) VALUES (?, ?, ?)', sha256(adminToken), g.id, t0);
      // On garde les 10 accès les plus récents.
      await t.run(
        `DELETE FROM admin_tokens WHERE group_id = ? AND token_hash NOT IN (
           SELECT token_hash FROM admin_tokens WHERE group_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10)`,
        g.id, g.id,
      );
      return { adminToken };
    });
    if (outcome.error) throw outcome.error;
    return outcome;
  }

  async function logout(sessionToken) {
    if (typeof sessionToken === 'string') await db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(sessionToken));
  }

  const santaIdOf = async (participantId, q = db) =>
    (await q.get('SELECT giver_id FROM assignments WHERE receiver_id = ?', participantId))?.giver_id ?? null;
  const recipientIdOf = async (participantId, q = db) =>
    (await q.get('SELECT receiver_id FROM assignments WHERE giver_id = ?', participantId))?.receiver_id ?? null;
  /** Prénom du Père Noël de chacun (receveur → prénom du donneur), en une requête. */
  const giverNames = async (groupId) => new Map((await db.all(
    'SELECT a.receiver_id, g.name FROM assignments a JOIN participants g ON g.id = a.giver_id WHERE a.group_id = ?', groupId,
  )).map((r) => [r.receiver_id, r.name]));

  /** Statut minimal visible sans être connecté. */
  /**
   * Ce que la page affiche. Sans le bon code : seulement le prénom et le nom du groupe,
   * rien qui dise si la personne est déjà venue (seul l'organisateur le sait).
   */
  async function participantStatus(participant, { authenticated = false } = {}) {
    const g = await db.get('SELECT name FROM groups WHERE id = ?', participant.group_id);
    const base = { name: participant.name, groupName: g.name };
    if (!authenticated) return base;
    return {
      ...base,
      hasCode: Boolean(participant.code_hash),
      resetCount: participant.reset_count,
      lastResetAt: participant.last_reset_at ?? null,
      codeSetAt: participant.code_set_at ?? null,
    };
  }

  /** Vue complète d'un participant connecté. Ne révèle jamais son Père Noël avant la révélation. */
  async function participantView(participant) {
    const p = await db.get('SELECT * FROM participants WHERE id = ?', participant.id);
    const g = await db.get('SELECT * FROM groups WHERE id = ?', p.group_id);
    let recipient = null;
    let santaName = null;
    if (g.drawn_at) {
      const rid = await recipientIdOf(p.id);
      const r = rid && await db.get('SELECT name, wishlist FROM participants WHERE id = ?', rid);
      if (r) recipient = { name: r.name, wishlist: r.wishlist };
    }
    // Après la révélation (et seulement après) : qui offrait à qui, pour tout le monde.
    let reveal = null;
    if (isRevealed(g)) {
      const sid = await santaIdOf(p.id);
      santaName = (sid && (await db.get('SELECT name FROM participants WHERE id = ?', sid))?.name) || null;
      reveal = await revealChain(g.id);
    }
    const reads = { recipient: 0, santa: 0 };
    for (const r of await db.all('SELECT conv, last_id FROM reads WHERE participant_id = ?', p.id)) reads[r.conv] = r.last_id;
    return {
      me: { name: p.name, wishlist: p.wishlist, giftStatus: GIFT_STEPS[p.gift_status] ?? 'searching' },
      // Le cadeau de la découverte a déjà été ouvert pour ce tirage (sur n'importe quel appareil).
      giftOpened: Boolean(g.drawn_at) && p.gift_opened_draw === g.drawn_at,
      group: await groupPublic(g),
      participants: (await listParticipants(g.id)).map((x) => x.name),
      recipient,
      santaName,
      reveal,
      reads,
    };
  }

  /** Liste des échanges, ordonnée en suivant les chaînes (A → B → C → … → A). */
  async function revealChain(groupId) {
    const people = await listParticipants(groupId);
    const nameOf = new Map(people.map((x) => [x.id, x.name]));
    const next = new Map((await db.all('SELECT giver_id, receiver_id FROM assignments WHERE group_id = ?', groupId)).map((a) => [a.giver_id, a.receiver_id]));
    const done = new Set();
    const chain = [];
    for (const start of people) {
      let cur = start.id;
      while (next.has(cur) && !done.has(cur)) {
        done.add(cur);
        chain.push({ giver: nameOf.get(cur), receiver: nameOf.get(next.get(cur)) });
        cur = next.get(cur);
      }
    }
    return chain;
  }

  // --- Notifications --------------------------------------------------------

  const B64URL_RE = /^[A-Za-z0-9_-]+={0,2}$/;

  async function savePushSubscription(participant, sub) {
    const endpoint = sub?.endpoint;
    const p256dh = sub?.keys?.p256dh;
    const auth = sub?.keys?.auth;
    let url;
    try {
      url = new URL(endpoint);
    } catch {
      throw new HttpError(400, 'Abonnement invalide.');
    }
    if (url.protocol !== 'https:' || endpoint.length > 1000) throw new HttpError(400, 'Abonnement invalide.');
    if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100
      || !B64URL_RE.test(p256dh) || !B64URL_RE.test(auth)) {
      throw new HttpError(400, 'Abonnement invalide.');
    }
    await db.transaction(async (t) => {
      await t.run(
        `INSERT INTO push_subscriptions (endpoint, participant_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET participant_id = excluded.participant_id, p256dh = excluded.p256dh, auth = excluded.auth`,
        endpoint, participant.id, p256dh, auth, now(),
      );
      // 10 appareils maximum par personne : on garde les plus récents.
      await t.run(
        `DELETE FROM push_subscriptions WHERE participant_id = ? AND endpoint NOT IN (
           SELECT endpoint FROM push_subscriptions WHERE participant_id = ? ORDER BY created_at DESC LIMIT 10)`,
        participant.id, participant.id,
      );
    });
  }

  async function deletePushSubscription(participant, endpoint) {
    if (typeof endpoint !== 'string') throw new HttpError(400, 'Abonnement invalide.');
    await db.run('DELETE FROM push_subscriptions WHERE endpoint = ? AND participant_id = ?', endpoint, participant.id);
  }

  /** Appareils abonnés d'un participant, avec son jeton (pour l'adresse de sa page). */
  async function pushTargets(participantId) {
    const p = await db.get('SELECT token FROM participants WHERE id = ?', participantId);
    if (!p) return [];
    return (await db.all('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE participant_id = ?', participantId))
      .map((r) => ({ subscription: { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, token: p.token }));
  }

  async function forgetPushEndpoint(endpoint) {
    await db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);
  }

  /** À qui va un message (pour le prévenir), selon la conversation. */
  async function messageTarget(participant, conv) {
    if (conv === 'recipient') return recipientIdOf(participant.id);
    return santaIdOf(participant.id);
  }

  async function groupParticipantIds(groupId) {
    return (await listParticipants(groupId)).map((p) => p.id);
  }

  // --- Réglages du serveur ----------------------------------------------------

  async function getSetting(key) {
    return (await db.get('SELECT value FROM settings WHERE key = ?', key))?.value ?? null;
  }

  /** Enregistre la valeur si la clé n'existe pas encore ; renvoie celle qui est en base. */
  async function initSetting(key, value) {
    return db.transaction(async (t) => {
      await t.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', key, value);
      return (await t.get('SELECT value FROM settings WHERE key = ?', key)).value;
    });
  }

  // --- Album souvenir et exports (après la révélation) ----------------------

  async function requireRevealedGroup(groupId, q = db) {
    const g = await q.get('SELECT * FROM groups WHERE id = ?', groupId);
    if (!g || !isRevealed(g)) throw new HttpError(409, "L'album et les téléchargements s'ouvrent après la révélation.");
    return traceReveal(g, q);
  }

  /** Les entrées de l'album : une par participant (son cadeau reçu, offert par son Père Noël). */
  async function albumView(groupId) {
    await requireRevealedGroup(groupId);
    const entries = new Map((await db.all('SELECT participant_id, note, photo IS NOT NULL AS has_photo, updated_at FROM album_entries WHERE group_id = ?', groupId))
      .map((e) => [e.participant_id, e]));
    const givers = await giverNames(groupId);
    return (await listParticipants(groupId)).map((p) => {
      const e = entries.get(p.id);
      return {
        id: p.id,
        name: p.name,
        giverName: givers.get(p.id) || '',
        note: e?.note ?? '',
        hasPhoto: Boolean(e?.has_photo),
        updatedAt: e?.updated_at ?? null,
      };
    });
  }

  const upsertAlbum = (participant, q) => q.run(
    `INSERT INTO album_entries (participant_id, group_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (participant_id) DO UPDATE SET updated_at = excluded.updated_at`,
    participant.id, participant.group_id, now(),
  );

  async function setAlbumNote(participant, rawNote) {
    await requireRevealedGroup(participant.group_id);
    const note = cleanText(rawNote, 'Petit mot', LIMITS.albumNote, { multiline: true });
    await db.transaction(async (t) => {
      await requireRevealedGroup(participant.group_id, t);
      await upsertAlbum(participant, t);
      await t.run('UPDATE album_entries SET note = ? WHERE participant_id = ?', note, participant.id);
    });
    return note;
  }

  async function setAlbumPhoto(participant, buffer) {
    await requireRevealedGroup(participant.group_id);
    if (!Buffer.isBuffer(buffer) || buffer.length < 100) throw new HttpError(400, 'Photo invalide.');
    if (buffer.length > LIMITS.albumPhotoBytes) throw new HttpError(413, 'Photo trop lourde (3 Mo maximum).');
    // Uniquement du JPEG (la page convertit et réduit la photo avant l'envoi).
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) throw new HttpError(415, 'Format de photo non reconnu (JPEG attendu).');
    await db.transaction(async (t) => {
      await requireRevealedGroup(participant.group_id, t);
      await upsertAlbum(participant, t);
      await t.run('UPDATE album_entries SET photo = ? WHERE participant_id = ?', buffer, participant.id);
    });
  }

  async function deleteAlbumPhoto(participant) {
    await db.transaction(async (t) => {
      await requireRevealedGroup(participant.group_id, t);
      await t.run('UPDATE album_entries SET photo = NULL, updated_at = ? WHERE participant_id = ?', now(), participant.id);
    });
  }

  /** Photo d'un participant du même groupe (null s'il n'y en a pas). */
  async function albumPhoto(groupId, participantId) {
    await requireRevealedGroup(groupId);
    if (typeof participantId !== 'string') throw new HttpError(404, 'Photo introuvable.');
    const row = await db.get('SELECT a.photo, p.name FROM album_entries a JOIN participants p ON p.id = a.participant_id WHERE a.participant_id = ? AND a.group_id = ?', participantId, groupId);
    if (!row?.photo) throw new HttpError(404, 'Photo introuvable.');
    const giverId = await santaIdOf(participantId);
    const giverName = (giverId && (await db.get('SELECT name FROM participants WHERE id = ?', giverId))?.name) || '';
    return { photo: Buffer.from(row.photo), name: row.name, giverName };
  }

  /**
   * Discussions en texte, avec les prénoms (après la révélation seulement).
   * participantId : seulement ses deux discussions ; null : toutes (organisateur).
   */
  async function conversationsExport(groupId, participantId = null) {
    const g = await requireRevealedGroup(groupId);
    const nameOf = new Map((await listParticipants(groupId)).map((p) => [p.id, p.name]));
    const fmt = new Intl.DateTimeFormat('fr-FR', { timeZone: g.time_zone || LIMITS.defaultTimeZone, dateStyle: 'short', timeStyle: 'short' });
    let pairs = await db.all('SELECT giver_id, receiver_id FROM assignments WHERE group_id = ?', groupId);
    if (participantId) pairs = pairs.filter((a) => a.giver_id === participantId || a.receiver_id === participantId);
    const out = [];
    for (const a of pairs) {
      const giver = nameOf.get(a.giver_id);
      const receiver = nameOf.get(a.receiver_id);
      const lines = (await db.all('SELECT from_santa, body, created_at FROM messages WHERE giver_id = ? ORDER BY id', a.giver_id))
        .map((m) => `[${fmt.format(new Date(m.created_at))}] ${m.from_santa ? `${giver} (Père Noël)` : receiver} : ${m.body.replace(/\n/g, '\n    ')}`);
      out.push({
        giver, receiver,
        title: `${giver} (Père Noël secret) → ${receiver}`,
        text: [eventTitle(g.name), `Discussion entre ${giver}, Père Noël secret, et ${receiver}`, '', ...(lines.length ? lines : ['(aucun message)']), ''].join('\n'),
      });
    }
    return out;
  }

  /** « Secret Santa « Noël 2026 » », ou « Secret Santa » seul si le groupe porte déjà ce nom. */
  function eventTitle(name) {
    return isBrandName(name) ? 'Secret Santa' : `Secret Santa « ${name} »`;
  }

  async function groupInfo(groupId) {
    const g = await db.get('SELECT name FROM groups WHERE id = ?', groupId);
    return { name: g.name };
  }

  /** Qui est le Père Noël de qui, pour l'organisateur (seulement s'il le demande). */
  async function adminAssignments(group) {
    const g = await db.get('SELECT drawn_at FROM groups WHERE id = ?', group.id);
    if (!g?.drawn_at) throw new HttpError(409, "Le tirage n'a pas encore eu lieu.");
    // Triés par personne qui reçoit (et non dans l'ordre de la chaîne, qui laisserait
    // deviner un duo à partir du précédent) : l'organisateur qui participe peut
    // éviter la ligne « Le Père Noël de <son prénom> ».
    return (await revealChain(group.id)).sort((a, b) => a.receiver.localeCompare(b.receiver, 'fr'));
  }

  async function setGiftStatus(participant, rawStatus) {
    const index = GIFT_STEPS.indexOf(rawStatus);
    if (index < 0) throw new HttpError(400, 'Étape inconnue.');
    await db.transaction(async (t) => {
      const g = await t.get('SELECT drawn_at FROM groups WHERE id = ?', participant.group_id);
      if (!g.drawn_at) throw new HttpError(409, "Le tirage n'a pas encore eu lieu.");
      await t.run('UPDATE participants SET gift_status = ? WHERE id = ?', index, participant.id);
    });
    return GIFT_STEPS[index];
  }

  /** La personne a ouvert son cadeau (animation de découverte) : retenu pour ce tirage. */
  async function markGiftOpened(participant, drawnAt) {
    await db.transaction(async (t) => {
      const g = await t.get('SELECT drawn_at FROM groups WHERE id = ?', participant.group_id);
      if (!g.drawn_at) throw new HttpError(409, "Le tirage n'a pas encore eu lieu.");
      // Tirage refait entre-temps : le cadeau vu était celui de l'ancien tirage.
      if (drawnAt !== undefined && drawnAt !== null && drawnAt !== g.drawn_at) throw new HttpError(409, "Le tirage a été refait : recharge la page.");
      await t.run('UPDATE participants SET gift_opened_draw = ? WHERE id = ?', g.drawn_at, participant.id);
    });
  }

  async function updateWishlist(participant, rawWishlist) {
    const wishlist = cleanText(rawWishlist, 'Liste de souhaits', LIMITS.wishlist, { multiline: true });
    await db.run('UPDATE participants SET wishlist = ? WHERE id = ?', wishlist, participant.id);
    return wishlist;
  }

  /**
   * Messages des deux conversations du participant :
   *  - conv "recipient" : avec la personne à qui il offre (il y est anonyme) ;
   *  - conv "santa"     : avec son Père Noël secret (anonyme pour lui).
   * Aucun identifiant de l'autre personne n'est renvoyé.
   */
  async function listMessages(participant, afterId = 0) {
    const after = Number.isSafeInteger(afterId) && afterId > 0 ? afterId : 0;
    const g = await db.get('SELECT drawn_at FROM groups WHERE id = ?', participant.group_id);
    if (!g.drawn_at) return [];
    const santaId = await santaIdOf(participant.id);
    const rows = await db.all(
      `SELECT id, giver_id, from_santa, body, created_at FROM messages
       WHERE id > ? AND giver_id IN (?, ?) ORDER BY id LIMIT ?`,
      after, participant.id, santaId ?? participant.id, LIMITS.messagesPerPage,
    );
    return rows.map((m) => {
      const conv = m.giver_id === participant.id ? 'recipient' : 'santa';
      const mine = conv === 'recipient' ? m.from_santa === 1 : m.from_santa === 0;
      return { id: m.id, conv, mine, body: m.body, createdAt: m.created_at };
    });
  }

  async function postMessage(participant, rawConv, rawBody, drawnAt = undefined) {
    const conv = cleanConv(rawConv);
    const body = cleanText(rawBody, 'Message', LIMITS.message, { required: true, multiline: true });
    return db.transaction(async (t) => {
      const g = await t.get('SELECT drawn_at FROM groups WHERE id = ?', participant.group_id);
      if (!g.drawn_at) throw new HttpError(409, "Le tirage n'a pas encore eu lieu.", 'stale-draw');
      // Le client indique le tirage qu'il affiche : si l'organisateur a refait le
      // tirage entre-temps, on refuse plutôt que d'écrire à la mauvaise personne.
      if (drawnAt !== undefined && drawnAt !== g.drawn_at) {
        throw new HttpError(409, 'Le tirage a été refait : la page va se mettre à jour.', 'stale-draw');
      }
      const giverId = conv === 'recipient' ? participant.id : await santaIdOf(participant.id, t);
      if (!giverId) throw new HttpError(409, 'Conversation indisponible.');
      const createdAt = now();
      const res = await t.run(
        'INSERT INTO messages (group_id, giver_id, from_santa, body, created_at) VALUES (?, ?, ?, ?, ?)',
        participant.group_id, giverId, conv === 'recipient' ? 1 : 0, body, createdAt,
      );
      return { id: Number(res.lastInsertRowid), conv, mine: true, body, createdAt };
    });
  }

  async function markRead(participant, rawConv, lastId) {
    if (!Number.isSafeInteger(lastId) || lastId < 0) throw new HttpError(400, 'Identifiant invalide.');
    const conv = cleanConv(rawConv);
    await db.run(
      `INSERT INTO reads (participant_id, conv, last_id) VALUES (?, ?, ?)
       ON CONFLICT (participant_id, conv) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)`,
      participant.id, conv, lastId,
    );
  }

  return {
    db,
    close: () => db.close(),
    // réglages du serveur
    getSetting,
    initSetting,
    // organisateur
    createGroup,
    groupByAdminToken,
    adminView,
    updateGroup,
    deleteGroup,
    addParticipant,
    renameParticipant,
    removeParticipant,
    resetParticipantCode,
    addExclusion,
    removeExclusion,
    draw,
    resetDraw,
    setRevealed,
    adminAssignments,
    savePushSubscription,
    albumView,
    setAlbumNote,
    setAlbumPhoto,
    deleteAlbumPhoto,
    albumPhoto,
    conversationsExport,
    groupInfo,
    deletePushSubscription,
    pushTargets,
    forgetPushEndpoint,
    messageTarget,
    groupParticipantIds,
    // participant
    participantByToken,
    inviteView,
    setShortName,
    inviteTokenByShortName,
    participantStatus,
    participantView,
    hasSession,
    setupCode,
    login,
    enter,
    logout,
    updateWishlist,
    listMessages,
    postMessage,
    markRead,
    setGiftStatus,
    markGiftOpened,
    organiserEnter,
  };
}
