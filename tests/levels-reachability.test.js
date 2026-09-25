// V1 : vérification reproductible que chaque niveau est réellement
// terminable, pas seulement "structurellement valide" (voir levels.test.js
// pour la validation de structure). Rejoue chaque niveau avec un "joueur"
// synthétique qui suit la balle avec une imprécision réaliste (jamais un
// centrage parfait au pixel près -- voir le rapport technique V1 pour
// pourquoi un centrage parfait est un cas dégénéré qu'aucun humain ne
// produit) et échoue si un niveau ne se termine pas dans un temps large mais
// borné. C'est ce test qui aurait détecté le niveau 1 bloqué remonté en
// bêta V0, et qui empêche qu'un futur niveau reproduise le même problème.
//
// V5 : ce test se voulait déjà déterministe ("jamais Math.random"), mais ne
// contrôlait que SES propres profils de bruit -- pas le tirage aléatoire
// réel des power-ups dans applyPowerUp() (src/engine/simulation.js), qui
// reste un Math.random() non semé. Sous un tirage suffisamment défavorable
// (aucun bonus utile ne tombe jamais), un niveau pouvait de façon rare mais
// réelle dépasser sa borne de temps -- flake reproduit et confirmé (échec
// réel constaté sur le run CI GitHub Actions du commit c709fac, niveau 13,
// puis reproduit localement 1 fois sur 5 exécutions). Corrigé en semant
// Math.random avec un générateur à graine FIXE pour la durée de chaque
// simulation (jamais dans le moteur lui-même, qui reste inchangé et garde
// son vrai aléa en jeu normal) : le test redevient réellement reproductible
// à l'identique, comme son intention initiale l'affirmait déjà.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLevelState } from "../src/engine/state.js";
import { tick } from "../src/engine/simulation.js";
import { LEVELS } from "../src/engine/levels.js";
import { ARENA_W } from "../src/engine/constants.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Profils de bruit déterministes (jamais Math.random -- un test doit être
// reproductible à l'identique) simulant plusieurs façons réalistes, mais
// imparfaites, de suivre la balle du doigt.
const NOISE_PROFILES = [
  (t) => Math.sin(t * 0.013) * 15,
  (t) => Math.sin(t * 0.021 + 1.7) * 25 + Math.sin(t * 0.007) * 8,
  (t) => Math.sin(t * 0.0031) * 30 + Math.sin(t * 0.059) * 6,
];

function simulateLevel(levelIndex, noiseFn, maxSeconds) {
  const state = createLevelState(levelIndex);
  const dtMs = 1000 / 60;
  let elapsed = 0;
  let launched = false;
  while (elapsed < maxSeconds * 1000) {
    const ball = state.balls[0];
    const pointerX = (ball ? ball.x : ARENA_W / 2) + noiseFn(elapsed);
    const input = { pointerX, launchRequested: !launched, fire: false };
    launched = true;
    tick(state, dtMs, input);
    elapsed += dtMs;
    if (state.status === "won" || state.status === "lost") break;
  }
  return {
    status: state.status,
    elapsedS: elapsed / 1000,
    remaining: state.bricks.filter((b) => b.alive).length,
    total: state.bricks.length,
  };
}

for (let i = 0; i < LEVELS.length; i++) {
  const level = LEVELS[i];
  test(`niveau ${level.id} ("${level.name}") réellement terminable, sans brique pratiquement inaccessible`, () => {
    const maxTargetS = level.targetSeconds[1];
    // Borne large et volontairement généreuse (pas une exigence de rapidité
    // -- voir simulation.test.js pour la vitesse/l'angle -- seulement une
    // détection de blocage total, comme le niveau 1 en bêta V0, qui prenait
    // plus de 300s sans jamais finir).
    const bound = Math.max(150, maxTargetS * 3);
    const originalRandom = Math.random;
    try {
      for (let p = 0; p < NOISE_PROFILES.length; p++) {
        // Graine fixe par (niveau, profil) : reproductible à l'identique
        // d'une exécution à l'autre, y compris en CI -- voir note V5
        // ci-dessus. N'affecte jamais le tirage réel en jeu normal (restauré
        // juste après).
        Math.random = mulberry32(level.id * 1000 + p);
        const result = simulateLevel(i, NOISE_PROFILES[p], bound);
        assert.equal(
          result.status,
          "won",
          `niveau ${level.id} non terminé après ${bound}s (${result.remaining}/${result.total} briques restantes) -- brique(s) probablement inaccessible(s)`
        );
        assert.ok(
          result.elapsedS <= bound,
          `niveau ${level.id} a pris ${result.elapsedS.toFixed(1)}s, au-delà de la borne ${bound}s`
        );
      }
    } finally {
      Math.random = originalRandom;
    }
  });
}
