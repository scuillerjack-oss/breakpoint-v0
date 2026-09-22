// Boucle de simulation, à pas de temps fixe (voir src/ui/main.js pour
// l'accumulateur qui appelle tick() avec un dtMs constant) — jamais un
// dt variable dépendant du framerate réel, pour que la physique reste
// déterministe et testable indépendamment du rendu.
import { sweptAABB, aabbFromCircle } from "./collision.js";
import { reflect } from "./vec2.js";
import { brickRect } from "./state.js";
import {
  ARENA_W,
  ARENA_H,
  PADDLE_W,
  PADDLE_XL_W,
  BALL_BASE_SPEED,
  MAX_PADDLE_BOUNCE_ANGLE_DEG,
  MAX_SUBSTEPS_PER_TICK,
  POWERUP_W,
  POWERUP_H,
  POWERUP_FALL_SPEED,
  POWERUP_DROP_CHANCE,
  POWERUP_KINDS,
  XL_PADDLE_DURATION_MS,
  LASER_DURATION_MS,
  PERFORATE_DURATION_MS,
  LASER_COOLDOWN_MS,
  LASER_SPEED,
  LASER_W,
  LASER_H,
} from "./constants.js";

function getColliders(state) {
  const BIG = 4000;
  const list = [
    { kind: "wall", rect: { minX: -BIG, minY: -BIG, maxX: 0, maxY: state.arena.h + BIG } },
    { kind: "wall", rect: { minX: state.arena.w, minY: -BIG, maxX: state.arena.w + BIG, maxY: state.arena.h + BIG } },
    { kind: "wall", rect: { minX: -BIG, minY: -BIG, maxX: state.arena.w + BIG, maxY: 0 } },
  ];
  const p = state.paddle;
  list.push({ kind: "paddle", rect: { minX: p.x, minY: p.y, maxX: p.x + p.w, maxY: p.y + p.h } });
  for (const b of state.bricks) {
    if (!b.alive) continue;
    const r = brickRect(b);
    list.push({ kind: "brick", brick: b, rect: { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h } });
  }
  return list;
}

function damageBrick(state, brick) {
  brick.hp -= 1;
  if (brick.hp <= 0) {
    brick.alive = false;
    state.score += 10 * brick.maxHp;
    state.events.push({ type: "brick_destroyed", id: brick.id });
    maybeDropPowerUp(state, brick);
  } else {
    state.events.push({ type: "brick_hit", id: brick.id, hp: brick.hp });
  }
}

function maybeDropPowerUp(state, brick) {
  if (Math.random() > POWERUP_DROP_CHANCE) return;
  const bias = state.powerUpBias || {};
  const pool = [];
  for (const kind of POWERUP_KINDS) {
    const weight = bias[kind] ?? 1;
    for (let i = 0; i < weight; i++) pool.push(kind);
  }
  const kind = pool[Math.floor(Math.random() * pool.length)];
  const r = brickRect(brick);
  state.powerUps.push({
    kind,
    x: r.x + r.w / 2 - POWERUP_W / 2,
    y: r.y,
    w: POWERUP_W,
    h: POWERUP_H,
    alive: true,
  });
}

function applyPowerUp(state, kind) {
  state.events.push({ type: "powerup_collected", kind });
  if (kind === "paddle_xl") {
    state.paddle.xlUntil = state.elapsedMs + XL_PADDLE_DURATION_MS;
  } else if (kind === "laser") {
    state.effects.laserUntil = state.elapsedMs + LASER_DURATION_MS;
  } else if (kind === "perforate") {
    for (const ball of state.balls) {
      if (ball.launched) ball.perforateUntil = state.elapsedMs + PERFORATE_DURATION_MS;
    }
  } else if (kind === "multiball") {
    const reference = state.balls.find((b) => b.launched) || state.balls[0];
    if (reference) {
      const spawnAngleOffsets = [-25, 25];
      for (const deg of spawnAngleOffsets) {
        const speed = Math.hypot(reference.vx, reference.vy) || BALL_BASE_SPEED;
        const baseAngle = Math.atan2(reference.vx, -reference.vy);
        const rad = (deg * Math.PI) / 180;
        const angle = baseAngle + rad;
        state.balls.push({
          x: reference.x,
          y: reference.y,
          r: reference.r,
          vx: speed * Math.sin(angle),
          vy: -speed * Math.cos(angle),
          launched: true,
          perforateUntil: reference.perforateUntil,
        });
      }
    }
  }
}

function movePaddle(state, input) {
  const p = state.paddle;
  p.w = state.elapsedMs < p.xlUntil ? PADDLE_XL_W : PADDLE_W;
  if (input.pointerX != null) {
    p.targetX = input.pointerX;
  }
  let x = p.targetX - p.w / 2;
  x = Math.max(0, Math.min(ARENA_W - p.w, x));
  p.x = x;
}

function launchBalls(state) {
  for (const ball of state.balls) {
    if (ball.launched) continue;
    const angleDeg = 15; // fixe et déterministe : jamais un lancer aléatoire non reproductible
    const rad = (angleDeg * Math.PI) / 180;
    ball.vx = BALL_BASE_SPEED * Math.sin(rad);
    ball.vy = -BALL_BASE_SPEED * Math.cos(rad);
    ball.launched = true;
  }
}

// Résout le déplacement d'UNE balle sur tout le pas de temps dt (secondes),
// en consommant le budget de temps par sous-pas successifs à chaque
// collision rencontrée (jusqu'à MAX_SUBSTEPS_PER_TICK) : c'est ce qui gère
// correctement "plusieurs collisions qui surviennent rapidement" (cahier des
// charges, section 2) dans un seul appel à tick(), sans jamais laisser la
// balle traverser un obstacle (tunneling) ni se retrouver "collée" dedans.
function stepBall(state, ball, dt) {
  let remaining = dt;
  let { x, y, vx, vy } = ball;
  let iterations = 0;

  while (remaining > 1e-7 && iterations < MAX_SUBSTEPS_PER_TICK) {
    iterations++;
    const displacement = { x: vx * remaining, y: vy * remaining };
    const movingBox = aabbFromCircle(x, y, ball.r);

    let best = null;
    for (const collider of getColliders(state)) {
      if (collider.kind === "brick" && ball.perforateUntil > state.elapsedMs) {
        // Balle perforante : on détecte quand même le contact (pour détruire
        // la brique) mais on NE remplace jamais la trajectoire par une
        // réflexion — voir plus bas, cas "perforating".
      }
      const result = sweptAABB(movingBox, displacement, collider.rect);
      if (result.collided && (!best || result.entryTime < best.entryTime)) {
        best = { ...result, collider };
      }
    }

    if (!best) {
      x += displacement.x;
      y += displacement.y;
      remaining = 0;
      break;
    }

    x += displacement.x * best.entryTime;
    y += displacement.y * best.entryTime;
    remaining = remaining * (1 - best.entryTime);

    const perforating = best.collider.kind === "brick" && ball.perforateUntil > state.elapsedMs;

    if (perforating) {
      damageBrick(state, best.collider.brick);
      // La vitesse ne change pas : la balle continue tout droit à travers.
      // On avance la position d'un epsilon pour ne pas redétecter la même
      // brique déjà détruite au sous-pas suivant.
      x += vx === 0 ? 0 : Math.sign(vx) * 0.01;
      y += vy === 0 ? 0 : Math.sign(vy) * 0.01;
      continue;
    }

    if (best.collider.kind === "paddle") {
      const p = state.paddle;
      const centerX = p.x + p.w / 2;
      let offset = (x - centerX) / (p.w / 2);
      offset = Math.max(-1, Math.min(1, offset));
      const maxAngle = (MAX_PADDLE_BOUNCE_ANGLE_DEG * Math.PI) / 180;
      const angle = offset * maxAngle;
      const speed = Math.hypot(vx, vy);
      vx = speed * Math.sin(angle);
      vy = -speed * Math.cos(angle);
    } else {
      const nv = reflect({ x: vx, y: vy }, best.normal);
      vx = nv.x;
      vy = nv.y;
      if (best.collider.kind === "brick") {
        damageBrick(state, best.collider.brick);
      }
    }
    // Correction positionnelle : repousse la balle HORS de la boîte
    // heurtée, jamais d'un simple epsilon fixe. Un epsilon fixe suffit pour
    // un contact tangent normal, mais pas si la balle s'est retrouvée plus
    // profondément embarquée dans l'obstacle (jamais censé arriver en jeu
    // normal, mais une correction positionnelle réelle — au lieu d'un
    // epsilon — élimine complètement la classe de bug "balle collée qui
    // oscille indéfiniment sans jamais ressortir", quelle qu'en soit la
    // cause. Math.max/min : ne repousse que si nécessaire, ne pousse
    // jamais la balle plus profondément.
    const rect = best.collider.rect;
    if (best.normal.x > 0) x = Math.max(x, rect.maxX + ball.r + 0.01);
    else if (best.normal.x < 0) x = Math.min(x, rect.minX - ball.r - 0.01);
    if (best.normal.y > 0) y = Math.max(y, rect.maxY + ball.r + 0.01);
    else if (best.normal.y < 0) y = Math.min(y, rect.minY - ball.r - 0.01);
  }

  ball.x = x;
  ball.y = y;
  ball.vx = vx;
  ball.vy = vy;

  if (ball.y - ball.r > state.arena.h) {
    ball.alive = false;
    state.events.push({ type: "ball_lost" });
  }
}

function stepPowerUpsFalling(state, dt) {
  const p = state.paddle;
  const paddleRect = { minX: p.x, minY: p.y, maxX: p.x + p.w, maxY: p.y + p.h };
  for (const pu of state.powerUps) {
    if (!pu.alive) continue;
    pu.y += POWERUP_FALL_SPEED * dt;
    const puRect = { minX: pu.x, minY: pu.y, maxX: pu.x + pu.w, maxY: pu.y + pu.h };
    const overlap =
      puRect.minX < paddleRect.maxX &&
      puRect.maxX > paddleRect.minX &&
      puRect.minY < paddleRect.maxY &&
      puRect.maxY > paddleRect.minY;
    if (overlap) {
      pu.alive = false;
      applyPowerUp(state, pu.kind);
    } else if (pu.y > state.arena.h) {
      pu.alive = false;
    }
  }
  state.powerUps = state.powerUps.filter((pu) => pu.alive);
}

function stepLasers(state, dt, input) {
  const canFire =
    state.effects.laserUntil > state.elapsedMs &&
    state.elapsedMs >= (state.effects.laserCooldownUntil || 0);
  if (input.fire && canFire) {
    const p = state.paddle;
    state.lasers.push({ x: p.x + p.w / 2 - LASER_W / 2, y: p.y - LASER_H, w: LASER_W, h: LASER_H, alive: true });
    state.effects.laserCooldownUntil = state.elapsedMs + LASER_COOLDOWN_MS;
  }

  for (const laser of state.lasers) {
    if (!laser.alive) continue;
    const displacement = { x: 0, y: -LASER_SPEED * dt };
    const movingBox = { minX: laser.x, minY: laser.y, maxX: laser.x + laser.w, maxY: laser.y + laser.h };
    let best = null;
    for (const b of state.bricks) {
      if (!b.alive) continue;
      const r = brickRect(b);
      const rect = { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h };
      const result = sweptAABB(movingBox, displacement, rect);
      if (result.collided && (!best || result.entryTime < best.entryTime)) {
        best = { ...result, brick: b };
      }
    }
    if (best) {
      laser.y += displacement.y * best.entryTime;
      damageBrick(state, best.brick);
      laser.alive = false;
    } else {
      laser.y += displacement.y;
      if (laser.y + laser.h < 0) laser.alive = false;
    }
  }
  state.lasers = state.lasers.filter((l) => l.alive);
}

function handleLifeLost(state) {
  state.lives -= 1;
  state.events.push({ type: "life_lost", livesRemaining: state.lives });
  if (state.lives <= 0) {
    state.status = "lost";
    return;
  }
  const p = state.paddle;
  state.balls = [
    { x: p.x + p.w / 2, y: p.y - 8, vx: 0, vy: 0, r: state.balls[0]?.r ?? 6, launched: false, perforateUntil: 0 },
  ];
  state.status = "ready";
}

function checkWinCondition(state) {
  if (state.bricks.some((b) => b.alive)) return;
  state.status = "won";
  state.events.push({ type: "level_won" });
}

/**
 * @param {object} state état muté en place (voir createLevelState)
 * @param {number} dtMs pas de temps FIXE (voir l'accumulateur dans main.js)
 * @param {{pointerX:?number, launchRequested:boolean, fire:boolean}} input
 */
export function tick(state, dtMs, input) {
  state.events = [];
  movePaddle(state, input);

  if (state.status === "ready") {
    if (input.launchRequested) {
      launchBalls(state);
      state.status = "playing";
    }
    return state;
  }

  if (state.status !== "playing") {
    return state;
  }

  const dt = dtMs / 1000;
  stepLasers(state, dt, input);
  stepPowerUpsFalling(state, dt);
  for (const ball of state.balls) {
    if (ball.launched) stepBall(state, ball, dt);
  }
  state.balls = state.balls.filter((b) => b.alive !== false);

  if (state.balls.length === 0) {
    handleLifeLost(state);
  } else {
    checkWinCondition(state);
  }

  state.elapsedMs += dtMs;
  return state;
}
