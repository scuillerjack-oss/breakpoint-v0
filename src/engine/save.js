// Sauvegarde locale : progression (niveau max débloqué), tutoriels déjà
// vus, réglages audio/haptique. Jamais l'état de partie en cours en détail
// (position de balle etc.) — seulement ce qui doit survivre une fermeture,
// conformément au cahier des charges (section 17).
const KEY = "breakpoint-v0-save";
const VERSION = 1;

function defaults() {
  return {
    version: VERSION,
    unlockedLevelIndex: 0,
    tutorialsSeen: {},
    settings: { music: true, sfx: true, haptics: true },
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaults();
    // Pas de migration nécessaire tant qu'un seul schéma (V1) existe — voir
    // README_REPRISE pour la procédure à suivre le jour où ça change (jamais
    // perdre silencieusement une progression après mise à jour).
    return { ...defaults(), ...parsed, settings: { ...defaults().settings, ...(parsed.settings || {}) } };
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
