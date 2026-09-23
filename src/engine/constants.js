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
// V1 : remontée depuis ARENA_H-46 -- retour bêta réelle, le pouce masquait la
// raquette. Ceci agrandit seulement la marge vide sous la raquette (aucune
// brique n'occupe jamais cette zone, voir BRICK_TOP_Y et le nombre de
// rangées par niveau) : l'espace de jeu briques/balle n'est pas réduit. Voir
// aussi viewport.js pour la réserve additionnelle liée au safe-area réel de
// l'appareil (encoche/barre de geste), gérée séparément et de façon
// responsive plutôt que par une valeur figée pour un téléphone précis.
export const PADDLE_Y = ARENA_H - 90;
export const PADDLE_SPEED_LIMIT = 1400; // unités/s max, évite un snap infini si le doigt saute

export const BALL_R = 6;
export const BALL_BASE_SPEED = 340; // unités/s, vitesse constante hors power-up

export const MAX_PADDLE_BOUNCE_ANGLE_DEG = 60;
// "Effet" (English) : une raquette qui bouge au moment de l'impact dévie la
// balle en plus de l'angle donné par le point d'impact -- voir simulation.js,
// stepBall(), cas "paddle". Sans cela, un joueur qui suit simplement la balle
// (impact quasi centré, offset≈0) ne fait jamais varier l'angle, et comme les
// murs/briques ne font QUE réfléchir en miroir (angle inchangé, voir
// reflect()), la balle peut rester piégée dans une trajectoire répétitive qui
// ne balaie jamais certaines briques (cause racine du niveau 1 bloqué en V0 --
// voir le rapport technique V1).
export const MAX_PADDLE_ENGLISH_ANGLE_DEG = 20;
export const MAX_TOTAL_BOUNCE_ANGLE_DEG = 80; // évite un renvoi quasi-horizontal absurde

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
