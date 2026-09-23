// Contrôle tactile relatif type trackpad (cahier des charges BREAKPOINT V1,
// section 4) : logique PURE, sans DOM, pour rester testable par node:test
// sans navigateur (voir tests/relative-touch.test.js) -- input.js s'occupe
// uniquement du branchement aux événements pointer réels et de la conversion
// écran -> espace arène.
//
// Comportement exact demandé :
// - au toucher initial, la raquette ne bouge pas (seul un point de référence
//   doigt+raquette est mémorisé) ;
// - le glissement déplace ensuite la raquette RELATIVEMENT à ce point de
//   référence, jamais vers une position absolue ;
// - au relâchement, la raquette garde sa position ; un nouveau toucher
//   ailleurs ne fait que fixer un nouveau point de référence (jamais un
//   saut/téléportation vers la coordonnée touchée) ;
// - en butée gauche/droite, la référence est ré-ancrée pour qu'il n'y ait
//   jamais d'"overshoot" accumulé à rattraper en repartant dans l'autre sens.
export function createRelativeTouchState(initialCenterX) {
  return {
    targetCenterX: initialCenterX,
    refFingerX: null,
    refPaddleCenterX: null,
  };
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

/** Nouveau toucher (pointerdown) : fixe la référence, ne déplace jamais la raquette. */
export function beginTouch(state, fingerX, currentPaddleCenterX) {
  state.refFingerX = fingerX;
  state.refPaddleCenterX = currentPaddleCenterX;
  state.targetCenterX = currentPaddleCenterX;
}

/** Glissement (pointermove) : déplacement relatif, avec ré-ancrage en butée. */
export function moveTouch(state, fingerX, minCenterX, maxCenterX) {
  if (state.refFingerX == null) return state.targetCenterX; // aucun toucher actif
  const raw = state.refPaddleCenterX + (fingerX - state.refFingerX);
  const clamped = clamp(raw, minCenterX, maxCenterX);
  if (clamped !== raw) {
    state.refPaddleCenterX = clamped;
    state.refFingerX = fingerX;
  }
  state.targetCenterX = clamped;
  return state.targetCenterX;
}

/** Relâchement (pointerup/pointercancel) : la raquette garde sa position. */
export function endTouch(state) {
  state.refFingerX = null;
  state.refPaddleCenterX = null;
}
