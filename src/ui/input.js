import { computeViewport, screenToArena } from "./viewport.js";
import { createRelativeTouchState, beginTouch, moveTouch, endTouch } from "./relative-touch.js";
import { ARENA_W, PADDLE_W } from "../engine/constants.js";

// Contrôle tactile RELATIF type trackpad (cahier des charges V1, section 4) :
// le toucher initial ne déplace jamais la raquette, seul le glissement la
// déplace ensuite relativement au point de référence (doigt + raquette)
// mémorisé au moment du toucher -- voir relative-touch.js pour la logique
// pure (testée indépendamment du DOM) et sa justification complète.
// pointerdown sert à la fois de "lancer la balle" (si le niveau attend un
// lancer) et de "tirer" (si le laser est actif) — un seul geste tactile
// couvre les deux, jamais un bouton séparé qui casserait l'immédiateté.
export function createInputController(canvas) {
  let pointerDown = false;
  let launchRequested = false;
  let viewport = computeViewport(canvas.width, canvas.height);
  // Dernière position connue du centre de la raquette, fournie par main.js
  // à chaque frame (voir setPaddleCenterX) : sert UNIQUEMENT à fixer la
  // référence au moment précis d'un nouveau toucher, jamais en continu --
  // après ça, c'est le glissement relatif qui pilote la cible, pas l'état
  // réel de la raquette (voir moveTouch()).
  let knownPaddleCenterX = ARENA_W / 2;
  const touch = createRelativeTouchState(knownPaddleCenterX);

  function updateViewport() {
    viewport = computeViewport(canvas.width, canvas.height);
  }

  function arenaXFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    // getBoundingClientRect() est en pixels CSS, canvas.width/height en
    // pixels réels (backing store, voir main.js) : on convertit d'abord la
    // position en pixels CSS relatifs au canvas, PUIS on passe à l'échelle
    // du backing store, avant d'appliquer viewport (qui, lui, est déjà
    // exprimé en pixels de backing store).
    const cssScale = canvas.width / rect.width;
    const localBackingX = (clientX - rect.left) * cssScale;
    const localBackingY = (clientY - rect.top) * cssScale;
    return screenToArena(localBackingX, localBackingY, { left: 0, top: 0 }, viewport).x;
  }

  // Bornes du CENTRE de la raquette. Utilise la largeur de base (pas la
  // largeur XL) : une borne légèrement plus prudente que nécessaire pendant
  // un power-up raquette XL n'est jamais un bug perceptible (juste une
  // marge de sécurité), alors que l'inverse laisserait la logique de
  // ré-ancrage se déclencher trop tard. La simulation applique de toute
  // façon son propre clamp final avec la largeur réelle (voir movePaddle()).
  const minCenterX = PADDLE_W / 2;
  const maxCenterX = ARENA_W - PADDLE_W / 2;

  canvas.addEventListener(
    "pointerdown",
    (e) => {
      pointerDown = true;
      launchRequested = true;
      const arenaX = arenaXFromClient(e.clientX, e.clientY);
      beginTouch(touch, arenaX, knownPaddleCenterX);
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    { passive: false }
  );
  canvas.addEventListener(
    "pointermove",
    (e) => {
      if (e.buttons === 0 && e.pointerType === "mouse") return;
      const arenaX = arenaXFromClient(e.clientX, e.clientY);
      moveTouch(touch, arenaX, minCenterX, maxCenterX);
      e.preventDefault();
    },
    { passive: false }
  );
  window.addEventListener("pointerup", () => {
    pointerDown = false;
    endTouch(touch);
  });
  window.addEventListener("pointercancel", () => {
    pointerDown = false;
    endTouch(touch);
  });

  return {
    updateViewport,
    getViewport: () => viewport,
    // Appelé par main.js à chaque frame avec la position réelle (post-
    // simulation) du centre de la raquette -- voir le commentaire sur
    // knownPaddleCenterX ci-dessus.
    setPaddleCenterX(x) {
      knownPaddleCenterX = x;
    },
    // Appelé par main.js à chaque nouveau niveau (startLevel()) : évite
    // qu'un ancien point de référence "colle" à la raquette fraîchement
    // recentrée du niveau suivant et la fasse sauter dès la première frame
    // sans aucun toucher réel -- pas le cas visé par "aucune téléportation"
    // du cahier des charges, mais un même risque d'effet de bord si l'état
    // du contrôleur tactile persistait tel quel d'un niveau à l'autre.
    resetTarget(centerX) {
      knownPaddleCenterX = centerX;
      touch.targetCenterX = centerX;
      touch.refFingerX = null;
      touch.refPaddleCenterX = null;
    },
    sample() {
      return { pointerX: touch.targetCenterX, pointerDown };
    },
    consumeLaunch() {
      if (!launchRequested) return false;
      launchRequested = false;
      return true;
    },
  };
}
