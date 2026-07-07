// Smart City patrol — minimal service worker: makes the app installable
// and keeps the shell reachable. Network-first (app updates often), but
// with a hard timeout so a weak-signal fetch can't freeze the app.
const CACHE = 'sc-shell-v2';  // bumped: forces old worker to update + purge
const SHELL = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png'];
const NET_TIMEOUT_MS = 8000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // NEVER touch framework assets: /_next/ chunks (incl. dynamic imports
  // like jszip), the dev overlay, and HMR. Intercepting them broke
  // dynamic import() with net::ERR_FAILED. Let the browser handle them.
  if (url.pathname.startsWith('/_next/') || url.pathname.startsWith('/__next')) return;
  // network-first with timeout, cache fallback (offline shell / slow 3G)
  e.respondWith(
    Promise.race([
      fetch(e.request),
      new Promise((_, rej) => setTimeout(() => rej(new Error('net-timeout')), NET_TIMEOUT_MS)),
    ])
      .then((res) => {
        if (res.ok && (url.pathname === '/' || SHELL.includes(url.pathname))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((m) => m || Response.error()))
  );
});
