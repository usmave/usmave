/**
 * Service Worker – automatisch erzeugt von tools/gen-sw.mjs. Nicht von Hand ändern.
 * Alle Dateien liegen offline bereit; eine neue Version lädt im Hintergrund
 * und ist beim nächsten Öffnen da.
 */
const VERSION = '22cccdfa3d';
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
  "data/areas/adjektive2.js",
  "data/areas/amt.js",
  "data/areas/aperitivo.js",
  "data/areas/apotheke.js",
  "data/areas/arbeit.js",
  "data/areas/arzt.js",
  "data/areas/auto.js",
  "data/areas/bahn.js",
  "data/areas/bank.js",
  "data/areas/bar.js",
  "data/areas/beschreiben.js",
  "data/areas/beschweren.js",
  "data/areas/beziehungen.js",
  "data/areas/diskutieren.js",
  "data/areas/erzaehlen.js",
  "data/areas/falsche-freunde.js",
  "data/areas/familie.js",
  "data/areas/feste.js",
  "data/areas/flughafen.js",
  "data/areas/freizeit.js",
  "data/areas/freunde.js",
  "data/areas/gefuehle.js",
  "data/areas/geld.js",
  "data/areas/geschaeft.js",
  "data/areas/geschichte.js",
  "data/areas/gesellschaft.js",
  "data/areas/gespraech.js",
  "data/areas/gesten.js",
  "data/areas/haushalt.js",
  "data/areas/hotel.js",
  "data/areas/kennenlernen.js",
  "data/areas/kleidung.js",
  "data/areas/kleinwoerter.js",
  "data/areas/kochen.js",
  "data/areas/kultur.js",
  "data/areas/lebensmittel.js",
  "data/areas/markt.js",
  "data/areas/medien.js",
  "data/areas/nahverkehr.js",
  "data/areas/natur.js",
  "data/areas/nomen.js",
  "data/areas/nomen2.js",
  "data/areas/notfall.js",
  "data/areas/pizza-gelato.js",
  "data/areas/post-handy.js",
  "data/areas/restaurant.js",
  "data/areas/schule.js",
  "data/areas/service.js",
  "data/areas/sightseeing.js",
  "data/areas/smalltalk.js",
  "data/areas/speisen.js",
  "data/areas/sport.js",
  "data/areas/stadt.js",
  "data/areas/strand.js",
  "data/areas/supermarkt.js",
  "data/areas/tagesablauf.js",
  "data/areas/technik.js",
  "data/areas/telefon.js",
  "data/areas/tiere.js",
  "data/areas/umwelt.js",
  "data/areas/urlaub.js",
  "data/areas/verben.js",
  "data/areas/verben2.js",
  "data/areas/verben3.js",
  "data/areas/vorschlaege.js",
  "data/areas/weg.js",
  "data/areas/wellness.js",
  "data/areas/wetter.js",
  "data/areas/wohnen.js",
  "data/areas/zahlen.js",
  "data/areas/zeit.js",
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
