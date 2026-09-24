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
const CACHE_NAME = "breakpoint-cache-v3"; // changé à chaque version -- force le nettoyage de tout ancien cache par activate()

// V3 : audit complémentaire (cahier des charges V3, section 7). La stratégie
// réseau-d'abord de V2 reste correcte et n'est PAS modifiée ici -- elle
// empêche déjà par construction qu'une réponse périmée soit servie tant que
// le réseau répond. Les deux angles morts restants, réellement corrigés
// ci-dessous :
// 1. Un onglet PWA laissé ouvert longtemps (cas réaliste : app ajoutée à
//    l'écran d'accueil, jamais vraiment "fermée") ne revérifie jamais le SW
//    tout seul -- le navigateur ne vérifie une mise à jour qu'au moment
//    d'une navigation, avec en plus un débounce interne (~24h) documenté au
//    rapport V2. Voir le listener "visibilitychange" dans main.js, qui
//    appelle désormais registration.update() à chaque retour au premier
//    plan -- ça ne supprime pas la limite du navigateur, mais ça maximise
//    les occasions réelles de vérification (chaque retour d'arrière-plan,
//    pas juste un rechargement complet).
// 2. Même quand une mise à jour EST détectée et prend le contrôle
//    (activate ci-dessous, skipWaiting+clients.claim), un onglet déjà
//    ouvert continue d'exécuter en mémoire le JS de l'ANCIEN build tant
//    qu'il n'est pas rechargé -- clients.claim() ne recharge rien tout
//    seul. Voir le listener "controllerchange" dans main.js : il force
//    exactement UN rechargement automatique dès qu'un nouveau SW prend le
//    contrôle, pour que l'app affichée corresponde toujours au SW actif.
//
// Limite de stockage : cap du nombre d'entrées de fichiers hachés
// immuables mis en cache (voir trimHashedAssetCache) pour ne pas accumuler
// indéfiniment d'anciennes versions d'assets d'un build à l'autre.
const MAX_HASHED_CACHE_ENTRIES = 30;

async function trimHashedAssetCache() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  const hashedKeys = keys.filter((req) => isImmutableHashedAsset(new URL(req.url)));
  const excess = hashedKeys.length - MAX_HASHED_CACHE_ENTRIES;
  if (excess > 0) {
    // Cache.keys() renvoie l'ordre d'insertion dans les implémentations
    // courantes (non garanti par la spec, mais suffisant pour une simple
    // purge de confort -- jamais utilisé pour une garantie de fraîcheur,
    // qui repose entièrement sur la stratégie réseau-d'abord ci-dessus).
    await Promise.all(hashedKeys.slice(0, excess).map((req) => cache.delete(req)));
  }
}

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
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone).then(trimHashedAssetCache));
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
