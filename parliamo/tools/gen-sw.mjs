/**
 * Schreibt sw.js neu: Liste aller Dateien für den Offline-Betrieb und eine
 * Version aus dem Inhalt. Nach jeder Änderung an Inhalten oder Code ausführen:
 *
 *   node tools/gen-sw.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const INCLUDE = ['index.html', 'manifest.webmanifest', 'css', 'js', 'data', 'fonts', 'icons'];
const SKIP = /(^|\/)\.|\.md$|OFL\.txt$/;

function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [rel];
  return fs
    .readdirSync(abs)
    .sort()
    .flatMap((f) => walk(path.posix.join(rel, f)));
}

const files = INCLUDE.flatMap(walk).filter((f) => !SKIP.test(f));
const hash = crypto.createHash('sha256');
for (const f of files) hash.update(f).update(fs.readFileSync(path.join(ROOT, f)));
const version = hash.digest('hex').slice(0, 10);

const sw = `/**
 * Service Worker – automatisch erzeugt von tools/gen-sw.mjs. Nicht von Hand ändern.
 * Alle Dateien liegen offline bereit; eine neue Version lädt im Hintergrund
 * und ist beim nächsten Öffnen da.
 */
const VERSION = '${version}';
const CACHE = 'parliamo-' + VERSION;
const ASSETS = ${JSON.stringify(['./', ...files], null, 2)};

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
`;

fs.writeFileSync(path.join(ROOT, 'sw.js'), sw);
console.log(`sw.js: Version ${version}, ${files.length} Dateien`);
