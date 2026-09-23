import { ARENA_W, ARENA_H, BRICK_ROW_H } from "../engine/constants.js";
import { brickRect } from "../engine/state.js";
import { computeViewport } from "./viewport.js";

const BRICK_COLORS = {
  1: { fill: "#3ad6c7", edge: "#1f8f85" },
  2: { fill: "#f2a341", edge: "#b3701f" },
  3: { fill: "#ef4f7a", edge: "#a4224a" },
};

// V1 : remplace les cases à lettres par des pictogrammes reconnaissables
// sans lecture obligatoire (cahier des charges V1, section 6) -- la lettre
// reste présente mais seulement en petit repère secondaire (accessibilité),
// jamais tout le visuel. Même palette et mêmes couleurs par bonus qu'en V0
// (dark/néon), aucune dépendance graphique externe : tout est dessiné au
// tracé Canvas 2D, à la même échelle que la case (POWERUP_W/H inchangés).
const POWERUP_COLORS = {
  multiball: "#7ad1ff",
  paddle_xl: "#8affa0",
  laser: "#ff8a65",
  perforate: "#e0a8ff",
};
const POWERUP_LETTERS = { multiball: "M", paddle_xl: "X", laser: "L", perforate: "P" };

function drawPowerUpIcon(ctx, kind, cx, cy) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = "#0a0a16";
  ctx.strokeStyle = "#0a0a16";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (kind === "multiball") {
    // Trois petites balles : lisible instantanément comme "plusieurs balles".
    const r = 2.1;
    for (const dx of [-7, 0, 7]) {
      ctx.beginPath();
      ctx.arc(dx, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "paddle_xl") {
    // Barre centrale + chevrons vers l'extérieur : évoque l'élargissement.
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-4.5, 0);
    ctx.lineTo(4.5, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-6, -3.2);
    ctx.lineTo(-10, 0);
    ctx.lineTo(-6, 3.2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(6, -3.2);
    ctx.lineTo(10, 0);
    ctx.lineTo(6, 3.2);
    ctx.closePath();
    ctx.fill();
  } else if (kind === "laser") {
    // Petite fusée pointant vers le haut (tire vers le haut, comme le laser).
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(3, 1.5);
    ctx.lineTo(1.4, 1.5);
    ctx.lineTo(1.4, 4.2);
    ctx.lineTo(-1.4, 4.2);
    ctx.lineTo(-1.4, 1.5);
    ctx.lineTo(-3, 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-3, 1.5);
    ctx.lineTo(-5.6, 4.2);
    ctx.lineTo(-1.4, 4.2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(3, 1.5);
    ctx.lineTo(5.6, 4.2);
    ctx.lineTo(1.4, 4.2);
    ctx.closePath();
    ctx.fill();
  } else if (kind === "perforate") {
    // Anneau traversé par une flèche : évoque la perforation à travers un obstacle.
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(6.5, 0);
    ctx.moveTo(6.5, 0);
    ctx.lineTo(3.5, -2.4);
    ctx.moveTo(6.5, 0);
    ctx.lineTo(3.5, 2.4);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawFrame(ctx, canvasW, canvasH, state, trail) {
  const viewport = computeViewport(canvasW, canvasH);
  ctx.save();
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Fond rétro sobre : dégradé sombre + quelques lignes de grille discrètes,
  // jamais un décor chargé qui distrairait de la balle/des briques.
  const bg = ctx.createLinearGradient(0, 0, 0, canvasH);
  bg.addColorStop(0, "#141426");
  bg.addColorStop(1, "#0a0a16");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.translate(viewport.offsetX, viewport.offsetY);
  ctx.scale(viewport.scale, viewport.scale);

  // Cadre du terrain.
  ctx.strokeStyle = "rgba(122,209,255,0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, ARENA_W - 2, ARENA_H - 2);

  // Briques.
  for (const brick of state.bricks) {
    if (!brick.alive) continue;
    const r = brickRect(brick);
    const colors = BRICK_COLORS[Math.min(3, brick.maxHp)] || BRICK_COLORS[1];
    ctx.fillStyle = colors.fill;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = colors.edge;
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    // État visuel immédiatement compréhensible pour les briques renforcées :
    // un impact déjà pris se voit à un liseré plus terne, jamais un simple
    // chiffre illisible à cette échelle.
    if (brick.hp < brick.maxHp) {
      ctx.fillStyle = "rgba(10,10,20,0.35)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }

  // Power-ups qui tombent.
  for (const pu of state.powerUps) {
    const color = POWERUP_COLORS[pu.kind] || "#fff";
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(pu.x, pu.y, pu.w, pu.h, 6);
    ctx.fill();
    drawPowerUpIcon(ctx, pu.kind, pu.x + pu.w / 2, pu.y + pu.h / 2);
    // Lettre secondaire, petite et discrète (accessibilité) -- jamais tout
    // le visuel, voir cahier des charges V1 section 6.
    ctx.fillStyle = "rgba(10,10,20,0.55)";
    ctx.font = "bold 6.5px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(POWERUP_LETTERS[pu.kind] || "?", pu.x + pu.w - 2, pu.y + pu.h - 1);
  }

  // Tirs laser.
  ctx.fillStyle = "#ff5252";
  for (const laser of state.lasers) {
    ctx.fillRect(laser.x, laser.y, laser.w, laser.h);
  }

  // Raquette.
  const p = state.paddle;
  const paddleGrad = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
  paddleGrad.addColorStop(0, "#8be9fd");
  paddleGrad.addColorStop(1, "#4fa8c9");
  ctx.fillStyle = paddleGrad;
  ctx.beginPath();
  ctx.roundRect(p.x, p.y, p.w, p.h, 5);
  ctx.fill();

  // Traînée discrète de la balle (jamais assez marquée pour gêner la
  // lecture de sa position réelle).
  if (trail && trail.length > 1) {
    for (let i = 0; i < trail.length; i++) {
      const t = i / trail.length;
      ctx.globalAlpha = t * 0.35;
      ctx.fillStyle = "#fff59d";
      ctx.beginPath();
      ctx.arc(trail[i].x, trail[i].y, trail[i].r * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Balles.
  for (const ball of state.balls) {
    ctx.fillStyle = "#fff59d";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    if (ball.perforateUntil > state.elapsedMs) {
      ctx.strokeStyle = "#e0a8ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.restore();
  return viewport;
}
