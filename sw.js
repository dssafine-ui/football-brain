// Service Worker: hält die App auch ohne Netz bereit.
// Erst das Netz fragen (damit neue Fragen und App-Updates sofort ankommen), bei Funkloch den gespeicherten Stand zeigen.
const CACHE = 'football-brain-v3';
const DATEIEN = ['./', 'index.html', 'style.css', 'app.js', 'fragen.json', 'manifest.json', 'icon.svg'];
// So lange wartet die App aufs Netz, wenn sie eine gespeicherte Kopie hat. Ohne Kopie gibt es nichts anderes zu zeigen, dann gilt kein Limit.
const NETZ_LIMIT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(DATEIEN)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

// limit 0 heißt: ohne eigenes Zeitlimit warten (der Browser bricht bei einem Netzfehler selbst ab).
function vomNetz(url, limit) {
  return new Promise((resolve, reject) => {
    const timer = limit > 0 ? setTimeout(() => reject(new Error('Zeitlimit')), limit) : 0;
    fetch(url, { cache: 'no-cache' }).then(
      (antwort) => {
        clearTimeout(timer);
        resolve(antwort);
      },
      (fehler) => {
        clearTimeout(timer);
        reject(fehler);
      }
    );
  });
}

self.addEventListener('fetch', (event) => {
  const anfrage = event.request;
  if (anfrage.method !== 'GET') return;
  if (new URL(anfrage.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(anfrage, { ignoreSearch: true }).then((kopie) =>
      vomNetz(anfrage.url, kopie ? NETZ_LIMIT_MS : 0)
        .then((antwort) => {
          if (antwort.ok) {
            const abzug = antwort.clone();
            caches.open(CACHE).then((cache) => cache.put(anfrage, abzug));
          }
          return antwort;
        })
        .catch(() => kopie || caches.match('./'))
    )
  );
});
