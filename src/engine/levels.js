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

/** Rangée entièrement pleine d'une seule valeur de PV. */
function fullRow(hp) {
  return rowsToString(Array(BRICK_COLS).fill(String(hp)));
}

/** Cadre : bordure (première/dernière colonne de chaque rangée, première/dernière rangée) pleine, intérieur au choix. */
function frame(rowCount, hp, innerHp = "0") {
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const cells = [];
    for (let c = 0; c < BRICK_COLS; c++) {
      const border = r === 0 || r === rowCount - 1 || c === 0 || c === BRICK_COLS - 1;
      cells.push(border ? String(hp) : String(innerHp));
    }
    rows.push(rowsToString(cells));
  }
  return rows;
}

/** Damier alterné entre deux valeurs de PV (hpB peut être "0" = vide). */
function checker(rowCount, hpA, hpB) {
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const cells = [];
    for (let c = 0; c < BRICK_COLS; c++) {
      cells.push((r + c) % 2 === 0 ? String(hpA) : String(hpB));
    }
    rows.push(rowsToString(cells));
  }
  return rows;
}

/** Colonnes verticales : un motif de colonnes pleines/vides répété sur toutes les rangées. */
function columns(rowCount, colMask, hp) {
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const cells = [];
    for (let c = 0; c < BRICK_COLS; c++) {
      cells.push(colMask[c % colMask.length] === "1" ? String(hp) : "0");
    }
    rows.push(rowsToString(cells));
  }
  return rows;
}

/** Bandes horizontales : chaque rangée a sa propre valeur de PV pleine (ex. blindage alterné). */
function bands(hpPerRow) {
  return hpPerRow.map((hp) => fullRow(hp));
}

/** Losange/pyramide centré : densité croissante puis décroissante. */
function diamond(rowCount, hp) {
  const rows = [];
  const mid = (rowCount - 1) / 2;
  for (let r = 0; r < rowCount; r++) {
    const spread = Math.round((rowCount / 2 - Math.abs(r - mid)) * (BRICK_COLS / rowCount) + 1);
    const half = Math.max(1, Math.min(BRICK_COLS / 2, spread));
    const cells = [];
    for (let c = 0; c < BRICK_COLS; c++) {
      const distFromCenter = Math.abs(c - (BRICK_COLS - 1) / 2);
      cells.push(distFromCenter <= half ? String(hp) : "0");
    }
    rows.push(rowsToString(cells));
  }
  return rows;
}

/** Appareillage façon mur de briques : une colonne différente laissée vide à chaque rangée, en alternance. */
function brickWall(rowCount, hp) {
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const gapCol = r % 2 === 0 ? 0 : BRICK_COLS - 1;
    const cells = [];
    for (let c = 0; c < BRICK_COLS; c++) {
      cells.push(c === gapCol ? "0" : String(hp));
    }
    rows.push(rowsToString(cells));
  }
  return rows;
}

/** Dispersion déterministe (jamais Math.random -- reproductible) : donne un aspect moins géométrique. */
function sparse(rowCount, seed, hp) {
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const cells = [];
    for (let c = 0; c < BRICK_COLS; c++) {
      const v = (r * 7 + c * 13 + seed * 5) % 4;
      cells.push(v !== 0 ? String(hp) : "0");
    }
    rows.push(rowsToString(cells));
  }
  return rows;
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

// 4 paliers de 10 niveaux (11-20, 21-30, 31-40, 41-50) : rangées croissant
// progressivement (jamais brutalement -- +1 rangée tous les ~4 niveaux),
// mélange de PV croissant graduellement, style de composition qui change
// à chaque niveau (jamais deux niveaux consécutifs avec le même
// générateur) pour éviter le copier-coller, sans introduire de nouvelle
// mécanique de jeu.
const GENERATED_LEVELS = [];
{
  // "bands" et "full" ne produisent une forme distincte des autres styles
  // QUE lorsqu'un vrai contraste de PV existe (hpMain !== hpAlt) -- sinon
  // les deux dégénèrent en une simple grille pleine d'une seule valeur,
  // identique entre elles ET à un "frame" plein. Le choix du style est
  // donc conditionné au contraste RÉEL calculé pour ce niveau, pas
  // seulement au palier (le palier seul ne suffit pas à le garantir).
  const stylesWithContrast = ["frame", "checker", "columns", "diamond", "brickWall", "sparse", "bands", "full"];
  const stylesFlatHp = ["frame", "checker", "columns", "diamond", "brickWall", "sparse"];
  const colMasks = ["1100110011", "1010101010", "0110011001", "1001100110"];
  for (let n = 11; n <= 50; n++) {
    const tierIndex = Math.floor((n - 11) / 10); // 0..3
    const rowCount = Math.min(MAX_COMFORTABLE_ROWS - 2, 5 + Math.floor((n - 11) / 4));
    // Mélange de PV : de plus en plus de renforcé (2/3) au fil des paliers,
    // jamais 100% renforcé (garderait un rythme trop lent -- cahier des
    // charges : éviter les niveaux "interminables"). hpAlt toujours
    // strictement inférieur à hpMain quand un contraste est possible.
    const hpMain = tierIndex === 0 ? 1 : tierIndex === 1 ? (n % 2 === 0 ? 2 : 1) : tierIndex === 2 ? 2 : n % 2 === 0 ? 3 : 2;
    const hpAlt = hpMain > 1 ? hpMain - 1 : 1;
    const hasContrast = hpMain !== hpAlt;
    const styles = hasContrast ? stylesWithContrast : stylesFlatHp;
    const style = styles[(n - 11) % styles.length];
    let rows;
    switch (style) {
      case "frame":
        // Intérieur toujours creux (vrai vide, pas une valeur non-nulle) :
        // c'est ce qui garde une silhouette de cadre reconnaissable après
        // le plafonnement d'impacts, à n'importe quel palier -- un
        // intérieur rempli deviendrait indiscernable d'un "full" une fois
        // réduit (voir capTotalHits).
        rows = frame(rowCount, hpMain, "0");
        break;
      case "checker":
        // Toujours alterné avec du VIDE (comme le niveau 8 "Damier"
        // d'origine), jamais deux valeurs pleines : une checker "pleine"
        // (aucune case vide) perd sa silhouette distinctive dès que le
        // plafonnement d'impacts la réduit -- exactement la collision
        // niveau 43/44 détectée par les tests avant ce correctif.
        rows = checker(rowCount, hpMain, "0");
        break;
      case "columns":
        rows = columns(rowCount, colMasks[n % colMasks.length], hpMain);
        break;
      case "diamond":
        rows = diamond(rowCount, hpMain);
        break;
      case "brickWall":
        rows = brickWall(rowCount, hpMain);
        break;
      case "sparse":
        rows = sparse(rowCount, n, hpMain);
        break;
      case "bands": {
        const hpPerRow = Array.from({ length: rowCount }, (_, r) => (r % 2 === 0 ? hpMain : hpAlt));
        rows = bands(hpPerRow);
        break;
      }
      case "full":
      default:
        // "Mur quasi plein" avec deux fines colonnes creuses (jamais 100%
        // uniforme) : reste distinct de "bands" (silhouette par colonnes,
        // pas par rangées) même après plafonnement d'impacts, ce qu'un
        // remplissage totalement uniforme ne garantissait pas (collision
        // niveau 49/50 détectée par les tests avant ce correctif).
        rows = columns(rowCount, "1110111011", hpMain);
        break;
    }
    // Plafond CROISSANT par palier (pas un plafond unique global) : les
    // 10 derniers niveaux resteraient sinon tous à la même durée malgré des
    // motifs visuellement de plus en plus denses -- un vrai palier de
    // difficulté croissante, toujours borné pour ne jamais devenir un
    // marathon (140 impacts max, contre 110 pour le niveau 10 déjà validé).
    const tierHitsCap = [70, 95, 115, 140][tierIndex];
    rows = capTotalHits(rows, tierHitsCap);
    const powerUpKind = POWERUP_ROTATION[n % POWERUP_ROTATION.length];
    const nameByStyle = {
      frame: "Cadre renforcé",
      checker: "Damier avancé",
      columns: "Colonnes serrées",
      diamond: "Losange",
      brickWall: "Appareillage",
      sparse: "Dispersion",
      bands: "Bandes blindées",
      full: "Mur plein",
    };
    GENERATED_LEVELS.push(generatedLevel(n, `${nameByStyle[style]} ${n}`, rows, powerUpKind));
  }
}

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
