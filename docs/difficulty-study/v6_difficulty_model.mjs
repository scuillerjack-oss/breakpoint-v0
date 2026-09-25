#!/usr/bin/env node
// BREAKPOINT V6 — étude reproductible du taux de réussite réel par niveau.
//
// Contrairement à tests/levels-reachability.test.js (qui vérifie seulement
// qu'un niveau est un jour terminable) et à l'étude de vies V5 (qui mesurait
// des Game Over sur une campagne complète sous l'ancien modèle "3 vies
// conservées"), cette étude mesure directement ce que demande le cahier des
// charges V6 : pour CHAQUE niveau, la probabilité de réussite —
//   A — avec la seule vie gratuite (aucune continuation) ;
//   avec au plus 1 continuation rewarded (mesure "C" du cahier) ;
//   avec au plus 2 continuations rewarded (mesure "B" du cahier, quand 2
//     continuations sont autorisées) ;
// — pour une population de joueurs mélangée (5 profils, voir PLAYERS),
// jamais un seul profil isolé.
//
// Principe : UNE SEULE simulation par (niveau, profil, graine), avec un
// nombre de vies de départ volontairement très généreux (jamais limitant en
// pratique), qui enregistre combien de vies auraient été perdues avant la
// victoire (ou l'absence de victoire dans la borne de temps). Les mesures
// A / "1 continuation" / "2 continuations" se lisent ensuite directement
// dans cette distribution (0, <=1, <=2 vies perdues) sans reformuler la
// politique de vies testée — bien plus efficace que 3 simulations séparées
// par échantillon, et strictement équivalent (une continuation rewarded
// n'est rien d'autre qu'une vie supplémentaire accordée avant que le statut
// ne devienne "lost", voir src/engine/state.js/simulation.js).
//
// Non-déterminisme réel géré comme en V5 (voir docs/lives-study/) : le
// tirage des bonus dans applyPowerUp() utilise Math.random() en jeu normal
// (comportement volontairement inchangé) ; ce script le remplace par un
// générateur à graine fixe UNIQUEMENT pendant l'exécution de l'étude,
// jamais dans le moteur lui-même.
//
// Exécution : node docs/difficulty-study/v6_difficulty_model.mjs
// Sortie : docs/difficulty-study/v6_difficulty_results.json

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createLevelState } from "../../src/engine/state.js";
import { tick } from "../../src/engine/simulation.js";
import { LEVELS } from "../../src/engine/levels.js";
import { ARENA_W } from "../../src/engine/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DT_MS = 1000 / 60;
const SEEDS_PER_PLAYER = 10; // voir en-tête : résolution ~ 1/(5*10) = 2%
const VERY_HIGH_LIVES = 30; // jamais limitant : sert seulement à ne jamais couper la mesure prématurément

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

// --- Profils de joueur : repris à l'identique de l'étude de vies V5 -------
// (voir docs/lives-study/v5_lives_model.mjs pour la justification complète
// de chaque paramètre). Seul ajout V6 : une variation continue (phase,
// amplitude, délai) tirée de la graine, pour que les 10 graines par profil
// donnent une vraie distribution intra-profil plutôt que 10 clones ne
// variant que par le tirage des bonus.
const BASE_PLAYERS = [
  { name: "Expert", lagMs: 0, freezeEveryMs: 0, freezeDurationMs: 0, noiseFn: (t) => Math.sin(t * 0.013) * 15 },
  { name: "Bon", lagMs: 0, freezeEveryMs: 0, freezeDurationMs: 0, noiseFn: (t) => Math.sin(t * 0.021 + 1.7) * 25 + Math.sin(t * 0.007) * 8 },
  { name: "Moyen", lagMs: 60, freezeEveryMs: 0, freezeDurationMs: 0, noiseFn: (t) => Math.sin(t * 0.017) * 35 + Math.sin(t * 0.041) * 10 },
  { name: "Faible", lagMs: 120, freezeEveryMs: 2500, freezeDurationMs: 150, noiseFn: (t) => Math.sin(t * 0.023) * 55 + Math.sin(t * 0.061) * 15 },
  { name: "Debutant", lagMs: 200, freezeEveryMs: 1500, freezeDurationMs: 250, noiseFn: (t) => Math.sin(t * 0.031) * 80 + Math.sin(t * 0.089) * 20 },
];

// Mélange de population -- HYPOTHÈSE explicite (documentée au rapport), pas
// une donnée mesurée : dérivée du même partage "50% sans Game Over / 35%
// Faible / 15% Débutant" déjà posé par l'étude économique V5, seulement
// éclaté en 5 profils au lieu de 3 (Expert+Bon+Moyen = 50%, Faible+Debutant
// = 50%, mêmes proportions internes que V5 pour rester cohérent).
const POPULATION_MIX = { Expert: 0.05, Bon: 0.15, Moyen: 0.3, Faible: 0.35, Debutant: 0.15 };

function jitteredPlayer(base, seed) {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const phase = rnd() * 6000;
  const ampJitter = 0.85 + rnd() * 0.3;
  const lagJitter = base.lagMs * (0.8 + rnd() * 0.4);
  return {
    ...base,
    lagMs: lagJitter,
    noiseFn: (t) => base.noiseFn(t + phase) * ampJitter,
  };
}

// Identique dans l'esprit à simulateOneLevelAttempt (V5, docs/lives-study/),
// mais avec un budget de vies volontairement énorme : on laisse la
// simulation aller jusqu'à la victoire (ou la borne de temps) et on compte
// combien de vies ont RÉELLEMENT été perdues au passage -- c'est cette
// distribution qui donne A / 1 continuation / 2 continuations d'un seul
// coup (voir en-tête).
// BUG réel trouvé et corrigé ici (voir aussi rapport V6, section audit) :
// le script d'étude des vies V5 (docs/lives-study/v5_lives_model.mjs)
// utilisait `let launched = false; ... launched = true;` pour ne demander
// le lancement qu'à la toute première frame -- correct SEULEMENT si la
// balle n'est jamais reperdue au cours d'une même tentative. Dès qu'une vie
// EST perdue en cours de route (état qui repasse à "ready", voir
// handleLifeLost() dans simulation.js), plus aucune frame ne redemandait de
// relancer : la simulation restait bloquée en "ready" jusqu'à la borne de
// temps, sans jamais pouvoir gagner après une perte de vie. Conséquence
// directe pour CETTE étude (qui mesure justement la réussite APRÈS
// continuation) : les mesures "+1 continuation"/"+2 continuations"
// auraient été mathématiquement identiques à la mesure "A" -- aucune
// tentative n'aurait jamais pu montrer qu'une continuation aide. Corrigé en
// redemandant le lancement à CHAQUE frame où l'état est "ready" (sans effet
// tant que le statut n'est pas "ready", voir tick()) plutôt qu'une seule
// fois. Cette même correction s'applique potentiellement à l'étude V5 des
// vies (voir rapport V6, limite documentée sur les chiffres V5).
function simulateAttempt(levelIndex, player, maxSeconds) {
  const state = createLevelState(levelIndex, { lives: VERY_HIGH_LIVES, score: 0 });
  let elapsed = 0;
  const ballXHistory = [];
  let livesLost = 0;
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

    const input = { pointerX, launchRequested: state.status === "ready", fire: false };
    tick(state, DT_MS, input);
    for (const ev of state.events) if (ev.type === "life_lost") livesLost++;
    elapsed += DT_MS;
    if (state.status === "won" || state.status === "lost") break;
  }

  return { status: state.status, livesLost, elapsedS: elapsed / 1000 };
}

function studyBoundSeconds(level) {
  // Généreuse (>= celle du test de terminabilité, x3) : un "timeout" ici ne
  // doit refléter qu'un niveau réellement bloqué pour ce profil, jamais un
  // joueur simplement lent -- la vraie mécanique de fin d'attempt reste la
  // perte de vies (voir handleLifeLost), pas une horloge. Les profils
  // Faible/Debutant (délai de réaction + décrochages) ont besoin de plus de
  // marge que les profils sans délai déjà couverts par tests/levels-
  // reachability.test.js, d'où x4 au lieu de x3 ici.
  return Math.max(200, level.targetSeconds[1] * 4);
}

function studyLevel(levelIndex) {
  const level = LEVELS[levelIndex];
  const bound = studyBoundSeconds(level);
  const perPlayer = {};
  for (const base of BASE_PLAYERS) {
    let n = 0;
    let nA = 0; // livesLost === 0
    let nC1 = 0; // livesLost <= 1
    let nB2 = 0; // livesLost <= 2
    let nTimeout = 0;
    for (let s = 0; s < SEEDS_PER_PLAYER; s++) {
      const seed = level.id * 1_000_003 + BASE_PLAYERS.indexOf(base) * 97 + s;
      Math.random = mulberry32(seed);
      const player = jitteredPlayer(base, seed);
      const result = simulateAttempt(levelIndex, player, bound);
      n++;
      if (result.status !== "won") {
        nTimeout++;
        continue; // ni A, ni C1, ni B2 : n'a jamais fini dans la borne, quel que soit le nombre de vies
      }
      if (result.livesLost === 0) nA++;
      if (result.livesLost <= 1) nC1++;
      if (result.livesLost <= 2) nB2++;
    }
    perPlayer[base.name] = {
      successA: nA / n,
      successWith1Continuation: nC1 / n,
      successWith2Continuations: nB2 / n,
      timeoutRate: nTimeout / n,
    };
  }
  const blended = { successA: 0, successWith1Continuation: 0, successWith2Continuations: 0 };
  for (const [name, weight] of Object.entries(POPULATION_MIX)) {
    blended.successA += perPlayer[name].successA * weight;
    blended.successWith1Continuation += perPlayer[name].successWith1Continuation * weight;
    blended.successWith2Continuations += perPlayer[name].successWith2Continuations * weight;
  }
  return { id: level.id, name: level.name, perPlayer, blended };
}

function main() {
  const originalRandom = Math.random;
  const results = [];
  const t0 = Date.now();
  for (let i = 0; i < LEVELS.length; i++) {
    results.push(studyLevel(i));
    if ((i + 1) % 10 === 0) {
      process.stderr.write(`[progress] ${i + 1}/${LEVELS.length} niveaux (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
    }
  }
  Math.random = originalRandom;

  const output = {
    generatedAt: new Date().toISOString(),
    seedsPerPlayer: SEEDS_PER_PLAYER,
    populationMix: POPULATION_MIX,
    players: BASE_PLAYERS.map((p) => ({ name: p.name, lagMs: p.lagMs, freezeEveryMs: p.freezeEveryMs, freezeDurationMs: p.freezeDurationMs })),
    levels: results,
  };
  writeFileSync(join(__dirname, "v6_difficulty_results.json"), JSON.stringify(output, null, 2));

  console.log("=== BREAKPOINT V6 -- taux de réussite mesuré (population mélangée) ===");
  for (const r of results) {
    console.log(
      `Niveau ${String(r.id).padStart(3)} ${r.name.padEnd(24)} A=${(r.blended.successA * 100).toFixed(1)}%  +1cont=${(r.blended.successWith1Continuation * 100).toFixed(1)}%  +2cont=${(r.blended.successWith2Continuations * 100).toFixed(1)}%`
    );
  }
}

main();
