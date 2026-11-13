// Offline cache: the whole game is a handful of static files.
const CACHE = 'flappybird-v9';
const FILES = [
  './', 'index.html', 'style.css', 'game.js', 'pixelfont.js', 'ui.js', 'main.js', 'manifest.webmanifest',
  'assets/atlas.png', 'assets/atlas.txt',
  'audio/wing.wav', 'audio/point.wav', 'audio/hit.wav', 'audio/die.wav', 'audio/swooshing.wav',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// Stale-while-revalidate: launch instantly from the cache, refresh it in the background
// (an update shows up on the next launch). Falls back to the network when nothing is cached.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(e.request);
    const refresh = fetch(e.request).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => cached);
    return cached || refresh;
  }));
});
