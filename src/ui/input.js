import { computeViewport, screenToArena } from "./viewport.js";

// Contrôle tactile : la raquette doit suivre le doigt directement, sans
// aucun lissage/lerp ajouté ici (voir movePaddle() dans simulation.js, qui
// applique la position cible telle quelle, sans retard). pointerdown sert
// à la fois de "lancer la balle" (si le niveau attend un lancer) et de
// "tirer" (si le laser est actif) — un seul geste tactile couvre les deux,
// jamais un bouton séparé qui casserait l'immédiateté.
export function createInputController(canvas) {
  let pointerX = null;
  let pointerDown = false;
  let launchRequested = false;
  let viewport = computeViewport(canvas.width, canvas.height);

  function updateViewport() {
    viewport = computeViewport(canvas.width, canvas.height);
  }

  function handlePointer(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    // getBoundingClientRect() est en pixels CSS, canvas.width/height en
    // pixels réels (backing store, voir main.js) : on convertit d'abord la
    // position en pixels CSS relatifs au canvas, PUIS on passe à l'échelle
    // du backing store, avant d'appliquer viewport (qui, lui, est déjà
    // exprimé en pixels de backing store).
    const cssScale = canvas.width / rect.width;
    const localBackingX = (clientX - rect.left) * cssScale;
    const localBackingY = (clientY - rect.top) * cssScale;
    const arenaPoint = screenToArena(localBackingX, localBackingY, { left: 0, top: 0 }, viewport);
    pointerX = arenaPoint.x;
  }

  canvas.addEventListener(
    "pointerdown",
    (e) => {
      pointerDown = true;
      launchRequested = true;
      handlePointer(e.clientX, e.clientY);
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    { passive: false }
  );
  canvas.addEventListener(
    "pointermove",
    (e) => {
      if (e.buttons === 0 && e.pointerType === "mouse") return;
      handlePointer(e.clientX, e.clientY);
      e.preventDefault();
    },
    { passive: false }
  );
  window.addEventListener("pointerup", () => {
    pointerDown = false;
  });
  window.addEventListener("pointercancel", () => {
    pointerDown = false;
  });

  return {
    updateViewport,
    getViewport: () => viewport,
    sample() {
      return { pointerX, pointerDown };
    },
    consumeLaunch() {
      if (!launchRequested) return false;
      launchRequested = false;
      return true;
    },
  };
}
