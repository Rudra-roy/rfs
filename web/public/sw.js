// Minimal service worker: makes the site installable and shows an offline page
// when the network is gone. It never caches API responses or files; those are
// behind auth and must always come fresh from the hub.
const SHELL = 'rfs-shell-v1'
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.add(new Request('/offline.html', { credentials: 'include' }))).then(() => self.skipWaiting()))
})
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return // everything else goes straight to the network
  e.respondWith(fetch(e.request).catch(() => caches.match('/offline.html')))
})
