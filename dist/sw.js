const CACHE = 'gongzao-platform-v9';
const ASSETS = ['/index.html', '/styles.css', '/app.js', '/api-client.js', '/merchant-ui.js', '/auth-ui.js', '/international-ui.js', '/workflow-ui.js', '/operations-ui.js', '/icons.svg', '/app-icon.svg', '/manifest.webmanifest'];
const ENTRIES = new Set(['/', '/index.html', '/merchant', '/merchant/', '/merchant/login', '/merchant/login/', '/login', '/login/', '/account/login', '/account/login/']);
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => /^(gongzao-demo-|gongzao-platform-)/.test(key) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || (!ENTRIES.has(url.pathname) && !ASSETS.includes(url.pathname))) return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(ENTRIES.has(url.pathname) ? '/index.html' : url.pathname)) || Response.error()));
});
