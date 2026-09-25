// V5 : logique économique (cahier des charges V5, sections 3.1-3.3) --
// tests de la décision pure d'interstitiel/rewarded/Premium. Ce module ne
// touche à aucun SDK ni aucun écran réel (voir src/engine/monetization.js) ;
// ces tests couvrent donc entièrement la "préparation d'état" demandée par
// le cahier des charges V5, section 10.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMonetizationState,
  beginSession,
  recordLevelWon,
  recordInterstitialShown,
  canShowInterstitial,
  canOfferRewardedContinue,
  setPremium,
  LEVELS_PER_INTERSTITIAL,
  MIN_INTERSTITIAL_COOLDOWN_MS,
} from "../src/engine/monetization.js";

test("première session de découverte : aucun interstitiel possible même après 3 niveaux réussis", () => {
  const m = createMonetizationState();
  const isFirstSession = beginSession(m);
  assert.equal(isFirstSession, true, "le tout premier lancement de l'app doit être détecté comme première session");
  for (let i = 0; i < LEVELS_PER_INTERSTITIAL; i++) recordLevelWon(m);
  assert.equal(canShowInterstitial(m, 10_000_000, isFirstSession), false, "jamais d'interstitiel pendant la découverte");
});

test("deuxième session : la première session précédente est bien mémorisée", () => {
  const m = createMonetizationState();
  beginSession(m); // 1ère session réelle
  const isFirstSessionSecondLaunch = beginSession(m); // relance de l'app (2e session)
  assert.equal(isFirstSessionSecondLaunch, false, "un second lancement de l'app n'est plus la session de découverte");
});

test("compteur de niveaux : moins de 3 niveaux réussis ne déclenche jamais l'interstitiel", () => {
  const m = createMonetizationState();
  beginSession(m);
  const isFirstSession = false; // simule une session ultérieure
  recordLevelWon(m);
  recordLevelWon(m);
  assert.equal(canShowInterstitial(m, 10_000_000, isFirstSession), false, "2 niveaux réussis ne suffisent pas (seuil = 3)");
  recordLevelWon(m);
  assert.equal(canShowInterstitial(m, 10_000_000, isFirstSession), true, "3 niveaux réussis, hors première session, délai passé -> éligible");
});

test("garde-fou temporel : 5 minutes minimum, même si le compteur de niveaux est déjà satisfait", () => {
  const m = createMonetizationState();
  beginSession(m);
  for (let i = 0; i < LEVELS_PER_INTERSTITIAL; i++) recordLevelWon(m);
  const now = 1_000_000;
  recordInterstitialShown(m, now); // un interstitiel vient d'être montré
  for (let i = 0; i < LEVELS_PER_INTERSTITIAL; i++) recordLevelWon(m); // 3 niveaux de plus, très vite
  const tooSoon = now + MIN_INTERSTITIAL_COOLDOWN_MS - 1;
  assert.equal(
    canShowInterstitial(m, tooSoon, false),
    false,
    "le compteur de niveaux ne doit jamais permettre de contourner le délai de 5 minutes"
  );
  const justEnough = now + MIN_INTERSTITIAL_COOLDOWN_MS;
  assert.equal(canShowInterstitial(m, justEnough, false), true, "après exactement 5 minutes ET 3 niveaux, l'interstitiel redevient éligible");
});

test("les deux conditions sont bien un ET, pas un OU : 5 minutes passées mais pas assez de niveaux", () => {
  const m = createMonetizationState();
  beginSession(m);
  recordInterstitialShown(m, 0);
  recordLevelWon(m); // un seul niveau, très en dessous du seuil
  assert.equal(
    canShowInterstitial(m, MIN_INTERSTITIAL_COOLDOWN_MS * 10, false),
    false,
    "même largement après le délai, le compteur de niveaux doit être respecté"
  );
});

test("Premium supprime totalement l'interstitiel, même si toutes les autres conditions sont réunies", () => {
  const m = createMonetizationState();
  beginSession(m);
  setPremium(m, true);
  for (let i = 0; i < LEVELS_PER_INTERSTITIAL; i++) recordLevelWon(m);
  assert.equal(canShowInterstitial(m, 10_000_000, false), false, "un joueur Premium ne doit jamais voir d'interstitiel imposé");
});

test("recordInterstitialShown remet bien le compteur de niveaux à zéro", () => {
  const m = createMonetizationState();
  beginSession(m);
  for (let i = 0; i < LEVELS_PER_INTERSTITIAL; i++) recordLevelWon(m);
  recordInterstitialShown(m, 0);
  assert.equal(m.levelsWonSinceLastInterstitial, 0);
});

test("rewarded 'continuer' : proposé uniquement sur un vrai épuisement des vies (status 'lost')", () => {
  assert.equal(canOfferRewardedContinue("lost"), true);
  assert.equal(canOfferRewardedContinue("playing"), false, "un échec de niveau individuel (pas encore Game Over) ne doit jamais l'offrir");
  assert.equal(canOfferRewardedContinue("ready"), false);
  assert.equal(canOfferRewardedContinue("won"), false);
});

test("rewarded 'continuer' reste proposé à un joueur Premium (jamais imposé, mais jamais retiré non plus)", () => {
  // Le cahier des charges V5 (section 3.3) interdit d'IMPOSER le rewarded à
  // un joueur Premium, mais ne demande jamais de le lui retirer -- la
  // fonction ne dépend donc d'aucun état Premium, par construction.
  assert.equal(canOfferRewardedContinue("lost"), true);
});
