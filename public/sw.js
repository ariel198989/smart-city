// Smart City patrol — service worker. Installable + resilient on 3G.
// Navigations: network-first (app updates often) with a hard timeout so a
// weak signal can't freeze the app; falls back to the cached shell.
// Hashed /_next/static assets: cache-FIRST so the offline shell actually
// renders (the JS chunks are content-hashed → safe to cache immutably).
const CACHE = 'sc-shell-v3';  // bumped: also runtime-caches static chunks
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

  // hashed, immutable static assets → cache-first (this is what makes the
  // cached shell actually boot offline; content hashes prevent staleness)
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      caches.match(e.request).then((hit) =>
        hit || fetch(e.request).then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); }
          return res;
        })
      )
    );
    return;
  }
  // never touch dev overlay / HMR / non-static _next paths — intercepting
  // them broke dynamic import() with net::ERR_FAILED
  if (url.pathname.startsWith('/_next/') || url.pathname.startsWith('/__next')) return;

  // navigations + shell: network-first with timeout, cache fallback
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
      .catch(() => caches.match(e.request).then((m) => m || caches.match('/')).then((m) => m || Response.error()))
  );
});
