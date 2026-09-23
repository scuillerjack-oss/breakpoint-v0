import { ARENA_W, ARENA_H } from "../engine/constants.js";

// Réserve verticale (en pixels de backing store, même espace que
// canvasW/canvasH) tenue à l'écart du bas réel de l'écran -- safe-area de
// l'appareil (encoche/barre de geste) + marge ergonomique fixe pour le
// pouce (cahier des charges V1, section 5 : "logique responsive liée au
// viewport/safe area, pas un correctif propre à un téléphone"). Définie par
// main.js via setSafeAreaReserve() à chaque redimensionnement ; un module-
// level ici évite de changer la signature de computeViewport() partout où
// elle est déjà appelée (input.js, render.js).
let reserveBottomPx = 0;
export function setSafeAreaReserve(px) {
  reserveBottomPx = Math.max(0, px);
}

// Mise à l'échelle "contain" : le terrain logique (400x700) est toujours
// affiché en entier, jamais déformé ni recadré de façon imprévisible —
// centré dans l'espace utile du canvas réel (canvas moins la réserve de
// bas d'écran), quel que soit le ratio de l'écran. L'espace de jeu
// briques/balle n'est jamais réduit par cette réserve : seule la marge vide
// sous la raquette (voir PADDLE_Y) se redistribue entre le safe-area et le
// reste de l'écran.
export function computeViewport(canvasW, canvasH) {
  const availableH = Math.max(0, canvasH - reserveBottomPx);
  const scale = Math.min(canvasW / ARENA_W, availableH / ARENA_H);
  const w = ARENA_W * scale;
  const h = ARENA_H * scale;
  const offsetX = (canvasW - w) / 2;
  const offsetY = (availableH - h) / 2;
  return { scale, offsetX, offsetY, w, h };
}

export function screenToArena(clientX, clientY, canvasRect, viewport) {
  const localX = clientX - canvasRect.left - viewport.offsetX;
  const localY = clientY - canvasRect.top - viewport.offsetY;
  return { x: localX / viewport.scale, y: localY / viewport.scale };
}
