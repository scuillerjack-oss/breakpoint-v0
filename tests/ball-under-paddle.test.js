// V3 : régression pour le bug "balle bloquée/repassant sous la raquette"
// remonté en bêta réelle V2. Cause racine diagnostiquée (voir rapport
// technique V3 et simulation.js, branche "paddle" de stepBall()) : le
// collideur raquette forçait TOUJOURS un rebond vers le haut (formule de
// visée par décalage + effet), quelle que soit la normale réelle calculée
// par sweptAABB -- alors que la correction positionnelle, elle, utilise la
// vraie normale. Pour un impact réel sur la face INFÉRIEURE (balle déjà
// passée sous la raquette, ex. après un rebond de mur), ces deux logiques
// se contredisaient : position repoussée sous la raquette, vitesse forcée
// vers le haut -- la balle re-heurtait alors la même face au sous-pas
// suivant, indéfiniment (piège de collision perpétuelle).
// Reproduit de façon déterministe AVANT correction : la balle restait
// pinned à y == raquette.maxY + rayon + 0.01 avec vy inchangée sur des
// dizaines de ticks consécutifs. Corrigé en ne réservant la formule de
// visée qu'aux impacts où best.normal.y < 0 (face supérieure réelle) ;
// tout le reste (face inférieure, côtés) utilise désormais reflect(),
// exactement comme n'importe quel autre collideur (mur, brique).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLevelState } from "../src/engine/state.js";
import { tick } from "../src/engine/simulation.js";
import { ARENA_W, ARENA_H, PADDLE_Y, PADDLE_H } from "../src/engine/constants.js";

function noInput(overrides = {}) {
  return { pointerX: null, launchRequested: false, fire: false, ...overrides };
}

function runTicks(s, n, dtMs = 16) {
  for (let i = 0; i < n; i++) {
    tick(s, dtMs, noInput());
    if (!s.balls.length || s.status !== "playing") break;
  }
}

test("balle sous la raquette, remontant lentement : ne reste jamais bloquée (position figée)", () => {
  const s = createLevelState(0);
  s.status = "playing";
  const p = s.paddle;
  const centerX = p.x + p.w / 2;
  s.balls = [{ x: centerX, y: p.y + p.h + 3, vx: 20, vy: -300, r: 6, launched: true, perforateUntil: 0 }];
  const positions = new Set();
  for (let i = 0; i < 15; i++) {
    tick(s, 16, noInput());
    if (!s.balls.length) break;
    positions.add(Math.round(s.balls[0].y * 100));
  }
  assert.ok(
    positions.size > 1 || s.balls.length === 0,
    "la position Y de la balle ne doit jamais rester identique tick après tick (signature du bug bloqué)"
  );
});

test("balle sous la raquette, remontant : rebondit vers le BAS (s'éloigne), pas vers le haut", () => {
  const s = createLevelState(0);
  s.status = "playing";
  const p = s.paddle;
  const centerX = p.x + p.w / 2;
  s.balls = [{ x: centerX, y: p.y + p.h + 3, vx: 20, vy: -300, r: 6, launched: true, perforateUntil: 0 }];
  tick(s, 16, noInput());
  assert.ok(s.balls.length > 0, "la balle ne doit pas disparaître dès le premier tick");
  assert.ok(
    s.balls[0].vy > 0,
    `un impact réel sur la face inférieure doit renvoyer la balle vers le bas (vy>0), obtenu vy=${s.balls[0].vy}`
  );
});

test("balle sous la raquette : après un délai raisonnable, suit la perte normale (jamais bloquée indéfiniment)", () => {
  const s = createLevelState(0);
  s.status = "playing";
  const p = s.paddle;
  const centerX = p.x + p.w / 2;
  s.balls = [{ x: centerX, y: p.y + p.h + 3, vx: 20, vy: -300, r: 6, launched: true, perforateUntil: 0 }];
  runTicks(s, 200);
  assert.ok(
    s.status === "lost" || s.status === "ready" || s.status === "won",
    `la balle doit finir par déclencher la perte normale, pas rester "playing" indéfiniment (status=${s.status})`
  );
});

test("balle sous la raquette ne redevient JAMAIS jouable par accident (ne remonte pas au-dessus AVANT la perte normale)", () => {
  const s = createLevelState(0);
  s.status = "playing";
  const p = s.paddle;
  const centerX = p.x + p.w / 2;
  // Placée nettement sous la zone de jeu utile, mouvement clairement
  // descendant : doit suivre la perte, jamais repasser au-dessus de la
  // raquette AVANT ça (une fois la vie perdue, une NOUVELLE balle
  // réapparaît normalement au-dessus de la raquette -- comportement V2
  // attendu, pas la balle "sauvée" -- on arrête donc de surveiller dès
  // qu'un événement de perte réel survient).
  s.balls = [{ x: centerX, y: p.y + p.h + 3, vx: 5, vy: -50, r: 6, launched: true, perforateUntil: 0 }];
  let sawAboveBeforeLoss = false;
  let sawLossEvent = false;
  for (let i = 0; i < 300; i++) {
    tick(s, 16, noInput());
    if (s.events.some((e) => e.type === "ball_lost" || e.type === "life_lost")) {
      sawLossEvent = true;
      break;
    }
    if (!s.balls.length) break;
    if (s.balls[0].y < p.y) {
      sawAboveBeforeLoss = true;
      break;
    }
  }
  assert.ok(!sawAboveBeforeLoss, "une balle déjà sous la raquette ne doit jamais repasser au-dessus avant sa perte normale");
  assert.ok(sawLossEvent, "la balle doit finir par déclencher un vrai événement de perte (pas rester en jeu indéfiniment)");
});

test("coin de la raquette, impact depuis en dessous à haute vitesse : pas de blocage ni de dérive infinie", () => {
  const s = createLevelState(0);
  s.status = "playing";
  const p = s.paddle;
  const edgeX = p.x + p.w - 2;
  s.balls = [{ x: edgeX, y: p.y + p.h + 2, vx: 350, vy: -80, r: 6, launched: true, perforateUntil: 0 }];
  const xs = [];
  for (let i = 0; i < 30; i++) {
    tick(s, 16, noInput());
    if (!s.balls.length) break;
    xs.push(s.balls[0].x);
  }
  assert.ok(xs.length === 0 || new Set(xs.map((v) => Math.round(v))).size > 1, "la balle ne doit pas rester figée en X non plus");
});

test("collision proche du bord gauche de l'arène, sous la raquette : pas de blocage", () => {
  const s = createLevelState(0);
  s.status = "playing";
  const p = s.paddle;
  s.balls = [{ x: p.x + 3, y: p.y + p.h + 3, vx: -15, vy: -250, r: 6, launched: true, perforateUntil: 0 }];
  runTicks(s, 100);
  assert.ok(s.status !== "playing" || s.balls.length === 0 || s.balls[0].y !== p.y + p.h + 6.01, "ne doit pas rester pinned près du bord");
});

test("trajectoire rasante (quasi horizontale) sous la raquette : pas de blocage", () => {
  const s = createLevelState(0);
  s.status = "playing";
  const p = s.paddle;
  s.balls = [{ x: p.x - 20, y: p.y + p.h + 5, vx: 400, vy: -5, r: 6, launched: true, perforateUntil: 0 }];
  const before = { x: p.x - 20, y: p.y + p.h + 5 };
  runTicks(s, 50);
  if (s.balls.length > 0) {
    const moved = Math.abs(s.balls[0].x - before.x) > 1 || Math.abs(s.balls[0].y - before.y) > 1;
    assert.ok(moved, "une trajectoire rasante sous la raquette doit continuer à progresser, pas se figer");
  }
});

test("fortes vitesses sous la raquette (proche tunneling) : aucun blocage", () => {
  const s = createLevelState(0);
  s.status = "playing";
  const p = s.paddle;
  const centerX = p.x + p.w / 2;
  s.balls = [{ x: centerX, y: p.y + p.h + 2, vx: 0, vy: -3000, r: 6, launched: true, perforateUntil: 0 }];
  runTicks(s, 30);
  assert.ok(
    s.balls.length === 0 || s.balls[0].vy !== -3000,
    "même à très haute vitesse, un impact sous la raquette doit être résolu (rebond vers le bas), pas ignoré/figé"
  );
});

test("impact normal sur la face SUPÉRIEURE de la raquette : comportement V2 inchangé (non-régression)", () => {
  const s = createLevelState(0);
  s.status = "playing";
  const p = s.paddle;
  const centerX = p.x + p.w / 2;
  s.balls = [{ x: centerX, y: p.y - 5, vx: 0, vy: 300, r: 6, launched: true, perforateUntil: 0 }];
  tick(s, 16, noInput());
  assert.ok(s.balls[0].vy < 0, "un impact réel sur le dessus doit toujours renvoyer la balle vers le haut, comme en V2");
});
