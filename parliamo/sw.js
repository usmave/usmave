/**
 * Service Worker – automatisch erzeugt von tools/gen-sw.mjs. Nicht von Hand ändern.
 * Alle Dateien liegen offline bereit; eine neue Version lädt im Hintergrund
 * und ist beim nächsten Öffnen da.
 */
const VERSION = 'bc388c6105';
const CACHE = 'parliamo-' + VERSION;
const ASSETS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/styles.css",
  "js/app.js",
  "js/content.js",
  "js/ex/drill.js",
  "js/ex/listen.js",
  "js/ex/placement.js",
  "js/ex/quiz.js",
  "js/ex/speak.js",
  "js/ex/vocab.js",
  "js/flow.js",
  "js/session.js",
  "js/speech.js",
  "js/srs.js",
  "js/store.js",
  "js/text.js",
  "js/today.js",
  "js/ui.js",
  "js/views.js",
  "data/areas/adjektive.js",
  "data/areas/amt.js",
  "data/areas/aperitivo.js",
  "data/areas/apotheke.js",
  "data/areas/arbeit.js",
  "data/areas/arzt.js",
  "data/areas/auto.js",
  "data/areas/bahn.js",
  "data/areas/bank.js",
  "data/areas/bar.js",
  "data/areas/beschweren.js",
  "data/areas/familie.js",
  "data/areas/feste.js",
  "data/areas/flughafen.js",
  "data/areas/freizeit.js",
  "data/areas/freunde.js",
  "data/areas/gefuehle.js",
  "data/areas/geschaeft.js",
  "data/areas/gesten.js",
  "data/areas/hotel.js",
  "data/areas/kennenlernen.js",
  "data/areas/kleinwoerter.js",
  "data/areas/kochen.js",
  "data/areas/markt.js",
  "data/areas/nahverkehr.js",
  "data/areas/natur.js",
  "data/areas/notfall.js",
  "data/areas/pizza-gelato.js",
  "data/areas/post-handy.js",
  "data/areas/restaurant.js",
  "data/areas/service.js",
  "data/areas/sightseeing.js",
  "data/areas/smalltalk.js",
  "data/areas/speisen.js",
  "data/areas/strand.js",
  "data/areas/supermarkt.js",
  "data/areas/tagesablauf.js",
  "data/areas/telefon.js",
  "data/areas/verben.js",
  "data/areas/weg.js",
  "data/areas/wetter.js",
  "data/areas/wohnen.js",
  "data/areas/zahlen.js",
  "data/index.js",
  "data/placement.js",
  "data/pron.js",
  "fonts/bodoni-moda-italic.woff2",
  "fonts/bodoni-moda.woff2",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('parliamo-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (e) {
        if (req.mode === 'navigate') {
          const shell = await cache.match('./');
          if (shell) return shell;
        }
        throw e;
      }
    }),
  );
});
