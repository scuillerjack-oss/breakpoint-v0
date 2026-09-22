import { test } from "node:test";
import assert from "node:assert/strict";
import { createLevelState, brickRect } from "../src/engine/state.js";
import { tick } from "../src/engine/simulation.js";
import { ARENA_W, ARENA_H, BALL_BASE_SPEED } from "../src/engine/constants.js";

function noInput(overrides = {}) {
  return { pointerX: null, launchRequested: false, fire: false, ...overrides };
}

test("le lancer produit une vitesse déterministe (toujours la même)", () => {
  const s1 = createLevelState(0);
  tick(s1, 16, noInput({ launchRequested: true }));
  const s2 = createLevelState(0);
  tick(s2, 16, noInput({ launchRequested: true }));
  assert.equal(s1.balls[0].vx, s2.balls[0].vx);
  assert.equal(s1.balls[0].vy, s2.balls[0].vy);
  assert.ok(s1.balls[0].vy < 0, "la balle doit partir vers le haut");
});

test("la raquette suit le doigt immédiatement, sans lissage/retard", () => {
  const s = createLevelState(0);
  tick(s, 16, noInput({ pointerX: 300 }));
  assert.equal(s.paddle.x, 300 - s.paddle.w / 2, "position atteinte en un seul tick, pas de lerp progressif");
});

test("la raquette reste dans les limites de l'arène", () => {
  const s = createLevelState(0);
  tick(s, 16, noInput({ pointerX: -500 }));
  assert.equal(s.paddle.x, 0);
  tick(s, 16, noInput({ pointerX: 5000 }));
  assert.equal(s.paddle.x, ARENA_W - s.paddle.w);
});

test("rebond sur le mur gauche : vx change de signe, vy inchangé", () => {
  const s = createLevelState(0);
  s.status = "playing";
  s.bricks = [];
  // Balle proche du mur mais PAS déjà en chevauchement (x=10, rayon=6 :
  // marge de 4 unités avant contact) — un rebond réel s'approche toujours
  // ainsi ; démarrer déjà incrustée dans le mur ne teste rien de réel.
  s.balls = [{ x: 10, y: 300, vx: -1000, vy: 100, r: 6, launched: true, perforateUntil: 0 }];
  tick(s, 16, noInput());
  assert.ok(s.balls[0].vx > 0, "vx doit s'être inversé après le rebond sur le mur gauche");
});

test("le point d'impact sur la raquette influence l'angle de renvoi", () => {
  function bounceOffPaddleAt(hitFraction) {
    const s = createLevelState(0);
    s.status = "playing";
    s.bricks = [];
    const p = s.paddle;
    const hitX = p.x + p.w / 2 + hitFraction * (p.w / 2);
    s.balls = [{ x: hitX, y: p.y - 5, vx: 0, vy: 300, r: 6, launched: true, perforateUntil: 0 }];
    tick(s, 30, noInput());
    return s.balls[0];
  }
  const center = bounceOffPaddleAt(0);
  const right = bounceOffPaddleAt(0.9);
  const left = bounceOffPaddleAt(-0.9);
  assert.ok(Math.abs(center.vx) < Math.abs(right.vx), "un impact excentré doit dévier davantage que le centre");
  assert.ok(right.vx > 0, "impact côté droit -> renvoi vers la droite");
  assert.ok(left.vx < 0, "impact côté gauche -> renvoi vers la gauche");
  assert.ok(right.vy < 0 && left.vy < 0 && center.vy < 0, "le renvoi reste toujours vers le haut");
});

test("aucun tunneling à haute vitesse à travers une rangée de briques", () => {
  const s = createLevelState(0);
  s.status = "playing";
  // Rangée de briques fines juste sous la balle ; vitesse énorme choisie
  // pour qu'un pas naïf (sans sous-pas) la ferait franchir toute la rangée
  // en un seul appel de tick() si le moteur avait un bug de tunneling.
  s.bricks = [
    { col: 4, row: 0, hp: 1, maxHp: 1, alive: true, id: "t1" },
  ];
  // y de départ à l'intérieur de l'arène (pas au-delà du mur du haut, qui
  // occupe tout y<0) : une balle qui commence déjà hors-jeu ne teste rien.
  // Vitesse choisie pour un déplacement (100 unités) très supérieur à
  // l'épaisseur de la brique (16) ET à l'écart de départ (44) : un test
  // naïf "position finale seulement" laisserait passer un vrai tunneling.
  // Volontairement pas plus extrême : au-delà, la balle rebondirait aussi
  // sur le mur du haut dans le même tick (cascade de rebonds), ce qui est
  // un comportement correct mais rendrait cette assertion précise ambiguë
  // (le nombre de rebonds dans un seul pas dépend alors de la parité).
  const r = brickRect(s.bricks[0]);
  s.balls = [{ x: r.x + r.w / 2, y: r.y - 50, vx: 0, vy: 2000, r: 6, launched: true, perforateUntil: 0 }];
  tick(s, 50, noInput());
  assert.equal(s.bricks[0].alive, false, "la brique doit être détruite, pas traversée sans interaction");
  assert.ok(s.balls[0].vy < 0, "la balle doit avoir rebondi (vy inversé), pas continué tout droit");
});

test("brique renforcée absorbe plusieurs impacts avant destruction", () => {
  const s = createLevelState(0);
  s.status = "playing";
  s.bricks = [{ col: 4, row: 0, hp: 2, maxHp: 2, alive: true, id: "t1" }];
  const r = brickRect(s.bricks[0]);
  const ball = { x: r.x + r.w / 2, y: r.y + r.h + 50, vx: 0, vy: -300, r: 6, launched: true, perforateUntil: 0 };
  s.balls = [ball];
  tick(s, 200, noInput());
  assert.equal(s.bricks[0].alive, true, "1 impact ne doit pas détruire une brique à 2 PV");
  assert.equal(s.bricks[0].hp, 1);
});

test("balle perforante traverse plusieurs briques sans rebondir", () => {
  const s = createLevelState(0);
  s.status = "playing";
  s.bricks = [
    { col: 4, row: 0, hp: 1, maxHp: 1, alive: true, id: "a" },
    { col: 4, row: 1, hp: 1, maxHp: 1, alive: true, id: "b" },
    { col: 4, row: 2, hp: 1, maxHp: 1, alive: true, id: "c" },
  ];
  const top = brickRect(s.bricks[0]);
  s.balls = [
    { x: top.x + top.w / 2, y: top.y - 50, vx: 0, vy: 3000, r: 6, launched: true, perforateUntil: 999999 },
  ];
  tick(s, 50, noInput());
  assert.ok(s.bricks.every((b) => !b.alive), "les 3 briques alignées doivent toutes être détruites en un seul tick");
  assert.ok(s.balls[0].vy > 0, "la balle perforante ne rebondit pas : elle continue tout droit");
});

test("multiball crée des balles additionnelles à partir d'une balle existante", () => {
  const s = createLevelState(0);
  s.status = "playing";
  s.balls = [{ x: 200, y: 300, vx: 50, vy: -300, r: 6, launched: true, perforateUntil: 0 }];
  s.powerUps = [{ kind: "multiball", x: s.paddle.x, y: s.paddle.y - 5, w: 28, h: 16, alive: true }];
  tick(s, 16, noInput());
  assert.equal(s.balls.length, 3, "1 balle existante + 2 nouvelles = 3");
});

test("laser détruit une brique sur sa trajectoire", () => {
  const s = createLevelState(0);
  s.status = "playing";
  s.effects.laserUntil = 999999;
  s.bricks = [{ col: 4, row: 0, hp: 1, maxHp: 1, alive: true, id: "a" }];
  // Aligne la raquette (donc le tir) sur le centre de la colonne 4 : le
  // centre par défaut de l'arène (200) tombe exactement à la frontière
  // entre les colonnes 4 et 5, ce qui ferait rater la brique par un pur
  // hasard de coordonnées plutôt que de tester le vrai comportement.
  tick(s, 16, noInput({ pointerX: 180, fire: true }));
  assert.equal(s.lasers.length, 1, "un tir doit avoir été créé");
  // Simule suffisamment de temps pour que le laser atteigne la brique.
  for (let i = 0; i < 60 && s.bricks[0].alive; i++) {
    tick(s, 16, noInput());
  }
  assert.equal(s.bricks[0].alive, false, "le laser doit avoir détruit la brique");
});

test("perte de la balle : vie décomptée puis état 'ready' avec une balle neuve", () => {
  const s = createLevelState(0, { lives: 2 });
  s.status = "playing";
  s.balls = [{ x: 200, y: ARENA_H + 50, vx: 0, vy: 100, r: 6, launched: true, perforateUntil: 0 }];
  tick(s, 16, noInput());
  assert.equal(s.lives, 1);
  assert.equal(s.status, "ready");
  assert.equal(s.balls.length, 1);
  assert.equal(s.balls[0].launched, false);
});

test("dernière vie perdue : status 'lost'", () => {
  const s = createLevelState(0, { lives: 1 });
  s.status = "playing";
  s.balls = [{ x: 200, y: ARENA_H + 50, vx: 0, vy: 100, r: 6, launched: true, perforateUntil: 0 }];
  tick(s, 16, noInput());
  assert.equal(s.lives, 0);
  assert.equal(s.status, "lost");
});

test("toutes les briques détruites : status 'won'", () => {
  const s = createLevelState(0);
  s.status = "playing";
  s.bricks = [{ col: 4, row: 0, hp: 1, maxHp: 1, alive: true, id: "a" }];
  const r = brickRect(s.bricks[0]);
  s.balls = [{ x: r.x + r.w / 2, y: r.y + r.h + 50, vx: 0, vy: -300, r: 6, launched: true, perforateUntil: 0 }];
  tick(s, 200, noInput());
  assert.equal(s.status, "won");
});

test("la vitesse de la balle reste constante (pas d'accélération parasite au fil des rebonds)", () => {
  const s = createLevelState(0);
  s.status = "playing";
  s.bricks = [];
  s.balls = [{ x: 5, y: 300, vx: -300, vy: 200, r: 6, launched: true, perforateUntil: 0 }];
  const initialSpeed = Math.hypot(s.balls[0].vx, s.balls[0].vy);
  for (let i = 0; i < 30; i++) tick(s, 16, noInput());
  const finalSpeed = Math.hypot(s.balls[0].vx, s.balls[0].vy);
  assert.ok(Math.abs(finalSpeed - initialSpeed) < 1e-6, `vitesse dérivée: ${initialSpeed} -> ${finalSpeed}`);
});

test("stress: beaucoup de briques + plusieurs balles ne plante pas et reste cohérent", () => {
  const s = createLevelState(3); // niveau avec biais multiball
  s.status = "playing";
  s.balls = [
    { x: 100, y: 300, vx: 120, vy: -300, r: 6, launched: true, perforateUntil: 0 },
    { x: 200, y: 320, vx: -80, vy: -280, r: 6, launched: true, perforateUntil: 0 },
    { x: 300, y: 310, vx: 40, vy: -320, r: 6, launched: true, perforateUntil: 0 },
  ];
  for (let i = 0; i < 300; i++) {
    tick(s, 16, noInput());
    if (s.status !== "playing") break;
  }
  assert.ok(["playing", "won", "ready", "lost"].includes(s.status));
});
