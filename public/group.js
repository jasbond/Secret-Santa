import { api, el, clear, tokenFromPath, formatDate, storage, onComputer, icon } from './common.js';

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
  const cancel = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Annuler');
  const form = el('form', { class: 'ask-form', novalidate: true },
    el('span', { class: 'ask-grabber', 'aria-hidden': 'true' }),
    el('h2', { class: 'ask-title' }, icon('key-round'), "Je suis l'organisateur"),
    el('label', { class: 'field', for: 'organiser-code' }, el('span', {}, 'Code organisateur'), code),
    el('p', { class: 'muted small', id: 'organiser-help' }, "Entre le code choisi à la création du groupe. Après 5 essais ratés, l'accès est bloqué un moment."),
    error,
    el('div', { class: 'ask-actions' }, submit, cancel));
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

let going = false;
function go(person, tile = null) {
  if (going) return;
  going = true;
  // On retient le choix sur cet appareil, et d'où l'on vient (pour pouvoir revenir à la liste).
  storage.set(rememberKey, { token: person.token, name: person.name });
  storage.set('ss_from_invite', { invite, token: person.token });
  const url = `/p/${encodeURIComponent(person.token)}`;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const card = root.querySelector('.gate-card');
  if (!card) { location.href = url; return; }
  // Petite animation qui confirme le prénom choisi, avant d'ouvrir sa page.
  card.classList.add('choosing');
  if (tile) {
    // La case choisie se soulève, un reflet doré la traverse et quelques paillettes montent.
    tile.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    // Assez haut pour ne pas passer sous la confirmation, en bas de l'écran.
    const r = tile.getBoundingClientRect();
    const room = window.innerHeight - 96;
    if (r.bottom > room) window.scrollBy(0, r.bottom - room);
    tile.classList.add('chosen');
    tile.setAttribute('aria-current', 'true');
    tile.append(el('span', { class: 'chosen-sheen', 'aria-hidden': 'true' }));
    if (!reduce) {
      const colors = ['#C9A45C', '#E6C987', '#FBF7EF'];
      for (let i = 0; i < 12; i += 1) {
        const speck = el('span', { class: 'chosen-speck', 'aria-hidden': 'true' });
        speck.style.setProperty('--x', `${8 + ((i * 83) % 84)}%`);
        speck.style.setProperty('--c', colors[i % colors.length]);
        speck.style.setProperty('--delay', `${(i % 6) * 0.05}s`);
        speck.style.setProperty('--drift', `${(i % 2 ? 1 : -1) * (4 + (i % 4) * 3)}px`);
        tile.append(speck);
      }
    }
  }
  // La confirmation est posée en bas de l'écran ; la zone d'annonce existe déjà, vide,
  // pour que les lecteurs d'écran la lisent.
  let msg = document.querySelector('.chosen-msg');
  if (!msg) {
    msg = el('p', { class: 'chosen-msg', role: 'status', 'aria-live': 'polite' });
    document.body.append(msg);
  }
  clear(msg, icon('check-circle', { size: 20, className: 'chosen-msg-icon' }), el('span', {}, `C’est toi, ${person.name} !`));
  msg.classList.add('show');
  setTimeout(() => { location.href = url; }, reduce ? 800 : 1200);
}

async function load() {
  let data;
  try {
    data = await api('GET', `/api/g/${encodeURIComponent(invite)}`);
  } catch (err) {
    clear(root, el('section', { class: 'card gate-card center' },
      el('h1', {}, 'Lien introuvable'),
      el('p', {}, err.message),
    ));
    return;
  }
  const { group, participants } = data;
  document.title = `Qui es-tu ? · ${group.name}`;
  const remembered = storage.get(rememberKey, null);
  const me = remembered && participants.find((p) => p.token === remembered.token);

  // Seulement la date : le budget est rappelé sur la page de chacun.
  const people = el('div', { class: 'people', id: 'gate-people' }, participants.map((p, i) => el('button', {
    class: `person${me && me.token === p.token ? ' current' : ''}`, type: 'button',
    onclick: (e) => go(p, e.currentTarget),
  },
    // Couleur selon la place dans la liste (jamais selon la personne) : elle ne révèle rien.
    el('span', { class: `avatar avatar-initial avatar-tone-${i % 4}`, 'aria-hidden': 'true' }, initial(p.name)),
    el('span', { class: 'person-text' },
      el('span', { class: 'person-name' }, p.name),
    ),
  )));

  clear(root,
    el('section', { class: 'card gate-card', 'aria-labelledby': 'gate-title' },
      el('div', { class: 'gate-hero' },
        el('div', { class: 'gate-art', 'aria-hidden': 'true' }, icon('gift-art', { size: 72 })),
        el('p', { class: 'eyebrow' }, group.name),
        el('h1', { id: 'gate-title' }, 'Qui es-tu ?'),
        group.eventDate ? el('p', { class: 'gate-facts' }, icon('calendar', { size: 16 }), el('span', {}, formatDate(group.eventDate))) : null),
      me ? el('button', { class: 'btn btn-primary btn-block continue', type: 'button', onclick: () => go(me, root.querySelector('.person.current')) },
        `Continuer en tant que ${me.name}`) : null,
      me ? el('p', { class: 'divider' }, el('span', {}, 'ou choisis un autre prénom')) : el('p', { class: 'gate-hint' }, `${onComputer() ? 'Clique' : 'Appuie'} sur ton prénom pour ouvrir ta page.`),
      people,
      el('p', { class: 'divider' }, el('span', {}, 'ou')),
      el('button', { class: 'btn btn-block organiser-btn', type: 'button', onclick: openOrganiser }, icon('key-round', { size: 18 }), "Je suis l'organisateur"),
      el('p', { class: 'gate-note' },
        'La première fois, tu choisis un code secret (4 chiffres ou plus) qui protège ta page. ',
        el('strong', {}, "Si on te demande ton code alors que tu n'en as jamais choisi, préviens l'organisateur.")),
    ),
  );
  // Zone d'annonce vide, prête avant le choix : « C'est toi, … ! » y sera écrit.
  if (!document.querySelector('.chosen-msg')) document.body.append(el('p', { class: 'chosen-msg', role: 'status', 'aria-live': 'polite' }));
}

load();
