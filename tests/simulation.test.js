import { test } from "node:test";
import assert from "node:assert/strict";
import { createLevelState, brickRect } from "../src/engine/state.js";
import { tick } from "../src/engine/simulation.js";
import { ARENA_W, ARENA_H, BALL_BASE_SPEED, MAX_TOTAL_BOUNCE_ANGLE_DEG, PADDLE_SPEED_LIMIT } from "../src/engine/constants.js";

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

// V1 : une raquette en mouvement au moment de l'impact dévie la balle en plus
// de l'angle donné par le point d'impact ("effet") -- voir constants.js pour
// la justification complète. Sans cela, un joueur qui suit simplement la
// balle (impact quasi centré en permanence) ne fait jamais varier l'angle, et
// puisque les murs/briques réfléchissent en miroir (angle inchangé), la balle
// peut rester piégée dans une trajectoire répétitive qui ne balaie jamais
// certaines briques -- cause racine du niveau 1 bloqué remonté en bêta V0.
test("une raquette en mouvement dévie la balle même pour un impact centré (effet)", () => {
  function bounceWithPaddleMotion(direction) {
    const s = createLevelState(0);
    s.status = "playing";
    // Laisse les briques par défaut du niveau en place (loin de la raquette,
    // sans effet sur ce test) : les vider déclencherait immédiatement la
    // condition de victoire au premier tick et figerait la physique de la
    // balle pour tous les ticks suivants (voir checkWinCondition()).
    // Fait bouger la raquette sur plusieurs ticks pour lui donner une
    // vitesse réelle (paddle.vx), sans jamais toucher la balle.
    for (let i = 0; i < 5; i++) {
      tick(s, 16, noInput({ pointerX: ARENA_W / 2 + direction * i * 20 }));
    }
    const p = s.paddle;
    // Balle pile au centre de la raquette (offset=0) au moment de l'impact.
    const centerX = p.x + p.w / 2;
    s.balls = [{ x: centerX, y: p.y - 5, vx: 0, vy: 300, r: 6, launched: true, perforateUntil: 0 }];
    // Dernier tick avec un pas de temps minuscule : la raquette continue à
    // EXACTEMENT la même vitesse (paddle.vx recalculé = déplacement/dt,
    // donc un dt minuscule + un déplacement proportionnellement minuscule
    // donne la même vitesse) mais ne se déplace presque plus en position --
    // ce qui isole l'effet de la vitesse SANS réintroduire un vrai décalage
    // de position (qui, lui, changerait aussi l'angle par le point d'impact
    // et fausserait ce test précis). Un dt normal ferait bouger la raquette
    // d'assez pour sortir la balle du centre et mélanger les deux causes.
    const velocity = 1250; // même vitesse que celle établie par le warmup ci-dessus
    const tinyDtMs = 1;
    const lastWarmupTarget = ARENA_W / 2 + direction * 4 * 20;
    const tinyDelta = velocity * (tinyDtMs / 1000) * direction;
    tick(s, tinyDtMs, noInput({ pointerX: lastWarmupTarget + tinyDelta }));
    return s.balls[0];
  }
  const right = bounceWithPaddleMotion(1);
  const left = bounceWithPaddleMotion(-1);
  assert.ok(right.vx > 0, "raquette en mouvement vers la droite -> dévie vers la droite même à impact centré");
  assert.ok(left.vx < 0, "raquette en mouvement vers la gauche -> dévie vers la gauche même à impact centré");
  assert.ok(right.vy < 0 && left.vy < 0, "le renvoi reste toujours vers le haut");
});

test("la vitesse de la balle reste constante même avec un renvoi dévié par effet de raquette", () => {
  const s = createLevelState(0);
  s.status = "playing";
  for (let i = 0; i < 5; i++) tick(s, 16, noInput({ pointerX: ARENA_W / 2 + i * 20 }));
  const p = s.paddle;
  const centerX = p.x + p.w / 2;
  s.balls = [{ x: centerX, y: p.y - 5, vx: 0, vy: 300, r: 6, launched: true, perforateUntil: 0 }];
  const before = Math.hypot(s.balls[0].vx, s.balls[0].vy);
  tick(s, 16, noInput({ pointerX: ARENA_W / 2 + 5 * 20 }));
  const after = Math.hypot(s.balls[0].vx, s.balls[0].vy);
  assert.ok(Math.abs(after - before) < 1e-6, `vitesse dérivée par l'effet: ${before} -> ${after}`);
});

test("l'effet de raquette ne peut jamais produire un renvoi quasi-horizontal", () => {
  const s = createLevelState(0);
  s.status = "playing";
  // Fait bouger la raquette vers la droite sur plusieurs ticks à la vitesse
  // maximale plausible (voir PADDLE_SPEED_LIMIT), pour lui donner une vraie
  // vitesse importante -- movePaddle() recalcule paddle.vx à CHAQUE tick à
  // partir du déplacement réel, donc l'affecter directement serait écrasé.
  const stepPerTick = (PADDLE_SPEED_LIMIT * 16) / 1000; // déplacement/tick pour atteindre ~PADDLE_SPEED_LIMIT
  for (let i = 0; i < 4; i++) {
    tick(s, 16, noInput({ pointerX: ARENA_W / 2 + i * stepPerTick }));
  }
  // Prédit la position de la raquette APRÈS le prochain tick (celui de la
  // collision), pour placer la balle au bord extrême de cette position
  // future -- movePaddle() bouge la raquette AVANT que stepBall() ne teste
  // la collision, dans le même tick.
  const p = s.paddle;
  const nextTarget = ARENA_W / 2 + 4 * stepPerTick;
  const nextX = Math.max(0, Math.min(ARENA_W - p.w, nextTarget - p.w / 2));
  const hitX = nextX + p.w - 1;
  s.balls = [{ x: hitX, y: p.y - 5, vx: 0, vy: 300, r: 6, launched: true, perforateUntil: 0 }];
  tick(s, 16, noInput({ pointerX: nextTarget }));
  const ball = s.balls[0];
  const angleFromVerticalDeg = (Math.atan2(Math.abs(ball.vx), -ball.vy) * 180) / Math.PI;
  assert.ok(
    angleFromVerticalDeg <= MAX_TOTAL_BOUNCE_ANGLE_DEG + 0.5,
    `angle ${angleFromVerticalDeg.toFixed(1)}° dépasse le plafond ${MAX_TOTAL_BOUNCE_ANGLE_DEG}°`
  );
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
