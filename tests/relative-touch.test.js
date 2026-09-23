// V1 : contrôle tactile relatif type trackpad (cahier des charges section 4).
// Tests de la logique PURE (sans DOM) -- voir src/ui/relative-touch.js.
// Le cahier des charges liste explicitement, section 9 : "Aucun saut de
// raquette au nouveau toucher ; déplacements relatifs corrects après
// plusieurs relâchements/reprises."
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRelativeTouchState, beginTouch, moveTouch, endTouch } from "../src/ui/relative-touch.js";

const MIN = 36; // demi-largeur raquette de base (PADDLE_W/2), bornes réalistes
const MAX = 400 - 36;

test("le toucher initial ne déplace pas la raquette", () => {
  const s = createRelativeTouchState(200);
  beginTouch(s, 350, 200); // doigt loin du centre de la raquette
  assert.equal(s.targetCenterX, 200, "la cible ne doit pas sauter vers le doigt au toucher initial");
});

test("le glissement déplace la raquette relativement au point de référence", () => {
  const s = createRelativeTouchState(200);
  beginTouch(s, 100, 200);
  moveTouch(s, 130, MIN, MAX); // doigt +30 vers la droite
  assert.equal(s.targetCenterX, 230, "un glissement de +30 doit déplacer la raquette de +30 (1:1)");
  moveTouch(s, 80, MIN, MAX); // doigt -20 par rapport au point de référence initial (100)
  assert.equal(s.targetCenterX, 180, "un glissement de -20 par rapport à la référence doit donner 200-20=180");
});

test("le relâchement conserve la position ; un nouveau toucher ailleurs ne téléporte pas", () => {
  const s = createRelativeTouchState(200);
  beginTouch(s, 100, 200);
  moveTouch(s, 150, MIN, MAX); // raquette à 250
  assert.equal(s.targetCenterX, 250);
  endTouch(s);
  assert.equal(s.targetCenterX, 250, "le relâchement seul ne doit rien changer");
  // Nouveau toucher à une coordonnée TRÈS différente (ex: côté opposé de
  // l'écran) : ne doit PAS téléporter la raquette vers cette coordonnée.
  beginTouch(s, 20, s.targetCenterX);
  assert.equal(s.targetCenterX, 250, "un nouveau toucher ailleurs ne doit jamais téléporter la raquette");
  // Le nouveau toucher devient le nouveau point de référence : un petit
  // glissement à partir de LÀ doit produire un déplacement relatif correct.
  moveTouch(s, 35, MIN, MAX); // +15 par rapport au nouveau point de référence (20)
  assert.equal(s.targetCenterX, 265, "après un nouveau toucher, le glissement doit rester relatif au nouveau point");
});

test("plusieurs cycles relâchement/reprise successifs restent cohérents (pas de dérive)", () => {
  const s = createRelativeTouchState(200);
  const cycles = [
    { down: 50, moves: [60, 80], expected: 230 }, // référence à 50, doigt finit à 80 -> +30
    { down: 300, moves: [290], expected: 220 }, // référence à 300, doigt finit à 290 -> -10
    { down: 10, moves: [10, 10, 10], expected: 220 }, // aucun mouvement net
  ];
  for (const cycle of cycles) {
    beginTouch(s, cycle.down, s.targetCenterX);
    for (const m of cycle.moves) moveTouch(s, m, MIN, MAX);
    assert.equal(s.targetCenterX, cycle.expected);
    endTouch(s);
  }
});

test("en butée droite : pas d'overshoot accumulé, la raquette repart immédiatement en sens inverse", () => {
  const s = createRelativeTouchState(200);
  beginTouch(s, 0, 200);
  moveTouch(s, 1000, MIN, MAX); // glissement énorme au-delà de la butée droite
  assert.equal(s.targetCenterX, MAX, "doit être clampé exactement à la borne, jamais au-delà");
  // Le doigt continue de glisser encore plus loin à droite : aucun effet
  // supplémentaire, mais surtout aucune "dette" à rattraper ensuite.
  moveTouch(s, 2000, MIN, MAX);
  assert.equal(s.targetCenterX, MAX);
  // Reprise immédiate dans l'autre sens : un petit retour de 5 doit
  // immédiatement réduire la cible de 5, PAS rester bloqué à la butée en
  // attendant de rattraper tout l'overshoot (2000-1000=1000 de "dette").
  moveTouch(s, 1995, MIN, MAX);
  assert.equal(s.targetCenterX, MAX - 5, "un retour de 5 après butée doit réduire la cible de 5 immédiatement");
});

test("en butée gauche : symétrique, pas d'overshoot ni de zone morte", () => {
  const s = createRelativeTouchState(200);
  beginTouch(s, 0, 200);
  moveTouch(s, -1000, MIN, MAX);
  assert.equal(s.targetCenterX, MIN);
  moveTouch(s, -995, MIN, MAX); // retour de 5 vers la droite
  assert.equal(s.targetCenterX, MIN + 5);
});

test("aucune vibration : un glissement nul ne change pas la cible", () => {
  const s = createRelativeTouchState(200);
  beginTouch(s, 100, 200);
  for (let i = 0; i < 5; i++) {
    moveTouch(s, 100, MIN, MAX);
    assert.equal(s.targetCenterX, 200);
  }
});
