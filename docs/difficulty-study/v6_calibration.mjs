#!/usr/bin/env node
// BREAKPOINT V6 -- calibration PAR STYLE de la relation D (index de
// difficulté brut : remplissage/mélange de PV/plafond d'impacts) -> taux de
// réussite réellement mesuré. Nécessaire car un même D produit des taux de
// réussite différents selon le style (silhouette) -- voir
// docs/difficulty-study/v6_difficulty_model.mjs pour les 5 profils de
// joueur et le mélange de population réutilisés ici à l'identique.
//
// Sortie : docs/difficulty-study/v6_calibration_results.json -- une table
// (style, D, taux de réussite mesuré) que src/engine/levels.js consulte
// ensuite pour choisir, pour CHAQUE niveau, le D qui atteint réellement le
// repère de conception voulu POUR SON STYLE, plutôt qu'un D partagé qui
// produisait des résultats très inégaux d'un style à l'autre (mesuré et
// corrigé ici -- voir rapport V6).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tick } from "../../src/engine/simulation.js";
import { buildBricksForLevel } from "../../src/engine/levels.js";
import { ARENA_W, BRICK_COLS, BRICK_TOP_Y, BRICK_ROW_H, PADDLE_Y } from "../../src/engine/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DT_MS = 1000 / 60;
const SEEDS_PER_PLAYER = 8;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE_PLAYERS = [
  { name: "Expert", lagMs: 0, freezeEveryMs: 0, freezeDurationMs: 0, noiseFn: (t) => Math.sin(t * 0.013) * 15 },
  { name: "Bon", lagMs: 0, freezeEveryMs: 0, freezeDurationMs: 0, noiseFn: (t) => Math.sin(t * 0.021 + 1.7) * 25 + Math.sin(t * 0.007) * 8 },
  { name: "Moyen", lagMs: 60, freezeEveryMs: 0, freezeDurationMs: 0, noiseFn: (t) => Math.sin(t * 0.017) * 35 + Math.sin(t * 0.041) * 10 },
  { name: "Faible", lagMs: 120, freezeEveryMs: 2500, freezeDurationMs: 150, noiseFn: (t) => Math.sin(t * 0.023) * 55 + Math.sin(t * 0.061) * 15 },
  { name: "Debutant", lagMs: 200, freezeEveryMs: 1500, freezeDurationMs: 250, noiseFn: (t) => Math.sin(t * 0.031) * 80 + Math.sin(t * 0.089) * 20 },
];
const POPULATION_MIX = { Expert: 0.05, Bon: 0.15, Moyen: 0.3, Faible: 0.35, Debutant: 0.15 };

function jitteredPlayer(base, seed) {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const phase = rnd() * 6000;
  const ampJitter = 0.85 + rnd() * 0.3;
  const lagJitter = base.lagMs * (0.8 + rnd() * 0.4);
  return { ...base, lagMs: lagJitter, noiseFn: (t) => base.noiseFn(t + phase) * ampJitter };
}

// --- Génération d'un niveau de calibration (réplique styleMask/cellHp de
// src/engine/levels.js -- dupliqué volontairement, voir en-tête) ---------
const MAX_COMFORTABLE_ROWS = Math.floor((PADDLE_Y - BRICK_TOP_Y - 130) / BRICK_ROW_H);
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function styleMask(style, rowCount, seed) {
  const colMasks = ["1100110011", "1010101010", "0110011001", "1001100110"];
  const mask = Array.from({ length: rowCount }, () => Array(BRICK_COLS).fill(0));
  const set = (r, c) => {
    if (r >= 0 && r < rowCount && c >= 0 && c < BRICK_COLS) mask[r][c] = 1;
  };
  switch (style) {
    case "frame":
      for (let r = 0; r < rowCount; r++) for (let c = 0; c < BRICK_COLS; c++) if (r === 0 || r === rowCount - 1 || c === 0 || c === BRICK_COLS - 1) set(r, c);
      break;
    case "checker":
      for (let r = 0; r < rowCount; r++) for (let c = 0; c < BRICK_COLS; c++) if ((r + c) % 2 === 0) set(r, c);
      break;
    case "columns": {
      const colMask = colMasks[seed % colMasks.length];
      for (let r = 0; r < rowCount; r++) for (let c = 0; c < BRICK_COLS; c++) if (colMask[c % colMask.length] === "1") set(r, c);
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
      for (let r = 0; r < rowCount; r++) for (let c = 0; c < BRICK_COLS; c++) if ((r * 7 + c * 13 + seed * 5) % 4 !== 0) set(r, c);
      break;
    case "bands":
      for (let r = 0; r < rowCount; r++) if (r % 2 === 0) for (let c = 0; c < BRICK_COLS; c++) set(r, c);
      break;
    case "full":
    default:
      for (let r = 0; r < rowCount; r++) for (let c = 0; c < BRICK_COLS; c++) if ("1110111011"[c % 10] === "1") set(r, c);
      break;
  }
  return mask;
}
function cellHp(seed, r, c, d) {
  const hGap = ((r * 7 + c * 13 + seed * 5) % 97) / 97;
  if (hGap >= lerp(0.75, 0.98, d)) return 0;
  const pHigh = lerp(0.05, 0.75, d);
  const pMid = lerp(0.15, 0.2, d);
  const hHp = ((r * 11 + c * 17 + seed * 7 + 3) % 97) / 97;
  if (hHp < pHigh) return 3;
  if (hHp < pHigh + pMid) return 2;
  return 1;
}
function totalHitsOf(rows) {
  return rows
    .join("")
    .split("")
    .reduce((s, ch) => s + (ch === "0" ? 0 : Number(ch)), 0);
}
function capTotalHits(rows, maxHits) {
  let grid = rows.map((r) => r.split(""));
  let total = totalHitsOf(rows);
  let guard = 0;
  while (total > maxHits && guard < 2000) {
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
  return grid.map((r) => r.join(""));
}
function buildCalibLevel(style, d, seed) {
  const rowCount = Math.min(MAX_COMFORTABLE_ROWS - 2, Math.round(lerp(5, MAX_COMFORTABLE_ROWS - 2, d)));
  const mask = styleMask(style, rowCount, seed);
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const cells = [];
    for (let c = 0; c < BRICK_COLS; c++) cells.push(mask[r][c] ? String(cellHp(seed, r, c, d)) : "0");
    rows.push(cells.join(""));
  }
  const hitsCap = Math.round(lerp(80, 210, d));
  const capped = capTotalHits(rows, hitsCap);
  const totalHits = totalHitsOf(capped);
  const minS = Math.round(totalHits / 1.2);
  const maxS = Math.round(totalHits / 0.52);
  return { id: 9000, rows: capped, targetSeconds: [minS, maxS] };
}

// --- Simulation d'une tentative (1 vie, comme le jeu réel V6) ------------
function simulateAttemptOnLevel(level, player, maxSeconds) {
  const paddleX = ARENA_W / 2 - 36;
  const state = {
    arena: { w: ARENA_W, h: 700 },
    levelIndex: 0,
    levelId: level.id,
    levelName: "calib",
    status: "ready",
    paddle: { x: paddleX, w: 72, h: 14, y: PADDLE_Y, targetX: ARENA_W / 2, xlUntil: 0, vx: 0 },
    balls: [{ x: paddleX + 36, y: PADDLE_Y - 7, vx: 0, vy: 0, r: 6, launched: false, perforateUntil: 0 }],
    bricks: buildBricksForLevel(level),
    powerUps: [],
    lasers: [],
    effects: { laserUntil: 0, laserCooldownUntil: 0 },
    lives: 1,
    score: 0,
    elapsedMs: 0,
    events: [],
  };
  let elapsed = 0;
  const ballXHistory = [];
  let frozenPointerX = null;
  while (elapsed < maxSeconds * 1000) {
    const ball = state.balls[0];
    const rawBallX = ball ? ball.x : ARENA_W / 2;
    ballXHistory.push({ t: elapsed, x: rawBallX });
    while (ballXHistory.length > 1 && ballXHistory[0].t < elapsed - player.lagMs - 50) ballXHistory.shift();
    let trackedX = rawBallX;
    if (player.lagMs > 0) {
      const targetT = elapsed - player.lagMs;
      let chosen = ballXHistory[0];
      for (const sample of ballXHistory) {
        if (sample.t <= targetT) chosen = sample;
        else break;
      }
      trackedX = chosen.x;
    }
    let pointerX = trackedX + player.noiseFn(elapsed);
    if (player.freezeEveryMs > 0) {
      const phase = elapsed % player.freezeEveryMs;
      if (phase < player.freezeDurationMs) {
        if (frozenPointerX == null) frozenPointerX = pointerX;
        pointerX = frozenPointerX;
      } else frozenPointerX = null;
    }
    const input = { pointerX, launchRequested: state.status === "ready", fire: false };
    tick(state, DT_MS, input);
    elapsed += DT_MS;
    if (state.status === "won" || state.status === "lost") break;
  }
  return state.status === "won";
}

function measure(level) {
  const bound = Math.max(200, level.targetSeconds[1] * 4);
  const perPlayer = {};
  let blended = 0;
  for (const base of BASE_PLAYERS) {
    let won = 0;
    for (let s = 0; s < SEEDS_PER_PLAYER; s++) {
      const seed = 555001 + BASE_PLAYERS.indexOf(base) * 131 + s * 17;
      Math.random = mulberry32(seed);
      const player = jitteredPlayer(base, seed);
      if (simulateAttemptOnLevel(level, player, bound)) won++;
    }
    perPlayer[base.name] = won / SEEDS_PER_PLAYER;
  }
  for (const [name, w] of Object.entries(POPULATION_MIX)) blended += perPlayer[name] * w;
  return { blended, perPlayer };
}

const STYLES = ["frame", "checker", "columns", "diamond", "brickWall", "sparse", "bands", "full"];
const D_SAMPLES = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0];

function main() {
  const originalRandom = Math.random;
  const table = {};
  const t0 = Date.now();
  for (const style of STYLES) {
    table[style] = [];
    for (const d of D_SAMPLES) {
      const level = buildCalibLevel(style, d, 7);
      const { blended, perPlayer } = measure(level);
      table[style].push({ d, successA: blended, perPlayer });
      process.stderr.write(`[calib] ${style} D=${d.toFixed(2)} -> A=${(blended * 100).toFixed(1)}% (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
    }
  }
  Math.random = originalRandom;
  writeFileSync(join(__dirname, "v6_calibration_results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), dSamples: D_SAMPLES, table }, null, 2));
  console.log("done");
}
main();
