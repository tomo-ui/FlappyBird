// Offline cache: the whole game is a handful of static files.
const CACHE = 'flappybird-v1';
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

// Network first (so updates arrive), cache as the offline fallback.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request)));
});
