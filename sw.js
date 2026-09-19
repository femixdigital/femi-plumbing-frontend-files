/* FEMIX Plumbing Services — Service Worker (v2)
   Strategy:
   - Pages, CSS, JS ("shell"): NETWORK-FIRST with a 3 s timeout, then cache.
     Visitors always get the newest deploy (no more "I pushed but nothing
     changed"), and the site still opens offline / on very slow networks.
   - Images: stale-while-revalidate (instant from cache, refreshed quietly),
     capped so the cache can't grow forever.
   - Any other same-origin GET: network-first, cache fallback.
   To force every visitor onto a clean cache after a big change, bump
   CACHE_VERSION below. */

const CACHE_VERSION = 'femix-v2';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const NETWORK_TIMEOUT_MS = 3000;
const MAX_IMAGE_ENTRIES = 80;

const SHELL_ASSETS = [
  './',
  './index.html',
  './style-dev.css',
  './script.js',
  './manifest.json',
  './images/branding/femix-plumbing-logo.webp',
  './images/branding/femix-logo.webp'
];
const SHELL_PATHS = new Set(SHELL_ASSETS.map((a) => new URL(a, self.location).pathname));

// Install: pre-cache the shell. One missing file must not block the whole install.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => Promise.allSettled(
        SHELL_ASSETS.map((a) => cache.add(new Request(a, { cache: 'reload' })))
      ))
      .then(() => self.skipWaiting())
  );
});

// Activate: remove caches from older versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('femix-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (r) => { clearTimeout(t); resolve(r); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

async function networkFirst(event, cacheName, isNavigation) {
  const request = event.request;
  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    if (response && response.status === 200) {
      const clone = response.clone();
      event.waitUntil(caches.open(cacheName).then((c) => c.put(request, clone)));
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (isNavigation) {
      const page = (await caches.match('./index.html')) || (await caches.match('./'));
      if (page) return page;
    }
    return Response.error();
  }
}

async function staleWhileRevalidate(event) {
  const request = event.request;
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(async (response) => {
    if (response && response.status === 200) {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      if (keys.length > MAX_IMAGE_ENTRIES) await cache.delete(keys[0]);
    }
    return response;
  }).catch(() => cached);
  if (cached) { event.waitUntil(refresh); return cached; }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.headers.has('range')) return;              // let the browser stream video/audio itself

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;       // never touch third-party (GA, fonts, API on Render)

  const isNavigation = request.mode === 'navigate';
  if (isNavigation || SHELL_PATHS.has(url.pathname)) {
    event.respondWith(networkFirst(event, SHELL_CACHE, isNavigation));
    return;
  }
  if (request.destination === 'image') {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }
  event.respondWith(networkFirst(event, RUNTIME_CACHE, false));
});
