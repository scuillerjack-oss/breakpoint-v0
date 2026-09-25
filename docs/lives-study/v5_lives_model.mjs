#!/usr/bin/env node
// BREAKPOINT V5 — étude reproductible du système de vies.
//
// Rejoue une campagne COMPLÈTE de 50 niveaux (dans l'ordre réel du jeu,
// exactement comme un joueur qui enchaîne "Niveau suivant") sous 5 profils
// de joueur déterministes, et compare 3 politiques de gestion des vies :
//
//   A - actuelle (réellement auditée dans le code, voir rapport) : les vies
//       ne sont PAS réinitialisées entre niveaux ; seul un Game Over (ou un
//       retour au menu) les remet à 3.
//   B - 3 vies restaurées au début de CHAQUE niveau.
//   C - restauration par palier (toutes les N niveaux) -- testée sur
//       plusieurs paliers candidats, retenue seulement si un palier apporte
//       un compromis réellement différent de A ET de B (voir section
//       dédiée : le choix n'est jamais arbitraire).
//
// Sur un Game Over, on modélise le comportement réel du joueur observé dans
// le code (bouton "Recommencer") : vies remises à 3, même niveau rejoué,
// puis la campagne continue -- jamais un arrêt de la simulation, pour
// mesurer la fréquence/distribution réelle des Game Over sur toute la
// campagne, pas seulement le premier mur rencontré.
//
// IMPORTANT -- source de non-déterminisme réelle et gérée explicitement :
// applyPowerUp()/le tirage des bonus dans src/engine/simulation.js utilise
// Math.random() (comportement de jeu réel et volontairement inchangé, un
// bonus aléatoire fait partie de l'expérience validée). Pour qu'une étude
// AUTOUR de ce moteur reste reproductible, ce script ne modifie PAS
// simulation.js : il remplace Math.random par un générateur pseudo-aléatoire
// à graine fixe (mulberry32) UNIQUEMENT pendant l'exécution de ce script
// d'analyse, et fait tourner CHAQUE combinaison (joueur x politique) sur
// plusieurs graines indépendantes pour rapporter une distribution (moyenne/
// min/max), jamais un seul tirage qui serait trompeur.
//
// Exécution : node docs/lives-study/v5_lives_model.mjs
// Sortie : docs/lives-study/v5_lives_results.json

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createLevelState } from "../../src/engine/state.js";
import { tick } from "../../src/engine/simulation.js";
import { LEVELS } from "../../src/engine/levels.js";
import { ARENA_W } from "../../src/engine/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DT_MS = 1000 / 60;
const SEEDS = Array.from({ length: 8 }, (_, i) => i * 7919 + 1); // 8 graines fixes, indépendantes

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

// --- Profils de joueur déterministes, du plus précis au moins précis -----
// Les 2 premiers reprennent les profils déjà utilisés par
// tests/levels-reachability.test.js (validés depuis V1) -- mesuré
// empiriquement (voir rapport) : seuls avec le tirage de bonus désactivé,
// ces 2 profils ne perdent jamais de vie sur aucun des 50 niveaux. Ils
// servent de référence "joueur expert/bon", insuffisante à elle seule pour
// une étude de vies -- d'où l'ajout de 3 profils modélisant un délai de
// réaction (la raquette suit une position RETARDÉE de la balle, jamais la
// position instantanée) et, pour les moins précis, des fenêtres de
// "décrochage" (distraction ponctuelle, doigt immobile). Cela reste un
// modèle du JOUEUR, jamais une modification des niveaux ou de la difficulté
// du jeu eux-mêmes -- aucun niveau n'est retouché par cette étude.
function makePlayer({ name, lagMs, freezeEveryMs, freezeDurationMs, noiseFn }) {
  return { name, lagMs, freezeEveryMs, freezeDurationMs, noiseFn };
}

const PLAYERS = [
  makePlayer({ name: "Expert", lagMs: 0, freezeEveryMs: 0, freezeDurationMs: 0, noiseFn: (t) => Math.sin(t * 0.013) * 15 }),
  makePlayer({ name: "Bon", lagMs: 0, freezeEveryMs: 0, freezeDurationMs: 0, noiseFn: (t) => Math.sin(t * 0.021 + 1.7) * 25 + Math.sin(t * 0.007) * 8 }),
  makePlayer({ name: "Moyen", lagMs: 60, freezeEveryMs: 0, freezeDurationMs: 0, noiseFn: (t) => Math.sin(t * 0.017) * 35 + Math.sin(t * 0.041) * 10 }),
  makePlayer({ name: "Faible", lagMs: 120, freezeEveryMs: 2500, freezeDurationMs: 150, noiseFn: (t) => Math.sin(t * 0.023) * 55 + Math.sin(t * 0.061) * 15 }),
  makePlayer({ name: "Debutant", lagMs: 200, freezeEveryMs: 1500, freezeDurationMs: 250, noiseFn: (t) => Math.sin(t * 0.031) * 80 + Math.sin(t * 0.089) * 20 }),
];

function simulateOneLevelAttempt(levelIndex, player, startingLives, maxSeconds) {
  const state = createLevelState(levelIndex, { lives: startingLives, score: 0 });
  let elapsed = 0;
  let launched = false;
  const ballXHistory = [];
  let livesLostThisAttempt = 0;
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
      } else {
        frozenPointerX = null;
      }
    }

    const input = { pointerX, launchRequested: !launched, fire: false };
    launched = true;
    tick(state, DT_MS, input);
    for (const ev of state.events) if (ev.type === "life_lost") livesLostThisAttempt++;
    elapsed += DT_MS;
    if (state.status === "won" || state.status === "lost") break;
  }

  return {
    status: state.status,
    livesRemaining: state.status === "lost" ? 0 : state.lives,
    livesLostThisAttempt,
  };
}

function simulateCampaign(player, policy, restorePeriod = null) {
  let lives = 3;
  let gameOverCount = 0;
  let totalLivesLost = 0;
  let levelIndex = 0;
  let guard = 0;
  const gameOverLevelIds = [];

  while (levelIndex < LEVELS.length && guard < LEVELS.length * 6) {
    guard++;
    let startingLives;
    if (policy === "A") startingLives = lives;
    else if (policy === "B") startingLives = 3;
    else if (policy === "C") startingLives = levelIndex % restorePeriod === 0 ? 3 : lives;
    if (startingLives <= 0) startingLives = 3;

    const bound = Math.max(150, LEVELS[levelIndex].targetSeconds[1] * 3);
    const result = simulateOneLevelAttempt(levelIndex, player, startingLives, bound);
    totalLivesLost += result.livesLostThisAttempt;

    if (result.status === "lost") {
      gameOverCount++;
      gameOverLevelIds.push(LEVELS[levelIndex].id);
      lives = 3; // "Recommencer" réel (voir audit du code, showLevelResult(false))
      continue; // rejoue le même niveau, n'avance pas levelIndex
    }
    lives = result.livesRemaining;
    levelIndex++;
  }

  return { gameOverCount, totalLivesLost, gameOverLevelIds, completedAll: levelIndex >= LEVELS.length };
}

// Fait tourner une combinaison (joueur, politique) sur toutes les graines et
// agrège en une distribution -- jamais un seul tirage.
function runAcrossSeeds(player, policy, restorePeriod = null) {
  const perSeed = [];
  for (const seed of SEEDS) {
    Math.random = mulberry32(seed);
    perSeed.push(simulateCampaign(player, policy, restorePeriod));
  }
  const gameOverCounts = perSeed.map((r) => r.gameOverCount);
  const allGameOverLevelIds = perSeed.flatMap((r) => r.gameOverLevelIds);
  const mean = gameOverCounts.reduce((a, b) => a + b, 0) / gameOverCounts.length;
  return {
    player: player.name,
    policy: policy === "C" ? `C(N=${restorePeriod})` : policy,
    restorePeriod: restorePeriod ?? null,
    seeds: SEEDS.length,
    gameOverMean: Math.round(mean * 100) / 100,
    gameOverMin: Math.min(...gameOverCounts),
    gameOverMax: Math.max(...gameOverCounts),
    totalLivesLostMean: Math.round((perSeed.reduce((s, r) => s + r.totalLivesLost, 0) / perSeed.length) * 100) / 100,
    gameOverLevelIdHistogram: allGameOverLevelIds.reduce((h, id) => ((h[id] = (h[id] || 0) + 1), h), {}),
  };
}

function main() {
  const originalRandom = Math.random;
  const rows = [];
  for (const player of PLAYERS) {
    process.stderr.write(`[progress] ${player.name} A...\n`);
    rows.push(runAcrossSeeds(player, "A"));
    process.stderr.write(`[progress] ${player.name} B...\n`);
    rows.push(runAcrossSeeds(player, "B"));
  }

  const gameOverLevelIdsUnderA = rows
    .filter((r) => r.policy === "A")
    .flatMap((r) => Object.entries(r.gameOverLevelIdHistogram).flatMap(([id, n]) => Array(n).fill(Number(id))));

  let scenarioC = null;
  let scenarioCReason;
  const candidatePeriods = [10, 20, 30];
  const totalGameOversA = rows.filter((r) => r.policy === "A").reduce((s, r) => s + r.gameOverMean, 0);
  const totalGameOversB = rows.filter((r) => r.policy === "B").reduce((s, r) => s + r.gameOverMean, 0);

  if (gameOverLevelIdsUnderA.length === 0) {
    scenarioCReason =
      "Aucun Game Over observé sous la politique A (comportement actuel), même avec les profils de joueur les moins précis simulés sur 15 graines -- un scénario C n'a aucune donnée à optimiser et n'est donc pas construit.";
  } else {
    const candidateResults = [];
    for (const period of candidatePeriods) {
      process.stderr.write(`[progress] C(N=${period})...\n`);
      const periodRows = PLAYERS.map((player) => runAcrossSeeds(player, "C", period));
      const totalGameOvers = periodRows.reduce((s, r) => s + r.gameOverMean, 0);
      candidateResults.push({ period, totalGameOversMean: Math.round(totalGameOvers * 100) / 100 });
      for (const r of periodRows) rows.push(r);
    }
    const sorted = [...gameOverLevelIdsUnderA].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // Un palier C n'est retenu comme recommandation que s'il se situe
    // STRICTEMENT entre A et B (moins de Game Over que A, mais au moins
    // autant que B) -- sinon il n'apporte rien que A ou B n'offre déjà.
    const usefulCandidates = candidateResults.filter(
      (c) => c.totalGameOversMean < totalGameOversA && c.totalGameOversMean > totalGameOversB
    );
    scenarioCReason =
      `Game Over sous A concentrés autour du niveau ${median} (médiane, ${gameOverLevelIdsUnderA.length} occurrences sur ${SEEDS.length} graines x profils). ` +
      `Total moyen de Game Over -- A: ${totalGameOversA.toFixed(2)}, B: ${totalGameOversB.toFixed(2)}. ` +
      `Paliers candidats : ${candidateResults.map((c) => `N=${c.period}->${c.totalGameOversMean}`).join(", ")}. ` +
      (usefulCandidates.length > 0
        ? `${usefulCandidates.length} palier(s) offrent un compromis réel (strictement entre A et B).`
        : `Aucun palier testé n'offre un compromis strictement entre A et B -- C n'apporte donc rien que A ou B n'offre déjà à lui seul.`);
    scenarioC = { candidateResults, medianGameOverLevelId: median, usefulCandidates };
  }

  Math.random = originalRandom;

  const output = {
    generatedAt: new Date().toISOString(),
    baseCommit: "7e5743ef233478ebb23a0058588882e5101285f0",
    seeds: SEEDS,
    players: PLAYERS.map((p) => ({ name: p.name, lagMs: p.lagMs, freezeEveryMs: p.freezeEveryMs, freezeDurationMs: p.freezeDurationMs })),
    scenarioCDecision: { built: scenarioC !== null, reason: scenarioCReason, ...(scenarioC || {}) },
    totalGameOversMeanByPolicy: { A: Math.round(totalGameOversA * 100) / 100, B: Math.round(totalGameOversB * 100) / 100 },
    rows,
  };

  writeFileSync(join(__dirname, "v5_lives_results.json"), JSON.stringify(output, null, 2));

  console.log("=== BREAKPOINT V5 — étude des vies (moyenne sur", SEEDS.length, "graines) ===\n");
  for (const policy of ["A", "B"]) {
    console.log(`Politique ${policy} :`);
    for (const r of rows.filter((r) => r.policy === policy)) {
      console.log(`  - ${r.player}: moyenne ${r.gameOverMean} Game Over (min ${r.gameOverMin}, max ${r.gameOverMax}) sur ${r.seeds} graines`);
    }
  }
  console.log("\nScénario C :", scenarioCReason);
}

main();
