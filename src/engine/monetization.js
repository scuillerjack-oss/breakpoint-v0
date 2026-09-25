// BREAKPOINT V5/V6 — logique économique (cahier des charges V5, sections
// 3.1-3.3 ; cahier des charges V6, "vies/rewarded"/"interstitiels"/
// "Premium"). Fonctions PURES et testables : ce module ne charge, ne
// référence et n'appelle AUCUN SDK publicitaire ou de paiement. La règle
// interstitiel (3 niveaux réussis ET 5 minutes minimum) reste NON câblée à
// une UI réelle, inchangée depuis V5 -- seule la continuation rewarded est
// devenue un mécanisme réellement joué en V6 (voir src/main.js), avec un
// bouton honnêtement étiqueté plutôt qu'une fausse publicité simulée (voir
// rapport officiel V6, section monétisation, pour la justification de ce
// choix). Le câblage réel à un SDK publicitaire/de paiement reste un
// travail du futur chantier Capacitor/AAB.

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

// V6 : passage à UNE vie gratuite par tentative (cahier des charges V6,
// section "vies/rewarded") -- remplace les 3 vies conservées entre niveaux
// de V0-V5 (voir src/engine/state.js, createLevelState). Une continuation
// rewarded ajoute une vie (voir state.grantContinuation) SANS jamais
// dépasser un plafond par tentative -- "aucune boucle de rewarded
// illimitée" (cahier des charges V6). Le palier ci-dessous (à partir de
// quel niveau une 2e continuation est autorisée) est déterminé par
// simulation, jamais supposé -- voir docs/difficulty-study/ et le rapport
// officiel V6 pour la justification précise (le cahier demande
// explicitement de ne PAS fixer arbitrairement le niveau 51).
export const MAX_CONTINUATIONS_BASE = 1;
export const MAX_CONTINUATIONS_LATE = 2;
export const SECOND_CONTINUATION_UNLOCK_LEVEL_ID = 61;

export function maxContinuationsForLevel(levelId) {
  return levelId >= SECOND_CONTINUATION_UNLOCK_LEVEL_ID ? MAX_CONTINUATIONS_LATE : MAX_CONTINUATIONS_BASE;
}

// Rewarded "continuer" : déclenché uniquement par un ÉPUISEMENT RÉEL des
// vies (status "lost"), jamais par un échec de niveau individuel, jamais
// automatiquement, et jamais au-delà du plafond de continuations de CETTE
// tentative (voir maxContinuationsForLevel ci-dessus -- "aucune boucle de
// rewarded illimitée", cahier des charges V6). Reste proposé même à un
// joueur Premium (le cahier des charges V5/V6 interdit de l'IMPOSER, pas de
// le proposer) : Premium n'intervient donc PAS dans cette éligibilité.
export function canOfferRewardedContinue(gameStatus, continuationsUsed, levelId) {
  if (gameStatus !== "lost") return false;
  return continuationsUsed < maxContinuationsForLevel(levelId);
}

export function setPremium(monetization, value) {
  monetization.premium = value;
}
