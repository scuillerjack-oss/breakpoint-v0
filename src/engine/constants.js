// Espace logique du terrain de jeu, indépendant des pixels réels de l'écran
// (voir src/ui/render.js pour la mise à l'échelle "contain" responsive).
export const ARENA_W = 400;
export const ARENA_H = 700;

export const WALL_THICKNESS = 8;

export const BRICK_COLS = 10;
export const BRICK_COL_W = ARENA_W / BRICK_COLS; // 40
export const BRICK_MARGIN = 2;
export const BRICK_W = BRICK_COL_W - BRICK_MARGIN * 2;
export const BRICK_H = 16;
export const BRICK_ROW_H = BRICK_H + BRICK_MARGIN * 2;
export const BRICK_TOP_Y = 70;

export const PADDLE_W = 72;
export const PADDLE_XL_W = 116;
export const PADDLE_H = 14;
export const PADDLE_Y = ARENA_H - 46;
export const PADDLE_SPEED_LIMIT = 1400; // unités/s max, évite un snap infini si le doigt saute

export const BALL_R = 6;
export const BALL_BASE_SPEED = 340; // unités/s, vitesse constante hors power-up

export const MAX_PADDLE_BOUNCE_ANGLE_DEG = 60;

export const POWERUP_W = 28;
export const POWERUP_H = 16;
export const POWERUP_FALL_SPEED = 160;
export const POWERUP_DROP_CHANCE = 0.22;

export const XL_PADDLE_DURATION_MS = 12000;
export const LASER_DURATION_MS = 9000;
export const PERFORATE_DURATION_MS = 7000;
export const LASER_COOLDOWN_MS = 320;
export const LASER_SPEED = 700;
export const LASER_W = 4;
export const LASER_H = 14;

export const MAX_SUBSTEPS_PER_TICK = 8;

export const POWERUP_KINDS = ["multiball", "paddle_xl", "laser", "perforate"];
