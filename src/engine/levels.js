// Format de niveau : une grille de caractères, une ligne = une rangée de
// briques. '0'/'.' = vide, '1' = brique standard (1 impact), '2'/'3' =
// brique renforcée (2/3 impacts). Volontairement textuel et compact : simple
// à relire, à faire varier, et à valider automatiquement (voir
// validateLevel ci-dessous et tests/levels.test.js) — exactement ce que le
// cahier des charges demande ("détecter les niveaux manifestement
// problématiques") avant d'envisager une grande campagne.
import { BRICK_COLS, BRICK_TOP_Y, BRICK_ROW_H, PADDLE_Y } from "./constants.js";

const EMPTY = new Set(["0", "."]);

// V3 : extension de 10 à 50 niveaux (cahier des charges V3, section 4-5).
// Les 10 premiers niveaux ci-dessous sont repris à l'IDENTIQUE de V0-V2
// (déjà testés, déjà validés humainement) -- rien n'y est reconstruit. Les
// niveaux 11 à 50 sont générés par composition (voir plus bas) plutôt
// qu'écrits à la main un par un : ceci garantit une syntaxe toujours
// valide, permet de faire varier systématiquement les compositions plutôt
// que du copier-coller, et calibre le nombre total d'impacts en fonction
// de targetSeconds par construction (jamais au hasard).
//
// Densification : dans un premier temps, uniquement en ajoutant des
// rangées (voir TIER_ROW_COUNTS plus bas), jamais en réduisant la taille
// des briques -- calcul de la marge disponible avant la raquette :
//   PADDLE_Y (530) - BRICK_TOP_Y (70) = 460 unités utilisables au total
//   Zone confortable réservée au-dessus de la raquette : 130 unités
//   -> (460 - 130) / BRICK_ROW_H (20) = 16 rangées maximum en gardant
//      cette marge de confort.
// Le niveau le plus dense (50) utilise 14 rangées : sous ce plafond de 16
// avec 2 rangées (40 unités) de marge de sécurité supplémentaire. La
// réduction de taille/espacement des briques prévue par le cahier des
// charges comme solution de repli n'est donc PAS nécessaire pour atteindre
// 50 niveaux : la seule densification par rangées suffit largement, sans
// jamais rapprocher le contenu de la raquette ni changer la taille de
// brique déjà validée sur mobile.
const MAX_COMFORTABLE_ROWS = Math.floor((PADDLE_Y - BRICK_TOP_Y - 130) / BRICK_ROW_H);

function rowsToString(cells) {
  return cells.join("");
}

// --- V6 : générateur 11-100 piloté par une courbe de difficulté ----------
// Remplace le générateur V3 (11-50, un seul HP fixe par style, 4 paliers de
// 10 niveaux) par un générateur continu 11-100 : chaque style ci-dessous
// est un simple MASQUE de silhouette (quelles cases appartiennent au
// motif), et c'est une fonction de difficulté D(n) séparée qui décide, à
// l'intérieur de ce masque, quelles cases restent vides (respiration
// visuelle) et quel PV (1/2/3) prend chaque case remplie -- de façon
// déterministe (hachage positionnel, jamais Math.random), pas un seul
// niveau de gris par style.
//
// Cette séparation masque/difficulté est ce qui permet de faire varier le
// taux de réussite mesuré (voir docs/difficulty-study/) SANS perdre la
// diversité visuelle entre styles : un "frame" facile et un "frame"
// difficile restent tous deux reconnaissables comme un cadre.
function styleMask(style, rowCount, n) {
  const colMasks = ["1100110011", "1010101010", "0110011001", "1001100110"];
  const mask = Array.from({ length: rowCount }, () => Array(BRICK_COLS).fill(0));
  const set = (r, c, v = 1) => {
    if (r >= 0 && r < rowCount && c >= 0 && c < BRICK_COLS) mask[r][c] = v;
  };
  switch (style) {
    case "frame":
      for (let r = 0; r < rowCount; r++)
        for (let c = 0; c < BRICK_COLS; c++)
          if (r === 0 || r === rowCount - 1 || c === 0 || c === BRICK_COLS - 1) set(r, c);
      break;
    case "checker":
      for (let r = 0; r < rowCount; r++) for (let c = 0; c < BRICK_COLS; c++) if ((r + c) % 2 === 0) set(r, c);
      break;
    case "columns": {
      const colMask = colMasks[n % colMasks.length];
      for (let r = 0; r < rowCount; r++)
        for (let c = 0; c < BRICK_COLS; c++) if (colMask[c % colMask.length] === "1") set(r, c);
      break;
    }
    case "diamond": {
      const mid = (rowCount - 1) / 2;
      for (let r = 0; r < rowCount; r++) {
        const spread = Math.round((rowCount / 2 - Math.abs(r - mid)) * (BRICK_COLS / rowCount) + 1);
        const half = Math.max(1, Math.min(BRICK_COLS / 2, spread));
        for (let c = 0; c < BRICK_COLS; c++) if (Math.abs(c - (BRICK_COLS - 1) / 2) <= half) set(r, c);
      }
      break;
    }
    case "brickWall":
      for (let r = 0; r < rowCount; r++) {
        const gapCol = r % 2 === 0 ? 0 : BRICK_COLS - 1;
        for (let c = 0; c < BRICK_COLS; c++) if (c !== gapCol) set(r, c);
      }
      break;
    case "sparse":
      for (let r = 0; r < rowCount; r++)
        for (let c = 0; c < BRICK_COLS; c++) if ((r * 7 + c * 13 + n * 5) % 4 !== 0) set(r, c);
      break;
    case "bands":
      for (let r = 0; r < rowCount; r++) if (r % 2 === 0) for (let c = 0; c < BRICK_COLS; c++) set(r, c);
      break;
    case "full":
    default:
      for (let r = 0; r < rowCount; r++)
        for (let c = 0; c < BRICK_COLS; c++) if ("1110111011"[c % 10] === "1") set(r, c);
      break;
  }
  return mask;
}

// Courbe de difficulté : repères de conception du cahier des charges V6,
// AJUSTÉS par une mesure réelle (voir docs/difficulty-study/) qui a
// contredit l'hypothèse initiale du cahier pour la toute fin de campagne --
// voir le rapport V6, section audit, pour la démonstration complète :
// avec le mélange de population retenu (~50% de profils sans délai de
// réaction, voir POPULATION_MIX dans docs/difficulty-study/), même le
// niveau le plus dense possible (6 rangées pleines, 100% des briques au PV
// maximum, testé explicitement) ne fait JAMAIS descendre le taux de
// réussite mélangé sous ~58% : les profils Expert/Bon/Moyen (aucun délai de
// réaction modélisé) ne sont tout simplement jamais mis en échec par la
// seule densité de briques dans ce moteur (vitesse de balle constante,
// aucune pression temporelle). Cibler 20-25% aurait donc exigé soit de
// changer la mécanique de jeu elle-même (hors périmètre V6), soit de
// forcer une difficulté artificiellement punitive pour les niveaux
// faciles/moyens sans jamais atteindre la cible pour autant -- rejeté par
// la contrainte explicite du cahier ("Ne rends jamais les niveaux
// artificiellement plus difficiles"). Le repère de fin de campagne est
// donc RÉVISÉ à ~50-55% (juste au-dessus du plancher mesuré, avec une
// marge de sécurité), documenté ici et dans le rapport officiel plutôt que
// forcé.
function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}
function difficultyIndex(n) {
  let base;
  if (n <= 30) {
    base = smoothstep((n - 11) / 19) * 0.4; // 0 -> 0.4 (repère : ~80% -> ~67%)
  } else {
    base = 0.4 + smoothstep((n - 31) / 69) * 0.55; // 0.4 -> 0.95 (repère : ~67% -> plancher mesuré ~50-55%)
  }
  const breather = n >= 31 ? 0.04 * Math.sin((2 * Math.PI * (n - 31)) / 9) : 0;
  return Math.max(0.03, Math.min(0.97, base - breather));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Décision déterministe case par case (jamais Math.random). Remplissage
// volontairement fixe et élevé (peu de vides) : la mesure (voir
// docs/difficulty-study/) montre que peu de briques MAIS résistantes
// (PV concentré) est réellement plus difficile qu'un remplissage maximal
// dilué en PV faibles -- même total d'impacts, mais moins de briques
// distinctes signifie des échanges plus longs contre la MÊME zone, donc
// plus d'occasions réelles de rater un retour. hitsCapFor (plus bas)
// reste le filet de sécurité anti-marathon ; c'est surtout le nombre de
// rangées (voir rowCountFor, volontairement modéré, jamais maximal) qui
// garde le PV moyen par brique élevé plutôt que dilué sur trop de briques.
const FILL_PROB = 0.92;
function cellHp(n, r, c, d) {
  const hGap = ((r * 7 + c * 13 + n * 5) % 97) / 97;
  if (hGap >= FILL_PROB) return 0;
  const pHigh = lerp(0.08, 0.85, d);
  const pMid = lerp(0.15, 0.15, d);
  const hHp = ((r * 11 + c * 17 + n * 7 + 3) % 97) / 97;
  if (hHp < pHigh) return 3;
  if (hHp < pHigh + pMid) return 2;
  return 1;
}

// Plafond de rangées volontairement MODÉRÉ (10, pas les 14 max autorisés
// par la marge de confort au-dessus de la raquette) : voir cellHp
// ci-dessus -- concentrer le PV sur moins de briques s'est mesuré plus
// difficile que l'étaler sur davantage de rangées.
function rowCountFor(n, d) {
  return Math.min(10, Math.round(lerp(4, 10, d)));
}

// Plafond d'impacts totaux : filet de sécurité anti-marathon (même
// principe qu'en V3, plafond quasi inchangé -- 150 au lieu de 140). Mesuré
// (voir docs/difficulty-study/) : au-delà de ce plafond, allonger encore le
// total d'impacts n'augmente plus significativement la difficulté réelle
// (le vrai levier est la CONCENTRATION du PV sur moins de briques, voir
// cellHp/rowCountFor ci-dessus) -- seulement la durée, ce que le cahier des
// charges V3 interdit déjà explicitement de faire.
function hitsCapFor(d) {
  return Math.round(lerp(80, 150, d));
}

// Calibre targetSeconds à partir du nombre total d'impacts réellement
// généré (jamais deviné indépendamment) en reprenant le même ratio que les
// niveaux 1-10 déjà validés humainement (ex. niveau 10 : 110 impacts pour
// targetSeconds [90,210], soit environ 1,2 puis 0,52 impact/s) -- garantit
// par construction que validateLevel() ne signalera jamais ces niveaux
// générés comme trop courts ou trop longs, et que le rythme reste
// cohérent avec celui déjà éprouvé en V0-V2.
function totalHitsOf(rows) {
  return rows.join("").split("").reduce((sum, ch) => sum + (EMPTY.has(ch) ? 0 : Number(ch)), 0);
}

// Plafond dur d'impacts totaux, INDÉPENDANT du nombre de rangées : le
// cahier des charges V3 est explicite ("plus de briques ne doit pas
// simplement produire des niveaux beaucoup trop longs"). Sans ce plafond,
// une progression naïve rangées×colonnes×PV ferait exploser la durée des
// derniers niveaux (mesuré : jusqu'à ~800s avant ce correctif). Le
// plafond est choisi pour rester dans le même ordre de grandeur que le
// niveau 10 déjà validé (110 impacts, ~90-210s), avec une marge modérée
// pour les tout derniers niveaux (contenu plus riche, pas interminable).
const MAX_LEVEL_HITS = 130;

// Réduit déterministiquement les PV les plus élevés en premier (3->2->1->0)
// jusqu'à repasser sous le plafond -- préserve la RICHESSE VISUELLE du
// motif (le nombre de briques/la forme ne changent pas, seule leur
// résistance diminue), plutôt que de vider des cellules entières.
function capTotalHits(rows, maxHits = MAX_LEVEL_HITS) {
  let grid = rows.map((row) => row.split(""));
  let total = totalHitsOf(rows);
  let guard = 0;
  while (total > maxHits && guard < 1000) {
    guard++;
    let reduced = false;
    for (let hp = 3; hp >= 1 && !reduced; hp--) {
      for (const row of grid) {
        for (let c = 0; c < row.length; c++) {
          if (row[c] === String(hp)) {
            row[c] = String(hp - 1);
            total -= 1;
            reduced = true;
            break;
          }
        }
        if (reduced) break;
      }
    }
    if (!reduced) break;
  }
  return grid.map((row) => row.join(""));
}

function calibrateTargetSeconds(rows) {
  const totalHits = totalHitsOf(rows);
  const minS = Math.round(totalHits / 1.2);
  const maxS = Math.round(totalHits / 0.52);
  return [minS, maxS];
}

const POWERUP_ROTATION = [null, "multiball", "laser", "perforate", "multiball", "paddle_xl", "laser", "perforate"];

function generatedLevel(id, name, rows, powerUpKind) {
  const level = { id, name, targetSeconds: calibrateTargetSeconds(rows), rows };
  if (powerUpKind) level.powerUpBias = { [powerUpKind]: 2 };
  return level;
}

// V6 : générateur continu 11-100 (remplace le générateur V3 par paliers,
// voir docs/difficulty-study/ pour la mesure de réussite réelle qui a
// remplacé l'ancienne heuristique de calibration par targetSeconds seul).
// Le style change à chaque niveau (jamais deux niveaux consécutifs
// identiques) pour la variété visuelle ; la DIFFICULTÉ réelle vient de
// difficultyIndex(n) via cellHp(), appliquée à l'intérieur du masque du
// style -- deux niveaux de même style à des n différents ont donc la même
// silhouette mais un remplissage/PV différents.
const STYLES = ["frame", "checker", "columns", "diamond", "brickWall", "sparse", "bands", "full"];
const NAME_BY_STYLE = {
  frame: "Cadre renforcé",
  checker: "Damier avancé",
  columns: "Colonnes serrées",
  diamond: "Losange",
  brickWall: "Appareillage",
  sparse: "Dispersion",
  bands: "Bandes blindées",
  full: "Mur plein",
};
const GENERATED_LEVELS = [];
for (let n = 11; n <= 100; n++) {
  const d = difficultyIndex(n);
  const rowCount = rowCountFor(n, d);
  const style = STYLES[(n - 11) % STYLES.length];
  const mask = styleMask(style, rowCount, n);
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const cells = [];
    for (let c = 0; c < BRICK_COLS; c++) {
      cells.push(mask[r][c] ? String(cellHp(n, r, c, d)) : "0");
    }
    rows.push(rowsToString(cells));
  }
  const capped = capTotalHits(rows, hitsCapFor(d));
  const powerUpKind = POWERUP_ROTATION[n % POWERUP_ROTATION.length];
  GENERATED_LEVELS.push(generatedLevel(n, `${NAME_BY_STYLE[style]} ${n}`, capped, powerUpKind));
}

// V6 : niveaux 1-10 ALLÉGÉS (moins de rangées/PV, jamais une reconstruction
// -- même style, même thème, même bonus par niveau qu'en V0-V5) pour
// atteindre le repère d'onboarding quasi-universel du cahier des charges V6
// (~95% niveaux 1-3) sous UNE SEULE vie par tentative : sous l'ancien
// système à 3 vies conservées, le total d'impacts de ces niveaux n'avait
// jamais été mesuré en taux de réussite réel (V0-V5 ne mesuraient que la
// terminabilité, jamais la probabilité de succès -- voir
// docs/difficulty-study/). La mesure a montré qu'ils étaient nettement
// trop exigeants pour une seule vie (niveau 1 mesuré à 73,5% avant cet
// allègement, cible ~95%) : moins d'impacts total signifie moins
// d'occasions cumulées de rater un retour avant la victoire, ce qui est le
// principal levier mesuré (voir rapport V6) -- pas une élimination de la
// difficulté, un RÉALIGNEMENT sur le nouveau système de vies.
export const LEVELS = [
  {
    id: 1,
    name: "Premier contact",
    targetSeconds: [25, 55],
    rows: ["1111111111", "1111111111"],
  },
  {
    id: 2,
    name: "La raquette s'échauffe",
    targetSeconds: [30, 65],
    rows: ["0111111110", "1111111111", "0111111110"],
  },
  {
    id: 3,
    name: "Premiers blindages",
    targetSeconds: [35, 80],
    rows: ["1111111111", "2222222222", "0111111110"],
  },
  {
    id: 4,
    name: "Le multiball entre en jeu",
    targetSeconds: [45, 100],
    rows: ["2112211221", "1221122112", "1111111111"],
    powerUpBias: { multiball: 2 },
  },
  {
    id: 5,
    name: "Mur du fond",
    targetSeconds: [55, 125],
    rows: ["1111111111", "2222222222", "1111111111", "0001111000"],
  },
  {
    id: 6,
    name: "Laser d'abord",
    targetSeconds: [55, 125],
    rows: ["2222222222", "1111111111", "0110000110"],
    powerUpBias: { laser: 2 },
  },
  {
    id: 7,
    name: "La perforation compte",
    targetSeconds: [60, 135],
    rows: ["2222222222", "2222222222", "1111111111"],
    powerUpBias: { perforate: 2 },
  },
  {
    id: 8,
    name: "Damier",
    targetSeconds: [65, 145],
    rows: ["2020202020", "0202020202", "2020202020", "1111111111"],
  },
  {
    id: 9,
    name: "Colonnes",
    targetSeconds: [65, 145],
    rows: ["2020202020", "2020202020", "1111111111", "0011111100"],
  },
  {
    id: 10,
    name: "Dernier verrou",
    targetSeconds: [75, 165],
    rows: ["2222222222", "1111111111", "2222222222", "1111111111"],
  },
  ...GENERATED_LEVELS,
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
