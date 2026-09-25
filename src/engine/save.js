// Sauvegarde locale : progression (niveau max débloqué), tutoriels déjà
// vus, réglages audio/haptique. Jamais l'état de partie en cours en détail
// (position de balle etc.) — seulement ce qui doit survivre une fermeture,
// conformément au cahier des charges (section 17).
import { createMonetizationState } from "./monetization.js";

const KEY = "breakpoint-v0-save";
const VERSION = 1;

function defaults() {
  return {
    version: VERSION,
    unlockedLevelIndex: 0,
    tutorialsSeen: {},
    settings: { music: true, sfx: true, haptics: true },
    // V5 : état économique persistant (cahier des charges V5, section 4 --
    // "compteur de niveaux, temporisation 5 minutes... état Premium et
    // persistance"). Jamais lu par une UI publicitaire réelle dans cette
    // version (voir src/engine/monetization.js) : préparation d'état
    // uniquement, aucune fausse publicité ni faux achat.
    monetization: createMonetizationState(),
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaults();
    // Pas de migration destructive nécessaire : chaque nouvelle clé (ex.
    // "monetization" ajoutée en V5) est fusionnée avec ses valeurs par
    // défaut, jamais None de perte silencieuse de progression existante --
    // voir README_REPRISE pour la procédure générale.
    return {
      ...defaults(),
      ...parsed,
      settings: { ...defaults().settings, ...(parsed.settings || {}) },
      monetization: { ...defaults().monetization, ...(parsed.monetization || {}) },
    };
  } catch {
    return defaults();
  }
}

export function writeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Stockage indisponible (mode privé strict, quota) : le jeu doit rester
    // jouable, seulement sans persistance — jamais une erreur bloquante.
  }
}

export function markLevelUnlocked(save, levelIndex) {
  if (levelIndex > save.unlockedLevelIndex) {
    save.unlockedLevelIndex = levelIndex;
    writeSave(save);
  }
}

export function markTutorialSeen(save, key) {
  if (!save.tutorialsSeen[key]) {
    save.tutorialsSeen[key] = true;
    writeSave(save);
  }
}
