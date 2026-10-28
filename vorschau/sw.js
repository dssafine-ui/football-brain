// Service Worker: hält die App auch ohne Netz bereit.
// Erst das Netz fragen (damit neue Fragen und App-Updates sofort ankommen), bei Funkloch den gespeicherten Stand zeigen.
//
// Dieselbe Datei läuft in der echten App und in der Vorschau (Unterordner /vorschau/ derselben Domain). Zwischenspeicher gelten je Domain.
// Darum hat die Vorschau eigene Namen, und jede Seite räumt nur ihre eigenen alten Zwischenspeicher weg.
const IN_VORSCHAU = self.location.pathname.indexOf('/vorschau/') !== -1;
const CACHE = (IN_VORSCHAU ? 'football-brain-vorschau-v' : 'football-brain-v') + '5';
// Ohne diese Dateien startet die App nicht: Fehlt eine, wird der neue Service Worker nicht installiert.
const DATEIEN = ['./', 'index.html', 'style.css', 'design-neu.css', 'app.js', 'manifest.json', 'icon.svg'];
// Die Fragenliste holt die App bei jedem Start ohnehin frisch. Hier ist sie nur ein Bonus für den ersten Start ohne Netz;
// die Vorschau hat vielleicht keine eigene (sie nimmt dann die der echten App), das darf die Installation nicht verhindern.
const OPTIONAL = ['fragen.json'];
// So lange wartet die App aufs Netz, wenn sie eine gespeicherte Kopie hat. Ohne Kopie gibt es nichts anderes zu zeigen, dann gilt kein Limit.
const NETZ_LIMIT_MS = 3000;

// Gehört ein Zwischenspeicher zu dieser Installation? Die Vorschau löscht nie die der echten App, die echte App nie die der Vorschau.
function gehoertDazu(name) {
  if (IN_VORSCHAU) return name.indexOf('football-brain-vorschau-v') === 0;
  return name.indexOf('football-brain-v') === 0 && name.indexOf('football-brain-vorschau-v') !== 0;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(DATEIEN).then(() => Promise.all(OPTIONAL.map((datei) => cache.add(datei).catch(() => {})))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((name) => name !== CACHE && gehoertDazu(name)).map((name) => caches.delete(name))))
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
  const adresse = new URL(anfrage.url);
  if (adresse.origin !== self.location.origin) return;
  // Die echte App lässt die Vorschau in Ruhe: Deren Dateien kommen direkt aus dem Netz und nicht in ihren Zwischenspeicher.
  if (!IN_VORSCHAU && adresse.pathname.indexOf('/vorschau/') !== -1) return;

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
