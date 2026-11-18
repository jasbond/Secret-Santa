// Service worker du Secret Santa : affiche les notifications et ouvre la bonne page.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Secret Santa', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(self.registration.showNotification(data.title || 'Secret Santa', {
    body: data.body || '',
    icon: '/static/icon-192.png',
    badge: '/static/icon-192.png',
    tag: data.tag || 'pere-noel-secret',
    renotify: true,
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const path = new URL(url).pathname;
    // Une page de la même personne est déjà ouverte : on la réutilise.
    const existing = windows.find((w) => new URL(w.url).pathname === path);
    if (existing) {
      await existing.focus();
      return existing.navigate ? existing.navigate(url) : undefined;
    }
    return self.clients.openWindow(url);
  })());
});
