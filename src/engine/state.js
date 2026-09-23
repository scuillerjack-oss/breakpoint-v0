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
    lives: carry.lives ?? 3,
    score: carry.score ?? 0,
    elapsedMs: 0,
    events: [],
  };
}

export function createInitialState() {
  return createLevelState(0, { lives: 3, score: 0 });
}
