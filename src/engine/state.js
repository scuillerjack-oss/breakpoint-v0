import {
  ARENA_W,
  ARENA_H,
  BRICK_COL_W,
  BRICK_ROW_H,
  BRICK_TOP_Y,
  BRICK_MARGIN,
  PADDLE_W,
  PADDLE_Y,
  PADDLE_H,
  BALL_R,
  BALL_BASE_SPEED,
} from "./constants.js";
import { LEVELS, buildBricksForLevel } from "./levels.js";

export function brickRect(brick) {
  return {
    x: brick.col * BRICK_COL_W + BRICK_MARGIN,
    y: BRICK_TOP_Y + brick.row * BRICK_ROW_H,
    w: BRICK_COL_W - BRICK_MARGIN * 2,
    h: BRICK_ROW_H - BRICK_MARGIN * 2,
  };
}

function freshBall(paddleX) {
  return {
    x: paddleX,
    y: PADDLE_Y - BALL_R - 1,
    vx: 0,
    vy: 0,
    r: BALL_R,
    launched: false,
    perforateUntil: 0,
  };
}

export function createLevelState(levelIndex, carry = {}) {
  const level = LEVELS[levelIndex];
  const paddleX = ARENA_W / 2 - PADDLE_W / 2;
  return {
    arena: { w: ARENA_W, h: ARENA_H },
    levelIndex,
    levelId: level.id,
    levelName: level.name,
    status: "ready", // ready -> playing -> (paused) -> won | lost
    paddle: { x: paddleX, w: PADDLE_W, h: PADDLE_H, y: PADDLE_Y, targetX: ARENA_W / 2, xlUntil: 0, vx: 0 },
    balls: [freshBall(paddleX + PADDLE_W / 2)],
    bricks: buildBricksForLevel(level),
    powerUps: [],
    lasers: [],
    effects: { laserUntil: 0, laserCooldownUntil: 0 },
    // V6 : une seule vie gratuite par tentative (cahier des charges V6,
    // section "vies/rewarded") -- remplace les 3 vies conservées entre
    // niveaux de V0-V5. Une continuation rewarded (voir grantContinuation
    // ci-dessous) est la SEULE façon d'en obtenir une de plus au sein d'une
    // même tentative.
    lives: carry.lives ?? 1,
    score: carry.score ?? 0,
    elapsedMs: 0,
    events: [],
  };
}

export function createInitialState() {
  return createLevelState(0, { lives: 1, score: 0 });
}

// V6 : accorde une continuation (rewarded, volontaire -- voir cahier des
// charges V6 et src/engine/monetization.js pour le plafond par niveau).
// Symétrique de handleLifeLost() (simulation.js) : même respawn de balle,
// mais AJOUTE une vie et ne vérifie jamais un plafond ici (le plafond est
// une décision de PRODUIT, prise par l'appelant via
// monetization.canOfferRewardedContinue -- cette fonction se contente
// d'exécuter la continuation déjà autorisée). Ne touche jamais aux briques
// déjà détruites ni au score : la progression de la tentative en cours est
// intégralement conservée, seule la balle est relancée.
export function grantContinuation(state) {
  state.lives += 1;
  const p = state.paddle;
  state.balls = [freshBall(p.x + p.w / 2)];
  state.status = "ready";
}
