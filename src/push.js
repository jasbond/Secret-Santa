import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

/**
 * Clés VAPID (notifications), dans cet ordre :
 *  1. l'environnement (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) ;
 *  2. la base de données (table settings) ;
 *  3. un ancien fichier DATA_DIR/vapid.json, recopié dans la base ;
 *  4. sinon, de nouvelles clés, enregistrées dans la base.
 * Elles sont gardées en base et non sur le disque : chez un hébergeur gratuit
 * (Render), le disque est effacé à chaque redémarrage, et de nouvelles clés
 * couperaient les notifications de tous les téléphones déjà abonnés.
 */
export async function loadVapidKeys({ store, dataDir = null, env = process.env }) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  }
  const valid = (k) => Boolean(k && typeof k.publicKey === 'string' && typeof k.privateKey === 'string' && k.publicKey && k.privateKey);
  const read = (text) => {
    try {
      const k = JSON.parse(text);
      return valid(k) ? { publicKey: k.publicKey, privateKey: k.privateKey } : null;
    } catch {
      return null;
    }
  };
  const saved = read(await store.getSetting('vapid'));
  if (saved) return saved;
  let keys = null;
  const file = dataDir ? path.join(dataDir, 'vapid.json') : null;
  if (file && existsSync(file)) keys = read(readFileSync(file, 'utf8'));
  keys ??= webpush.generateVAPIDKeys();
  // Si un autre serveur vient d'enregistrer ses clés, on garde les siennes.
  return read(await store.initSetting('vapid', JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey }))) ?? keys;
}

/**
 * Envoie les notifications. Ne contient jamais le texte des messages ni le nom
 * d'un Père Noël : seulement « tu as un nouveau message ».
 */
export function createNotifier({ store, vapid, subject, logger = console, send = webpush.sendNotification, now = () => Date.now() }) {
  const options = { vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 24 * 3600, urgency: 'normal' };
  // Évite les rafales : au plus une notification par minute et par conversation.
  const lastSent = new Map();
  const THROTTLE_MS = 60 * 1000;

  async function toParticipant(participantId, payload, { throttleKey = null } = {}) {
    if (!participantId) return 0;
    if (throttleKey) {
      const key = `${participantId}:${throttleKey}`;
      const t = now();
      if (lastSent.has(key) && t - lastSent.get(key) < THROTTLE_MS) return 0;
      lastSent.set(key, t);
      if (lastSent.size > 5000) lastSent.clear();
    }
    let sent = 0;
    for (const { subscription, token } of await store.pushTargets(participantId)) {
      const body = JSON.stringify({ ...payload, url: `/p/${token}${payload.query || ''}` });
      try {
        await send(subscription, body, options);
        sent++;
      } catch (err) {
        // Abonnement expiré ou supprimé côté navigateur : on l'oublie.
        if (err?.statusCode === 404 || err?.statusCode === 410) await store.forgetPushEndpoint(subscription.endpoint);
        else logger.error?.(`Notification non envoyée (${err?.statusCode ?? err?.message})`);
      }
    }
    return sent;
  }

  return {
    publicKey: vapid.publicKey,
    toParticipant,
    /** Fire-and-forget : une notification qui échoue ne doit jamais bloquer la requête. */
    fire(participantId, payload, opts) {
      toParticipant(participantId, payload, opts).catch((err) => logger.error?.(err));
    },
  };
}
