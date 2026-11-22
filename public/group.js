import { api, el, clear, tokenFromPath, formatDate, storage, onComputer } from './common.js';

// Page du lien de groupe : chacun choisit son prénom, puis arrive sur sa page
// personnelle (protégée par son code secret).

const invite = tokenFromPath();
const root = document.getElementById('app');
const rememberKey = `ss_me_${invite}`;

function initial(name) {
  return [...name][0]?.toLocaleUpperCase('fr') || '?';
}

// « Je suis l'organisateur » : le code organisateur ouvre la page organisateur.
const organiserKey = `ss_admin_${invite}`;
async function openOrganiser() {
  // Déjà ouvert sur cet appareil : on y retourne directement (si l'accès est toujours valable).
  const saved = storage.get(organiserKey, null);
  if (saved?.token) {
    const ok = await api('GET', `/api/admin/${encodeURIComponent(saved.token)}`).then(() => true).catch(() => false);
    if (ok) { location.href = `/admin/${encodeURIComponent(saved.token)}`; return; }
    storage.remove?.(organiserKey);
    storage.set(organiserKey, null);
  }
  const code = el('input', {
    type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '12', autocomplete: 'off',
    id: 'organiser-code', 'aria-describedby': 'organiser-help',
  });
  code.addEventListener('input', () => { const d = code.value.replace(/\D/g, '').slice(0, 12); if (d !== code.value) code.value = d; code.removeAttribute('aria-invalid'); });
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Entrer');
  const cancel = el('button', { class: 'btn', type: 'button' }, 'Annuler');
  const form = el('form', { class: 'ask-form', novalidate: true },
    el('h2', { class: 'ask-title' }, "🎩 Je suis l'organisateur"),
    el('label', { class: 'field', for: 'organiser-code' }, el('span', {}, 'Code organisateur')),
    code,
    el('p', { class: 'muted small', id: 'organiser-help' }, "Entre le code choisi à la création du groupe. Après 5 essais ratés, l'accès est bloqué un moment."),
    error,
    el('div', { class: 'ask-actions' }, cancel, submit));
  const dialog = el('dialog', { class: 'ask', 'aria-labelledby': 'organiser-title' }, form);
  form.querySelector('h2').id = 'organiser-title';
  const close = () => { dialog.close(); dialog.remove(); };
  cancel.addEventListener('click', close);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fail = (msg) => { error.textContent = msg; error.hidden = false; code.setAttribute('aria-invalid', 'true'); code.value = ''; code.focus(); };
    if (!/^[0-9]{4,12}$/.test(code.value)) return fail('Le code doit faire de 4 à 12 chiffres.');
    submit.disabled = true;
    try {
      const { adminToken } = await api('POST', `/api/g/${encodeURIComponent(invite)}/organisateur`, { code: code.value });
      storage.set(organiserKey, { token: adminToken });
      location.href = `/admin/${encodeURIComponent(adminToken)}`;
    } catch (err) {
      fail(err.message);
    } finally {
      submit.disabled = false;
    }
  });
  document.body.append(dialog);
  dialog.showModal();
  code.focus();
}

// Styles de l'animation du choix du prénom (fichier à part, chargé une fois).
if (!document.querySelector('link[href="/static/gate-anim.css"]')) {
  document.head.append(el('link', { rel: 'stylesheet', href: '/static/gate-anim.css' }));
}

// Un renne qui galope vers la droite (pattes qui bougent, corps qui rebondit).
const deerSvg = (x, y, rudolph, late) => `
<g transform="translate(${x} ${y})"><g class="bob${late ? ' late' : ''}">
  <g class="leg a"><rect x="10" y="32" width="4" height="19" rx="2" fill="#7a4b22"/><rect x="9.5" y="49" width="5" height="3.5" rx="1" fill="#3b2414"/></g>
  <g class="leg b"><rect x="35" y="32" width="4" height="19" rx="2" fill="#7a4b22"/><rect x="34.5" y="49" width="5" height="3.5" rx="1" fill="#3b2414"/></g>
  <ellipse cx="5" cy="23" rx="3.5" ry="2.5" fill="#fff"/>
  <ellipse cx="25" cy="27" rx="21" ry="10.5" fill="#8b5a2b"/>
  <ellipse cx="25" cy="32" rx="13" ry="4" fill="#c89a6a"/>
  <g class="leg b"><rect x="14" y="31" width="4" height="20" rx="2" fill="#8b5a2b"/><rect x="13.5" y="49" width="5" height="3.5" rx="1" fill="#3b2414"/></g>
  <g class="leg a"><rect x="39" y="31" width="4" height="20" rx="2" fill="#8b5a2b"/><rect x="38.5" y="49" width="5" height="3.5" rx="1" fill="#3b2414"/></g>
  <polygon points="36,22 43,6 51,8 45,27" fill="#8b5a2b"/>
  <path d="M46 3 L43 -7 M43 -7 L39 -10 M43 -7 L45 -13 M50 3 L53 -7 M53 -7 L50 -12 M53 -7 L58 -10" stroke="#6b4a2b" stroke-width="1.8" stroke-linecap="round" fill="none"/>
  <ellipse cx="44" cy="3" rx="3.5" ry="1.6" fill="#7a4b22" transform="rotate(-25 44 3)"/>
  <ellipse cx="51" cy="8" rx="8.5" ry="5.5" fill="#8b5a2b"/>
  <ellipse cx="58" cy="10" rx="4.5" ry="3.2" fill="#a87545"/>
  <circle cx="62" cy="9.5" r="${rudolph ? 2.8 : 2}" fill="${rudolph ? '#e8202f' : '#3b2414'}"${rudolph ? ' class="rudolph"' : ''}/>
  <circle cx="51" cy="6" r="1.1" fill="#1b120c"/>
  <path d="M38 21 Q 44 25 49 13" stroke="#c8283b" stroke-width="2.5" fill="none"/>
  <circle cx="44" cy="22.5" r="1.6" fill="#f2b84b"/>
</g></g>`;

// Le Père Noël dans son traîneau, tiré par deux rennes (Rudolph devant).
const SLEIGH_SVG = `<svg viewBox="-6 -26 250 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M70 38 Q 100 46 132 30 M70 38 Q 140 44 198 28" stroke="#5a3a1e" stroke-width="1.4" fill="none"/>
  ${deerSvg(112, 6, false, true)}
  ${deerSvg(176, 4, true, false)}
  <g class="santa">
    <rect x="8" y="6" width="16" height="14" rx="2" fill="#1f6b47"/><rect x="14.5" y="6" width="3" height="14" fill="#f2b84b"/><rect x="8" y="11.5" width="16" height="3" fill="#f2b84b"/>
    <rect x="20" y="10" width="12" height="10" rx="2" fill="#3a6fd8"/><rect x="25" y="10" width="2.5" height="10" fill="#fff"/>
    <ellipse cx="44" cy="22" rx="14" ry="12" fill="#d32f3f"/>
    <rect x="31" y="24" width="26" height="4" rx="1.5" fill="#2a1a14"/><rect x="42" y="23.5" width="5" height="5" rx="1" fill="#f2b84b"/>
    <path d="M52 18 Q 60 20 68 33" stroke="#d32f3f" stroke-width="6" stroke-linecap="round" fill="none"/>
    <circle cx="69" cy="35" r="3.6" fill="#1f6b47"/>
    <circle cx="47" cy="3" r="8.5" fill="#f5c9a8"/>
    <path d="M38 5 Q 40 18 48 19 Q 57 18 56 5 Q 52 10 47 9 Q 42 10 38 5 Z" fill="#fff"/>
    <ellipse cx="47" cy="8.5" rx="4.5" ry="1.8" fill="#fff"/>
    <circle cx="50" cy="1" r="1.1" fill="#1b120c"/><circle cx="53" cy="5" r="1.8" fill="#f29a9a" opacity=".7"/>
    <path d="M38 -1 Q 44 -20 62 -12 L 57 -3 Z" fill="#d32f3f"/>
    <rect x="37" y="-4" width="21" height="5" rx="2.5" fill="#fff"/><circle cx="63" cy="-12" r="3.4" fill="#fff"/>
  </g>
  <path d="M2 22 L2 44 Q 2 50 9 50 L 80 50 Q 90 50 93 38 L 96 24 Q 84 30 72 25 L 72 22 Z" fill="#c8283b" stroke="#9c1b2b" stroke-width="1.5"/>
  <path d="M6 27 L 70 27" stroke="#f2b84b" stroke-width="2"/><path d="M10 40 Q 40 46 86 38" stroke="#f2b84b" stroke-width="1.5" fill="none"/>
  <path d="M12 50 L 12 58 M 78 50 L 78 58" stroke="#c9a45c" stroke-width="2.5"/>
  <path d="M-4 56 Q 4 62 16 60 L 86 60 Q 100 60 102 48" stroke="#e0b450" stroke-width="3.5" stroke-linecap="round" fill="none"/>
</svg>`;

/** Petit élément d'animation positionné par variables CSS (posées via le CSSOM : la CSP refuse style=""). */
function fxPiece(cls, text, vars) {
  const n = el('span', { class: `gate-fx ${cls}`, 'aria-hidden': 'true' }, text);
  for (const [k, v] of Object.entries(vars)) n.style.setProperty(k, v);
  return n;
}

/** Retire l'animation (retour arrière vers cette page, ou fin de l'animation). */
function clearGateAnimation() {
  document.querySelector('.gate-veil')?.remove();
  document.querySelector('.gate-layer')?.remove();
  document.body.classList.remove('gate-focus');
}

let going = false;
/**
 * Choix d'un prénom : le reste de la page devient flou, le prénom vient au centre,
 * des étoiles dorées tournent autour, le Père Noël passe dessous avec son traîneau et il
 * neige. Environ 2 secondes, puis la page de la personne s'ouvre ; toucher l'écran passe
 * l'animation.
 */
function go(person, tile = null) {
  if (going) return;
  going = true;
  // On retient le choix sur cet appareil, et d'où l'on vient (pour pouvoir revenir à la liste).
  storage.set(rememberKey, { token: person.token, name: person.name });
  storage.set('ss_from_invite', { invite, token: person.token });
  const url = `/p/${encodeURIComponent(person.token)}`;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let left = false;
  const open = () => { if (left) return; left = true; location.href = url; };

  clearGateAnimation();
  const veil = el('div', { class: 'gate-veil', 'aria-hidden': 'true' });
  const layer = el('div', { class: 'gate-layer' });
  // Annonce pour les lecteurs d'écran (et texte visible sous le prénom).
  const caption = el('p', { class: 'gate-caption', 'aria-hidden': 'true' });
  // La zone d'annonce (vide, déjà présente) lit « C'est toi, … ! » aux lecteurs d'écran.
  const live = document.querySelector('.chosen-msg');
  if (live) live.textContent = `C’est toi, ${person.name} !`;
  layer.append(caption);
  document.body.append(veil, layer);
  veil.addEventListener('click', open);

  // Le prénom : une copie de la case touchée (ou une case dessinée pour « Continuer en tant que … »).
  const hero = el('div', { class: 'gate-hero', 'aria-hidden': 'true' },
    el('span', { class: 'avatar avatar-initial' }, initial(person.name)),
    el('span', { class: 'person-name' }, person.name));
  const r = tile?.getBoundingClientRect();
  const start = r ? { left: r.left, top: r.top, width: r.width } : { left: window.innerWidth / 2 - 110, top: window.innerHeight / 2 - 31, width: 220 };
  hero.style.left = `${start.left}px`;
  hero.style.top = `${start.top}px`;
  hero.style.minWidth = `${start.width}px`;
  layer.append(hero);
  if (tile) tile.style.visibility = 'hidden';
  const hr = hero.getBoundingClientRect();
  const scale = Math.min(1.6, (window.innerWidth * 0.86) / hr.width);
  const dx = window.innerWidth / 2 - (hr.left + hr.width / 2);
  const dy = window.innerHeight / 2 - (hr.top + hr.height / 2);
  const center = `translate(${dx}px, ${dy}px) scale(${scale})`;

  document.body.classList.add('gate-focus');
  requestAnimationFrame(() => veil.classList.add('on'));
  if (reduce) {
    hero.style.transform = center;
    caption.textContent = `C’est toi, ${person.name} ! 🎄`;
    caption.classList.add('show');
    setTimeout(open, 900);
    return;
  }
  hero.animate([{ transform: 'none' }, { transform: center }], { duration: 550, easing: 'cubic-bezier(.2,.9,.25,1.15)', fill: 'forwards' });
  hero.classList.add('shine');

  // Étoiles dorées autour du prénom
  for (let i = 0; i < 12; i += 1) {
    layer.append(fxPiece('gate-star', '✦', { '--d': `${(0.3 + i * 0.035).toFixed(3)}s`, '--s': `${0.9 + (i % 3) * 0.35}rem` }));
  }
  // Le traîneau, avec sa traînée d'étoiles
  const sleigh = el('span', { class: 'gate-fx gate-sleigh', 'aria-hidden': 'true' });
  sleigh.innerHTML = SLEIGH_SVG;
  layer.append(sleigh);
  for (let i = 0; i < 12; i += 1) {
    const t = fxPiece('gate-trail', '✦', { '--d': `${(0.45 + i * 0.1).toFixed(2)}s`, '--s': `${0.7 + (i % 3) * 0.25}rem` });
    t.style.left = `${4 + i * 8}%`;
    layer.append(t);
  }
  // Flocons sur tout l'écran
  for (let i = 0; i < 34; i += 1) {
    const f = fxPiece('gate-snow', i % 5 === 0 ? '❄️' : '❄', {
      '--d': `${((i % 8) * 0.05).toFixed(2)}s`, '--dur': `${(1.25 + (i % 5) * 0.08).toFixed(2)}s`,
      '--s': `${0.7 + (i % 4) * 0.3}rem`, '--drift': `${(i % 2 ? 1 : -1) * (10 + (i % 6) * 6)}px`,
    });
    f.style.left = `${(i * 29) % 100}%`;
    layer.append(f);
  }
  setTimeout(() => { caption.textContent = `C’est toi, ${person.name} ! 🎄`; caption.classList.add('show'); }, 550);
  setTimeout(open, 2000);
}

async function load() {
  let data;
  try {
    data = await api('GET', `/api/g/${encodeURIComponent(invite)}`);
  } catch (err) {
    clear(root, el('section', { class: 'card gate-card center' },
      el('div', { class: 'hero-icon', 'aria-hidden': 'true' }, '😕'),
      el('h1', {}, 'Lien introuvable'),
      el('p', {}, err.message),
    ));
    return;
  }
  data_ = data;
  render();
}

let data_ = null;
let showList = false; // « Je ne suis pas … » : la liste des prénoms, sur son propre écran

/**
 * Déjà venu sur cet appareil : un écran simple « Continuer en tant que … », et un lien
 * « Je ne suis pas … » vers la liste des prénoms (où se trouve aussi l'organisateur).
 * Première fois : directement la liste.
 */
function render() {
  const { group, participants } = data_;
  document.title = `Qui es-tu ? · ${group.name}`;
  going = false;
  const remembered = storage.get(rememberKey, null);
  const me = remembered && participants.find((p) => p.token === remembered.token);
  const organiserSaved = !me && storage.get(organiserKey, null)?.token;
  const returning = Boolean(me || organiserSaved);
  const list = !returning || showList;

  // Seulement la date : le budget est rappelé sur la page de chacun.
  const facts = group.eventDate ? el('p', { class: 'gate-facts' }, `📅 ${formatDate(group.eventDate)}`) : null;
  const head = (title) => [
    el('div', { class: 'gate-icon', 'aria-hidden': 'true' }, '🎅'),
    el('p', { class: 'eyebrow center' }, group.name),
    el('h1', { id: 'gate-title', class: 'center' }, title),
    facts,
  ];

  if (!list) {
    const who = me ? me.name : "l'organisateur";
    clear(root,
      el('section', { class: 'card gate-card', 'aria-labelledby': 'gate-title' },
        ...head(me ? `Bon retour, ${me.name} !` : 'Bon retour !'),
        el('button', {
          class: 'btn btn-primary btn-block continue', type: 'button',
          onclick: () => (me ? go(me, null) : openOrganiser()),
        }, `Continuer en tant que ${who}`),
        el('button', {
          class: 'btn btn-ghost btn-block not-me', type: 'button',
          onclick: () => { showList = true; history.pushState({ list: true }, '', '#choisir'); render(); window.scrollTo(0, 0); },
        }, `Je ne suis pas ${who} : choisir une autre personne`),
      ),
    );
    if (window.matchMedia?.('(pointer: fine)').matches) root.querySelector('.continue')?.focus();
    return;
  }

  const people = el('div', { class: 'people' }, participants.map((p) => el('button', {
    class: 'person', type: 'button',
    onclick: (e) => go(p, e.currentTarget),
  },
    el('span', { class: 'avatar avatar-initial', 'aria-hidden': 'true' }, initial(p.name)),
    el('span', { class: 'person-text' },
      el('span', { class: 'person-name' }, p.name),
    ),
  )));

  clear(root,
    el('section', { class: 'card gate-card', 'aria-labelledby': 'gate-title' },
      returning ? el('button', { class: 'btn btn-ghost btn-small gate-back', type: 'button', onclick: () => history.back() }, '‹ Retour') : null,
      ...head('Qui es-tu ?'),
      el('p', { class: 'center muted' }, `${onComputer() ? 'Clique' : 'Appuie'} sur ton prénom pour ouvrir ta page.`),
      people,
      el('p', { class: 'gate-or' }, 'ou'),
      el('button', { class: 'btn btn-block organiser-btn', type: 'button', onclick: openOrganiser }, "🎩 Je suis l'organisateur"),
      el('p', { class: 'gate-note' },
        'La première fois, tu choisis un code secret (4 chiffres ou plus) qui protège ta page. ',
        el('strong', {}, "Si on te demande ton code alors que tu n'en as jamais choisi, préviens l'organisateur.")),
    ),
  );
  // Zone d'annonce vide, prête avant le choix : « C'est toi, … ! » y sera écrit.
  if (!document.querySelector('.chosen-msg')) document.body.append(el('p', { class: 'chosen-msg', role: 'status', 'aria-live': 'polite' }));
  // Au clavier/souris seulement : sur téléphone, un cadre de focus ferait croire à une sélection.
  if (window.matchMedia?.('(pointer: fine)').matches) root.querySelector('.person')?.focus();
}

// Bouton « retour » du téléphone : de la liste vers « Continuer en tant que … ».
window.addEventListener('popstate', () => {
  showList = location.hash === '#choisir';
  if (data_) render();
});

// Retour arrière depuis une page personnelle : le navigateur peut réafficher l'ancienne
// page telle quelle (prénom encore sélectionné, page grisée). On la redessine proprement.
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  clearGateAnimation();
  document.querySelector('.chosen-msg')?.classList.remove('show', 'at-top');
  showList = location.hash === '#choisir';
  if (data_) render();
});

showList = location.hash === '#choisir';
load();
