import { api, el, clear, toast, withButton, tokenFromPath, formatDate, formatTime, linkify, ask, storage, downloadLink, frTypo, eventName, pageTitle, isBrandName, onComputer, icon, fitLabel } from './common.js';
import { prepareImage, renderGallery } from './album.js';

const token = tokenFromPath();
const base = `/api/p/${encodeURIComponent(token)}`;
const root = document.getElementById('app');

const MESSAGE_POLL_MS = 4000;
const STATE_POLL_MS = 20000;

let state = null;
let chat = null; // état de la messagerie, créé après le tirage
let pollTimer = null;
let lastStatePoll = 0;
let polling = false;
let renderedDrawnAt; // drawnAt du tirage affiché à l'écran
let renderedRevealed; // révélation affichée à l'écran
let failedAttemptsNotice = 0; // essais ratés signalés à la connexion, jusqu'à ce que le participant les ait vus
let codeCreatedNotice = false; // code tout juste choisi : rappel de bien le retenir
let wishlistDraft = null; // brouillon de lettre non enregistré, gardé même quand la carte est cachée (révélation)
let unwrapping = false; // animation d'ouverture du cadeau en cours
let currentTab = null; // onglet affiché (« tirage », « lettre », « salettre », « messages »…), gardé dans l'adresse (#lettre)
let revealOpened = 0; // nombre de cadeaux déjà ouverts dans l'animation de révélation
let revealTimer = null;
let lastInfoKey = null; // évite de redessiner (et de perdre le focus) quand rien n'a changé
let pendingFocusKey = null; // élément à refocaliser au prochain rendu (après un clic)

const GIFT_STEPS = [
  ['searching', 'search', 'Je cherche'],
  ['idea', 'lightbulb', 'Idée trouvée'],
  ['bought', 'shopping-bag', 'Acheté / fabriqué'],
  ['wrapped', 'bow', 'Emballé'],
];

/** Titre de carte : icône dorée + texte. */
const titled = (name, text) => [icon(name, { className: 'title-icon' }), el('span', {}, text)];
/** Libellé de bouton : icône + texte. */
const withIcon = (name, text) => [icon(name, { size: 18 }), el('span', {}, text)];

// ---------------------------------------------------------------------------
// Chargement et connexion
// ---------------------------------------------------------------------------

async function load() {
  try {
    state = await api('GET', base);
  } catch (err) {
    stopPolling();
    chat?.destroy();
    chat = null;
    clear(root,
      el('section', { class: 'card center' },
        el('h1', {}, 'Oups'),
        el('p', {}, err.message),
      ),
    );
    return;
  }
  if (!state.authenticated) {
    stopPolling();
    chat?.destroy();
    chat = null;
    return renderEnter();
  }
  renderMain();
  startPolling();
}

/** « dans 3 jours », « demain », « aujourd'hui », « passée »… */
function relativeDay(iso) {
  const n = daysUntil(iso);
  if (n === 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  if (n > 1) return `dans ${n} jours`;
  if (n === -1) return 'hier';
  return `il y a ${-n} jours`;
}

// Mois affiché dans le calendrier (conservé quand la page se rafraîchit).
let calMonth = null; // { y, m } (m de 0 à 11)

const isoOf = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const monthOf = (iso) => { const [y, m] = iso.split('-').map(Number); return { y, m: m - 1 }; };

/** Calendrier du mois : aujourd'hui, date limite de la liste et jour de l'échange. */
function renderCalendar(marks, sfx = '') {
  const today = todayLocal();
  if (!calMonth) calMonth = monthOf(today);
  const { y, m } = calMonth;
  const monthName = new Date(y, m, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const offset = (new Date(y, m, 1).getDay() + 6) % 7; // lundi en premier
  const inMonth = new Date(y, m + 1, 0).getDate();
  const weeks = Math.ceil((offset + inMonth) / 7);
  const move = (delta) => {
    const d = new Date(y, m + delta, 1);
    calMonth = { y: d.getFullYear(), m: d.getMonth() };
    redrawDates(delta < 0 ? 'cal-prev' : 'cal-next');
  };
  const rows = [];
  for (let w = 0; w < weeks; w += 1) {
    const cells = [];
    for (let i = 0; i < 7; i += 1) {
      const date = new Date(y, m, 1 - offset + w * 7 + i);
      const iso = isoOf(date.getFullYear(), date.getMonth(), date.getDate());
      const other = date.getMonth() !== m;
      // Jours d'un autre mois : cases vides (plus calme, et plus de chiffres trop pâles).
      if (other) { cells.push(el('td', { class: 'cal-day other' })); continue; }
      const kinds = marks.filter((k) => k.iso === iso);
      const cls = ['cal-day', other ? 'other' : '', iso === today ? 'today' : '', ...kinds.map((k) => k.kind)].filter(Boolean).join(' ');
      const label = [iso === today ? "aujourd'hui" : null, ...kinds.map((k) => k.label)].filter(Boolean).join(', ');
      cells.push(el('td', { class: cls, 'aria-current': iso === today ? 'date' : null },
        el('span', { class: 'cal-num' }, String(date.getDate())),
        label ? el('span', { class: 'sr-only' }, ` (${label})`) : null));
    }
    rows.push(el('tr', {}, cells));
  }
  const days = [['lu', 'lundi'], ['ma', 'mardi'], ['me', 'mercredi'], ['je', 'jeudi'], ['ve', 'vendredi'], ['sa', 'samedi'], ['di', 'dimanche']];
  return el('div', { class: 'cal' },
    el('div', { class: 'cal-head' },
      el('h3', { class: 'cal-title', id: `cal-title${sfx}`, 'aria-live': 'polite' }, monthName),
      el('div', { class: 'cal-nav' },
        el('button', { class: 'cal-btn', type: 'button', 'aria-label': 'Mois précédent', 'data-focus-key': 'cal-prev', onclick: () => move(-1) }, icon('chevron-left')),
        el('button', { class: 'cal-btn', type: 'button', 'aria-label': 'Mois suivant', 'data-focus-key': 'cal-next', onclick: () => move(1) }, icon('chevron-right')))),
    el('table', { class: 'cal-grid', 'aria-labelledby': `cal-title${sfx}` },
      el('thead', {}, el('tr', {}, days.map(([short, long]) => el('th', { scope: 'col', abbr: long }, short)))),
      el('tbody', {}, rows)),
  );
}

/** Les dates importantes, toujours au même endroit : calendrier + aujourd'hui, liste de souhaits, échange. */
function datesCard(sfx = '') {
  const g = state.group;
  const deadline = g.wishlistDeadline;
  const deadlineLate = deadline && daysUntil(deadline) < 0;
  // Après l'échange, la date limite n'est plus qu'une information (ni « dépassée », ni en surbrillance).
  const urge = !g.revealed && !state.me.wishlist && !exchangeReached();
  const marks = [
    deadline ? { iso: deadline, kind: 'deadline', label: 'date limite de la lettre au Père Noël' } : null,
    g.eventDate ? { iso: g.eventDate, kind: 'exchange', label: 'échange des cadeaux' } : null,
  ].filter(Boolean);
  // Une ligne de la légende : un appui affiche le bon mois dans le calendrier.
  const row = (kind, iconName, label, iso, value, hint, hot = false) => {
    const content = [
      el('span', { class: `date-icon date-icon-${kind}`, 'aria-hidden': 'true' }, icon(iconName, { size: 18 })),
      el('span', { class: 'date-text' },
        el('span', { class: 'date-label' }, label),
        el('span', { class: 'date-value' }, value),
        hint ? el('span', { class: 'date-hint' }, hint) : null),
    ];
    return el('li', {}, iso
      ? el('button', {
        class: `date-row date-row-${kind}${hot ? ' hot' : ''}`, type: 'button', 'data-focus-key': `date-${kind}`,
        'aria-label': `${label} : ${value}${hint ? `, ${hint}` : ''}. Afficher dans le calendrier`,
        onclick: () => { calMonth = monthOf(iso); redrawDates(`date-${kind}`); },
      }, content)
      : el('div', { class: `date-row date-row-${kind}${hot ? ' hot' : ''}` }, content));
  };
  const { participants } = state;
  return el('section', { class: 'card dates', 'aria-labelledby': `dates-title${sfx}` },
    el('h2', { id: `dates-title${sfx}` }, titled('calendar', 'Les dates')),
    el('div', { class: 'dates-grid' },
    renderCalendar(marks, sfx),
    el('div', { class: 'dates-side' },
    el('ul', { class: 'date-list' },
      row('today', 'sun', "Aujourd'hui", todayLocal(), formatDate(todayLocal())),
      row('deadline', 'mail', 'Lettre au Père Noël à écrire avant le',
        deadline || null,
        deadline ? formatDate(deadline) : 'Pas de date limite',
        deadline ? (deadlineLate && !exchangeReached() ? 'Date dépassée' : relativeDay(deadline)) : null,
        Boolean(deadline) && urge && daysUntil(deadline) <= 3),
      row('exchange', 'gift', 'Échange des cadeaux',
        g.eventDate || null,
        g.eventDate ? formatDate(g.eventDate) : "Pas encore fixée par l'organisateur",
        g.eventDate ? relativeDay(g.eventDate) : null),
    ))),
    // Infos pratiques (dans la page seulement) : chaque date n'apparaît qu'une fois, au-dessus.
    sfx ? null : el('dl', { class: 'facts' },
      g.budget ? [el('dt', {}, 'Budget'), el('dd', {}, g.budget)] : null,
      [el('dt', {}, 'Participants'), el('dd', {}, participants.join(', '))],
    ),
    sfx || !g.description ? null : el('div', { class: 'orga-note' }, el('h3', {}, "Le mot de l'orga"), el('p', { class: 'wishlist-text' }, linkify(g.description))),
  );
}

/** Redessine la carte des dates en gardant le focus sur le bouton utilisé. */
function redrawDates(focusKey) {
  // Le calendrier peut être dans la page et dans le plein écran de la première connexion.
  for (const box of document.querySelectorAll('[data-dates-box]')) {
    const had = box.contains(document.activeElement);
    clear(box, datesCard(box.dataset.datesBox));
    if (focusKey && had) box.querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
  }
}

// ---------------------------------------------------------------------------
// Découverte de la personne à qui on offre : un cadeau à ouvrir, une seule fois
// ---------------------------------------------------------------------------
const unwrapKey = () => `ss_unwrapped_${token}_${state.group.drawnAt}`;
// Brouillon de lettre au Père Noël pas encore enregistré : gardé sur l'appareil (l'onglet peut
// être rechargé, ex. iPhone qui libère la mémoire d'un onglet en arrière-plan).
const draftKey = () => `ss_wish_draft_${token}`;
const forgetDraft = () => { try { localStorage.removeItem(draftKey()); } catch { /* stockage indisponible */ } };
/** Le cadeau a-t-il déjà été ouvert (sur cet appareil, pour ce tirage) ? */
const isUnwrapped = () => !state.group.drawn || state.group.revealed || !state.recipient || Boolean(state.giftOpened) || Boolean(storage.get(unwrapKey(), false));
// Retenu par le serveur : une seule fois par personne, quel que soit l'appareil.
const markUnwrapped = () => {
  skipStatusThisVisit(); // cadeau découvert à l'instant : la question attendra la prochaine visite
  storage.set(unwrapKey(), true);
  state.giftOpened = true;
  api('POST', `${base}/gift-opened`, { drawnAt: state.group.drawnAt }).catch(() => { /* hors ligne : réessayé à la prochaine ouverture */ });
};

/**
 * Confettis dorés (rectangles et étoiles à 4 branches) qui tombent sur les côtés de l'écran,
 * derrière le prénom : ils ne le cachent jamais.
 */
function foilConfetti(layer) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#C9A45C', '#E6C987', '#FBF7EF', '#A3202F'];
  for (let i = 0; i < 56; i += 1) {
    const star = i % 5 === 0;
    const piece = el('span', { class: `foil${star ? ' foil-star' : ''}`, 'aria-hidden': 'true' });
    // Sur les bords, à gauche ou à droite, et toujours vers l'extérieur : jamais sur le texte.
    const right = i % 2 === 1;
    const side = right ? 86 + Math.random() * 14 : Math.random() * 14;
    piece.style.setProperty('--x', `${side.toFixed(1)}%`);
    piece.style.setProperty('--c', colors[i % colors.length]);
    piece.style.setProperty('--dur', `${(2.1 + Math.random() * 0.8).toFixed(2)}s`);
    piece.style.setProperty('--delay', `${(Math.random() * 0.5).toFixed(2)}s`);
    piece.style.setProperty('--drift', `${(right ? 1 : -1) * Math.round(Math.random() * 30)}px`);
    piece.style.setProperty('--rot', `${Math.round(Math.random() * 720 - 360)}deg`);
    layer.append(piece);
  }
  setTimeout(() => layer.replaceChildren(), 3600);
}

let giftOverlayDismissed = false; // « Plus tard » : on ne rouvre pas le plein écran à chaque rafraîchissement

/** Le cadeau en 3D : une vraie boîte (4 côtés), un couvercle, le ruban et un nœud doré. */
function giftBox(label) {
  const face = (cls) => el('span', { class: `g3-face ${cls}` });
  return el('button', { class: 'gift-box g3', type: 'button', 'aria-label': label },
    el('span', { class: 'g3-shadow', 'aria-hidden': 'true' }),
    el('span', { class: 'g3-light', 'aria-hidden': 'true' }),
    el('span', { class: 'g3-scene', 'aria-hidden': 'true' },
      el('span', { class: 'g3-box' },
        el('span', { class: 'g3-body' }, face('b-front'), face('b-back'), face('b-left'), face('b-right')),
        el('span', { class: 'g3-lid' },
          face('l-top'), face('l-front'), face('l-back'), face('l-left'), face('l-right'),
          el('span', { class: 'g3-bow' }, icon('bow', { size: 92 }))),
      ),
    ),
  );
}

/**
 * Le cadeau en plein écran, sur la nuit : on le touche, il se soulève et tremble, le
 * couvercle se lève, une lumière chaude sort de la boîte et le prénom apparaît.
 */
function openGiftOverlay(recipientName) {
  if (document.querySelector('.gift-overlay')) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const previous = document.activeElement;
  const reveal = el('div', { class: 'gift-reveal', 'aria-live': 'polite' });
  const confetti = el('div', { class: 'gift-confetti', 'aria-hidden': 'true' });
  const box = giftBox('Ouvrir le cadeau pour découvrir à qui tu offres');
  const hint = el('p', { class: 'gift-hint' }, onComputer() ? 'Clique sur le cadeau pour l’ouvrir' : 'Touche le cadeau pour l’ouvrir');
  const later = el('button', { class: 'btn btn-ghost gift-later', type: 'button' }, 'Plus tard');
  // « Plus tard » et « Continuer » occupent la même place : la fenêtre ne change pas de hauteur
  // pendant l'ouverture (le titre ne saute pas).
  const next = el('button', { class: 'btn btn-primary btn-block gift-continue', type: 'button', tabindex: '-1', 'aria-hidden': 'true' }, 'Continuer');
  const panel = el('div', { class: 'gift-modal' },
    el('p', { class: 'eyebrow' }, 'Le tirage a eu lieu !'),
    el('h2', { id: 'gift-title' }, 'Découvre à qui tu offres un cadeau'),
    el('div', { class: 'gift-stage' }, box, reveal),
    hint,
    el('p', { class: 'gift-secret' }, 'Garde le secret : personne ne doit savoir que c’est toi !'),
    el('div', { class: 'gift-actions' }, later, next),
  );
  const overlay = el('div', { class: 'gift-overlay reveal-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gift-title' }, confetti, panel);
  const close = () => {
    overlay.remove();
    root.inert = false;
    document.body.classList.remove('gift-open');
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !unwrapping) {
      giftOverlayDismissed = true;
      close();
      document.querySelector('[data-focus-key="gift-open"]')?.focus();
    }
  };
  later.addEventListener('click', () => onKey({ key: 'Escape' }));
  document.addEventListener('keydown', onKey);
  let openedDrawAt; // tirage dont on a ouvert le cadeau (il peut être refait pendant l'animation)
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    const redrawn = openedDrawAt !== state.group.drawnAt;
    // Tirage refait pendant l'animation : l'ancien prénom ne compte plus, le nouveau cadeau reste à ouvrir.
    if (redrawn) storage.set(`ss_unwrapped_${token}_${openedDrawAt}`, true);
    else markUnwrapped();
    unwrapping = false;
    close();
    renderMain();
    if (redrawn) {
      // (Tirage seulement annulé : le message « tirage annulé » est déjà affiché.)
      if (state.group.drawn) toast('L’organisateur a refait le tirage : ouvre ton nouveau cadeau !', 'info');
      return;
    }
    // Arrivée depuis une notification de message : la discussion vient de s'ouvrir par-dessus.
    if (chat?.isOpen()) return;
    selectTab('tirage', { scroll: false }); // le prénom est dans « Mon tirage »
    const tag = document.querySelector('.card.target');
    if (tag) {
      tag.classList.add('tag-arrive');
      tag.setAttribute('tabindex', '-1');
      tag.focus({ preventScroll: true });
      tag.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    } else if (previous?.isConnected) previous.focus();
  };
  next.addEventListener('click', finish);
  box.addEventListener('click', () => {
    if (unwrapping) return;
    unwrapping = true;
    openedDrawAt = state.group.drawnAt;
    clear(reveal, el('p', { class: 'eyebrow' }, 'Tu offres un cadeau à'), el('p', { class: 'big-name' }, recipientName));
    // Le focus reste dans la fenêtre (sur le prénom) avant que le bouton ne soit désactivé.
    reveal.setAttribute('tabindex', '-1');
    reveal.focus({ preventScroll: true });
    box.disabled = true;
    later.tabIndex = -1;
    later.setAttribute('aria-hidden', 'true');
    const showNext = () => {
      panel.classList.add('can-continue');
      next.removeAttribute('tabindex');
      next.removeAttribute('aria-hidden');
    };
    if (reduce) {
      panel.classList.add('opening', 'opened');
      setTimeout(showNext, 150);
      setTimeout(finish, 5000);
      return;
    }
    // Il se soulève et tremble, le couvercle se lève, la lumière monte, puis le prénom.
    panel.classList.add('opening');
    setTimeout(() => panel.classList.add('opened'), 700);
    setTimeout(() => foilConfetti(confetti), 800);
    setTimeout(showNext, 1600);
    setTimeout(finish, 5000);
  });
  document.body.append(overlay);
  document.body.classList.add('gift-open');
  root.inert = true;
  box.focus({ preventScroll: true });
}

let wishlistPromptDone = false; // la lettre plein écran n'est proposée qu'une fois, à la première connexion
let onboardingDone = false; // calendrier + liste en plein écran : seulement à la toute première connexion

/** Première connexion : le calendrier en plein écran (les dates à retenir), puis « Continuer ». */
function openDatesOverlay(onDone) {
  if (document.querySelector('.gift-overlay')) return;
  const next = el('button', { class: 'btn btn-primary btn-block onboard-next', type: 'button' }, el('span', {}, 'Continuer'), icon('arrow-right', { size: 18 }));
  // Le message « code enregistré » est dans le surtitre (pas de message par-dessus la fenêtre).
  const panel = el('div', { class: 'onboard-modal sheet' },
    el('div', { class: 'sheet-body' },
      // Un surtitre court, sur une ligne : la bienvenue (avec le prénom) est sur la fiche suivante.
      el('p', { class: 'eyebrow eyebrow-check' }, codeCreatedNotice ? withIcon('check-circle', 'Code enregistré') : 'Première connexion'),
      el('h2', { id: 'onboard-title' }, 'Les dates à retenir'),
      el('div', { 'data-dates-box': '-intro' }, datesCard('-intro'))),
    el('div', { class: 'sheet-foot' }, next),
  );
  const overlay = el('div', { class: 'gift-overlay dates-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'onboard-title' }, panel);
  const close = () => {
    overlay.remove();
    // Le mois choisi dans le plein écran ne reste pas : la carte de la page revient à aujourd'hui.
    calMonth = null;
    redrawDates();
    root.inert = false;
    document.body.classList.remove('gift-open');
    document.removeEventListener('keydown', onKey);
    onDone?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  next.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  document.body.classList.add('gift-open');
  root.inert = true;
  next.focus({ preventScroll: true });
}

/**
 * Première connexion : la lettre au Père Noël en plein écran, page floutée derrière, pour
 * qu'on l'écrive en premier (ou plus tard). onDone est appelé quand elle se ferme.
 */
function openWishlistOverlay(onDone) {
  if (document.querySelector('.gift-overlay')) return;
  wishlistPromptDone = true;
  const { me, group } = state;
  const area = el('textarea', {
    rows: '6', maxlength: '3000', id: 'wish-first', class: 'letter-body', value: wishlistDraft ?? me.wishlist ?? '',
    placeholder: LETTER_PLACEHOLDER,
    'aria-label': 'Ma lettre au Père Noël', 'aria-describedby': 'wish-first-help',
  });
  // Gardé au fil de la frappe (l'onglet peut être rechargé) : la carte de la page suit le texte.
  area.addEventListener('input', () => {
    const pageInput = document.getElementById('wishlist-input');
    if (pageInput) {
      pageInput.value = area.value;
      pageInput.dispatchEvent(new Event('input')); // brouillon enregistré sur l'appareil (ou oublié)
      return;
    }
    const text = area.value;
    wishlistDraft = text.trim() && text !== me.wishlist ? text : null;
    if (wishlistDraft) storage.set(draftKey(), text);
    else forgetDraft();
  });
  const error = formError();
  const save = el('button', { class: 'btn btn-primary', type: 'submit' }, withIcon('save', 'Enregistrer ma lettre'));
  const later = el('button', { class: 'btn btn-ghost wish-later', type: 'button' }, 'Remplir plus tard');
  const wishSheet = letterSheet(area, me.name, { compact: true, text: () => area.value });
  // La feuille s'allonge avec le texte, comme dans « Ma lettre ».
  const growWish = () => { area.style.height = 'auto'; area.style.height = `${area.scrollHeight + 4}px`; };
  area.addEventListener('input', () => { wishSheet.refresh(); growWish(); });
  requestAnimationFrame(growWish);
  // La fiche tient sur l'écran : le pied (« Enregistrer », « Plus tard ») reste collé en bas.
  // Le titre et la croix restent dans une bande fixe : la lettre (timbre, cachet) défile
  // dessous, jamais sous la croix.
  const wishHead = el('div', { class: 'wish-head' },
    el('span', { class: 'wish-art', 'aria-hidden': 'true' }, icon('envelope-art', { size: 56 })),
    el('div', {},
      el('p', { class: 'eyebrow' }, 'Bienvenue ', el('span', { class: 'nowrap' }, me.name), ' !'),
      el('h2', { id: 'wish-title' }, 'Ta lettre au Père Noël')));
  const form = el('form', { novalidate: true, class: 'wish-form' },
    el('div', { class: 'sheet-body' },
      // Téléphone à l'horizontale : l'explication se replie derrière « Pourquoi ? ».
      el('details', { class: 'wish-why', open: !window.matchMedia?.('(max-height: 500px)').matches },
        el('summary', {}, 'Pourquoi ?'),
        el('p', { id: 'wish-first-help' }, 'Ton Père Noël secret la lira pour te trouver le cadeau parfait. Tu pourras la modifier dans « Ma lettre ».')),
      group.wishlistDeadline ? deadlineChip(group.wishlistDeadline) : null,
      wishSheet,
      error),
    el('div', { class: 'sheet-foot wish-actions' }, save, later),
  );
  // Toujours un moyen de sortir, même quand la lettre dépasse l'écran du téléphone.
  const closeX = el('button', { class: 'sheet-close wish-close', type: 'button', 'aria-label': 'Fermer et remplir plus tard' }, icon('x'));
  const panel = el('div', { class: 'wish-modal sheet' }, el('div', { class: 'sheet-head' }, wishHead, closeX), form);
  // Clavier ouvert : la feuille se place au milieu de ce qui reste visible.
  area.addEventListener('focus', () => setTimeout(() => area.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250));
  const overlay = el('div', { class: 'gift-overlay wish-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wish-title' }, panel);
  const close = () => {
    overlay.remove();
    root.inert = false;
    document.body.classList.remove('gift-open');
    document.removeEventListener('keydown', onKey);
    onDone?.();
  };
  // « Plus tard » : le texte déjà tapé est gardé comme brouillon dans la carte de la page.
  const keepDraft = () => {
    const text = area.value;
    if (!text.trim() || text === me.wishlist) return;
    wishlistDraft = text;
    storage.set(draftKey(), text);
    const pageInput = document.getElementById('wishlist-input');
    if (pageInput) {
      pageInput.value = text;
      pageInput.dispatchEvent(new Event('input'));
    }
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { keepDraft(); close(); }
  };
  later.addEventListener('click', () => { keepDraft(); close(); });
  closeX.addEventListener('click', () => { keepDraft(); close(); });
  document.addEventListener('keydown', onKey);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!area.value.trim()) return showFormError(error, 'Écris au moins une idée dans ta lettre, ou choisis « Remplir plus tard ».', area);
    const result = await withButton(save, () => api('PUT', `${base}/wishlist`, { wishlist: area.value }));
    if (!result) return;
    state.me.wishlist = result.wishlist;
    wishlistDraft = null;
    forgetDraft();
    redrawDates(); // la date limite n'est plus « à écrire » (doré)
    const pageInput = document.getElementById('wishlist-input');
    if (pageInput) {
      // Le texte suivait la frappe (brouillon) : il est maintenant enregistré.
      pageInput.dataset.dirty = '';
      pageInput.syncSaved?.(result.wishlist);
      pageInput.value = result.wishlist;
      pageInput.dispatchEvent(new Event('input'));
    }
    toast('Lettre au Père Noël enregistrée !', 'success');
    updateQuickbar();
    close();
  });
  document.body.append(overlay);
  document.body.classList.add('gift-open');
  root.inert = true;
  // Sur téléphone, pas de saisie automatique : le clavier cacherait la moitié de l'écran.
  const title = panel.querySelector('#wish-title');
  title.setAttribute('tabindex', '-1');
  if (window.matchMedia?.('(pointer: fine)').matches) area.focus({ preventScroll: true });
  else title.focus({ preventScroll: true });
}

/** Dans la page : le cadeau attend d'être ouvert (le plein écran s'ouvre tout seul la première fois). */
function mysteryGiftCard(recipientName) {
  const small = giftBox('Ouvrir mon cadeau en plein écran');
  small.dataset.focusKey = 'gift-open';
  small.addEventListener('click', () => openGiftOverlay(recipientName));
  return el('section', { class: 'card mystery center', 'aria-labelledby': 'mystery-title' },
    el('p', { class: 'eyebrow' }, 'Le tirage a eu lieu !'),
    el('h2', { id: 'mystery-title' }, 'Ton cadeau t’attend'),
    el('div', { class: 'gift-stage small' }, small),
    el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openGiftOverlay(recipientName) }, withIcon('gift', 'Ouvrir mon cadeau')),
  );
}

/** Juste après avoir choisi son code : rappel de bien le retenir. */
function createdNotice() {
  if (!codeCreatedNotice) return null;
  const card = el('section', { class: 'card notice notice-ok', role: 'status' },
    el('p', {}, icon('check-circle', { size: 18, className: 'notice-icon' }), el('strong', {}, 'Ton code est enregistré.'), ' Retiens-le bien : il te sera demandé si tu ouvres ta page sur un autre téléphone ou ordinateur.'),
    el('button', {
      class: 'btn btn-small', type: 'button',
      onclick: () => {
        codeCreatedNotice = false;
        card.remove();
        root.querySelector('h1')?.focus?.();
      },
    }, "C'est noté"),
  );
  return card;
}

/** Essais avec un mauvais code depuis la dernière connexion : reste affiché jusqu'au « J'ai compris ». */
function failedNotice() {
  if (!failedAttemptsNotice) return null;
  const n = failedAttemptsNotice;
  const card = el('section', { class: 'card notice notice-warn', role: 'alert' },
    el('p', {}, icon('circle-alert', { size: 18, className: 'notice-icon' }), el('strong', {}, `${n} tentative${n > 1 ? 's' : ''} avec un mauvais code depuis ta dernière connexion.`)),
    el('p', { class: 'small' }, "Si ce n'était pas toi, quelqu'un a essayé d'ouvrir ta page. Parles-en à l'organisateur."),
    el('button', {
      class: 'btn btn-small', type: 'button',
      onclick: () => {
        failedAttemptsNotice = 0;
        card.remove();
        root.querySelector('h1')?.focus?.();
      },
    }, "J'ai compris"),
  );
  return card;
}

/** Avertit le participant si son code a été réinitialisé (trace impossible à effacer). */
function resetNotice() {
  if (!state.resetCount) return null;
  const when = state.lastResetAt
    ? new Date(state.lastResetAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })
    : '';
  const times = state.resetCount > 1 ? ` (${state.resetCount} fois)` : '';
  return el('section', { class: 'card notice notice-warn', role: 'note' },
    el('p', {}, icon('circle-alert', { size: 18, className: 'notice-icon' }), el('strong', {}, 'Le code secret de ce lien a été réinitialisé par l\'organisateur'), `${times}${when ? `, la dernière fois le ${when}` : ''}.`),
    el('p', { class: 'small' }, "Si tu ne l'avais pas demandé, ou si tu n'avais encore jamais choisi de code toi-même, quelqu'un a peut-être consulté ta page. Parles-en à l'organisateur : il peut annuler le tirage et en refaire un."),
  );
}

const fmtDateTime = (ts) => new Date(ts).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

/** Trace d'une révélation faite puis masquée par l'organisateur (impossible à effacer). */
function revealTraceNotice() {
  const g = state.group;
  if (!g || g.revealed || !g.firstRevealedAt) return null;
  return el('section', { class: 'card notice notice-warn', role: 'note' },
    el('p', {}, icon('circle-alert', { size: 18, className: 'notice-icon' }), el('strong', {}, `Les Pères Noël ont été révélés le ${fmtDateTime(g.firstRevealedAt)}, puis masqués à nouveau par l'organisateur.`)),
    el('p', { class: 'small' }, "Pendant ce temps, tout le monde a pu voir qui offre à qui, et l'organisateur a pu télécharger toutes les discussions. Si ce n'était pas prévu, demande-lui de refaire le tirage."),
  );
}

/** Message d'erreur affiché sous un formulaire (en plus du petit message temporaire). */
function formError() {
  return el('p', { class: 'form-error', role: 'alert', hidden: true });
}
function showFormError(node, message, field) {
  node.textContent = message ? frTypo(message) : '';
  node.hidden = !message;
  if (field) {
    if (message) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
    if (message) field.focus();
  }
}

/** Petit rappel du principe du Secret Santa (budget et date inclus s'ils sont connus). */
function howTo({ open = false, budget = '', eventDate = '' } = {}) {
  const steps = el('ol', { class: 'howto-steps' },
    el('li', {}, el('span', { class: 'howto-icon', 'aria-hidden': 'true' }, icon('dices')),
      el('span', {}, el('strong', {}, 'Un tirage au sort'), ' désigne la personne à qui tu offres un cadeau. Garde-le pour toi !')),
    el('li', {}, el('span', { class: 'howto-icon', 'aria-hidden': 'true' }, icon('santa-hat')),
      el('span', {}, 'Quelqu\'un d\'autre t\'offre aussi un cadeau : c\'est ', el('strong', {}, 'ton Père Noël secret'), '. Tu ne sais pas qui c\'est !')),
    el('li', {}, el('span', { class: 'howto-icon', 'aria-hidden': 'true' }, icon('message-circle')),
      el('span', {}, el('strong', {}, 'Écris-lui anonymement'), ' pour trouver le cadeau parfait, et écris ta lettre au Père Noël pour l’aider à te trouver le cadeau parfait.')),
    el('li', {}, el('span', { class: 'howto-icon', 'aria-hidden': 'true' }, icon('gift')),
      el('span', {}, el('strong', {}, 'Le jour de l\'échange'),
        eventDate ? ` (${formatDate(eventDate)})` : '',
        ', chacun offre son cadeau',
        budget ? [' (budget : ', el('strong', {}, budget), ')'] : '',
        '. Ensuite, on découvre qui était le Père Noël de qui !')),
  );
  if (open) {
    return el('section', { class: 'card howto' }, el('h2', {}, titled('circle-help', 'Le Secret Santa, comment ça marche ?')), steps);
  }
  return el('details', { class: 'card howto', 'data-key': 'howto' },
    el('summary', {}, el('h2', { class: 'inline' }, titled('circle-help', 'Le Secret Santa, comment ça marche ?')), icon('chevron-down', { size: 18, className: 'summary-chevron' })),
    steps,
  );
}

/** Date du jour (AAAA-MM-JJ) sur l'appareil. */
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Nombre de jours entre aujourd'hui et une date AAAA-MM-JJ (négatif si passée). */
function daysUntil(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const [ty, tm, td] = todayLocal().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

/** Le jour de l'échange est arrivé (ou passé) : on ne presse plus personne de remplir sa liste. */
const exchangeReached = () => Boolean(state.group.eventDate) && daysUntil(state.group.eventDate) <= 0;

const shortDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  // Espace insécable entre le jour et le mois : « 29 » ne reste jamais seul en fin de ligne
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/(\d+) /, '$1\u00a0');
};

/** « 🎄 Plus que 12 jours avant l'échange » */
function countdown() {
  const { eventDate, revealed } = state.group;
  if (!eventDate || revealed) return null;
  const n = daysUntil(eventDate);
  if (n < 0) return null;
  const text = n === 0 ? "C'est aujourd'hui, le jour de l'échange !"
    : n === 1 ? "C'est demain, l'échange des cadeaux !"
      : `Plus que ${n} jours avant l'échange`;
  return el('span', { class: `chip chip-night countdown${n <= 1 ? ' soon' : ''}` }, icon(n <= 1 ? 'gift' : 'hourglass', { size: 16 }), el('span', {}, text));
}

/** Lien « ← Changer de personne » quand on est arrivé par le lien du groupe. */
function backToGroup() {
  const from = storage.get('ss_from_invite', null);
  if (!from || from.token !== token) return null;
  return el('a', { class: 'back-link', href: `/g/${encodeURIComponent(from.invite)}` }, icon('chevron-left', { size: 18 }), el('span', {}, "Ce n'est pas moi : changer de personne"));
}

function welcomeHeader(subtitle) {
  return el('header', { class: 'page-header entry-header' },
    backToGroup(),
    el('p', { class: 'eyebrow' }, isBrandName(state.groupName) || !state.groupName ? 'Secret Santa' : state.groupName),
    el('h1', {}, `Salut ${state.name} !`),
    el('p', { class: 'lead' }, subtitle),
  );
}

/**
 * Page d'entrée unique, identique pour tout le monde : on ne peut pas savoir, en ouvrant
 * la page de quelqu'un d'autre, s'il est déjà venu. Première visite → on invente son code ;
 * ensuite → on retape le même.
 */
function renderEnter() {
  document.title = pageTitle(state.groupName);
  const code = el('input', {
    type: 'password', name: 'code', autocomplete: 'current-password', inputmode: 'numeric', pattern: '[0-9]*', minlength: '4', maxlength: '12', required: true,
    'aria-label': 'Ton code secret', 'aria-describedby': 'code-help',
  });
  // Deuxième saisie pour tout le monde (même en revenant) : si elle n'apparaissait qu'à la
  // première visite, on pourrait deviner qui est déjà venu en ouvrant sa page.
  const confirmCode = el('input', {
    type: 'password', name: 'confirm', id: 'code-confirm', autocomplete: 'off', inputmode: 'numeric', pattern: '[0-9]*', minlength: '4', maxlength: '12', required: true,
    'aria-label': 'Retape ton code secret',
  });
  // Afficher le code pendant la saisie évite une faute de frappe à la première visite.
  const toggle = el('button', {
    class: 'btn btn-ghost code-toggle', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Afficher le code',
    onclick: () => {
      const show = code.type === 'password';
      code.type = show ? 'text' : 'password';
      confirmCode.type = code.type;
      toggle.setAttribute('aria-pressed', String(show));
      toggle.setAttribute('aria-label', show ? 'Masquer le code' : 'Afficher le code');
      toggle.replaceChildren(icon(show ? 'eye-off' : 'eye'));
      code.focus();
    },
  }, icon('eye'));
  const error = formError();
  const submit = el('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Entrer');
  const form = el('form', { novalidate: true, class: 'code-form' },
    el('label', { class: 'field-label', for: 'code-input' }, 'Code (4 à 12 chiffres)'),
    el('div', { class: 'code-row' }, code, toggle),
    el('label', { class: 'field-label', for: 'code-confirm' }, 'Retape-le pour vérifier'),
    el('div', { class: 'code-row' }, confirmCode),
    error,
    submit,
  );
  code.id = 'code-input';
  for (const f of [code, confirmCode]) {
    f.addEventListener('input', () => {
      f.removeAttribute('aria-invalid');
      // Chiffres uniquement : une lettre ou un espace tapé (ou collé) est retiré aussitôt.
      const digits = f.value.replace(/\D/g, '').slice(0, 12);
      if (digits !== f.value) f.value = digits;
    });
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showFormError(error, '', null);
    if (!/^[0-9]{4,12}$/.test(code.value)) return showFormError(error, 'Le code doit faire de 4 à 12 chiffres.', code);
    if (code.value !== confirmCode.value) {
      confirmCode.value = '';
      return showFormError(error, 'Les deux codes ne sont pas pareils : retape-le dans le deuxième champ.', confirmCode);
    }
    submit.disabled = true;
    let ok;
    try {
      ok = await api('POST', `${base}/enter`, { code: code.value });
    } catch (err) {
      // Erreur affichée sous le champ (elle reste visible, contrairement au message temporaire).
      code.value = '';
      confirmCode.value = '';
      showFormError(error, err.message, code);
      return;
    } finally {
      submit.disabled = false;
    }
    codeCreatedNotice = Boolean(ok.created);
    // Avertissement de sécurité : affiché dans une carte qui reste, pas seulement un message temporaire.
    failedAttemptsNotice = ok.failedAttempts > 0 ? ok.failedAttempts : 0;
    await load();
    // (Première connexion : « Code enregistré » s'affiche dans la fenêtre des dates, pas par-dessus.)
    if (ok.created && state.group?.revealed) toast('Code enregistré ! Bienvenue', 'success');
    // Le formulaire était plus bas : on arrive en haut (titre, rappel du code, étiquette cadeau).
    window.scrollTo(0, 0);
  });

  clear(root,
    welcomeHeader(`Tu participes au ${eventName(state.groupName)}.`),
    // Le code en premier : sur téléphone, le champ est sur le premier écran.
    el('section', { class: 'card code-card' },
      el('h2', {}, titled('lock', 'Ton code secret')),
      el('p', { class: 'code-lead', id: 'code-help' }, 'Invente 4 à 12 chiffres (ou entre ton code si tu es déjà venu·e).'),
      form,
      el('details', { class: 'code-faq' },
        el('summary', {}, el('span', {}, 'Questions sur le code'), icon('chevron-down', { size: 18, className: 'summary-chevron' })),
        el('p', {}, el('strong', {}, 'Première visite ?'), ' Invente un code de 4 à 12 chiffres et retiens-le : il protège ta page. ',
          el('strong', {}, 'Déjà venu·e ?'), ' Entre le même code. Dans les deux cas, tape-le deux fois pour éviter une faute de frappe.'),
        el('p', {}, "Ton code te sera demandé si tu reviens depuis un autre appareil : personne d'autre ne peut ouvrir ta page. L'organisateur peut voir qui offre à qui et quand tu es passé·e sur ta page, mais pas tes messages. Après la révélation finale, tes discussions pourront être téléchargées en souvenir, par toi et par l'organisateur."),
        el('p', {}, "Code oublié ? L'organisateur peut le réinitialiser. Ton code est refusé alors que tu n'en as jamais choisi ? Quelqu'un l'a peut-être fait à ta place : préviens l'organisateur."),
        el('p', {}, `Tu n'es pas ${state.name} ? Reviens en arrière et choisis ton prénom : ce lien est personnel.`)),
    ),
    howTo({ open: true }),
  );
  // Sur téléphone, pas de focus automatique (le clavier cacherait l'explication).
  // Sur ordinateur, le champ qui a le focus est forcément visible.
  if (window.matchMedia?.('(pointer: fine)').matches) code.focus();
}

// ---------------------------------------------------------------------------
// Onglets en haut de la page : Mon tirage · Ma lettre · Sa lettre · Messages
// ---------------------------------------------------------------------------

/**
 * Les onglets du moment. « Sa lettre » n'existe qu'après le tirage ; après la révélation,
 * « Ma lettre » (qui ne sert plus) laisse la place à l'album souvenir.
 */
function tabList() {
  const { drawn, revealed } = state.group;
  return [
    ['tirage', 'gift', 'Mon tirage'],
    revealed ? ['album', 'images', 'Album'] : ['lettre', 'mail', 'Ma lettre'],
    drawn ? ['salettre', 'scroll-text', 'Sa lettre'] : null,
    ['messages', 'message-circle', 'Messages'],
  ].filter(Boolean);
}

/** Onglet demandé par l'adresse (#lettre…). Une discussion ouverte (#discussion) est dans les messages. */
function tabFromHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === 'discussion' || h === 'messagerie') return 'messages';
  // Ancien lien vers l'album ou la lettre : on montre ce qui le remplace.
  if (h === 'lettre' && state.group.revealed) return 'album';
  if (h === 'album' && !state.group.revealed) return 'lettre';
  return tabList().some(([id]) => id === h) ? h : null;
}

/** Adresse de la page avec l'onglet courant. keepSearch : garde ?ouvrir=… (pas encore traité). */
const tabUrl = ({ keepSearch = false } = {}) => `${location.pathname}${keepSearch ? location.search : ''}${currentTab ? `#${currentTab}` : ''}`;

function renderTabbar() {
  const tabs = tabList().map(([id, iconName, label]) => el('button', {
    class: 'tab', type: 'button', role: 'tab', id: `tab-${id}`, 'data-tab': id,
    'aria-controls': `panel-${id}`, 'aria-selected': 'false', tabindex: '-1', 'data-label': label,
    onclick: () => selectTab(id),
  },
  el('span', { class: 'tab-icon', 'aria-hidden': 'true' }, icon(iconName), el('span', { class: 'tab-badge', hidden: true })),
  el('span', { class: 'tab-label' }, label)));
  const list = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Ma page de Père Noël secret' }, tabs);
  // Flèches gauche/droite, Début/Fin : on passe d'un onglet à l'autre (comme dans une appli).
  list.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const tab = tabs[(next + tabs.length) % tabs.length];
    selectTab(tab.dataset.tab, { focus: true });
  });
  return el('nav', { class: 'tabbar', id: 'tabbar', 'aria-label': 'Sections de la page' }, el('div', { class: 'tabbar-inner' }, list));
}

/** Un panneau d'onglet (caché tant que son onglet n'est pas choisi). */
const tabPanel = (id, ...children) => el('div', {
  class: 'tab-panel', role: 'tabpanel', id: `panel-${id}`, 'aria-labelledby': `tab-${id}`, tabindex: '-1', hidden: true,
}, children);

/**
 * Affiche un onglet. url : l'adresse retient l'onglet (rechargement, retour arrière) ;
 * focus : le focus va sur l'onglet (clavier) ; sinon la page remonte au début du panneau.
 */
function selectTab(id, { focus = false, url = true, scroll = true } = {}) {
  const tabs = [...root.querySelectorAll('.tabbar [role="tab"]')];
  if (!tabs.length) return;
  if (!tabs.some((t) => t.dataset.tab === id)) id = 'tirage';
  const changed = currentTab !== id;
  currentTab = id;
  for (const t of tabs) {
    const on = t.dataset.tab === id;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  }
  for (const p of root.querySelectorAll('.tab-panel')) p.hidden = p.id !== `panel-${id}`;
  if (id === 'lettre') document.getElementById('wishlist-input')?.grow?.();
  if (changed) updateQuickbar(); // le rappel « Écris ta lettre » dépend de l'onglet
  // Pas pendant une discussion ouverte : son entrée d'historique (#discussion) sert au bouton « retour ».
  if (url && !history.state?.chat && location.hash !== `#${id}`) history.replaceState(history.state, '', tabUrl({ keepSearch: true }));
  if (focus) tabs.find((t) => t.dataset.tab === id)?.focus();
  // Page descendue plus bas que les onglets : le nouveau panneau s'affiche depuis son début.
  const anchor = document.getElementById('tab-anchor');
  if (changed && scroll && anchor) {
    const top = anchor.getBoundingClientRect().top + window.scrollY;
    if (window.scrollY > top) window.scrollTo(0, top);
  }
}

/** Pastilles des onglets : messages non lus, lettre encore à écrire. */
function updateTabs() {
  const set = (id, text, srText, cls) => {
    const tab = document.getElementById(`tab-${id}`);
    if (!tab) return;
    const badge = tab.querySelector('.tab-badge');
    badge.hidden = !text;
    // « à écrire » : un petit point doré (le texte reste lu par les lecteurs d'écran).
    if (cls === 'tab-badge-todo') clear(badge, el('span', { class: 'sr-only' }, text || ''));
    else badge.textContent = text || '';
    badge.className = `tab-badge${cls ? ` ${cls}` : ''}`;
    tab.classList.toggle('has-badge', Boolean(text));
    tab.setAttribute('aria-label', `${tab.dataset.label}${srText ? `, ${srText}` : ''}`);
  };
  const unread = chat ? chat.unreadTotal() : 0;
  set('messages', unread ? String(unread) : '', unread ? `${unread} message${unread > 1 ? 's' : ''} non lu${unread > 1 ? 's' : ''}` : '', 'tab-badge-count');
  set('lettre', letterNeedsFill() ? 'à écrire' : '', letterNeedsFill() ? 'lettre à écrire' : '', 'tab-badge-todo');
}

/** La lettre au Père Noël est encore vide (et il est encore temps de l'écrire). */
const letterNeedsFill = () => !state.group.revealed && !String(state.me.wishlist || '').trim() && !exchangeReached();

window.addEventListener('hashchange', () => {
  // Adresse modifiée à la main, ou retour arrière : l'onglet suit.
  if (!state?.authenticated || chat?.isOpen()) return;
  const id = tabFromHash();
  if (id && id !== currentTab) selectTab(id);
});

// ---------------------------------------------------------------------------
// Page principale
// ---------------------------------------------------------------------------

function renderMain() {
  const { group, me } = state;
  // Tirage refait pendant que le cadeau était affiché : on referme le plein écran (il se rouvre avec le bon prénom).
  // (La liste de souhaits plein écran, elle, reste ouverte : on ne perd pas ce qui est en cours d'écriture.)
  if (!unwrapping && document.querySelector('.gift-overlay:not(.wish-overlay):not(.dates-overlay)')) {
    document.querySelector('.gift-overlay:not(.wish-overlay):not(.dates-overlay)').remove();
    root.inert = false;
    document.body.classList.remove('gift-open');
  }
  document.title = pageTitle(group.name);
  renderedDrawnAt = group.drawnAt;
  renderedRevealed = group.revealed;
  resetRevealAnimation();

  // Si la page est reconstruite (tirage refait), on garde le brouillon de liste de souhaits.
  const previousInput = document.getElementById('wishlist-input');
  // Sans la carte (après révélation), on garde le dernier brouillon : il revient si la révélation est annulée.
  if (previousInput) wishlistDraft = previousInput.dataset.dirty === '1' ? previousInput.value : null;
  else if (wishlistDraft == null) {
    // Page rechargée : le brouillon gardé sur l'appareil revient dans la carte.
    const stored = storage.get(draftKey(), null);
    if (typeof stored === 'string' && stored.trim() && stored !== me.wishlist) wishlistDraft = stored;
  }
  const draft = wishlistDraft;

  chat?.destroy();
  chat = null;
  const wasOpen = document.querySelector('details.howto')?.open;
  // Avant le tirage, le rappel est ouvert (c'est le moment où on en a besoin) ; ensuite il est replié.
  const howToCard = howTo({ budget: group.budget, eventDate: group.eventDate });
  howToCard.open = wasOpen ?? (!group.drawn && !storage.get(`ss_howto_seen_${token}`, false));
  storage.set(`ss_howto_seen_${token}`, true);
  const info = el('div', { id: 'info' });
  const wishlist = renderWishlistCard(me.wishlist, draft);
  lastInfoKey = null;
  const chatSection = el('div', { id: 'chat-section' });

  // Onglet affiché : celui de l'adresse (#lettre…), sinon celui qu'on regardait, sinon « Mon tirage ».
  const startTab = tabFromHash() || currentTab || 'tirage';
  const logout = el('div', { class: 'logout' },
    el('p', { class: 'muted small' }, `Connecté·e en tant que ${me.name}`),
    el('button', {
      class: 'btn btn-ghost btn-small', type: 'button',
      onclick: async (e) => {
        const btn = e.currentTarget;
        if (!(await ask('Il faudra entrer ton code secret pour revenir sur cet appareil.', { title: 'Te déconnecter ?', confirmLabel: 'Me déconnecter' }))) return;
        await forgetDeviceNotifications();
        const ok = await withButton(btn, () => api('POST', `${base}/logout`, {}));
        if (ok) { await load(); window.scrollTo(0, 0); }
      },
    }, withIcon('log-out', 'Se déconnecter de cet appareil')),
  );
  // En-tête compact, seulement dans « Mon tirage » : les autres onglets commencent par leur carte.
  const when = group.eventDate ? new Date(`${group.eventDate}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : null;
  const header = el('header', { class: 'page-header' },
    el('p', { class: 'eyebrow' }, [isBrandName(group.name) ? 'Secret Santa' : group.name, when].filter(Boolean).join(' · ')),
    el('h1', { tabindex: '-1' }, `Salut ${me.name}`),
    el('div', { class: 'header-chips' },
      countdown(),
      el('nav', { class: 'quickbar', id: 'quickbar', 'aria-label': 'Raccourcis', hidden: true })),
  );
  // « Comment ça marche » : replié dès la deuxième visite.


  clear(root,
    // Les onglets tout en haut, toujours visibles (ils restent collés en haut quand on descend).
    el('div', { id: 'tab-anchor', 'aria-hidden': 'true' }),
    renderTabbar(),
    // Avertissements de sécurité : visibles quel que soit l'onglet.
    failedNotice(),
    createdNotice(),
    resetNotice(),
    el('div', { id: 'trace' }, revealTraceNotice()),
    // 🎁 Mon tirage : à qui j'offre, où en est le cadeau, les dates, le principe et les infos pratiques.
    tabPanel('tirage',
      header,
      info,
      group.drawn ? null : howToCard, // avant le tirage, le principe du jeu est en haut (ouvert)
      el('div', { id: 'dates', 'data-dates-box': '' }, datesCard()),
      group.drawn ? howToCard : null,
      logout),
    // ✉️ Ma lettre au Père Noël (après la révélation, elle ne sert plus : place à l'album).
    group.revealed
      ? tabPanel('album', el('div', { id: 'album' }))
      : tabPanel('lettre', wishlist),
    // 📜 Sa lettre : la lettre au Père Noël de la personne à qui j'offre (après le tirage).
    group.drawn ? tabPanel('salettre', el('div', { id: 'their-letter-box' })) : null,
    // 💬 Messages : les deux discussions anonymes, et les notifications.
    tabPanel('messages', chatSection, el('div', { id: 'notif-card' })),
  );
  selectTab(startTab, { scroll: false });
  // Arrivée depuis une notification de message alors que le cadeau n'a jamais été ouvert
  // (ici ou sur cet appareil) : le cadeau d'abord ; la discussion s'ouvre juste après.
  renderInfo();
  // Plein écran à la première connexion : d'abord la lettre au Père Noël, ensuite le cadeau à ouvrir.
  // On relit l'état à jour : le tirage a pu avoir lieu pendant les écrans d'accueil.
  const giftPending = () => state.group.drawn && !isUnwrapped() && !giftOverlayDismissed && state.recipient;
  const openGiftIfPending = () => { if (giftPending()) openGiftOverlay(state.recipient.name); };
  if (codeCreatedNotice && !onboardingDone && !group.revealed) {
    // Toute première connexion : calendrier, puis lettre au Père Noël, puis le cadeau (si le tirage a eu lieu).
    onboardingDone = true;
    openDatesOverlay(() => {
      if (!wishlistPromptDone && !state.me.wishlist && !exchangeReached()) openWishlistOverlay(openGiftIfPending);
      else openGiftIfPending();
    });
  } else if (giftPending()) openGiftIfPending();
  else maybeAskGiftStatus();
  if (group.drawn && !isUnwrapped()) {
    // Les discussions montrent le prénom : elles apparaissent une fois le cadeau ouvert.
    chat = null;
    chatSection.append(chatPlaceholder(true));
  } else if (group.drawn) {
    chat = createChat(group.drawnAt);
    chatSection.append(chat.element);
    chat.loadAll();
    // Arrivée depuis une notification : ouvre directement la bonne discussion (onglet Messagerie).
    const params = new URLSearchParams(location.search);
    const target = params.get('ouvrir');
    if (target === 'pere-noel' || target === 'destinataire') {
      currentTab = 'messages';
      history.replaceState(history.state, '', tabUrl());
      chat.openConv(target === 'pere-noel' ? 'santa' : 'recipient');
    }
  } else {
    chat = null;
    chatSection.append(chatPlaceholder(false));
  }
  renderNotifCard();
  if (group.revealed) renderAlbum();
  updateQuickbar();
}

// ---------------------------------------------------------------------------
// Album souvenir (après la révélation)
// ---------------------------------------------------------------------------

async function renderAlbum(focusKey = null) {
  const box = document.getElementById('album');
  if (!box) return;
  let data;
  try {
    data = await api('GET', `${base}/album`);
  } catch (err) {
    clear(box, el('section', { class: 'card' }, el('h2', {}, titled('images', 'Album souvenir')), el('p', { class: 'muted' }, err.message)));
    return;
  }
  const me = data.entries.find((e) => e.id === data.me);
  // On décide APRÈS l'attente : ne pas reprendre le focus si l'utilisateur est parti ailleurs.
  const active = document.activeElement;
  const keep = !active || active === document.body ? focusKey
    : box.contains(active) ? (active.dataset?.focusKey ?? null) : null;
  const photoUrl = (e) => `${base}/album/photo/${encodeURIComponent(e.id)}?v=${e.updatedAt ?? 0}`;

  // Ma contribution : photo du cadeau reçu + petit mot
  const fileInput = el('input', { type: 'file', accept: 'image/*', class: 'sr-only', id: 'album-file', 'data-focus-key': 'album-file' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const label = box.querySelector('label[for="album-file"]');
    label?.classList.add('busy');
    try {
      const blob = await prepareImage(file);
      let res;
      try {
        res = await fetch(`${base}/album/photo`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob, credentials: 'same-origin' });
      } catch {
        throw new Error('Connexion impossible. Vérifie ta connexion internet.');
      }
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Erreur ${res.status}`);
      toast('Photo ajoutée à l’album !', 'success');
      renderAlbum('album-file');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      label?.classList.remove('busy');
      fileInput.value = '';
    }
  });
  // Garde un mot tapé mais pas encore enregistré si l'album se redessine (envoi d'une photo).
  const oldNote = box.querySelector('#album-note');
  const noteDraft = oldNote && oldNote.value !== (oldNote.dataset.saved ?? '') ? oldNote.value : null;
  const note = el('textarea', { rows: '3', maxlength: '500', id: 'album-note', 'data-saved': me?.note ?? '', value: noteDraft ?? me?.note ?? '', placeholder: `Un petit mot pour ${me?.giverName || 'ton Père Noël secret'}…`, 'aria-label': 'Ton petit mot' });
  const noteForm = el('form', { novalidate: true }, note, el('div', { class: 'actions' }, el('button', { class: 'btn btn-primary', type: 'submit', 'data-focus-key': 'album-note-save' }, 'Enregistrer le mot')));
  noteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await withButton(noteForm.querySelector('button'), () => api('PUT', `${base}/album/note`, { note: note.value }));
    if (ok) {
      toast('Petit mot enregistré !', 'success');
      renderAlbum('album-note-save');
    }
  });

  clear(box, el('section', { class: 'card album' },
    el('h2', {}, titled('images', 'Album souvenir')),
    el('p', { class: 'muted' }, `Ajoute la photo du cadeau que tu as reçu et un petit mot pour ${me?.giverName || 'ton Père Noël secret'}. Tout le monde le verra dans l'album.`),
    el('div', { class: 'album-mine' },
      me?.hasPhoto ? el('img', { class: 'album-preview', src: photoUrl(me), alt: 'Ta photo' }) : null,
      el('div', { class: `album-photo-actions${me?.hasPhoto ? '' : ' empty'}` },
        fileInput,
        el('label', { for: 'album-file', class: me?.hasPhoto ? 'btn' : 'dropzone' }, icon('camera', { size: me?.hasPhoto ? 18 : 24 }), el('span', {}, me?.hasPhoto ? 'Changer la photo' : 'Ajouter une photo')),
        me?.hasPhoto ? el('button', {
          class: 'btn btn-ghost btn-small', type: 'button', 'data-focus-key': 'album-photo-remove',
          onclick: async (e) => {
            const btn = e.currentTarget;
            if (!(await ask('Ta photo sera retirée de l’album.', { title: 'Retirer la photo ?', confirmLabel: 'Retirer', danger: true }))) return;
            const ok = await withButton(btn, () => api('DELETE', `${base}/album/photo`, {}));
            if (ok) renderAlbum('album-file');
          },
        }, 'Retirer la photo') : null,
      ),
      noteForm,
    ),
    el('div', { class: 'divider divider-sprig', 'aria-hidden': 'true' }, icon('fir-sprig', { size: 40 })),
    el('h3', {}, "L'album du groupe"),
    renderGallery(data.entries, { photoUrl, groupName: state.group.name, meId: data.me }),
    el('div', { class: 'downloads' },
      downloadLink(`${base}/souvenirs.zip`, withIcon('download', 'Tout télécharger'), { className: 'btn btn-primary', onError: () => load() }),
      downloadLink(`${base}/conversations.txt`, withIcon('message-circle', 'Mes discussions'), { onError: () => load() }),
    ),
    el('p', { class: 'muted small' }, '« Tout télécharger » : les photos, les petits mots et tes deux discussions, dans un fichier ZIP.'),
  ));
  if (keep) (box.querySelector(`[data-focus-key="${keep}"]`) || fileInput).focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Notifications sur le téléphone
// ---------------------------------------------------------------------------

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

async function enableNotifications(button) {
  button.disabled = true;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast('Notifications refusées. Tu peux les autoriser dans les réglages du navigateur.', 'error');
      return renderNotifCard();
    }
    await navigator.serviceWorker.ready;
    const { publicKey } = await api('GET', '/api/push/key');
    const sub = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
    await api('POST', `${base}/push`, { subscription: sub.toJSON() });
    toast('Notifications activées sur cet appareil !', 'success');
  } catch (err) {
    toast(err?.message ? `Activation impossible : ${err.message}` : 'Activation impossible.', 'error');
  } finally {
    button.disabled = false;
  }
  renderNotifCard();
}

async function disableNotifications(button) {
  button.disabled = true;
  try {
    const sub = await currentSubscription();
    if (sub) {
      await api('DELETE', `${base}/push`, { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
    toast('Notifications désactivées sur cet appareil.', 'success');
  } finally {
    button.disabled = false;
  }
  renderNotifCard();
}

/** Avant de se déconnecter : cet appareil ne doit plus recevoir les notifications. */
async function forgetDeviceNotifications() {
  try {
    const sub = await currentSubscription();
    if (sub) {
      await api('DELETE', `${base}/push`, { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* sans importance */ }
}

async function renderNotifCard() {
  const box = document.getElementById('notif-card');
  if (!box) return;
  const card = (...children) => el('section', { class: 'card notif' }, el('h2', {}, titled('bell', 'Notifications')), ...children);
  if (!pushSupported()) {
    if (isIOS() && !isStandalone()) {
      clear(box, card(
        el('p', {}, "Pour être prévenu·e quand ton Père Noël secret t'écrit, installe d'abord l'appli sur ton iPhone :"),
        el('ol', { class: 'notif-steps' },
          el('li', {}, 'Appuie sur le bouton ', el('strong', {}, 'Partager'), ' de Safari (le carré avec une flèche).'),
          el('li', {}, 'Choisis ', el('strong', {}, '« Sur l’écran d’accueil »'), '.'),
          el('li', {}, "Ouvre l'appli Secret Santa depuis ton écran d'accueil, puis reviens ici pour activer les notifications."),
        ),
      ));
    } else {
      clear(box, card(el('p', { class: 'muted' }, 'Ce navigateur ne permet pas les notifications. Pense à revenir voir tes messages de temps en temps !')));
    }
    return;
  }
  if (Notification.permission === 'denied') {
    clear(box, card(el('p', { class: 'muted' }, 'Les notifications sont bloquées pour ce site. Pour les recevoir, autorise-les dans les réglages de ton navigateur ou de ton téléphone.')));
    return;
  }
  let sub = null;
  try {
    sub = await currentSubscription();
  } catch { /* ignore */ }
  if (sub && Notification.permission === 'granted') {
    // Ré-enregistre l'abonnement (au cas où le serveur l'aurait oublié, ex. code réinitialisé).
    api('POST', `${base}/push`, { subscription: sub.toJSON() }).catch(() => {});
    clear(box, card(
      el('p', { class: 'status-ok' }, icon('check-circle', { size: 18 }), el('span', {}, 'Activées sur cet appareil')),
      el('p', { class: 'muted small' }, "Tu seras prévenu·e quand on t'écrit, au tirage et à la révélation. Le contenu des messages n'apparaît jamais dans les notifications."),
      el('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: (e) => disableNotifications(e.currentTarget) }, 'Désactiver'),
    ));
    return;
  }
  clear(box, card(
    el('p', {}, "Sois prévenu·e dès que ton Père Noël secret t'écrit (sans que personne d'autre ne voie le message)."),
    el('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => enableNotifications(e.currentTarget) }, withIcon('bell', 'Activer les notifications')),
  ));
}

/** Raccourci dans l'en-tête de « Mon tirage » : nouveaux messages (caché quand le bandeau est visible). */
function updateQuickbar() {
  updateTabs();
  const bar = document.getElementById('quickbar');
  const unread = chat ? chat.unreadTotal() : 0;
  if (bar) {
    const links = [];
    if (unread) {
      links.push(el('a', {
        href: '#messages', class: 'chip chip-night quick quick-hot',
        onclick: (e) => {
          e.preventDefault();
          chat.openUnread();
        },
      }, icon('message-circle', { size: 16 }), el('span', {}, `${unread} nouveau${unread > 1 ? 'x' : ''} message${unread > 1 ? 's' : ''}`)));
    }
    clear(bar, links);
    bar.hidden = links.length === 0;
  }
  document.title = `${unread ? `(${unread}) ` : ''}${pageTitle(state.group.name)}`;
}

function resetRevealAnimation() {
  revealOpened = 0;
  if (revealTimer) clearInterval(revealTimer);
  revealTimer = null;
}

function renderInfo() {
  const info = document.getElementById('info');
  if (!info) return;
  if (!state.group.revealed) resetRevealAnimation();
  const { group, recipient, santaName } = state;
  const key = JSON.stringify([group, recipient, santaName, state.reveal, state.me.giftStatus, revealOpened, Boolean(revealTimer), isUnwrapped()]);
  // Pendant l'animation d'ouverture, on ne redessine pas la carte (rafraîchissement automatique).
  if (unwrapping) return;
  if (key === lastInfoKey) return;
  lastInfoKey = key;
  const trace = document.getElementById('trace');
  if (trace) clear(trace, revealTraceNotice());
  const letterBox = document.getElementById('their-letter-box');
  // Mémorise l'élément qui avait le focus pour le rendre après avoir redessiné.
  const inBoxes = info.contains(document.activeElement) || letterBox?.contains(document.activeElement);
  const focusKey = (inBoxes ? document.activeElement.dataset.focusKey : null) || pendingFocusKey;
  pendingFocusKey = null;
  const parts = [];
  let letterParts = [];

  if (group.revealed && santaName) {
    parts.push(el('section', { class: 'card reveal center' },
      el('div', { class: 'reveal-frame' },
        el('div', { class: 'hero-art', 'aria-hidden': 'true' }, icon('gift-art', { size: 64 })),
        el('p', { class: 'eyebrow' }, 'Ton Père Noël secret était…'),
        el('p', { class: 'big-name' }, santaName),
        el('p', { class: 'muted small' }, 'Pense à lui dire merci dans la discussion !')),
    ));
    if (state.reveal?.length) parts.push(renderRevealAll());
  }

  if (!group.drawn) {
    parts.push(el('section', { class: 'card waiting center' },
      el('div', { class: 'hero-art', 'aria-hidden': 'true' }, icon('gift-art', { size: 80 })),
      el('h2', {}, "Le tirage n'a pas encore eu lieu"),
      el('p', {}, "Reviens ici un peu plus tard : tu découvriras à qui tu offres un cadeau. En attendant, écris ta lettre au Père Noël pour aider ton futur Père Noël secret !"),
      letterNeedsFill() ? el('button', {
        class: 'btn btn-primary', type: 'button', 'data-focus-key': 'write-letter',
        onclick: () => { selectTab('lettre'); document.getElementById('wishlist-input')?.focus({ preventScroll: true }); },
      }, withIcon('mail', 'Écrire ma lettre')) : null,
    ));
  } else if (recipient && !isUnwrapped()) {
    // Première visite après le tirage : un cadeau à ouvrir (le prénom n'apparaît nulle part avant).
    parts.push(mysteryGiftCard(recipient.name));
    letterParts = [el('section', { class: 'card letter-soon center' },
      el('div', { class: 'hero-art', 'aria-hidden': 'true' }, icon('envelope-art', { size: 72 })),
      el('h2', {}, 'Sa lettre au Père Noël'),
      el('p', {}, 'Ouvre d’abord ton cadeau pour découvrir à qui tu offres : tu pourras ensuite lire sa lettre au Père Noël ici.'),
      el('button', {
        class: 'btn btn-primary', type: 'button', 'data-focus-key': 'letter-open-gift',
        onclick: () => { selectTab('tirage'); if (state.recipient) openGiftOverlay(state.recipient.name); },
      }, withIcon('gift', 'Ouvrir mon cadeau')))];
  } else if (recipient) {
    const revealed = group.revealed;
    // L'étiquette cadeau : le moment le plus important de la page.
    // Nom long : on réduit la taille selon le mot le plus long, pour ne pas couper au milieu.
    const longestWord = Math.max(...recipient.name.split(/[\s-]+/).map((w) => [...w].length), 1);
    const nameClass = longestWord > 16 ? 'big-name big-name-xlong' : longestWord > 11 ? 'big-name big-name-long' : 'big-name';
    parts.push(el('section', { class: 'card target', 'aria-label': revealed ? 'Tu offrais un cadeau à' : 'Tu offres un cadeau à' },
      el('span', { class: 'tag-ribbon', 'aria-hidden': 'true' }),
      el('span', { class: 'tag-bow', 'aria-hidden': 'true' }, icon('bow', { size: 64 })),
      el('div', { class: 'tag-content' },
        el('p', { class: 'eyebrow' }, revealed ? 'Tu offrais un cadeau à' : 'Tu offres un cadeau à'),
        el('p', { class: nameClass }, recipient.name),
        group.budget ? el('p', { class: 'tag-chip' }, `Budget : ${group.budget}`) : null,
        el('p', { class: 'hush' }, revealed
          ? `${recipient.name} sait maintenant que c'était toi !`
          : [icon('venetian-mask', { size: 18 }), ` Chut ! ${recipient.name} ne sait pas que c'est toi.`]),
        el('div', { class: 'tag-actions' },
          el('button', {
            class: 'btn btn-on-berry tag-letter', type: 'button', 'data-focus-key': 'read-letter',
            onclick: () => selectTab('salettre'),
          }, icon('scroll-text', { size: 18 }), recipient.wishlist ? fitLabel('Lire sa lettre au Père Noël', 'Lire sa lettre') : fitLabel('Sa lettre au Père Noël', 'Sa lettre')),
          revealed ? null : el('button', {
            class: 'btn btn-on-berry', type: 'button', 'data-focus-key': 'tag-write',
            onclick: () => chat?.openConv('recipient'),
          }, withIcon('message-circle', `Écrire à ${recipient.name}`)))),
    ));
    // Où en est le cadeau (le suivi reste dans « Mon tirage », sous l'étiquette).
    if (!revealed) parts.push(el('section', { class: 'card gift-card' }, renderGiftProgress(recipient.name)));
    // Sa lettre au Père Noël (signée de son prénom : on sait déjà à qui on offre).
    letterParts = [el('section', { class: 'card letter-read', id: 'their-letter', 'aria-labelledby': 'their-letter-title' },
      el('h2', { id: 'their-letter-title' }, titled('scroll-text', `La lettre de ${recipient.name}`)),
      recipient.wishlist
        ? letterSheet(letterText(recipient.wishlist), recipient.name, { read: true, text: () => recipient.wishlist })
        : el('div', { class: 'letter-missing' },
          el('span', { class: 'letter-missing-art', 'aria-hidden': 'true' }, icon('envelope-art', { size: 64 })),
          el('p', { class: 'muted' }, revealed
            ? `${recipient.name} n'avait pas écrit sa lettre.`
            : `${recipient.name} n'a pas encore écrit sa lettre. Pose-lui discrètement des questions dans la discussion !`)),
      revealed ? null : el('div', { class: 'letter-read-actions' },
        el('button', {
          class: 'btn btn-block', type: 'button', 'data-focus-key': 'write-recipient',
          onclick: () => chat?.openConv('recipient'),
        }, withIcon('message-circle', `Écrire à ${recipient.name}`))),
    )];
  }
  clear(info, parts);
  if (letterBox) clear(letterBox, letterParts);
  if (focusKey) (info.querySelector(`[data-focus-key="${focusKey}"]`) || letterBox?.querySelector(`[data-focus-key="${focusKey}"]`))?.focus();
  updateQuickbar();
}

let giftStatusAsked = false; // déjà demandé pendant cette visite
/**
 * Connexions suivantes, après le tirage (cadeau déjà découvert) : avant d'arriver sur la page,
 * on demande en plein écran où en est le cadeau. Une fois par visite (pas à chaque
 * rechargement), pas avant l'ouverture du cadeau, plus quand il est emballé ni après l'échange.
 */
const statusAskedKey = () => `ss_status_asked_${token}`;
/** Pas de question pendant cette visite (ex. on vient de se connecter pour la 1re fois ou d'ouvrir son cadeau). */
function skipStatusThisVisit() {
  giftStatusAsked = true;
  try { sessionStorage.setItem(statusAskedKey(), '1'); } catch { /* stockage indisponible */ }
}
function maybeAskGiftStatus() {
  const { group, recipient, me } = state;
  if (codeCreatedNotice) { skipStatusThisVisit(); return; } // toute 1re connexion : déjà assez d'écrans
  if (giftStatusAsked || !group.drawn || group.revealed || !recipient || !isUnwrapped()) return;
  if (me.giftStatus === 'wrapped' || exchangeReached()) return;
  if (new URLSearchParams(location.search).get('ouvrir')) return; // venu lire un message
  if (document.querySelector('.gift-overlay')) return;
  try { if (sessionStorage.getItem(statusAskedKey())) return; } catch { /* stockage indisponible */ }
  skipStatusThisVisit();
  openGiftStatusOverlay(recipient.name);
}

function openGiftStatusOverlay(recipientName) {
  const current = state.me.giftStatus;
  const currentIndex = GIFT_STEPS.findIndex(([k]) => k === current);
  const later = el('button', { class: 'btn btn-ghost btn-block status-later', type: 'button' }, current ? 'Pas de changement' : 'Plus tard');
  const choices = GIFT_STEPS.map(([key, iconName, label], i) => el('button', {
    type: 'button',
    class: `status-choice${key === current ? ' active' : ''}${i < currentIndex ? ' done' : ''}`,
    'aria-pressed': String(key === current),
    onclick: async (e) => {
      if (key === state.me.giftStatus) { close(); return; }
      const result = await withButton(e.currentTarget, () => api('PUT', `${base}/gift-status`, { status: key }));
      if (!result) return;
      state.me.giftStatus = result.giftStatus;
      close();
      renderInfo();
      toast(result.giftStatus === 'wrapped' ? 'Bravo, cadeau prêt !' : 'Avancement enregistré.', 'success');
    },
  }, el('span', { class: 'status-icon', 'aria-hidden': 'true' }, icon(i < currentIndex ? 'check' : iconName, { size: iconName === 'bow' && i >= currentIndex ? 34 : 26 })), el('span', { class: 'status-label' }, label)));
  const panel = el('div', { class: 'status-modal sheet' },
    el('div', { class: 'sheet-body' },
      el('p', { class: 'eyebrow' }, `Bon retour, ${state.me.name} !`),
      el('h2', { id: 'status-title', tabindex: '-1' }, `Où en est le cadeau pour ${recipientName} ?`),
      el('p', { class: 'muted' }, 'Personne d’autre ne voit ta réponse : l’organisateur voit seulement combien de cadeaux sont prêts.'),
      el('div', { class: 'status-choices', role: 'group', 'aria-labelledby': 'status-title' }, choices)),
    el('div', { class: 'sheet-foot' }, later),
  );
  const overlay = el('div', { class: 'gift-overlay status-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'status-title' }, panel);
  const previous = document.activeElement;
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) close(); };
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (!document.querySelector('.gift-overlay')) { root.inert = false; document.body.classList.remove('gift-open'); }
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  }
  later.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  document.body.classList.add('gift-open');
  root.inert = true;
  panel.querySelector('#status-title').focus({ preventScroll: true });
}

/** Suivi du cadeau : le Père Noël indique où il en est (l'organisateur ne voit que des totaux). */
function renderGiftProgress(recipientName) {
  const current = state.me.giftStatus;
  const currentIndex = GIFT_STEPS.findIndex(([k]) => k === current);
  const buttons = GIFT_STEPS.map(([key, iconName, label], i) => el('button', {
    type: 'button',
    'data-focus-key': `step-${key}`,
    class: `step${key === current ? ' active' : ''}${i < currentIndex ? ' done' : ''}`,
    'aria-pressed': String(key === current),
    onclick: async (e) => {
      if (key === state.me.giftStatus) return;
      const result = await withButton(e.currentTarget, () => api('PUT', `${base}/gift-status`, { status: key }));
      if (!result) return;
      state.me.giftStatus = result.giftStatus;
      pendingFocusKey = `step-${key}`;
      renderInfo();
      toast(result.giftStatus === 'wrapped' ? 'Bravo, cadeau prêt !' : 'Avancement enregistré.', 'success');
    },
  }, el('span', { class: 'step-icon', 'aria-hidden': 'true' }, i <= currentIndex && key !== current ? icon('check', { size: 16 }) : icon(iconName, { size: iconName === 'bow' ? 24 : 16 })), el('span', { class: 'step-label' }, label)));
  // Barre de progression entre les étapes (largeur posée via le CSSOM).
  const row = el('div', { class: 'steps-row' }, buttons);
  row.style.setProperty('--done', String(Math.max(0, currentIndex) / (GIFT_STEPS.length - 1)));
  return el('div', { class: 'gift-progress' },
    el('h2', {}, `Et ce cadeau pour ${recipientName}, ça avance ?`),
    row,
    current === 'wrapped' ? el('p', { class: 'mission-done' }, icon('check-circle', { size: 18 }), el('span', {}, 'Mission accomplie, Père Noël ! Le cadeau est prêt pour le grand jour.')) : null,
  );
}

/** « Salomé J » ne se coupe pas avant l'initiale. */
const keepInitial = (name) => String(name).replace(/ (\S)$/u, '\u00a0$1');

/** Après la révélation : on ouvre les cadeaux un par un pour voir qui offrait à qui. */
function renderRevealAll() {
  const chain = state.reveal;
  const list = el('ol', { class: 'reveal-list' });
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const fill = () => {
    clear(list, chain.map((pair, i) => el('li', { class: i < revealOpened ? `opened${i === revealOpened - 1 && revealTimer ? ' pop' : ''}` : 'closed' },
      i < revealOpened
        ? [el('strong', { class: 'duo-giver' }, keepInitial(pair.giver)), icon('arrow-right', { size: 16, className: 'duo-arrow' }), el('span', { class: 'sr-only' }, ' offrait à '), el('strong', { class: 'duo-receiver' }, keepInitial(pair.receiver))]
        : [icon('gift', { size: 22 }), el('span', { class: 'reveal-closed-label', 'aria-hidden': 'true' }, 'À ouvrir'), el('span', { class: 'sr-only' }, 'Cadeau encore fermé')],
    )));
  };
  const button = el('button', { class: 'btn btn-primary', type: 'button', 'data-focus-key': 'reveal-open' });
  const updateButton = () => {
    // Caché pendant l'animation (il ne ferait rien) et une fois tout ouvert.
    button.hidden = revealOpened >= chain.length || Boolean(revealTimer);
    clear(button, withIcon('gift', revealOpened === 0 ? 'Ouvrir tous les cadeaux' : 'Ouvrir le suivant'));
  };
  // L'état d'ouverture est global : la carte peut être redessinée pendant l'animation
  // (rafraîchissement automatique) sans que l'animation ne s'arrête.
  const openNext = () => {
    revealOpened = Math.min(state.reveal?.length ?? 0, revealOpened + 1);
    renderInfo();
  };
  button.addEventListener('click', () => {
    if (revealTimer) return;
    if (revealOpened > 0) return openNext();
    if (reduceMotion) {
      // Sans animation : tout s'ouvre d'un coup.
      revealOpened = chain.length;
      renderInfo();
      document.getElementById('reveal-title')?.focus();
      return;
    }
    revealTimer = setInterval(() => {
      if (!state.reveal || revealOpened >= state.reveal.length) {
        clearInterval(revealTimer);
        revealTimer = null;
        renderInfo();
        // Le focus a déjà été placé sur le titre au démarrage ; ne pas le reprendre
        // (ni refaire défiler la page) si l'utilisateur est parti ailleurs entre-temps.
        const a = document.activeElement;
        if (!a || a === document.body) document.getElementById('reveal-title')?.focus({ preventScroll: true });
        return;
      }
      openNext();
    }, 800);
    openNext(); // après la création du minuteur, pour que le premier cadeau s'anime aussi
    // Le bouton disparaît pendant l'animation : le focus va sur le titre de la liste (sans défilement).
    document.getElementById('reveal-title')?.focus({ preventScroll: true });
  });
  fill();
  updateButton();
  return el('section', { class: 'card reveal-all' },
    el('h2', { id: 'reveal-title', tabindex: '-1', 'data-focus-key': 'reveal-title' }, 'Qui offrait à qui ?'),
    el('div', { class: 'reveal-actions' }, button),
    list,
  );
}

// ---------------------------------------------------------------------------
// La lettre au Père Noël (anciennement « liste de souhaits », même champ côté serveur)
// ---------------------------------------------------------------------------

/** Rubriques proposées pour aider à écrire la lettre (insérées dans le texte). */
const RUBRICS = [
  ['🎁', 'Mes idées cadeaux'],
  ['❤️', 'Mes goûts'],
  ['🚫', 'À éviter'],
  ['📏', 'Mes tailles'],
  ['😇', 'Mes bonnes actions de l’année'],
];
// Indications discrètes (les rubriques ci-dessous les ajoutent dans la lettre d'un appui).
const LETTER_PLACEHOLDER = [
  'Cette année, j’ai été très sage…',
  '🎁 Mes idées cadeaux : un livre, des bougies…',
  '❤️ Mes goûts : le bleu, la plage, le monoï…',
  '🚫 À éviter : le chocolat…',
  '📏 Mes tailles : M, pointure 38…',
].join('\n');

const normalize = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** La lettre commence déjà par « Cher Père Noël » : pas de formule imprimée en double. */
const hasGreeting = (text) => /^\s*(cher|chère|chere)\s+p[èe]re\s+no[ëe]l/i.test(String(text || ''));
/** La dernière ligne contient déjà le prénom : pas de signature imprimée en double. */
function hasSignature(text, name) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  const first = normalize(String(name || '').split(/\s+/)[0] || '');
  return Boolean(last && first && normalize(last).includes(first));
}

/**
 * Une feuille de lettre : timbre et cachet de la poste, « Cher Père Noël, », le texte,
 * la signature « Je t'embrasse, <prénom> » et un cachet de cire.
 * signName : le prénom de celui ou celle qui écrit la lettre. text() : le texte actuel
 * (la formule et la signature ne sont pas répétées si la lettre les contient déjà).
 */
function letterSheet(body, signName, { compact = false, read = false, text = null } = {}) {
  const greeting = el('p', { class: 'letter-greeting' }, 'Cher Père Noël,');
  const sign = el('p', { class: 'letter-sign' }, 'Je t’embrasse,', el('span', { class: 'letter-name' }, signName));
  const sheet = el('div', { class: `letter-paper${compact ? ' compact' : ''}${read ? ' read' : ''}` },
    el('span', { class: 'letter-stamp', 'aria-hidden': 'true' }, el('span', { class: 'letter-stamp-art' })),
    el('span', { class: 'letter-postmark', 'aria-hidden': 'true' }, el('span', {}, 'Pôle'), el('span', {}, 'Nord')),
    greeting,
    body,
    el('div', { class: 'letter-foot' },
      el('span', { class: 'letter-seal', 'aria-hidden': 'true' }, icon('fir-sprig', { size: 24 })),
      sign),
  );
  sheet.refresh = () => {
    const t = text ? text() : '';
    greeting.hidden = hasGreeting(t);
    sign.hidden = hasSignature(t, signName);
  };
  sheet.refresh();
  return sheet;
}

/** Le texte d'une lettre, en lecture (les liens sont cliquables ; pas plus d'une ligne vide de suite). */
const letterText = (text) => el('div', { class: 'letter-text wishlist-text' }, linkify(String(text).replace(/\n{3,}/g, '\n\n')));

/** La date limite de la lettre, en clair, dans une pastille (« avant dim. 29 nov. », « plus que 2 jours »…). */
function deadlineChip(d, todo = false) {
  if (!d || exchangeReached()) return null;
  const n = daysUntil(d);
  const [y, m, day] = d.split('-').map(Number);
  const short = new Date(y, m - 1, day).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const urgent = n <= 2;
  const when = n < 0 ? 'date dépassée : écris-la vite !' : n === 0 ? "c'est aujourd'hui, dernier jour !" : n === 1 ? 'plus que 1 jour' : `plus que ${n} jours`;
  return el('span', { class: `chip letter-deadline ${urgent ? 'chip-alert' : 'chip-wait'}` },
    icon('calendar', { size: 16 }),
    el('span', {}, urgent ? when : `${todo ? 'À écrire avant' : 'avant'} ${short}`),
    el('span', { class: 'sr-only' }, urgent ? ` (lettre à poster avant le ${shortDate(d)})` : ` (${when})`));
}
function letterDeadline() {
  return deadlineChip(state.group.wishlistDeadline, letterNeedsFill());
}

function renderWishlistCard(initial, draft = null) {
  const myName = state.me.name;
  const area = el('textarea', {
    rows: '7', maxlength: '3000', value: draft ?? initial, id: 'wishlist-input', class: 'letter-body',
    placeholder: LETTER_PLACEHOLDER,
    'aria-label': 'Ma lettre au Père Noël', 'aria-describedby': 'letter-help',
  });
  const status = el('span', { class: 'letter-status muted small', role: 'status' });
  const button = el('button', { class: 'btn btn-primary', type: 'submit' }, withIcon('save', 'Enregistrer ma lettre'));
  // Aperçu : la lettre telle que la lira le Père Noël secret.
  const preview = el('div', { class: 'letter-preview', hidden: true });
  const previewBtn = el('button', { class: 'btn btn-ghost', type: 'button', 'aria-pressed': 'false' }, withIcon('eye', 'Aperçu'));
  const editBox = el('div', { class: 'letter-edit' }, area);
  // (L'émoji de la rubrique est écrit dans la lettre elle-même, pas sur le bouton.)
  const chips = RUBRICS.map(([emoji, label]) => el('button', {
    class: 'rubric', type: 'button', 'data-rubric': label,
    onclick: () => addRubric(emoji, label),
  }, el('span', { class: 'rubric-done', 'aria-hidden': 'true' }, icon('check', { size: 16 })), el('span', {}, label), el('span', { class: 'sr-only rubric-sr' })));
  let saved = initial;
  let card = null;
  let sheet = null;
  const updateChips = () => {
    for (const chip of chips) {
      const used = area.value.includes(chip.dataset.rubric);
      chip.classList.toggle('used', used);
      chip.querySelector('.rubric-sr').textContent = used ? ' (déjà dans ta lettre)' : '';
    }
  };
  const updateStatus = () => {
    const dirty = area.value !== saved;
    area.dataset.dirty = dirty ? '1' : '';
    status.textContent = dirty ? 'Modifications non enregistrées' : '';
    // Le brouillon est gardé sur l'appareil jusqu'à ce qu'il soit enregistré.
    if (dirty) storage.set(draftKey(), area.value);
    else forgetDraft();
    // Tant que la lettre n'est pas enregistrée, la carte brille pour qu'on la remarque.
    const needsFill = !String(saved || '').trim() && !exchangeReached();
    card?.classList.toggle('needs-fill', needsFill);
    sheet?.refresh();
    updateChips();
  };
  /** Ajoute une rubrique à la fin de la lettre (ou y emmène le curseur si elle y est déjà). */
  function addRubric(icon, label) {
    if (!preview.hidden) togglePreview(false);
    const at = area.value.indexOf(label);
    if (at >= 0) {
      const end = area.value.indexOf('\n', at);
      const pos = end < 0 ? area.value.length : end;
      area.focus();
      area.setSelectionRange(pos, pos);
      return;
    }
    const text = area.value.replace(/\s+$/, '');
    const line = `${icon} ${label} : `;
    area.value = text ? `${text}\n\n${line}` : line;
    area.dispatchEvent(new Event('input'));
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    area.scrollTop = area.scrollHeight;
  }
  function togglePreview(show) {
    preview.hidden = !show;
    editBox.hidden = show;
    if (!show) area.grow();
    previewBtn.setAttribute('aria-pressed', String(show));
    clear(previewBtn, show ? withIcon('pen-line', 'Continuer d’écrire') : withIcon('eye', 'Aperçu'));
    if (show) {
      clear(preview, area.value.trim()
        ? letterText(area.value)
        : el('p', { class: 'letter-text letter-empty-text' }, 'Ta lettre est encore vide…'));
    }
  }
  previewBtn.addEventListener('click', () => togglePreview(preview.hidden));
  // La feuille s'allonge avec le texte (comme une vraie lettre), sans barre de défilement.
  area.grow = () => {
    if (!area.offsetParent) return; // onglet caché : recalculé à l'affichage
    const keep = window.scrollY;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight + 4}px`;
    window.scrollTo(0, keep);
    keepCaretAboveSavebar();
  };
  // En écrivant en bas de la lettre, la ligne tapée reste au-dessus de « Enregistrer / Terminé ».
  const keepCaretAboveSavebar = () => {
    const bar = area.closest('form')?.querySelector('.letter-savebar');
    if (!bar || bar.hidden || document.activeElement !== area) return;
    if (area.selectionEnd < area.value.length - 1) return; // on corrige plus haut : on ne bouge pas
    const caretBottom = area.getBoundingClientRect().bottom - parseFloat(getComputedStyle(area).paddingBottom || '0');
    const limit = bar.getBoundingClientRect().top - 12;
    if (caretBottom > limit) window.scrollBy(0, caretBottom - limit);
  };
  area.addEventListener('input', () => area.grow());
  area.addEventListener('input', updateStatus);
  updateStatus();
  // Rafraîchissement automatique : si la lettre a changé ailleurs (autre appareil) et
  // qu'on n'est pas en train de la modifier ici, on affiche la version enregistrée.
  area.syncSaved = (value) => {
    if (area.dataset.dirty === '1' || value === saved) return;
    saved = value;
    area.value = value;
    updateStatus();
    area.grow();
    if (!preview.hidden) togglePreview(true);
    savebar.hidden = document.activeElement !== area;
  };
  // Pendant l'écriture (surtout sur téléphone, clavier ouvert) : une barre reste collée en bas
  // de l'écran avec « Enregistrer » et « Terminé » (qui referme le clavier).
  const doneBtn = el('button', { class: 'btn btn-ghost btn-small letter-done', type: 'button', hidden: true, onclick: () => area.blur() }, withIcon('check', 'Terminé'));
  const saveNow = el('button', { class: 'btn btn-primary btn-small', type: 'submit' }, withIcon('save', 'Enregistrer'));
  const savebar = el('div', { class: 'letter-savebar', hidden: true }, saveNow, doneBtn);
  const updateSavebar = () => {
    const writing = document.activeElement === area;
    savebar.hidden = !(writing || area.value !== saved);
    doneBtn.hidden = !writing;
  };
  area.addEventListener('focus', updateSavebar);
  area.addEventListener('blur', () => setTimeout(updateSavebar, 0));
  area.addEventListener('input', updateSavebar);
  area.addEventListener('focus', () => requestAnimationFrame(keepCaretAboveSavebar));
  sheet = letterSheet([editBox, preview], myName, { text: () => area.value });
  const form = el('form', { novalidate: true, class: 'letter-form' },
    sheet,
    savebar,
    el('div', { class: 'rubrics' },
      el('p', { class: 'rubrics-title', id: 'rubrics-title' }, icon('lightbulb', { size: 16 }), el('span', {}, 'Besoin d’idées ? Ajoute une rubrique :')),
      el('div', { class: 'rubric-list', role: 'group', 'aria-labelledby': 'rubrics-title' }, chips)),
    el('div', { class: 'letter-actions' }, button, previewBtn, status));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = await withButton(button, () => api('PUT', `${base}/wishlist`, { wishlist: area.value }));
    if (!result) return;
    saved = result.wishlist;
    if (area.value.trim() === result.wishlist) area.value = result.wishlist;
    updateStatus();
    // Le calendrier, les onglets et les raccourcis suivent tout de suite (date limite plus « à écrire »).
    state.me.wishlist = result.wishlist;
    redrawDates();
    updateQuickbar();
    if (!preview.hidden) togglePreview(true);
    updateSavebar();
    toast('Lettre au Père Noël enregistrée !', 'success');
  });
  area.addEventListener('input', () => updateQuickbar());
  card = el('section', { class: 'card letter-card', id: 'wishlist-card', 'aria-labelledby': 'letter-title' },
    el('div', { class: 'card-title-row' },
      el('h2', { id: 'letter-title' }, titled('mail', 'Ma lettre au Père Noël')),
      letterDeadline()),
    el('p', { class: 'muted small', id: 'letter-help' }, 'Ton Père Noël secret la lira pour te trouver le cadeau parfait : tes envies, tes goûts, ta taille, ce que tu n’aimes pas…'),
    form,
  );
  updateStatus();
  return card;
}

// ---------------------------------------------------------------------------
// Messagerie anonyme
// ---------------------------------------------------------------------------

/** Onglet Messagerie avant que les discussions n'existent (pas de tirage, ou cadeau pas encore ouvert). */
function chatPlaceholder(giftWaiting) {
  return el('section', { class: 'card chat-soon center' },
    el('div', { class: 'hero-art', 'aria-hidden': 'true' }, giftWaiting ? icon('gift-art', { size: 72 }) : el('span', { class: 'hero-icon-disc' }, icon('message-circle', { size: 32 }))),
    el('h2', {}, 'Messagerie'),
    giftWaiting
      ? [
        el('p', {}, 'Ouvre d’abord ton cadeau pour découvrir à qui tu offres : tes deux discussions anonymes apparaîtront ici.'),
        el('button', { class: 'btn btn-primary', type: 'button', onclick: () => { selectTab('tirage'); if (state.recipient) openGiftOverlay(state.recipient.name); } }, withIcon('gift', 'Ouvrir mon cadeau')),
      ]
      : el('p', {}, 'Après le tirage au sort, tu auras ici deux discussions anonymes : une avec la personne à qui tu offres un cadeau (elle ne saura pas que c’est toi), et une avec ton Père Noël secret.'),
  );
}

function createChat(drawnAt) {
  const messages = { recipient: [], santa: [] };
  const seen = new Set();
  let lastId = 0;
  let loaded = false; // premier chargement terminé ? (on n'annonce pas l'historique)
  let open = null; // conversation ouverte en plein écran (« recipient » ou « santa »)
  const readUpTo = { ...state.reads };
  // Page rechargée alors qu'une discussion était ouverte : on la rouvre (le bouton
  // « retour » la refermera normalement).
  const resumeConv = history.state?.chat === 'recipient' || history.state?.chat === 'santa' ? history.state.chat : null;
  const fine = () => window.matchMedia?.('(pointer: fine)').matches;

  // ---- Liste des conversations (sur la page principale), comme dans une messagerie
  const rows = {
    recipient: el('button', { class: 'convo', type: 'button', 'data-conv': 'recipient', onclick: () => openConv('recipient') }),
    santa: el('button', { class: 'convo', type: 'button', 'data-conv': 'santa', onclick: () => openConv('santa') }),
  };
  // Zone invisible qui annonce uniquement les nouveaux messages reçus aux lecteurs d'écran.
  const announcer = el('div', { class: 'sr-only', 'aria-live': 'polite' });
  const element = el('section', { class: 'card chat', id: 'chat-card' },
    el('h2', {}, titled('message-circle', 'Discussions')),
    el('div', { class: 'convo-list' }, rows.recipient, rows.santa),
    el('details', { class: 'chat-private' },
      el('summary', {}, icon('lock', { size: 16 }), el('span', {}, 'Seuls vous deux lisez ces messages.')),
      el('p', {}, el('strong', {}, 'Privé :'),
        " chaque discussion est seulement entre toi et l'autre personne (ton Père Noël secret, ou la personne à qui tu offres). Personne d'autre ne la lit pendant le jeu, pas même l'organisateur.")),
  );

  // ---- Page de discussion plein écran
  const backButton = el('button', { class: 'chat-back', type: 'button', 'aria-label': 'Retour', onclick: () => closeConv() }, icon('chevron-left', { size: 24 }));
  const avatar = el('span', { class: 'avatar', 'aria-hidden': 'true' });
  const title = el('h2', { class: 'chat-title', id: 'chat-title', tabindex: '-1' });
  const subtitle = el('p', { class: 'chat-subtitle' });
  // Pas de role="log" : la liste est redessinée, ce qui ferait relire toute la conversation.
  const list = el('div', { class: 'messages', role: 'region', 'aria-label': 'Messages', tabindex: '0' });
  let sending = false;
  // Un brouillon par discussion : un texte commencé pour l'un ne part jamais chez l'autre.
  const drafts = { recipient: '', santa: '' };
  const input = el('textarea', { rows: '1', maxlength: '2000', placeholder: 'Écris un message…', 'aria-label': 'Message', enterkeyhint: 'send' });
  const atEnd = () => list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  // La zone de saisie s'agrandit avec le texte (jusqu'à 40 % de l'écran), sans cacher les derniers messages.
  const autoGrow = () => {
    const wasAtEnd = atEnd();
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight + 2, Math.round(window.innerHeight * 0.4))}px`;
    if (wasAtEnd) list.scrollTop = list.scrollHeight;
  };
  input.addEventListener('input', autoGrow);
  // Clavier du téléphone qui s'ouvre, écran qui tourne… : si on était en bas, on y reste.
  let stuckToEnd = true;
  list.addEventListener('scroll', () => {
    stuckToEnd = atEnd();
    if (stuckToEnd) hideNewPill();
  }, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(() => { if (open && stuckToEnd) list.scrollTop = list.scrollHeight; }).observe(list);
  // « ↓ Nouveau message » : un message est arrivé pendant qu'on lisait plus haut.
  let newPill = null;
  let newBelow = false;
  function hideNewPill() { newPill?.remove(); newPill = null; }
  function showNewPill() {
    if (newPill) return;
    newPill = el('button', {
      class: 'chat-new-pill', type: 'button',
      onclick: () => {
        list.scrollTo({ top: list.scrollHeight, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        hideNewPill();
      },
    }, icon('chevron-down', { size: 16 }), el('span', {}, 'Nouveau message'));
    chatFoot.prepend(newPill);
  }
  const sendButton = el('button', { class: 'send', type: 'submit', 'aria-label': 'Envoyer' }, icon('send', { size: 20 }));
  const form = el('form', { class: 'composer', novalidate: true }, input, sendButton);
  const footTip = el('p', { class: 'chat-tip' }, "Attention à ne pas te trahir par ta façon d'écrire !");
  const chatFoot = el('div', { class: 'chat-foot' }, form, footTip);
  const screen = el('section', { class: 'chat-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'chat-title', hidden: true },
    el('div', { class: 'chat-panel' },
      el('header', { class: 'chat-head' }, backButton, avatar, el('div', { class: 'chat-head-text' }, title, subtitle)),
      list,
      chatFoot,
    ),
  );
  // Échap ferme la discussion, où que soit le focus (sauf si une fenêtre de confirmation est ouverte).
  const onKey = (e) => { if (e.key === 'Escape' && open && !document.querySelector('dialog[open]')) closeConv(); };
  document.addEventListener('keydown', onKey);
  // L'annonce des nouveaux messages reste hors de la page principale, qui devient inerte
  // pendant une discussion (sinon les lecteurs d'écran ne l'entendraient pas).
  document.body.append(screen, announcer);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body || sending || !open) return; // évite le double envoi (Entrée pressée deux fois)
    sending = true;
    const conv = open;
    let result;
    try {
      result = await withButton(sendButton, () => api('POST', `${base}/messages`, { conv, body, drawnAt }));
    } finally {
      sending = false;
    }
    if (!result) {
      // Tirage refait entre-temps : on recharge la page plutôt que d'écrire à la mauvaise personne.
      lastStatePoll = 0;
      poll();
      return;
    }
    // Envoyé : on vide le brouillon de CETTE discussion (on a pu passer à l'autre entre-temps).
    drafts[conv] = '';
    if (open === conv) {
      input.value = '';
      autoGrow();
    }
    // Le message envoyé n'avance PAS le curseur de lecture : sinon un message reçu
    // juste avant (identifiant plus petit) ne serait jamais récupéré.
    add([result.message], { advance: false });
    if (open === conv) {
      // Comme Messenger : son propre message est toujours visible, même si on était remonté.
      list.scrollTop = list.scrollHeight;
      hideNewPill();
      input.focus();
    }
  });

  const nameOf = (conv) => (conv === 'recipient'
    ? (state.recipient?.name ?? '?')
    : (state.santaName || 'Mon Père Noël secret'));
  // Avatar : bonnet de Père Noël pour son Père Noël secret (jamais d'initiale), initiale pour sa personne.
  const avatarContent = (conv) => (conv === 'santa' ? icon('santa-hat', { size: 22 }) : [...(state.recipient?.name ?? '?')][0].toLocaleUpperCase('fr'));
  const hintOf = (conv) => {
    const name = state.recipient?.name ?? '';
    if (conv === 'recipient') {
      return state.group.revealed
        ? `C'est révélé : ${name} sait maintenant que c'était toi !`
        : `Tu es anonyme : ${name} voit « Père Noël secret », pas ton prénom.`;
    }
    return state.santaName
      ? `Ton Père Noël secret était ${state.santaName} !`
      : "Cette personne sait qui tu es, mais toi tu ne sais pas qui c'est.";
  };

  function otherLabel(conv) {
    if (conv === 'recipient') return state.recipient?.name ?? '?';
    return state.santaName ? state.santaName : 'Ton Père Noël secret';
  }

  function unread(conv) {
    return messages[conv].filter((m) => !m.mine && m.id > (readUpTo[conv] || 0)).length;
  }

  function renderRows() {
    for (const conv of ['recipient', 'santa']) {
      const items = messages[conv];
      const last = items[items.length - 1];
      const n = unread(conv);
      const preview = last
        ? `${last.mine ? 'Moi : ' : ''}${last.body.replace(/\s+/g, ' ')}`
        : state.group.revealed
          ? (conv === 'recipient' ? 'Demande-lui si le cadeau lui a plu !' : 'Dis merci à ton Père Noël !')
          : (conv === 'recipient' ? 'Envoie-lui un premier message (tu restes anonyme)' : 'Pose-lui tes questions !');
      clear(rows[conv],
        el('span', { class: `avatar avatar-${conv}`, 'aria-hidden': 'true' }, avatarContent(conv)),
        el('span', { class: 'convo-text' },
          el('span', { class: 'convo-top' },
            el('span', { class: 'convo-name' }, conv === 'recipient' ? nameOf(conv) : (state.santaName || 'Ton Père Noël secret')),
            last ? el('span', { class: 'convo-time' }, formatTime(last.createdAt)) : null,
          ),
          el('span', { class: 'convo-sub' },
            el('span', { class: `convo-preview${n ? ' unread' : ''}` }, preview),
            n ? [el('span', { class: 'count', 'aria-hidden': 'true' }, String(n)), el('span', { class: 'sr-only' }, ` (${n} non lu${n > 1 ? 's' : ''})`)] : null,
          ),
        ),
        icon('chevron-right', { size: 18, className: 'convo-chevron' }),
      );
      rows[conv].setAttribute('aria-label', `${conv === 'recipient' ? `Discussion avec ${nameOf(conv)}` : 'Discussion avec ton Père Noël secret'}${n ? `, ${n} non lu${n > 1 ? 's' : ''}` : ''}`);
      rows[conv].classList.toggle('has-unread', n > 0);
    }
    element.classList.toggle('has-unread', unread('recipient') + unread('santa') > 0);
  }

  function renderHead() {
    if (!open) return;
    // Le rappel ne concerne que la discussion où l'on est anonyme, avant la révélation.
    footTip.hidden = open !== 'recipient' || state.group.revealed;
    clear(avatar, avatarContent(open));
    avatar.className = `avatar avatar-${open}`;
    title.textContent = open === 'recipient' ? nameOf('recipient') : (state.santaName || 'Ton Père Noël secret');
    clear(subtitle, open === 'recipient' && !state.group.revealed ? icon('venetian-mask', { size: 14 }) : null, el('span', {}, hintOf(open)));
    // Court : le prénom est déjà dans l'en-tête, et un long texte serait coupé sur téléphone.
    input.placeholder = open === 'recipient' && !state.group.revealed ? 'Message anonyme…' : 'Ton message…';
  }

  // Conseil anti-trahison, affiché dans la discussion où l'on est anonyme tant qu'il n'a pas été lu.
  const tipKey = `ss_tip_seen_${token}`;
  function tipCard() {
    if (open !== 'recipient' || state.group.revealed || storage.get(tipKey, false)) return null;
    return el('div', { class: 'chat-tip-card', role: 'note' },
      el('p', {}, icon('venetian-mask', { size: 18, className: 'notice-icon' }), el('strong', {}, 'Pour rester incognito'), ", change un peu ta façon d'écrire : évite tes émojis préférés, tes expressions habituelles (« mdr », « grave »…) et ta ponctuation fétiche (« !!! », « ... »)."),
      el('button', {
        class: 'btn btn-small', type: 'button',
        onclick: () => { storage.set(tipKey, true); renderMessages(); input.focus(); },
      }, 'Compris !'),
    );
  }

  /** Bandeau en haut de la discussion : elle est privée, entre les deux personnes seulement. */
  function privateBanner() {
    const other = open === 'recipient' ? nameOf('recipient') : (state.santaName || 'ton Père Noël secret');
    return el('p', { class: 'chat-private-pill' },
      icon('lock', { size: 14 }), el('span', {}, `Discussion privée entre toi et ${other}`));
  }

  function renderMessages() {
    if (!open) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const items = messages[open];
    const tip = tipCard();
    if (items.length === 0) {
      clear(list, privateBanner(), tip, el('div', { class: 'empty chat-empty' },
        el('span', { class: `avatar avatar-lg avatar-${open}`, 'aria-hidden': 'true' }, avatarContent(open)),
        el('p', {}, state.group.revealed
          ? (open === 'recipient' ? 'Aucun message. Demande-lui si le cadeau lui a plu !' : 'Aucun message. Dis merci à ton Père Noël !')
          : (open === 'recipient' ? 'Aucun message. Lance la conversation, par exemple : « Plutôt sucré ou salé ? »' : 'Aucun message pour le moment.')),
      ));
    } else {
      // L'heure s'affiche au milieu, seulement après une pause d'au moins 5 minutes ;
      // qui parle se voit au côté et à la couleur (et reste lu par les lecteurs d'écran).
      clear(list, privateBanner(), tip, items.flatMap((m, i) => {
        const prev = items[i - 1];
        const pause = !prev || m.createdAt - prev.createdAt >= 5 * 60 * 1000;
        const grouped = prev && !pause && prev.mine === m.mine;
        return [
          pause ? el('p', { class: 'msg-time' }, formatTime(m.createdAt)) : null,
          el('div', { class: `msg ${m.mine ? 'mine' : 'theirs'}${grouped ? ' grouped' : ''}` },
            el('span', { class: 'sr-only' }, `${m.mine ? 'Moi' : otherLabel(open)} : `),
            el('div', { class: 'msg-body' }, linkify(m.body)),
          ),
        ];
      }));
    }
    if (nearBottom || items.length === 0 || list.dataset.conv !== open) list.scrollTop = list.scrollHeight;
    else if (newBelow) showNewPill(); // reçu pendant qu'on lit plus haut : on le signale
    newBelow = false;
    list.dataset.conv = open;
  }

  function render() {
    renderRows();
    renderHead();
    renderMessages();
    markOpenRead();
    updateQuickbar();
  }

  function openConv(conv, { push = true } = {}) {
    const previous = open;
    if (previous) drafts[previous] = input.value;
    // La discussion s'ouvre par-dessus l'onglet Messagerie (on y revient en la fermant).
    selectTab('messages', { scroll: false });
    open = conv;
    screen.hidden = false;
    root.inert = true;
    document.body.classList.add('chat-open');
    // L'alerte « nouveau message » se pose juste sous l'en-tête de la discussion.
    const head = screen.querySelector('.chat-head');
    if (head) document.documentElement.style.setProperty('--chat-head-h', `${head.offsetHeight}px`);
    // Une entrée d'historique : le bouton « retour » du téléphone ferme la discussion.
    // Passage direct d'une discussion à l'autre (bandeau) : on remplace l'entrée, pour
    // qu'un seul « retour » ramène à la page.
    if (push) {
      if (previous && history.state?.chat) history.replaceState({ chat: conv }, '', '#discussion');
      else history.pushState({ chat: conv }, '', '#discussion');
    }
    if (previous !== conv) {
      input.value = drafts[conv] || '';
      hideNewPill();
    }
    newBelow = false;
    render();
    autoGrow();
    list.scrollTop = list.scrollHeight;
    stuckToEnd = true;
    if (fine()) input.focus(); // sur téléphone, on n'ouvre pas le clavier d'office
    else title.focus();
  }

  function closeConv({ fromHistory = false } = {}) {
    if (!open) return;
    const was = open;
    drafts[was] = input.value;
    input.value = '';
    hideNewPill();
    open = null;
    screen.hidden = true;
    root.inert = false;
    document.body.classList.remove('chat-open');
    if (!fromHistory && history.state?.chat) history.back();
    renderRows();
    rows[was]?.focus();
  }

  function add(newMessages, { advance = true, announce = false } = {}) {
    let changed = false;
    const incoming = [];
    for (const m of newMessages) {
      if (advance) lastId = Math.max(lastId, m.id);
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      messages[m.conv].push(m);
      messages[m.conv].sort((a, b) => a.id - b.id);
      if (!m.mine) incoming.push(m);
      changed = true;
    }
    if (incoming.some((m) => m.conv === open)) newBelow = true;
    if (changed) render();
    newBelow = false;
    if (announce && incoming.length) {
      const m = incoming[incoming.length - 1];
      announcer.textContent = `Nouveau message de ${otherLabel(m.conv)} : ${m.body}`;
      if (open !== m.conv) messageAlert(m.conv);
    }
  }

  /** Bandeau en bas de l'écran : « Nouveau message » + « Ton Père Noël secret t'a écrit » + « Lire ». */
  let alertTimer = null;
  function messageAlert(conv) {
    // Jamais par-dessus la discussion concernée, déjà ouverte.
    if (open === conv) return;
    document.querySelector('.msg-alert')?.remove();
    clearTimeout(alertTimer);
    const who = conv === 'santa'
      ? (state.santaName ? `${state.santaName} t'a écrit !` : 'Ton Père Noël secret t’a écrit !')
      : `${nameOf('recipient')} t’a répondu !`;
    const close = () => {
      const hadFocus = banner.contains(document.activeElement);
      banner.remove();
      document.body.classList.remove('has-msg-alert');
      clearTimeout(alertTimer);
      // Fermé au clavier (ou tout seul) : le focus ne tombe pas dans le vide.
      if (hadFocus && !open) {
        const target = element.isConnected ? element.querySelector('h2') : document.querySelector('h1');
        target?.setAttribute('tabindex', '-1');
        target?.focus({ preventScroll: true });
      }
    };
    // Toute la notification est cliquable : elle ouvre directement la bonne discussion.
    const banner = el('div', { class: 'msg-alert', role: 'status' },
      el('button', { class: 'msg-alert-main', type: 'button', onclick: () => { close(); openConv(conv); } },
        el('span', { class: `avatar avatar-${conv}`, 'aria-hidden': 'true' }, avatarContent(conv)),
        el('span', { class: 'msg-alert-text' }, el('strong', {}, 'Nouveau message !'), el('span', {}, who)),
        el('span', { class: 'msg-alert-go', 'aria-hidden': 'true' }, 'Lire')),
      el('button', { class: 'msg-alert-close', type: 'button', 'aria-label': 'Fermer la notification', onclick: close }, icon('x', { size: 20 })));
    // Le reste du bandeau ouvre aussi la discussion.
    banner.addEventListener('click', (e) => {
      if (e.target.closest('button')) return; // « Lire » et × ont leur propre action
      close();
      openConv(conv);
    });
    document.body.append(banner);
    document.body.classList.add('has-msg-alert');
    try { navigator.vibrate?.([120, 60, 120]); } catch { /* pas de vibration */ }
    // Disparaît seule après 8 s, sauf tant que la souris est dessus ou que le focus y est
    // (la pastille de l'onglet garde le compte).
    const arm = () => { clearTimeout(alertTimer); alertTimer = setTimeout(close, 8000); };
    // Seule une vraie souris met en pause : au doigt, il n'y a jamais de « sortie » du bandeau.
    const mouseOver = (e) => e.pointerType === 'mouse';
    let hovered = false;
    banner.addEventListener('pointerenter', (e) => { if (mouseOver(e)) { hovered = true; clearTimeout(alertTimer); } });
    banner.addEventListener('focusin', () => clearTimeout(alertTimer));
    banner.addEventListener('pointerleave', (e) => { if (mouseOver(e)) { hovered = false; if (!banner.contains(document.activeElement)) arm(); } });
    banner.addEventListener('focusout', (e) => { if (!banner.contains(e.relatedTarget) && !hovered) arm(); });
    arm();
  }

  /** En arrivant sur la page : s'il y a un message non lu, la notification s'affiche (après les écrans d'accueil). */
  function alertUnreadOnArrival() {
    const conv = unread('santa') ? 'santa' : unread('recipient') ? 'recipient' : null;
    if (!conv || open) return;
    const show = () => {
      if (!document.contains(element)) return; // page reconstruite entre-temps
      if (document.querySelector('.gift-overlay')) { setTimeout(show, 600); return; }
      if (unread(conv) && !open) messageAlert(conv);
    };
    show();
  }

  function markOpenRead() {
    if (!open || document.visibilityState !== 'visible') return;
    // Seuls les messages REÇUS comptent pour « lu » (un message envoyé peut avoir
    // un identifiant plus grand qu'un message reçu pas encore récupéré).
    const items = messages[open].filter((m) => !m.mine);
    if (!items.length) return;
    const maxId = items[items.length - 1].id;
    if (maxId <= (readUpTo[open] || 0)) return;
    readUpTo[open] = maxId;
    api('POST', `${base}/read`, { conv: open, lastId: maxId }).catch(() => {});
    renderRows();
    updateQuickbar();
  }

  async function fetchNew() {
    // Boucle tant qu'il reste des messages (pages de 500).
    const firstLoad = !loaded;
    for (let i = 0; i < 20; i++) {
      const { messages: batch } = await api('GET', `${base}/messages?after=${lastId}`);
      add(batch, { announce: !firstLoad });
      if (batch.length < 500) break;
    }
    loaded = true;
  }

  let lastLabelKey = `${state.santaName}|${state.recipient?.name}`;
  render();
  return {
    element,
    drawnAt,
    loadAll: () => fetchNew().then(() => {
      if (resumeConv && !open) openConv(resumeConv, { push: false });
      else alertUnreadOnArrival();
    }).catch(handlePollError),
    fetchNew,
    onVisible: markOpenRead,
    unreadTotal: () => unread('recipient') + unread('santa'),
    openUnread: () => openConv(unread('recipient') ? 'recipient' : 'santa'),
    openConv: (conv) => openConv(conv),
    isOpen: () => Boolean(open),
    // Bouton « retour » du téléphone / navigateur
    onPopState: (st) => {
      if (st?.chat && st.chat !== open) openConv(st.chat, { push: false });
      else if (!st?.chat && open) closeConv({ fromHistory: true });
    },
    // Retire la page de discussion (tirage refait, déconnexion…)
    destroy: () => {
      if (open) {
        open = null;
        root.inert = false;
        document.body.classList.remove('chat-open');
        if (history.state?.chat) history.replaceState(null, '', tabUrl());
      }
      screen.remove();
      announcer.remove();
      document.removeEventListener('keydown', onKey);
    },
    // Rafraîchit les libellés ; la liste n'est redessinée que si un nom affiché a changé.
    refreshLabels: () => {
      const labelKey = `${state.santaName}|${state.recipient?.name}`;
      renderRows();
      renderHead();
      if (labelKey !== lastLabelKey) renderMessages();
      lastLabelKey = labelKey;
    },
  };
}

window.addEventListener('popstate', (e) => chat?.onPopState(e.state));

// ---------------------------------------------------------------------------
// Rafraîchissement automatique
// ---------------------------------------------------------------------------

let lastReload = 0;
function handlePollError(err) {
  if (err.status === 401 || err.status === 404) {
    // Session révoquée (code réinitialisé) ou groupe supprimé : on recharge la page.
    // Au plus une fois toutes les 10 secondes, pour ne jamais boucler si une
    // requête échoue de façon répétée (ex. ancienne version de la page encore ouverte).
    if (Date.now() - lastReload < 10_000) return;
    lastReload = Date.now();
    load();
  }
}

async function refreshState() {
  const fresh = await api('GET', base);
  if (!fresh.authenticated) {
    state = fresh;
    return load();
  }
  state = fresh;
  const drawChanged = renderedDrawnAt !== fresh.group.drawnAt || renderedRevealed !== fresh.group.revealed;
  if (renderedDrawnAt && !fresh.group.drawnAt) toast("L'organisateur a annulé le tirage.", 'info');
  if (drawChanged) {
    // Tirage fait, annulé ou refait : on reconstruit la page (le brouillon de
    // liste de souhaits est conservé par renderMain).
    renderMain();
    return;
  }
  renderInfo();
  const dates = document.getElementById('dates');
  if (dates && !dates.contains(document.activeElement)) clear(dates, datesCard());
  chat?.refreshLabels();
  document.getElementById('wishlist-input')?.syncSaved?.(fresh.me.wishlist);
}

async function poll() {
  if (polling || document.visibilityState !== 'visible') return;
  polling = true;
  try {
    if (Date.now() - lastStatePoll > STATE_POLL_MS) {
      lastStatePoll = Date.now();
      await refreshState();
    }
    if (chat && state?.authenticated && state.group.drawnAt === chat.drawnAt) await chat.fetchNew();
  } catch (err) {
    handlePollError(err);
  } finally {
    polling = false;
  }
}

function startPolling() {
  stopPolling();
  lastStatePoll = Date.now();
  pollTimer = setInterval(poll, MESSAGE_POLL_MS);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && pollTimer) {
    lastStatePoll = 0; // force un rafraîchissement complet au retour sur l'onglet
    poll();
    chat?.onVisible();
  }
});

load();
