import { api, el, clear, toast, withButton, storage } from './common.js';

const form = document.getElementById('create-form');

function renderMyGroups() {
  const groups = storage.get('ss_admin_groups', []);
  const section = document.getElementById('my-groups');
  const list = document.getElementById('my-groups-list');
  if (!Array.isArray(groups) || groups.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  clear(list, groups.map((g) => el('li', {},
    el('a', { href: `/admin/${encodeURIComponent(g.token)}` }, g.name),
    g.createdAt ? el('span', { class: 'muted small' }, ` · créé le ${new Date(g.createdAt).toLocaleDateString('fr-FR')}`) : null,
  )));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  if (!name) {
    toast('Donne un nom au groupe.', 'error');
    form.elements.name.focus();
    return;
  }
  const participants = String(data.get('participants') || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const button = form.querySelector('button[type=submit]');
  const result = await withButton(button, () =>
    api('POST', '/api/groups', {
      name,
      budget: String(data.get('budget') || ''),
      eventDate: String(data.get('eventDate') || ''),
      description: String(data.get('description') || ''),
      participants,
      adminCode: String(data.get('adminCode') || '').replace(/\D/g, '') || undefined,
      // Fuseau de l'organisateur (ex. Pacific/Tahiti) : pour la révélation automatique.
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  );
  if (!result) return;
  const groups = storage.get('ss_admin_groups', []);
  const list = Array.isArray(groups) ? groups : [];
  list.unshift({ token: result.adminToken, name, createdAt: Date.now() });
  storage.set('ss_admin_groups', list.slice(0, 20));
  location.href = `/admin/${encodeURIComponent(result.adminToken)}?new=1`;
});

renderMyGroups();
