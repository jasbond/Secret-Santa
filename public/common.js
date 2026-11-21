import './decor.js';
import { icon } from './icons.js';

export { icon };
// Utilitaires partagés. Tout le texte est inséré avec textContent : jamais d'innerHTML.

export async function api(method, url, body) {
  const init = {
    method,
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  };
  if (method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    const err = new Error('Connexion impossible. Vérifie ta connexion internet.');
    err.status = 0;
    throw err;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* réponse vide ou non JSON */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Erreur ${res.status}`);
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data;
}

/** Crée un élément DOM. el('p', {class: 'x', onclick: fn}, 'texte', autreElement) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key === 'value') node.value = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

/**
 * Typographie française : espace insécable avant « : ; ! ? » » et après « « », pour
 * qu'une ponctuation ne se retrouve jamais seule en début ou en fin de ligne.
 */
export function frTypo(text) {
  return String(text).replace(/ ([:;!?»])/g, '\u00a0$1').replace(/« /g, '«\u00a0')
    // Les milliers restent ensemble : « 2 000 XPF » ne se coupe pas entre 2 et 000.
    .replace(/(\d) (?=\d{3}(?!\d))/g, '$1\u00a0').replace(/(\d) (XPF|€|F\b)/g, '$1\u00a0$2')
    // Une initiale reste avec le prénom : « Salomé M » ne se coupe pas avant le M.
    .replace(/(\p{L}) (\p{Lu}\.?)(?=\s|$)/gu, '$1\u00a0$2')
    // Trait d'union insécable : « Garde‑le », « Toi‑même », « peut‑être » ne se coupent pas.
    .replace(/\b([Gg]arde|[Tt]oi|[Pp]eut)-(le|même|être)(?![\p{L}])/gu, '$1\u2011$2');
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(frTypo(child)));
  }
}

/**
 * Transforme un texte en nœuds DOM où les adresses http(s) deviennent des liens
 * cliquables (ouverts dans un nouvel onglet, sans transmettre l'adresse de la page).
 */
export function linkify(text) {
  const out = [];
  const re = /\bhttps?:\/\/[^\s<>"«»“”]+/gi;
  let last = 0;
  for (const match of String(text).matchAll(re)) {
    // Retire la ponctuation finale qui fait rarement partie du lien ; une parenthèse
    // fermante n'est retirée que si elle n'a pas de parenthèse ouvrante dans le lien.
    let url = match[0];
    for (;;) {
      const lastChar = url.slice(-1);
      if (/[.,;:!?\]’…]/.test(lastChar)) url = url.slice(0, -1);
      else if (lastChar === ')' && (url.match(/\)/g) || []).length > (url.match(/\(/g) || []).length) url = url.slice(0, -1);
      else break;
    }
    if (match.index > last) out.push(text.slice(last, match.index));
    let ok = false;
    try {
      ok = ['http:', 'https:'].includes(new URL(url).protocol);
    } catch {
      ok = false;
    }
    out.push(ok ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer nofollow' }, url) : url);
    last = match.index + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function clear(node, ...children) {
  node.replaceChildren();
  append(node, children);
  return node;
}

let toastTimer;
let toastQueue = [];
// La zone des messages existe dès le chargement : une zone « live » créée au moment
// du message n'est souvent pas lue par les lecteurs d'écran.
function toastBox() {
  let box = document.getElementById('toast');
  if (!box) {
    box = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  return box;
}
if (document.body) toastBox();
else document.addEventListener('DOMContentLoaded', toastBox, { once: true });

const TOAST_ICONS = { success: 'check-circle', error: 'circle-alert', info: 'info' };
/** Une fenêtre plein écran est ouverte (cadeau, lettre, calendrier…) : les messages attendent. */
const overlayOpen = () => document.body?.classList.contains('gift-open');

function showToast(message, type) {
  const box = toastBox();
  box.replaceChildren(icon(TOAST_ICONS[type] || 'info', { size: 18, className: 'toast-icon' }), el('span', { class: 'toast-text' }, message));
  box.className = `toast toast-${type}`;
  // Nouvelle apparition à chaque message (le petit mouvement rejoue).
  void box.offsetWidth;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), type === 'error' ? 5000 : 2800);
}

// Les messages mis de côté s'affichent juste après la fermeture de la fenêtre plein écran.
if (window.MutationObserver) {
  const watch = () => new MutationObserver(() => {
    if (!toastQueue.length || overlayOpen()) return;
    const queued = toastQueue;
    toastQueue = [];
    setTimeout(() => {
      if (overlayOpen()) { toastQueue.push(...queued); return; }
      for (const [m, t] of queued.slice(-1)) showToast(m, t);
    }, 300);
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (document.body) watch();
  else document.addEventListener('DOMContentLoaded', watch, { once: true });
}

export function toast(message, type = 'info') {
  // Jamais de message par-dessus une fenêtre plein écran (sauf une erreur, qui doit se voir).
  if (overlayOpen() && type !== 'error') {
    toastQueue.push([message, type]);
    return;
  }
  showToast(message, type);
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} ${time}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Repli pour les navigateurs sans API presse-papiers (ou en HTTP).
    const area = el('textarea', { readonly: true, class: 'offscreen' });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/** Jeton présent dans l'URL : /admin/<jeton> ou /p/<jeton> */
export function tokenFromPath() {
  const parts = location.pathname.split('/').filter(Boolean);
  return parts[1] || '';
}

export function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle('busy', busy);
}

/** Exécute une action asynchrone liée à un bouton, avec affichage des erreurs. */
export async function withButton(button, fn) {
  setBusy(button, true);
  try {
    return await fn();
  } catch (err) {
    toast(err.message, 'error');
    return undefined;
  } finally {
    setBusy(button, false);
  }
}

export const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* stockage indisponible : sans importance */
    }
  },
};

/**
 * Fenêtre de confirmation assortie au design (remplace confirm() et prompt() du navigateur).
 * Renvoie true/false, ou le texte saisi (null si annulé) quand `input` est fourni.
 */
export function ask(message, {
  title = null, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false, input = null,
} = {}) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const field = input ? el('input', { value: input.value ?? '', maxlength: String(input.maxLength ?? 80), 'aria-label': input.label ?? 'Valeur', autocomplete: 'off' }) : null;
    const confirmButton = el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'submit' }, confirmLabel);
    const cancelButton = el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close(null) }, cancelLabel);
    const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
    const paragraphs = String(message).split(/\n{2,}/).map((part) => el('p', {}, part.split('\n').flatMap((line, i) => (i ? [el('br'), line] : [line]))));
    const form = el('form', { method: 'dialog', class: 'ask-form' },
      el('span', { class: 'ask-grabber', 'aria-hidden': 'true' }),
      title ? el('h2', { class: 'ask-title' }, title) : null,
      el('div', { class: 'ask-message' }, paragraphs),
      field,
      error,
      el('div', { class: 'ask-actions' }, confirmButton, cancelButton),
    );
    const dialog = el('dialog', { class: `ask${danger ? ' ask-danger' : ''}`, 'aria-label': title || 'Confirmation' }, form);
    let done = false;
    function close(value) {
      if (done) return;
      done = true;
      dialog.close();
      dialog.remove();
      if (previous && previous.isConnected) previous.focus();
      resolve(value);
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (field) {
        const value = field.value.trim();
        // Erreur affichée dans la fenêtre (le texte saisi est conservé).
        const message = !value ? 'Ce champ est obligatoire.' : (input.validate?.(value) || null);
        if (message) {
          error.textContent = frTypo(message);
          error.hidden = false;
          field.setAttribute('aria-invalid', 'true');
          field.focus();
          return;
        }
        close(value);
      } else close(true);
    });
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(field ? null : false); });
    // Clic en dehors de la fenêtre : annuler
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(field ? null : false); });
    document.body.append(dialog);
    dialog.showModal();
    if (field) {
      field.focus();
      field.select();
    } else (danger ? cancelButton : confirmButton).focus(); // action destructive : focus sur « Annuler »
  }).then((v) => (input ? v : Boolean(v)));
}

/**
 * Lien de téléchargement qui reste dans l'application en cas d'erreur (session
 * expirée, révélation masquée…) : le message s'affiche au lieu d'une page brute.
 */
export function downloadLink(href, label, { className = 'btn', onError } = {}) {
  return el('a', {
    class: className, href,
    onclick: async (e) => {
      e.preventDefault();
      const link = e.currentTarget;
      if (link.getAttribute('aria-disabled') === 'true') return;
      link.setAttribute('aria-disabled', 'true');
      try {
        let res;
        try {
          res = await fetch(href, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' });
        } catch {
          toast('Connexion impossible. Vérifie ta connexion internet.', 'error');
          return;
        }
        if (res.ok) {
          // Le serveur envoie le fichier en pièce jointe : la page reste affichée.
          window.location.href = href;
          return;
        }
        let message = `Erreur ${res.status}`;
        try {
          const data = await (await fetch(href, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })).json();
          if (data?.error) message = data.error;
        } catch {
          /* message par défaut */
        }
        toast(message, 'error');
        onError?.(res.status);
      } finally {
        link.removeAttribute('aria-disabled');
      }
    },
  }, label);
}

/** Nom de l'événement affiché partout. */
export const BRAND = 'Secret Santa';
/** Le groupe s'appelle-t-il simplement « Secret Santa » (ou « Père Noël secret ») ? */
export function isBrandName(name) {
  const n = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s-]+/g, ' ').trim();
  return n === 'secret santa' || n === 'pere noel secret';
}
/** « Secret Santa « Noël 2026 » », ou juste « Secret Santa » si le groupe porte déjà ce nom. */
export function eventName(name) {
  const n = String(name || '').trim();
  return !n || isBrandName(n) ? BRAND : `${BRAND} « ${n} »`;
}
/** Titre de l'onglet : « Noël 2026 · Secret Santa », ou « Secret Santa » seul. */
export function pageTitle(name) {
  const n = String(name || '').trim();
  return !n || isBrandName(n) ? BRAND : `${n} · ${BRAND}`;
}

/** Ordinateur (souris) ou téléphone (doigt) : pour dire « clique » ou « touche ». */
export const onComputer = () => Boolean(window.matchMedia?.('(hover: hover) and (pointer: fine)').matches);

/**
 * Libellé de bouton en deux longueurs : le texte complet, et un texte court qui le remplace
 * sur les très petits écrans (moins de 360 px), pour qu'il tienne sur une ligne.
 */
export function fitLabel(long, short) {
  return el('span', {}, el('span', { class: 'lbl-long' }, long), el('span', { class: 'lbl-short' }, short));
}
