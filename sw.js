// Service Worker: hält die App auch ohne Netz bereit.
// Erst das Netz fragen (damit neue Fragen und App-Updates sofort ankommen), bei Funkloch den gespeicherten Stand zeigen.
const CACHE = 'football-brain-v2';
const DATEIEN = ['./', 'index.html', 'style.css', 'app.js', 'fragen.json', 'manifest.json', 'icon.svg'];
const NETZ_LIMIT_MS = 5000;

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

function vomNetz(url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Zeitlimit')), NETZ_LIMIT_MS);
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
    vomNetz(anfrage.url)
      .then((antwort) => {
        if (antwort.ok) {
          const kopie = antwort.clone();
          caches.open(CACHE).then((cache) => cache.put(anfrage, kopie));
        }
        return antwort;
      })
      .catch(() =>
        caches.match(anfrage, { ignoreSearch: true }).then((treffer) => treffer || caches.match('./'))
      )
  );
});
