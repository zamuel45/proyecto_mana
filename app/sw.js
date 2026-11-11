/* Service worker de Maná (PWA).
 * - Guarda la aplicación (HTML, JS, CSS, íconos) para abrir rápido e instalarla en el celular.
 * - NUNCA guarda la API (/api/) ni el tiempo real: pedidos, mesas e inventario siempre son en vivo. */
const CACHE = 'mana-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icons/logo.svg'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/api/') || url.pathname.includes('/socket.io/')) return;
  // Páginas: primero la red (para tener siempre la última versión); sin red, la copia guardada
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }
  // Archivos de la app: copia guardada, y si no existe se descarga y se guarda
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).then((resp) => {
      if (resp.ok && url.pathname.includes('/assets/')) {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
      }
      return resp;
    })),
  );
});
