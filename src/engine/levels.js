// Format de niveau : une grille de caractères, une ligne = une rangée de
// briques. '0'/'.' = vide, '1' = brique standard (1 impact), '2'/'3' =
// brique renforcée (2/3 impacts). Volontairement textuel et compact : simple
// à relire, à faire varier, et à valider automatiquement (voir
// validateLevel ci-dessous et tests/levels.test.js) — exactement ce que le
// cahier des charges demande ("détecter les niveaux manifestement
// problématiques") avant d'envisager une grande campagne.
import { BRICK_COLS } from "./constants.js";

const EMPTY = new Set(["0", "."]);

export const LEVELS = [
  {
    id: 1,
    name: "Premier contact",
    targetSeconds: [40, 100],
    rows: ["1111111111", "1111111111", "1111111111"],
  },
  {
    id: 2,
    name: "La raquette s'échauffe",
    targetSeconds: [50, 120],
    rows: ["0111111110", "1111111111", "1111111111", "0111111110"],
  },
  {
    id: 3,
    name: "Premiers blindages",
    targetSeconds: [60, 150],
    rows: ["1111111111", "2222222222", "1111111111", "0111111110"],
  },
  {
    id: 4,
    name: "Le multiball entre en jeu",
    targetSeconds: [60, 160],
    rows: ["2112211221", "1221122112", "1111111111", "0011111100"],
    powerUpBias: { multiball: 2 },
  },
  {
    id: 5,
    name: "Mur du fond",
    targetSeconds: [70, 170],
    rows: ["1111111111", "2222222222", "2222222222", "1111111111", "0001111000"],
  },
  {
    id: 6,
    name: "Laser d'abord",
    targetSeconds: [70, 170],
    rows: ["3333333333", "1111111111", "1111111111", "0110000110"],
    powerUpBias: { laser: 2 },
  },
  {
    id: 7,
    name: "La perforation compte",
    targetSeconds: [70, 180],
    rows: ["2222222222", "3333333333", "2222222222", "1111111111"],
    powerUpBias: { perforate: 2 },
  },
  {
    id: 8,
    name: "Damier",
    targetSeconds: [80, 190],
    rows: ["2020202020", "0202020202", "2020202020", "0202020202", "1111111111"],
  },
  {
    id: 9,
    name: "Colonnes",
    targetSeconds: [80, 190],
    rows: ["3030303030", "3030303030", "3131313131", "1111111111", "0011111100"],
  },
  {
    id: 10,
    name: "Dernier verrou",
    targetSeconds: [90, 210],
    rows: ["3333333333", "2222222222", "3333333333", "2222222222", "1111111111"],
  },
];

export function buildBricksForLevel(level) {
  const bricks = [];
  level.rows.forEach((row, rowIndex) => {
    for (let col = 0; col < row.length; col++) {
      const ch = row[col];
      if (EMPTY.has(ch)) continue;
      const hp = Number(ch);
      if (!Number.isFinite(hp) || hp <= 0) continue;
      bricks.push({ col, row: rowIndex, hp, maxHp: hp, alive: true, id: `${level.id}-${rowIndex}-${col}` });
    }
  });
  return bricks;
}

// Détecte les niveaux "manifestement problématiques" : rangées de longueur
// incohérente, aucune brique, ou un nombre de briques disproportionné par
// rapport à targetSeconds (signe qu'un niveau prendrait beaucoup plus que
// la durée cible de 1 à 3 minutes visée par le cahier des charges).
export function validateLevel(level) {
  const errors = [];
  if (!level.rows || level.rows.length === 0) {
    errors.push("aucune rangée de briques");
    return errors;
  }
  for (const row of level.rows) {
    if (row.length !== BRICK_COLS) {
      errors.push(`rangée de longueur ${row.length}, attendu ${BRICK_COLS} ("${row}")`);
    }
    for (const ch of row) {
      if (!EMPTY.has(ch) && !"123".includes(ch)) {
        errors.push(`caractère de brique inconnu "${ch}" dans "${row}"`);
      }
    }
  }
  const bricks = buildBricksForLevel(level);
  if (bricks.length === 0) {
    errors.push("niveau sans aucune brique destructible");
  }
  const totalHits = bricks.reduce((sum, b) => sum + b.hp, 0);
  // Heuristique volontairement large (pas une mesure de durée réelle, qui
  // dépend de l'adresse du joueur) : sert seulement à repérer un niveau
  // dont le nombre total d'impacts nécessaires est hors de proportion avec
  // sa durée cible déclarée.
  if (level.targetSeconds) {
    const [minS, maxS] = level.targetSeconds;
    const minHitsPerSecond = 0.15;
    const maxHitsPerSecond = 2.5;
    if (totalHits < minS * minHitsPerSecond) {
      errors.push(`seulement ${totalHits} impacts nécessaires pour une cible de ${minS}-${maxS}s (trop court)`);
    }
    if (totalHits > maxS * maxHitsPerSecond) {
      errors.push(`${totalHits} impacts nécessaires excède largement une cible de ${minS}-${maxS}s (probablement trop long)`);
    }
  }
  return errors;
}

export function validateAllLevels(levels = LEVELS) {
  const report = {};
  for (const level of levels) {
    const errors = validateLevel(level);
    if (errors.length > 0) report[level.id] = errors;
  }
  return report;
}
