import { api, el, clear, toast, withButton, copyText, tokenFromPath, formatDate, storage, ask, downloadLink, eventName, BRAND, onComputer, icon, fitLabel } from './common.js';

/** Titre de carte : icône dorée + texte. */
const titled = (name, text) => [icon(name, { className: 'title-icon' }), el('span', {}, text)];
/** Libellé de bouton : icône + texte. */
const withIcon = (name, text) => [icon(name, { size: 18 }), el('span', {}, text)];
/** Surtitre d'une partie de la page (« Partage », « Tirage »…). */
const section = (text) => el('p', { class: 'section-eyebrow' }, text);
/** Explication repliée (« En savoir plus ») : la page reste courte, le texte reste là. */
const more = (...children) => el('details', { class: 'more-info' },
  el('summary', {}, el('span', {}, 'En savoir plus'), icon('chevron-down', { size: 16, className: 'summary-chevron' })),
  el('p', {}, children));
/** Initiale (couleur selon la place dans la liste, jamais selon la personne). */
const initialOf = (name) => [...String(name)][0]?.toLocaleUpperCase('fr') || '?';
/** Champ de date : la date en toutes lettres en dessous (l'ordre jour/mois du navigateur ne trompe personne). */
function datePreview(input) {
  const out = el('span', { class: 'date-preview', 'aria-live': 'polite' });
  const show = () => { out.textContent = input.value ? formatDate(input.value) : ''; };
  input.addEventListener('input', show);
  show();
  return out;
}
import { renderGallery } from './album.js';

const token = tokenFromPath();
const base = `/api/admin/${encodeURIComponent(token)}`;
const root = document.getElementById('app');
let state = null;
// Liste « qui est le Père Noël de qui », chargée seulement à la demande de l'organisateur.
let assignments = null;
// La liste des participants repliée (grand groupe) : ouverte ou non, gardé pendant la visite.
let participantsUnfolded = (() => { try { return sessionStorage.getItem(`ss_admin_unfold_${tokenFromPath()}`) === '1'; } catch { return false; } })();
let assignmentsDrawnAt = null;
let assignmentsOpened = new Set(); // duos déjà dévoilés (un par un)

const participantUrl = (p) => `${location.origin}/p/${encodeURIComponent(p.token)}`;
const adminUrl = () => `${location.origin}/admin/${encodeURIComponent(token)}`;

function invitation(p) {
  const g = state.group;
  const lines = [
    `🎅 Salut ${p.name} !`,
    `Tu fais partie du ${eventName(g.name)}.`,
    '',
  ];
  if (g.budget) lines.push(`💰 Budget : ${g.budget}`);
  if (g.eventDate) lines.push(`📅 Échange des cadeaux : ${formatDate(g.eventDate)}`);
  if (g.description) lines.push(`📝 ${g.description.length > 200 ? `${g.description.slice(0, 200)}…` : g.description}`);
  if (g.budget || g.eventDate || g.description) lines.push('');
  lines.push(
    '👉 Ton lien perso, rien qu\'à toi (ne le transfère pas) :',
    participantUrl(p),
    '',
    'À la première ouverture, tu choisis un code secret de 4 chiffres ou plus. Retiens-le : il te sera demandé si tu reviens depuis un autre appareil.',
  );
  return lines.join('\n');
}

function rememberGroup() {
  const groups = storage.get('ss_admin_groups', []);
  const list = (Array.isArray(groups) ? groups : []).filter((g) => g && g.token !== token);
  const previous = (Array.isArray(groups) ? groups : []).find((g) => g && g.token === token);
  list.unshift({ token, name: state.group.name, createdAt: previous?.createdAt });
  storage.set('ss_admin_groups', list.slice(0, 20));
}

function forgetGroup() {
  const groups = storage.get('ss_admin_groups', []);
  storage.set('ss_admin_groups', (Array.isArray(groups) ? groups : []).filter((g) => g && g.token !== token));
}

// ---------------------------------------------------------------------------
// Présence (visible par l'organisateur seulement) : « En ligne », « Vu il y a 5 min »…
// ---------------------------------------------------------------------------
let clockOffset = 0; // écart entre l'horloge du serveur et celle de cet appareil
const ONLINE_MS = 150 * 1000; // la page d'un participant ouverte se signale au moins chaque minute

function presenceInfo(p) {
  if (!p.lastSeenAt) return p.hasCode ? { text: 'Pas revenu·e', full: 'Pas revenu·e depuis le choix du code', cls: '' } : null;
  const nowMs = Date.now() + clockOffset;
  const diff = Math.max(0, nowMs - p.lastSeenAt);
  if (diff < ONLINE_MS) return { text: 'En ligne', cls: 'online' };
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return { text: `Vu il y a ${minutes} min`, cls: '' };
  const seen = new Date(p.lastSeenAt);
  const now = new Date(nowMs);
  const time = seen.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(seen) === dayKey(now)) return { text: `Vu aujourd'hui à ${time}`, cls: '' };
  if (dayKey(seen) === dayKey(yesterday)) return { text: `Vu hier à ${time}`, cls: '' };
  return { text: `Vu le ${seen.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${time}`, cls: '' };
}

function presenceLine(p) {
  const info = presenceInfo(p);
  return el('span', { class: `presence${info?.cls ? ` ${info.cls}` : ''}`, 'data-presence': p.id, title: info?.full || null, hidden: !info }, info ? info.text : '');
}

/** Met à jour seulement les lignes de présence (sans redessiner la page). */
function refreshPresence() {
  for (const p of state?.participants || []) {
    const node = root.querySelector(`[data-presence="${CSS.escape(p.id)}"]`);
    if (node) node.replaceWith(presenceLine(p));
    const dot = root.querySelector(`[data-dot="${CSS.escape(p.id)}"]`);
    if (dot) dot.classList.toggle('online', presenceInfo(p)?.cls === 'online');
  }
}

// Un champ modifié et pas encore enregistré : on ne redessine pas la page (on perdrait la saisie).
// « En cours de saisie » = un champ diffère vraiment de ce que render() a affiché
// (taper puis effacer, ou remettre « Choisir… », ne bloque plus les mises à jour).
let renderedFields = new Map();
const fieldValue = (f) => ((f.type === 'checkbox' || f.type === 'radio') ? String(f.checked) : f.value);
const editableFields = () => [...root.querySelectorAll('input, textarea, select')].filter((f) => !f.readOnly && !f.disabled);
const snapshotFields = () => { renderedFields = new Map(editableFields().map((f) => [f, fieldValue(f)])); };
const hasUnsavedEdits = () => editableFields().some((f) => renderedFields.has(f) && renderedFields.get(f) !== fieldValue(f));

/** Tout ce qui compte à l'écran, sauf la présence (mise à jour à part, sans tout redessiner). */
const viewSignature = (view) => JSON.stringify({
  ...view, serverNow: 0, participants: view.participants.map(({ lastSeenAt, ...rest }) => rest),
});

async function pollPresence() {
  if (document.visibilityState !== 'visible' || !state) return;
  try {
    const fresh = await api('GET', base);
    clockOffset = fresh.serverNow - Date.now();
    // Quelqu'un a choisi son code, rempli sa liste… : la page entière est mise à jour
    // (badge « Lien activé », étapes), sauf si l'organisateur est en train d'écrire.
    const editing = hasUnsavedEdits() || document.querySelector('dialog[open]')
      || root.querySelector('input:focus, textarea:focus, select:focus');
    if (!editing && viewSignature(fresh) !== viewSignature(state)) {
      state = fresh;
      render();
      return;
    }
    const seen = new Map(fresh.participants.map((p) => [p.id, p.lastSeenAt]));
    for (const p of state.participants) if (seen.has(p.id)) p.lastSeenAt = seen.get(p.id);
    refreshPresence();
  } catch {
    /* réseau coupé : on réessaiera au prochain tour */
  }
}
setInterval(pollPresence, 30 * 1000);

async function load() {
  try {
    state = await api('GET', base);
    clockOffset = (state.serverNow ?? Date.now()) - Date.now();
    rememberGroup();
    render();
  } catch (err) {
    if (err.status === 404) forgetGroup();
    clear(root,
      el('section', { class: 'card center' },
        el('h1', {}, 'Oups'),
        el('p', {}, err.message),
        el('a', { class: 'btn', href: '/' }, "Retour à l'accueil"),
      ),
    );
  }
}

/** Appelle l'API puis rafraîchit l'affichage avec la vue renvoyée. */
/** Clé stable d'un élément, pour lui rendre le focus après avoir redessiné la page. */
function focusKeyOf(node) {
  if (!node || node === document.body || !root.contains(node)) return null;
  if (node.dataset.focusKey) return node.dataset.focusKey;
  const card = node.closest('[data-card]')?.dataset.card || '';
  const pid = node.closest('[data-pid]')?.dataset.pid || '';
  return [node.tagName, node.name || '', node.textContent.trim().slice(0, 40), pid, card].join('|');
}

function restoreFocus(key, cardKey) {
  if (!key) return;
  const target = [...root.querySelectorAll('button, input, select, textarea, a, summary, [data-focus-key]')].find((n) => focusKeyOf(n) === key && !n.disabled && !n.hidden);
  if (target) return target.focus();
  // L'élément a disparu (ex. bouton remplacé) : on se place sur le titre de sa carte.
  const heading = cardKey && root.querySelector(`[data-card="${cardKey}"] h2`);
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
}

async function mutate(button, method, path, body, successMessage) {
  const key = focusKeyOf(button);
  const cardKey = button?.closest('[data-card]')?.dataset.card;
  const result = await withButton(button, () => api(method, base + path, body));
  if (!result) {
    // L'action a échoué (souvent parce que la page n'était plus à jour, ex. tirage fait
    // dans un autre onglet) : on recharge pour afficher l'état réel.
    await load();
    return false;
  }
  state = result;
  render();
  restoreFocus(key, cardKey);
  if (successMessage) toast(successMessage, 'success');
  return true;
}

// ---------------------------------------------------------------------------

function render() {
  const activeKey = focusKeyOf(document.activeElement);
  const activeCard = document.activeElement?.closest?.('[data-card]')?.dataset.card;
  // Garde ouverts les panneaux repliables que l'utilisateur avait ouverts.
  const openPanels = new Set([...root.querySelectorAll('details[open][data-key]')].map((d) => d.dataset.key));
  const { group, participants } = state;
  const nameOf = new Map(participants.map((p) => [p.id, p.name]));
  const isNew = new URLSearchParams(location.search).has('new');
  document.title = `${group.name} · Organisation`;

  const header = el('header', { class: 'page-header' },
    el('a', { href: '/', class: 'back' }, icon('chevron-left', { size: 18 }), el('span', {}, 'Accueil')),
    el('p', { class: 'eyebrow' }, 'Page organisateur'),
    el('h1', {}, group.name),
  );
  // L'ordre des cartes suit l'étape du moment : avant le tirage, on partage et on prépare ;
  // après, on suit le tirage et les cadeaux (les liens se rangent dans un panneau).
  clear(root, group.drawn
    ? [
      header,
      renderChecklist(),
      section('Tirage'),
      renderStatusCard(),
      renderProgressCard(),
      group.revealed ? el('div', { id: 'admin-album' }) : null,
      section('Participants'),
      renderParticipantsCard(),
      section('Partage'),
      el('details', { class: 'card links-card', 'data-key': 'links' },
        el('summary', {}, el('h2', { class: 'inline' }, titled('link', 'Liens')), icon('chevron-down', { size: 18, className: 'summary-chevron' })),
        renderInviteCard({ nested: true }),
        renderAdminLinkCard(isNew, { nested: true })),
      section('Réglages'),
      renderSettingsCard(),
      renderDangerCard(),
    ]
    : [
      header,
      renderChecklist(),
      section('Partage'),
      renderInviteCard(),
      renderAdminLinkCard(isNew),
      section('Participants'),
      renderParticipantsCard(),
      renderExclusionsCard(nameOf),
      section('Tirage'),
      renderStatusCard(),
      section('Réglages'),
      renderSettingsCard(),
      renderDangerCard(),
    ]);
  for (const d of root.querySelectorAll('details[data-key]')) d.open = openPanels.has(d.dataset.key);
  restoreFocus(activeKey, activeCard);
  if (group.revealed) renderAdminAlbum();
  snapshotFields();
}

/** Après la révélation : l'album et le téléchargement de tous les souvenirs. */
async function renderAdminAlbum() {
  const box = document.getElementById('admin-album');
  if (!box) return;
  let data;
  try {
    data = await api('GET', `${base}/album`);
  } catch (err) {
    clear(box, el('section', { class: 'card' }, el('h2', {}, titled('images', 'Album souvenir')), el('p', { class: 'muted' }, err.message)));
    return;
  }
  const photoUrl = (e) => `${base}/album/photo/${encodeURIComponent(e.id)}?v=${e.updatedAt ?? 0}`;
  const filled = data.entries.filter((e) => e.hasPhoto || e.note).length;
  clear(box, el('section', { class: 'card album', 'data-card': 'album' },
    el('h2', {}, titled('images', 'Album souvenir')),
    el('p', { class: 'muted' }, `${filled} / ${data.entries.length} participant${data.entries.length > 1 ? 's ont' : ' a'} ajouté une photo ou un mot.`),
    renderGallery(data.entries, { photoUrl, groupName: state.group.name }),
    el('div', { class: 'downloads' },
      downloadLink(`${base}/souvenirs.zip`, withIcon('download', 'Tout télécharger'), { className: 'btn', onError: () => load() }),
    ),
    el('p', { class: 'muted small' }, '« Tout télécharger » : les photos, les petits mots et toutes les discussions avec les prénoms, dans un fichier ZIP.'),
  ));
}

/** Les étapes à suivre, cochées au fur et à mesure. */
function renderChecklist() {
  const { group, participants, limits } = state;
  const activated = participants.filter((p) => p.hasCode).length;
  const enough = participants.length >= limits.minParticipantsForDraw;
  const steps = [
    { done: enough || group.drawn, label: 'Ajouter les participants', detail: `${participants.length} personne${participants.length > 1 ? 's' : ''}` },
    // Après le tirage, l'étape est passée : elle est cochée, avec le nombre de codes en note
    // si quelqu'un n'a pas encore choisi le sien.
    {
      done: group.drawn || (participants.length > 0 && activated === participants.length),
      warn: group.drawn && activated < participants.length,
      label: 'Partager le lien du groupe',
      detail: activated === 0 ? "personne n'a encore choisi son code" : `${activated} / ${participants.length} ${activated > 1 ? 'ont choisi leur code' : 'a choisi son code'}`,
    },
    { done: group.drawn, label: 'Lancer le tirage', detail: group.drawn ? 'fait' : (enough ? 'prêt' : `au moins ${limits.minParticipantsForDraw} personnes`) },
    { done: group.revealed, label: 'Révélation pour tout le monde', detail: group.revealed ? 'fait' : "après l'échange des cadeaux" },
  ];
  // La prochaine étape vient toujours après la dernière faite (le fil ne revient pas en arrière).
  // Une fois tout révélé, il n'y en a plus.
  const lastDone = steps.map((st) => st.done).lastIndexOf(true);
  const firstTodo = group.revealed ? -1 : steps.findIndex((st, i) => !st.done && i > lastDone);
  return el('section', { class: 'card checklist', 'data-card': 'checklist', 'aria-label': 'Étapes' },
    el('p', { class: 'eyebrow' }, group.revealed ? 'Tout est fait' : (group.drawn ? 'Dernière étape' : 'Prochaine étape')),
    el('ol', { class: 'checklist-steps' }, steps.map((st, i) => el('li', {
      class: st.done ? 'done' : (i === firstTodo ? 'current' : ''),
    },
      el('span', { class: 'check', 'aria-hidden': 'true' }, st.done ? icon('check', { size: 16 }) : String(i + 1)),
      el('span', { class: 'check-text' },
        el('strong', {}, st.label),
        el('span', { class: `check-detail${st.warn ? ' warn' : ''}` }, ` · ${st.detail}`),
        el('span', { class: 'sr-only' }, st.done ? ' (fait)' : (i === firstTodo ? ' (prochaine étape)' : '')),
      ),
    ))),
  );
}

/** La date limite de la liste de souhaits est-elle dépassée (fuseau de l'appareil) ? */
function deadlinePassed() {
  const d = state.group.wishlistDeadline;
  if (!d) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return today > d;
}

const inviteUrl = () => `${location.origin}/g/${encodeURIComponent(state.inviteToken)}`;

function groupMessage() {
  const g = state.group;
  const lines = [`🎅 ${eventName(g.name)} !`, ''];
  if (g.budget) lines.push(`💰 Budget : ${g.budget}`);
  if (g.eventDate) lines.push(`📅 Échange des cadeaux : ${formatDate(g.eventDate)}`);
  if (g.budget || g.eventDate) lines.push('');
  lines.push(
    '👉 Ouvrez ce lien, appuyez sur votre prénom et choisissez un code secret de 4 chiffres ou plus (retenez-le !) :',
    inviteUrl(),
  );
  return lines.join('\n');
}

/** Le lien unique à coller dans la conversation de groupe (Messenger, WhatsApp…). */
function renderInviteCard({ nested = false } = {}) {
  const canShare = typeof navigator.share === 'function';
  return el(nested ? 'div' : 'section', { class: `${nested ? 'sub-card' : 'card'} invite`, 'data-card': 'invite' },
    el(nested ? 'h3' : 'h2', {}, titled('megaphone', 'Le lien à partager dans votre groupe')),
    el('p', {}, 'Un seul lien pour tout le monde : colle-le dans votre conversation Messenger. Chacun choisit son prénom et son code secret.'),
    el('div', { class: 'copy-row' },
      el('input', { class: 'link-field', readonly: true, value: inviteUrl(), 'aria-label': 'Lien du groupe', onfocus: (e) => e.target.select() }),
    ),
    el('div', { class: 'actions' },
      el('button', {
        class: `btn ${nested ? '' : 'btn-primary'}`, type: 'button',
        onclick: async () => {
          const ok = await copyText(groupMessage());
          toast(ok ? 'Message copié : colle-le dans Messenger !' : 'Copie impossible, sélectionne le lien à la main.', ok ? 'success' : 'error');
        },
      }, withIcon('copy', 'Copier le message')),
      canShare ? el('button', {
        class: 'btn', type: 'button',
        onclick: () => navigator.share({ title: BRAND, text: groupMessage() }).catch(() => {}),
      }, withIcon('share-2', 'Partager')) : null,
    ),
    more("Si quelqu'un se voit demander un code alors qu'il n'a jamais ouvert sa page, réinitialise son code dans la liste des participants. Toi seul vois qui est déjà venu : la page du groupe n'affiche que les prénoms."),
  );
}

function renderAdminLinkCard(isNew, { nested = false } = {}) {
  // Juste après la création, la carte est ouverte et mise en avant (il faut garder ce lien).
  // Ensuite, elle se replie en une ligne, comme « Liens » après le tirage.
  const folded = !nested && !isNew;
  const body = [
    el('p', {}, 'Garde ce lien précieusement : c\'est le seul moyen de revenir sur cette page. Ne le partage pas.'),
    el('div', { class: 'copy-row' },
      el('input', { class: 'link-field', readonly: true, value: adminUrl(), 'aria-label': 'Lien organisateur', onfocus: (e) => e.target.select() }),
      el('button', {
        class: 'btn', type: 'button',
        onclick: async () => {
          const ok = await copyText(adminUrl());
          toast(ok ? 'Lien copié !' : 'Copie impossible, sélectionne le lien à la main.', ok ? 'success' : 'error');
        },
      }, withIcon('copy', 'Copier')),
    ),
    more(
      "Après le tirage, cette page peut afficher qui est le Père Noël de qui, mais seulement si tu le demandes. Si tu participes aussi, ne l'affiche pas pour garder la surprise, et utilise ton propre lien personnel."),
  ];
  if (folded) {
    return el('details', { class: 'card links-card', 'data-key': 'admin-link' },
      el('summary', {}, el('h2', { class: 'inline' }, titled('key-round', 'Ton lien organisateur')), icon('chevron-down', { size: 18, className: 'summary-chevron' })),
      el('div', { class: 'sub-card' }, body));
  }
  return el(nested ? 'div' : 'section', { class: nested ? 'sub-card' : `card ${isNew ? 'highlight' : ''}` },
    el(nested ? 'h3' : 'h2', {}, titled('key-round', 'Ton lien organisateur')),
    body,
  );
}

function renderStatusCard() {
  const { group, participants, limits } = state;
  const card = el('section', { class: 'card', 'data-card': 'draw' }, el('h2', {}, titled('dices', 'Tirage au sort')));

  if (!group.drawn) {
    const missing = Math.max(0, limits.minParticipantsForDraw - participants.length);
    const waiting = participants.filter((p) => !p.hasCode).length;
    card.append(
      el('p', {}, "Le tirage n'a pas encore eu lieu."),
      missing > 0
        ? el('p', { class: 'muted' }, `Ajoute encore ${missing} participant${missing > 1 ? 's' : ''} pour pouvoir lancer le tirage.`)
        : el('p', { class: 'muted' }, waiting > 0
          ? `Idéalement, attends que tout le monde ait choisi son code (encore ${waiting}).`
          : 'Tout le monde a choisi son code : vérifie la liste et les exclusions, puis lance le tirage.'),
      el('button', {
        class: 'btn btn-primary btn-block', type: 'button', disabled: missing > 0,
        onclick: (e) => runDraw(e.currentTarget),
      }, withIcon('dices', 'Lancer le tirage')),
    );
    return card;
  }

  card.append(
    el('p', { class: 'status-ok' }, icon('check-circle', { size: 18 }), el('span', {}, `Tirage effectué le ${new Date(group.drawnAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}.`)),
  );
  // (append() du navigateur écrirait « null » : on n'ajoute la phrase que si elle sert.)
  if (!group.revealed) card.append(el('p', {}, 'Chaque participant voit maintenant, sur sa page personnelle, à qui il offre un cadeau, et peut discuter anonymement.'));

  if (!group.revealed && group.autoReveal && group.eventDate) {
    const [y, m, d] = group.eventDate.split('-').map(Number);
    const nextDay = new Date(y, m - 1, d + 1);
    const iso = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;
    card.append(el('p', { class: 'muted icon-line' }, icon('clock', { size: 18 }), el('span', {}, `Révélation automatique prévue le ${formatDate(iso)} (le lendemain de l'échange).`)));
  }
  if (!group.revealed && group.firstRevealedAt) {
    card.append(el('p', { class: 'notice-inline notice-warn small' }, icon('circle-alert', { size: 18, className: 'notice-icon' }), `Les Pères Noël ont été révélés le ${new Date(group.firstRevealedAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })} puis masqués. Les participants le voient aussi.`));
  }
  const actions = el('div', { class: 'actions' });
  if (!group.revealed) {
    actions.append(el('button', {
      class: 'btn btn-primary', type: 'button',
      onclick: async (e) => {
        const btn = e.currentTarget;
        if (!(await ask("Chaque participant va découvrir qui était son Père Noël secret, et la liste de qui offrait à qui. L'album souvenir s'ouvre, et tu pourras télécharger toutes les discussions.\n\nÀ faire après l'échange des cadeaux !", { title: 'Révélation pour tout le monde', confirmLabel: 'Tout révéler' }))) return;
        mutate(btn, 'POST', '/reveal', { revealed: true }, 'Les Pères Noël sont révélés !');
      },
    }, icon('sparkles', { size: 18 }), fitLabel('Révélation pour tout le monde', 'Tout révéler')));
  } else {
    card.append(el('p', { class: 'status-ok' }, icon('sparkles', { size: 18 }), el('span', {}, 'Les Pères Noël secrets sont révélés : chacun voit qui lui a offert son cadeau, et qui offrait à qui.')));
    actions.append(el('button', {
      class: 'btn', type: 'button',
      onclick: async (e) => {
        const btn = e.currentTarget;
        if (!(await ask("Chaque participant verra quand même que les Pères Noël ont été révélés puis masqués (pour que personne ne puisse regarder en cachette)." + (group.autoReveal ? "\n\nLa révélation automatique sera aussi désactivée." : ''), { title: 'Masquer à nouveau ?', confirmLabel: 'Masquer' }))) return;
        mutate(btn, 'POST', '/reveal', { revealed: false },
          group.autoReveal ? 'Révélation masquée. La révélation automatique a été désactivée.' : 'Révélation masquée.');
      },
    }, 'Masquer à nouveau'));
  }
  card.append(actions);
  card.append(renderAssignments());
  return card;
}

/** « Annuler le tirage » (dans la zone sensible), avec sa confirmation. */
function cancelDrawButton() {
  const { group } = state;
  return el('button', {
    class: 'btn btn-danger-outline', type: 'button',
    onclick: async (e) => {
      const btn = e.currentTarget;
      // La page peut dater : on relit l'état (révélé dans un autre onglet, auto-révélé, album rempli).
      const fresh = await api('GET', base).catch(() => null);
      const g = fresh?.group ?? group;
      const afterReveal = g.revealed || g.firstRevealedAt;
      const keepTip = g.revealed
        ? "\n\nPense à « Tout télécharger » avant !"
        : "\n\nPour garder les souvenirs, révèle à nouveau puis « Tout télécharger » avant d'annuler.";
      const warning = afterReveal
        ? "Les conversations, les photos et les petits mots de l'album souvenir, et l'avancement des cadeaux seront définitivement effacés, et il faudra refaire un tirage." + keepTip
        : "Les conversations et l'avancement des cadeaux seront définitivement effacés, et il faudra refaire un tirage.";
      if (!(await ask(warning, { title: 'Annuler le tirage ?', confirmLabel: 'Annuler le tirage', cancelLabel: 'Garder le tirage', danger: true }))) return;
      mutate(btn, 'POST', '/reset-draw', {}, 'Tirage annulé.').then((ok) => {
        if (ok && group.autoReveal && !state.group.autoReveal) {
          toast("Tirage annulé. La date de l'échange étant passée, la révélation automatique a été désactivée.", 'info');
        }
      });
    },
  }, 'Annuler le tirage');
}

/** Qui est le Père Noël de qui : caché par défaut, affiché seulement sur demande. */
function renderAssignments() {
  const { group } = state;
  // Un nouveau tirage rend l'ancienne liste fausse : on l'oublie.
  if (assignmentsDrawnAt !== group.drawnAt) assignments = null;
  const box = el('div', { class: 'assignments', 'data-focus-key': 'assignments' });
  if (!assignments) {
    box.append(el('button', {
      class: 'btn', type: 'button', 'data-focus-key': 'show-assignments',
      onclick: async (e) => {
        const btn = e.currentTarget;
        if (!(await ask("Chaque duo reste caché : tu l'ouvres un par un.\n\nSi tu participes aussi, n'ouvre pas la ligne « Le Père Noël de » suivie de ton prénom.", { title: 'Afficher la liste des duos ?', confirmLabel: 'Afficher' }))) return;
        const result = await withButton(btn, () => api('GET', `${base}/assignments`));
        if (!result) return;
        assignments = result.assignments;
        assignmentsDrawnAt = group.drawnAt;
        assignmentsOpened = new Set();
        render();
        root.querySelector('[data-focus-key="hide-assignments"]')?.focus();
      },
    }, icon('eye', { size: 18 }), fitLabel('Voir qui est le Père Noël de qui', 'Voir qui offre à qui')));
    return box;
  }
  box.append(
    el('h3', {}, 'Qui est le Père Noël de qui'),
    el('p', { class: 'muted small' }, `${onComputer() ? 'Clique sur' : 'Touche'} une ligne pour la dévoiler. Toi seul·e la vois : rien ne change pour les participants.`),
    el('ul', { class: 'assignment-list' }, assignments.map((a, i) => el('li', assignmentsOpened.has(i) ? { tabindex: '-1', 'data-focus-key': `duo-open-${i}` } : {},
      assignmentsOpened.has(i)
        ? [el('strong', {}, a.giver), icon('arrow-right', { size: 16, className: 'duo-arrow' }), el('span', { class: 'sr-only' }, ' offre à '), el('strong', {}, a.receiver)]
        : el('button', {
          class: 'duo-closed', type: 'button', 'data-focus-key': `duo-${i}`,
          onclick: () => {
            assignmentsOpened.add(i);
            render();
            // Le bouton a été remplacé par le duo : le focus va sur le duo dévoilé (lu à voix haute).
            root.querySelector(`[data-focus-key="duo-open-${i}"]`)?.focus();
          },
        }, icon('gift', { size: 18 }), el('span', {}, `Le Père Noël de ${a.receiver} : ${onComputer() ? 'cliquer' : 'toucher'} pour voir`)),
    ))),
    el('button', {
      class: 'btn btn-small', type: 'button', 'data-focus-key': 'hide-assignments',
      onclick: () => {
        assignments = null;
        render();
        root.querySelector('[data-focus-key="show-assignments"]')?.focus();
      },
    }, 'Cacher la liste'),
  );
  return box;
}

async function runDraw(button) {
  // État à jour avant d'afficher l'avertissement (quelqu'un a pu choisir son code entre-temps).
  try { state = await api('GET', base); } catch { /* on garde l'état affiché */ }
  const n = state.participants.length;
  let message = `Le tirage va désigner, pour chacun des ${n} participants, la personne à qui offrir un cadeau.\nLa liste des participants sera ensuite verrouillée.`;
  if (n === 3) {
    message += "\n\nÀ 3 personnes, chacun pourra deviner qui est son Père Noël secret (c'est forcément la personne à qui il n'offre pas). Mieux vaut être au moins 4.";
  }
  const waiting = state.participants.filter((p) => !p.hasCode).length;
  if (waiting > 0) {
    message += `\n\n${waiting === 1 ? "1 personne n'a pas encore choisi son code" : `${waiting} personnes n'ont pas encore choisi leur code`} : tant que ce n'est pas fait, quelqu'un d'autre du groupe pourrait ouvrir ${waiting === 1 ? 'sa page' : 'leur page'} et voir à qui ${waiting === 1 ? 'elle offre' : 'elles offrent'}. Mieux vaut attendre.`;
  }
  if (!(await ask(message, { title: 'Lancer le tirage ?', confirmLabel: 'Lancer le tirage' }))) return;
  try {
    button.disabled = true;
    state = await api('POST', `${base}/draw`, {});
  } catch (err) {
    if (err.code !== 'predictable' && err.code !== 'mutual') {
      button.disabled = false;
      toast(err.message, 'error');
      await load(); // la page n'était peut-être plus à jour
      return;
    }
    if (!(await ask(err.message, { title: 'Tirage devinable', confirmLabel: 'Tirer quand même' }))) {
      button.disabled = false;
      return;
    }
    const forced = await withButton(button, () => api('POST', `${base}/draw`, { force: true }));
    if (!forced) return;
    state = forced;
  }
  render();
  restoreFocus('none', 'draw'); // le bouton a été remplacé : focus sur le titre « Tirage au sort »
  toast('Tirage effectué !', 'success');
}

/** Avancement des cadeaux : uniquement des totaux, sans dire qui offre à qui. */
function renderProgressCard() {
  const progress = state.giftProgress;
  if (!progress) return null;
  const steps = [
    ['searching', 'search', 'Cherchent encore'],
    ['idea', 'lightbulb', 'Ont trouvé une idée'],
    ['bought', 'shopping-bag', 'Ont acheté ou fabriqué'],
    ['wrapped', 'gift', 'Ont emballé'],
  ];
  const ready = progress.wrapped;
  // Largeur posée via le CSSOM : un attribut style="" serait bloqué par la CSP.
  const fill = el('div', { class: 'meter-fill' });
  fill.style.width = `${progress.total ? Math.round((ready / progress.total) * 100) : 0}%`;
  return el('section', { class: 'card', 'data-card': 'progress' },
    el('h2', {}, titled('gift', 'Avancement des cadeaux')),
    el('div', { class: 'meter', role: 'img', 'aria-label': `${ready} cadeau(x) emballé(s) sur ${progress.total}` }, fill),
    el('p', {}, el('strong', {}, `${ready} / ${progress.total}`), ' cadeaux prêts'),
    el('ul', { class: 'progress-list' }, steps.map(([key, iconName, label]) => el('li', {},
      icon(iconName, { size: 18 }), el('span', {}, label), el('strong', { class: 'num' }, String(progress[key])),
    ))),
    el('p', { class: 'muted small' }, 'Chacun indique où il en est sur sa page.'),
  );
}

/** Ferme le panneau d'actions d'un participant ouvert (un seul à la fois). */
function closeSheets({ focusBack = false } = {}) {
  for (const sheet of root.querySelectorAll('.row-sheet:not([hidden])')) {
    sheet.hidden = true;
    const li = sheet.closest('.participant');
    const more = li?.querySelector('.row-more');
    more?.setAttribute('aria-expanded', 'false');
    li?.classList.remove('sheet-open');
    if (focusBack) more?.focus();
  }
  document.body.classList.remove('sheet-open');
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('sheet-open') && !document.querySelector('dialog[open]')) closeSheets({ focusBack: true });
});

function renderParticipantsCard() {
  const { group, participants, limits } = state;
  const activated = participants.filter((p) => p.hasCode).length;
  const letters = participants.filter((p) => p.hasWishlist).length;
  const card = el('section', { class: 'card', 'data-card': 'participants' },
    el('h2', {}, titled('users', `Participants (${participants.length})`)),
    participants.length ? el('p', { class: 'participants-summary' },
      el('strong', {}, `${activated}/${participants.length}`), ` code${activated > 1 ? 's' : ''} choisi${activated > 1 ? 's' : ''}`,
      group.revealed ? null : [' · ', el('strong', {}, String(letters)), ` lettre${letters > 1 ? 's' : ''} écrite${letters > 1 ? 's' : ''}`]) : null,
    more(
      "« Pas ouvert » : la personne n'a pas encore choisi son code. À côté du prénom : sa dernière visite. Tu peux aussi envoyer à quelqu'un son lien personnel directement (bouton « Copier l'invitation », dans le menu de chaque prénom). N'ouvre pas les liens des autres : la première personne qui ouvre un lien choisit le code qui le protège."),
  );

  if (participants.length === 0) {
    card.append(el('p', { class: 'empty' }, 'Aucun participant pour le moment.'));
  }

  const list = el('ul', { class: 'participants' });
  for (const [index, p] of participants.entries()) {
    const canShare = typeof navigator.share === 'function';
    const sheetId = `sheet-${p.id}`;
    // Les actions d'un participant : dans un panneau qui monte du bas de l'écran.
    const sheet = el('div', { class: 'row-sheet', id: sheetId, role: 'group', 'aria-label': `Actions pour ${p.name}`, hidden: true },
      el('div', { class: 'row-sheet-scrim', 'aria-hidden': 'true', onclick: () => closeSheets({ focusBack: true }) }),
      el('div', { class: 'row-sheet-panel' },
        el('span', { class: 'ask-grabber', 'aria-hidden': 'true' }),
        el('div', { class: 'row-sheet-head' },
          el('p', { class: 'row-sheet-title' }, p.name),
          el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer', onclick: () => closeSheets({ focusBack: true }) }, icon('x'))),
        el('label', { class: 'field-label', for: `link-${p.id}` }, 'Lien personnel'),
        el('input', { class: 'link-field', id: `link-${p.id}`, readonly: true, value: participantUrl(p), 'aria-label': `Lien de ${p.name}`, onfocus: (e) => e.target.select() }),
        el('div', { class: 'row-sheet-actions' },
          el('button', {
            class: 'btn btn-primary', type: 'button',
            onclick: async () => {
              const ok = await copyText(invitation(p));
              toast(ok ? `Invitation pour ${p.name} copiée !` : 'Copie impossible, sélectionne le lien à la main.', ok ? 'success' : 'error');
            },
          }, withIcon('copy', 'Copier l\'invitation')),
          canShare ? el('button', {
            class: 'btn', type: 'button',
            onclick: () => navigator.share({ title: BRAND, text: invitation(p) }).catch(() => {}),
          }, withIcon('share-2', 'Partager')) : null,
          el('button', {
            class: 'btn', type: 'button',
            onclick: async (e) => {
              const btn = e.currentTarget;
              closeSheets({ focusBack: true }); // la fenêtre de confirmation prend le relais
              const name = await ask('', {
                title: `Renommer ${p.name}`, confirmLabel: 'Renommer',
                input: {
                  value: p.name, label: 'Nouveau prénom', maxLength: 40,
                  validate: (v) => (participants.some((o) => o.id !== p.id && o.name.toLocaleLowerCase('fr') === v.toLocaleLowerCase('fr')) ? `Il y a déjà un participant nommé « ${v} ».` : null),
                },
              });
              if (name === null || name.trim() === '' || name.trim() === p.name) return;
              closeSheets();
              mutate(btn, 'PATCH', `/participants/${encodeURIComponent(p.id)}`, { name: name.trim() }, 'Nom modifié.');
            },
          }, withIcon('pen-line', 'Renommer')),
          p.hasCode ? el('button', {
            class: 'btn btn-danger-outline', type: 'button',
            onclick: async (e) => {
              const btn = e.currentTarget;
              closeSheets({ focusBack: true }); // la fenêtre de confirmation prend le relais
              if (!(await ask(`À faire seulement si ${p.name} a oublié son code. Son lien restera le même et ${p.name} choisira un nouveau code à sa prochaine visite.\n\nPour garantir l'anonymat, ${p.name} verra que son code a été réinitialisé.`, { title: `Réinitialiser le code de ${p.name} ?`, confirmLabel: 'Réinitialiser' }))) return;
              closeSheets();
              mutate(btn, 'POST', `/participants/${encodeURIComponent(p.id)}/reset-code`, {}, `Code de ${p.name} réinitialisé.`);
            },
          }, withIcon('key-round', 'Réinitialiser le code')) : null,
          group.drawn ? null : el('button', {
            class: 'btn btn-danger-outline', type: 'button',
            onclick: async (e) => {
              const btn = e.currentTarget;
              closeSheets({ focusBack: true }); // la fenêtre de confirmation prend le relais
              if (!(await ask(`${p.name} ne participera plus au Secret Santa et son lien ne marchera plus.`, { title: `Retirer ${p.name} ?`, confirmLabel: 'Retirer', danger: true }))) return;
              closeSheets();
              mutate(btn, 'DELETE', `/participants/${encodeURIComponent(p.id)}`, {}, `${p.name} ne fait plus partie du groupe.`);
            },
          }, withIcon('trash-2', 'Retirer')),
        ),
      ),
    );
    const info = presenceInfo(p);
    list.append(el('li', { class: `participant${!p.hasCode || p.resetCount ? ' needs-attention' : ''}`, 'data-pid': p.id },
      el('div', { class: 'participant-row' },
        el('span', { class: `avatar avatar-initial avatar-tone-${index % 4}`, 'aria-hidden': 'true' },
          initialOf(p.name),
          el('span', { class: `presence-dot${info?.cls === 'online' ? ' online' : ''}`, 'data-dot': p.id })),
        // Deux lignes égales pour tout le monde : le prénom et sa présence, puis les pastilles.
        // (« Lien activé » n'est plus affiché : le résumé « 12/13 codes choisis » le dit déjà.)
        el('div', { class: 'participant-main' },
          el('div', { class: 'participant-head' },
            el('strong', { class: 'participant-name' }, p.name),
            presenceLine(p)),
          el('div', { class: 'participant-badges' },
            p.hasCode ? null : el('span', { class: 'badge badge-wait' }, 'Pas ouvert'),
            // Après la révélation, les lettres ne servent plus : pas de badge.
            group.revealed ? null : p.hasWishlist
              ? el('span', { class: 'badge badge-info' }, 'Lettre ✓')
              : el('span', { class: `badge ${deadlinePassed() ? 'badge-danger' : 'badge-neutral'}` }, 'Liste vide'),
            p.resetCount ? el('span', { class: 'badge badge-wait' }, `Code réinit. ×${p.resetCount}`) : null)),
        el('button', {
          class: 'icon-btn row-more', type: 'button', 'aria-label': `Actions pour ${p.name}`, 'aria-expanded': 'false', 'aria-controls': sheetId,
          onclick: (e) => {
            const more = e.currentTarget;
            const opening = sheet.hidden;
            closeSheets();
            if (!opening) return;
            sheet.hidden = false;
            more.setAttribute('aria-expanded', 'true');
            more.closest('.participant').classList.add('sheet-open');
            document.body.classList.add('sheet-open');
            sheet.querySelector('.row-sheet-actions .btn')?.focus({ preventScroll: true });
          },
        }, icon('ellipsis'))),
      sheet,
    ));
  }
  card.append(list);
  // Grand groupe : la liste se replie après 6 prénoms (ceux qui demandent une action restent
  // toujours visibles).
  const FOLD_AFTER = 6;
  if (participants.length > FOLD_AFTER + 2) {
    const hiddenCount = participants.slice(FOLD_AFTER).length;
    const toggle = el('button', { class: 'btn btn-block participants-toggle', type: 'button', 'aria-controls': 'participants-list', 'data-focus-key': 'participants-toggle' });
    list.id = 'participants-list';
    const apply = () => {
      list.classList.toggle('is-folded', !participantsUnfolded);
      toggle.setAttribute('aria-expanded', String(participantsUnfolded));
      toggle.replaceChildren(
        el('span', {}, participantsUnfolded ? 'Réduire la liste' : `Voir les ${participants.length} participants`),
        icon('chevron-down', { size: 18, className: participantsUnfolded ? 'flip' : '' }));
    };
    toggle.addEventListener('click', () => {
      participantsUnfolded = !participantsUnfolded;
      try { sessionStorage.setItem(`ss_admin_unfold_${token}`, participantsUnfolded ? '1' : ''); } catch { /* stockage indisponible */ }
      apply();
    });
    apply();
    if (hiddenCount > 0) card.append(toggle);
  }
  const late = participants.filter((p) => !p.hasWishlist);
  if (late.length && participants.length && !group.revealed) {
    const remindLabel = `Copier un rappel pour les ${late.length} lettre${late.length > 1 ? 's' : ''} pas encore écrite${late.length > 1 ? 's' : ''}`;
    card.append(el('div', { class: 'actions' }, el('button', {
      class: 'btn btn-small', type: 'button', title: remindLabel, 'aria-label': remindLabel,
      onclick: async () => {
        const g = state.group;
        const who = late.map((p) => p.name).join(', ');
        const text = [
          `📝 Petit rappel du ${eventName(g.name)} !`,
          `${who} : vous n'avez pas encore écrit votre lettre au Père Noël${g.wishlistDeadline ? ` (date limite : ${formatDate(g.wishlistDeadline)})` : ''}.`,
          'Ça aide énormément votre Père Noël secret 🎅',
          inviteUrl(),
        ].join('\n');
        const ok = await copyText(text);
        toast(ok ? 'Rappel copié : colle-le dans Messenger !' : 'Copie impossible.', ok ? 'success' : 'error');
      },
    }, withIcon('copy', `Copier un rappel (${late.length})`))));
  }

  if (!group.drawn && participants.length < limits.maxParticipants) {
    const input = el('input', { name: 'name', maxlength: '40', placeholder: 'Prénom', required: true, autocomplete: 'off', 'aria-label': 'Prénom du participant' });
    const form = el('form', { class: 'copy-row', novalidate: true },
      input,
      el('button', { class: 'btn', type: 'submit' }, withIcon('plus', 'Ajouter')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      const ok = await mutate(form.querySelector('button'), 'POST', '/participants', { name }, `${name} fait partie du groupe !`);
      if (ok) document.querySelector('form.copy-row input[name=name]')?.focus();
    });
    card.append(el('h3', { class: 'card-subhead' }, 'Ajouter un participant'), form);
  } else if (group.drawn) {
    card.append(el('p', { class: 'muted small' }, 'La liste est verrouillée depuis le tirage. Pour ajouter ou retirer quelqu\'un, annule le tirage (les conversations seront effacées).'));
  }
  return card;
}

function renderExclusionsCard(nameOf) {
  const { participants, exclusions } = state;
  // Replié tant qu'il n'y a pas d'exclusion (la page reste courte).
  const wasOpen = root.querySelector('[data-card="exclusions"]')?.open;
  const card = el('details', { class: 'card', 'data-card': 'exclusions', open: Boolean(wasOpen || exclusions.length) },
    el('summary', {}, el('h2', { class: 'inline' }, titled('ban', 'Exclusions (facultatif)')), icon('chevron-down', { size: 18, className: 'summary-chevron' })),
    el('p', { class: 'muted small' }, 'Deux personnes « exclues » ne pourront pas se tirer au sort l\'une l\'autre (par exemple un couple qui s\'offre déjà des cadeaux).'),
  );
  if (exclusions.length) {
    card.append(el('ul', { class: 'exclusions' }, exclusions.map((x) => el('li', {},
      el('span', {}, `${nameOf.get(x.a) ?? '?'} ✕ ${nameOf.get(x.b) ?? '?'}`),
      el('button', {
        class: 'btn btn-small btn-ghost', type: 'button',
        onclick: (e) => mutate(e.currentTarget, 'DELETE', '/exclusions', { a: x.a, b: x.b }, 'Exclusion retirée.'),
      }, 'Retirer'),
    ))));
  }
  if (participants.length < 2) {
    card.append(el('p', { class: 'muted small' }, 'Ajoute au moins deux participants pour créer une exclusion.'));
    return card;
  }
  const options = () => participants.map((p) => el('option', { value: p.id }, p.name));
  const selectA = el('select', { 'aria-label': 'Première personne' }, el('option', { value: '' }, 'Choisir…'), options());
  const selectB = el('select', { 'aria-label': 'Deuxième personne' }, el('option', { value: '' }, 'Choisir…'), options());
  const form = el('form', { class: 'exclusion-form', novalidate: true },
    selectA, el('span', { class: 'muted' }, '✕'), selectB,
    el('button', { class: 'btn', type: 'submit' }, 'Ajouter'),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!selectA.value || !selectB.value) return toast('Choisis deux personnes.', 'error');
    if (selectA.value === selectB.value) return toast('Choisis deux personnes différentes.', 'error');
    mutate(form.querySelector('button'), 'POST', '/exclusions', { a: selectA.value, b: selectB.value }, 'Exclusion ajoutée.');
  });
  card.append(form);
  return card;
}

function renderSettingsCard() {
  const { group } = state;
  const form = el('form', { novalidate: true },
    el('label', { class: 'field' }, el('span', {}, 'Nom du groupe'),
      el('input', { name: 'name', maxlength: '80', required: true, value: group.name })),
    el('div', { class: 'row' },
      el('label', { class: 'field' }, el('span', {}, 'Budget'),
        el('input', { name: 'budget', maxlength: '40', value: group.budget, placeholder: '2 000 XPF minimum' })),
      (() => { const d = el('input', { name: 'eventDate', type: 'date', value: group.eventDate }); return el('label', { class: 'field' }, el('span', {}, "Date de l'échange"), d, datePreview(d)); })(),
    ),
    el('label', { class: 'field' }, el('span', {}, 'Message pour les participants'),
      el('textarea', { name: 'description', rows: '3', maxlength: '1000', value: group.description })),
    (() => { const d = el('input', { name: 'wishlistDeadline', type: 'date', value: group.wishlistDeadline }); return el('label', { class: 'field' }, el('span', {}, 'Date limite pour écrire sa lettre au Père Noël ', el('span', { class: 'muted' }, '(facultatif)')), d, datePreview(d)); })(),
    el('label', { class: 'field' },
      el('span', {}, 'Code organisateur ', el('span', { class: 'muted' }, state.hasAdminCode ? '(déjà choisi ✓ — laisse vide pour le garder)' : '(4 à 12 chiffres)')),
      el('input', { name: 'adminCode', type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '12', autocomplete: 'off', placeholder: state.hasAdminCode ? '••••••' : 'Ex. : un code à 6 chiffres' }),
      el('span', { class: 'muted small field-help' }, "Avec ce code, « Je suis l'organisateur » sur la page « Qui es-tu ? » du lien du groupe ouvre cette page. Ne le donne à personne.")),
    el('label', { class: 'checkbox' },
      el('input', { type: 'checkbox', name: 'autoReveal', checked: group.autoReveal }),
      el('span', {}, "Révéler automatiquement les Pères Noël le lendemain de l'échange (date obligatoire)")),
    el('button', { class: 'btn btn-primary', type: 'submit' }, withIcon('save', 'Enregistrer')),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    if (!String(data.get('name') || '').trim()) return toast('Le nom du groupe est obligatoire.', 'error');
    const adminCode = String(data.get('adminCode') || '').trim();
    if (adminCode && !/^[0-9]{4,12}$/.test(adminCode)) return toast('Le code organisateur doit faire de 4 à 12 chiffres.', 'error');
    mutate(form.querySelector('button'), 'PATCH', '', {
      name: String(data.get('name') || ''),
      budget: String(data.get('budget') || ''),
      eventDate: String(data.get('eventDate') || ''),
      description: String(data.get('description') || ''),
      autoReveal: data.get('autoReveal') === 'on',
      wishlistDeadline: String(data.get('wishlistDeadline') || ''),
      ...(adminCode ? { adminCode } : {}),
      // Le fuseau est fixé à la création du groupe : ne pas le renvoyer, un simple
      // enregistrement depuis un autre fuseau ne doit rien révéler ni masquer.
    }, 'Modifications enregistrées.');
  });
  return el('details', { class: 'card', 'data-key': 'settings' }, el('summary', {}, el('h2', { class: 'inline' }, titled('settings', 'Paramètres du groupe')), icon('chevron-down', { size: 18, className: 'summary-chevron' })), form);
}

function renderDangerCard() {
  const { group } = state;
  return el('details', { class: 'card danger-zone', 'data-key': 'danger' },
    el('summary', {}, el('h2', { class: 'inline' }, titled('circle-alert', 'Zone sensible')), icon('chevron-down', { size: 18, className: 'summary-chevron' })),
    group.drawn ? el('div', { class: 'danger-item' },
      el('h3', {}, 'Annuler le tirage'),
      el('p', { class: 'muted small' }, 'Efface les conversations et l’avancement des cadeaux ; il faudra refaire un tirage.'),
      cancelDrawButton()) : null,
    el('div', { class: 'danger-item' },
    el('h3', {}, 'Supprimer le groupe'),
    el('p', { class: 'muted small' }, 'Supprime définitivement le groupe, les participants, les listes de souhaits et toutes les conversations.'),
    el('button', {
      class: 'btn btn-danger-outline', type: 'button',
      onclick: async (e) => {
        const btn = e.currentTarget;
        if (!(await ask('Le groupe, les participants, les listes de souhaits et toutes les conversations seront effacés. Cette action est irréversible.', { title: `Supprimer « ${state.group.name} » ?`, confirmLabel: 'Supprimer définitivement', danger: true }))) return;
        const ok = await withButton(btn, () => api('DELETE', base, {}));
        if (!ok) return;
        forgetGroup();
        toast('Groupe supprimé.', 'success');
        setTimeout(() => { location.href = '/'; }, 900);
      },
    }, withIcon('trash-2', 'Supprimer définitivement'))),
  );
}

document.addEventListener('visibilitychange', () => {
  // Rafraîchit les statuts (liens activés, listes…) quand on revient sur l'onglet,
  // sauf si l'utilisateur est en train de taper quelque chose.
  const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.activeElement.readOnly;
  const openDetails = document.querySelector('details[open]');
  if (document.visibilityState === 'visible' && state && !typing && !openDetails && !hasUnsavedEdits()) load();
});

load();
