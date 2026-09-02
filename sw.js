// Service worker : rend l'appli installable et utilisable hors-ligne.
// Stratégie "réseau d'abord, repli sur le cache" : toujours la dernière
// version quand il y a du réseau, mais l'appli reste fonctionnelle sans
// connexion (le générateur de passphrase se rabat déjà sur de l'aléa pur
// si l'API du prix BTC est injoignable).

const CACHE_NAME = "personal-encoder-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./js/app.js",
  "./js/audio-decode.js",
  "./js/crypto.js",
  "./js/ecc.js",
  "./js/filemode.js",
  "./js/keyderive.js",
  "./js/modem.js",
  "./js/passgen.js",
  "./js/wav.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith(self.location.origin)) return; // laisse passer les appels externes (prix BTC)

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
