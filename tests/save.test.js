// V5 : vérifie que l'ajout du champ "monetization" (compteur d'interstitiel,
// état Premium -- cahier des charges V5) ne perd JAMAIS silencieusement une
// progression existante d'une sauvegarde antérieure sans ce champ (V0-V4).
// node:test n'a pas de localStorage : on simule le strict minimum utilisé
// par save.js, pas un environnement DOM complet.
import { test } from "node:test";
import assert from "node:assert/strict";

function installFakeLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return store;
}

test("une sauvegarde antérieure à V5 (sans le champ monetization) migre proprement, sans perte de progression", async () => {
  const store = installFakeLocalStorage();
  store.set(
    "breakpoint-v0-save",
    JSON.stringify({
      version: 1,
      unlockedLevelIndex: 12,
      tutorialsSeen: { first_move: true, first_launch: true },
      settings: { music: false, sfx: true, haptics: true },
      // pas de "monetization" -- exactement une sauvegarde V3/V4 réelle
    })
  );
  const { loadSave } = await import("../src/engine/save.js?t=v5migration1");
  const save = loadSave();
  assert.equal(save.unlockedLevelIndex, 12, "la progression réelle du joueur ne doit jamais être perdue par la migration V5");
  assert.equal(save.settings.music, false, "un réglage existant ne doit jamais être écrasé par un défaut");
  assert.ok(save.monetization, "le champ monetization doit être ajouté avec des valeurs par défaut sûres");
  assert.equal(save.monetization.premium, false);
  assert.equal(save.monetization.hasLaunchedAppBefore, false);
  assert.equal(save.monetization.levelsWonSinceLastInterstitial, 0);
});

test("une sauvegarde qui a déjà un état monetization réel (ex. Premium acheté) n'est jamais réinitialisée", async () => {
  installFakeLocalStorage();
  globalThis.localStorage.setItem(
    "breakpoint-v0-save",
    JSON.stringify({
      version: 1,
      unlockedLevelIndex: 5,
      tutorialsSeen: {},
      settings: { music: true, sfx: true, haptics: true },
      monetization: { premium: true, hasLaunchedAppBefore: true, levelsWonSinceLastInterstitial: 2, lastInterstitialAt: 123456 },
    })
  );
  const { loadSave } = await import("../src/engine/save.js?t=v5migration2");
  const save = loadSave();
  assert.equal(save.monetization.premium, true, "un état Premium déjà acquis ne doit jamais être perdu au rechargement");
  assert.equal(save.monetization.levelsWonSinceLastInterstitial, 2);
  assert.equal(save.monetization.lastInterstitialAt, 123456);
});

test("aucune sauvegarde existante (première visite) : monetization prend ses valeurs par défaut", async () => {
  installFakeLocalStorage();
  const { loadSave } = await import("../src/engine/save.js?t=v5migration3");
  const save = loadSave();
  assert.equal(save.monetization.premium, false);
  assert.equal(save.monetization.hasLaunchedAppBefore, false);
});
