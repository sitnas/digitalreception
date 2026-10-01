// Service worker of the "My badge" page: shows "your guest has arrived" notices sent with Web Push.
// No caching: the page always loads from the network like the rest of the app.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* not JSON: show a generic notice */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Reception', {
    body: data.body || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: 'arrival', renotify: true, data: { url: data.url || '/badge' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/badge', self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = open.find((c) => c.url.startsWith(`${self.location.origin}/badge`));
    if (tab) return tab.focus();
    return self.clients.openWindow(url);
  })());
});
