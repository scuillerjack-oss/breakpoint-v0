// V2 : la version précédente servait TOUT depuis le cache en priorité (le
// réseau ne mettait à jour le cache que pour la PROCHAINE visite -- jamais
// la visite en cours). Pour une app en display:standalone (ajoutée à l'écran
// d'accueil, sans geste "tirer pour rafraîchir" évident), un appareil ayant
// déjà visité une fois pouvait donc continuer à voir une ancienne version du
// jeu indéfiniment après chaque nouveau déploiement -- diagnostiqué comme
// cause plausible majeure des écarts constatés en bêta réelle V1 (raquette
// toujours basse, contrôle tactile encore absolu) alors que le dépôt/déploiement
// eux-mêmes étaient à jour. Voir le rapport technique V2 pour le diagnostic complet.
//
// Nouvelle stratégie :
// - fichiers HACHÉS par le contenu (dist/assets/*-[hash].js|css, générés par
//   Vite) : un nouveau build produit TOUJOURS un nouveau nom de fichier, donc
//   jamais périmé par construction -- cache-first est sûr et rapide.
// - tout le reste (navigation, index.html, manifest, icônes) : réseau
//   D'ABORD, le cache ne sert que de secours hors-ligne. Jamais de version
//   périmée servie silencieusement pendant qu'une mise à jour existe.
const CACHE_NAME = "breakpoint-cache-v2"; // changé à chaque version -- force le nettoyage de tout ancien cache par activate()

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isImmutableHashedAsset(url) {
  // Dossier de sortie par défaut de Vite pour les fichiers hachés par le
  // contenu -- voir vite.config.js (aucune configuration outDir/assets
  // personnalisée qui changerait ce chemin).
  return url.pathname.includes("/assets/");
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (isImmutableHashedAsset(url)) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
      )
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
