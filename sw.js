/* sw.js — офлайн-кэш */
const CACHE = 'fithelper-v12';
const ASSETS = [
  './', './index.html', './css/style.css',
  './js/app.js', './js/store.js', './js/engine.js', './js/gemini.js', './js/ui.js', './js/recipes.js', './js/prices.js', './prices.json',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // запросы к Gemini никогда не кэшируем
  if (url.hostname.includes('googleapis.com')) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.ok && url.origin === location.origin){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
