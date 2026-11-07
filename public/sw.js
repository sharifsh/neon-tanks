/* Neon Tanks service worker: lets the installed app (the Windows app from the Microsoft Store, or a home-screen app)
   start and play offline. Network first, so a new version shows up as soon as the device is online; the cache is the
   fallback. Online rooms and community maps talk to Supabase directly and are never cached. Registered only on the
   live https site, never in the phone apps. */
const CACHE = 'neon-tanks-v1';
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'style.css', 'fonts.css',
  'main.js', 'audio.js', 'config.js', 'const.js', 'editor.js', 'fakenet.js', 'game.js', 'input.js', 'levels.js',
  'maps.js', 'net.js', 'render.js', 'store.js', 'support-api.js', 'themes.js', 'vendor/supabase.js',
  'fonts/black-ops-one-latin-400-normal.woff2', 'fonts/orbitron-latin-600-normal.woff2', 'fonts/orbitron-latin-800-normal.woff2',
  'fonts/orbitron-latin-900-normal.woff2', 'fonts/press-start-2p-latin-400-normal.woff2', 'fonts/rajdhani-latin-500-normal.woff2',
  'fonts/rajdhani-latin-600-normal.woff2', 'fonts/rajdhani-latin-700-normal.woff2', 'fonts/russo-one-latin-400-normal.woff2',
  'fonts/share-tech-mono-latin-400-normal.woff2',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // One missing file shouldn't stop the rest from being saved.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (err) => { clearTimeout(t); reject(err); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetchWithTimeout(req, 5000);
      if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const hit = (await cache.match(req, { ignoreSearch: true })) ||
        (req.mode === 'navigate' ? (await cache.match('index.html')) || (await cache.match('./')) : undefined);
      if (hit) return hit;
      throw err;
    }
  })());
});
