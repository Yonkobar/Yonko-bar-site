// Only the public offline page and icons are cached. Never cache private data.
const CACHE = 'yonko-public-v1';
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png']);
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('yonko-public-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && event.request.mode === 'navigate' && ['/dashboard', '/dashboard.html'].includes(url.pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
  }
});
self.addEventListener('push', event => event.waitUntil((async () => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Show a generic notification. */ }
  const tag = typeof data.tag === 'string' ? data.tag.slice(0, 150) : 'yonko-update';
  await self.registration.showNotification(String(data.title || 'Yonko Bar').slice(0, 120), {
    body: String(data.body || 'Une mise à jour est disponible dans votre tableau de bord.').slice(0, 350),
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag, renotify: false,
    data: {url: '/dashboard'},
  });
  for (const client of await self.clients.matchAll({type: 'window', includeUncontrolled: true})) {
    const url = new URL(client.url);
    if (url.origin === self.location.origin && ['/dashboard', '/dashboard.html'].includes(url.pathname)) client.postMessage({type: 'yonko-reservations-changed'});
  }
})()));
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    for (const client of await self.clients.matchAll({type: 'window', includeUncontrolled: true})) {
      const url = new URL(client.url);
      if (url.origin === self.location.origin && ['/dashboard', '/dashboard.html'].includes(url.pathname)) { await client.focus(); return; }
    }
    await self.clients.openWindow('/dashboard');
  })());
});
