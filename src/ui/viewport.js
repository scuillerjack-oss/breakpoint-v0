import { ARENA_W, ARENA_H } from "../engine/constants.js";

// Mise à l'échelle "contain" : le terrain logique (400x700) est toujours
// affiché en entier, jamais déformé ni recadré de façon imprévisible —
// centré dans le canvas réel, quel que soit le ratio de l'écran.
export function computeViewport(canvasW, canvasH) {
  const scale = Math.min(canvasW / ARENA_W, canvasH / ARENA_H);
  const w = ARENA_W * scale;
  const h = ARENA_H * scale;
  const offsetX = (canvasW - w) / 2;
  const offsetY = (canvasH - h) / 2;
  return { scale, offsetX, offsetY, w, h };
}

export function screenToArena(clientX, clientY, canvasRect, viewport) {
  const localX = clientX - canvasRect.left - viewport.offsetX;
  const localY = clientY - canvasRect.top - viewport.offsetY;
  return { x: localX / viewport.scale, y: localY / viewport.scale };
}
