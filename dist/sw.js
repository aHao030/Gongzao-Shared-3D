const CACHE = 'gongzao-demo-v1';
const SHELL = ['./', './index.html', './styles.css', './app.js', './icons.svg', './app-icon.svg', './manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('gongzao-demo-') && key !== CACHE).map(key => caches.delete(key))))); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/') || url.pathname.includes('auth')) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
