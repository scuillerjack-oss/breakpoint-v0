// BREAKPOINT V5 — logique économique (cahier des charges V5, sections 3.1 à
// 3.3). Fonctions PURES et testables uniquement : ce module ne charge, ne
// référence et n'appelle AUCUN SDK publicitaire ou de paiement, et n'affiche
// jamais rien à l'écran. Il prépare l'état, les paramètres et les points de
// décision nécessaires au futur portage Android/Capacitor (AdMob, Google
// Play Billing) sans introduire de fausse publicité ni de faux achat dans
// cette PWA (cahier des charges V5, section 8) -- le câblage réel à un SDK
// et à un écran d'annonce reste un travail du futur chantier AAB, listé
// explicitement dans le rapport officiel V5.

export const LEVELS_PER_INTERSTITIAL = 3;
export const MIN_INTERSTITIAL_COOLDOWN_MS = 5 * 60 * 1000;

export function createMonetizationState() {
  return {
    premium: false,
    hasLaunchedAppBefore: false,
    levelsWonSinceLastInterstitial: 0,
    lastInterstitialAt: null,
  };
}

// À appeler une fois par vrai lancement de l'app (pas par niveau). Renvoie
// true si CETTE session est la toute première découverte de l'app (donc
// aucun interstitiel ne doit y apparaître), et marque la prochaine comme
// n'étant plus la première.
export function beginSession(monetization) {
  const isFirstSessionEver = !monetization.hasLaunchedAppBefore;
  monetization.hasLaunchedAppBefore = true;
  return isFirstSessionEver;
}

export function recordLevelWon(monetization) {
  monetization.levelsWonSinceLastInterstitial += 1;
}

export function recordInterstitialShown(monetization, now) {
  monetization.levelsWonSinceLastInterstitial = 0;
  monetization.lastInterstitialAt = now;
}

// Décision d'affichage interstitiel : les DEUX conditions doivent être
// vraies (cahier des charges V5, section 3.1 — "le compteur de niveaux ne
// permet jamais de contourner le délai"). Jamais pendant la session de
// découverte, jamais pour un joueur Premium.
export function canShowInterstitial(monetization, now, isFirstSessionEver) {
  if (monetization.premium) return false;
  if (isFirstSessionEver) return false;
  if (monetization.levelsWonSinceLastInterstitial < LEVELS_PER_INTERSTITIAL) return false;
  if (monetization.lastInterstitialAt != null && now - monetization.lastInterstitialAt < MIN_INTERSTITIAL_COOLDOWN_MS) {
    return false;
  }
  return true;
}

// Rewarded "continuer" : déclenché uniquement par un ÉPUISEMENT RÉEL des
// vies (status "lost"), jamais par un échec de niveau individuel, jamais
// automatiquement. Reste proposé même à un joueur Premium (le cahier des
// charges V5 interdit de l'IMPOSER, pas de le proposer -- section 3.3) :
// Premium n'intervient donc PAS dans cette éligibilité.
export function canOfferRewardedContinue(gameStatus) {
  return gameStatus === "lost";
}

export function setPremium(monetization, value) {
  monetization.premium = value;
}
