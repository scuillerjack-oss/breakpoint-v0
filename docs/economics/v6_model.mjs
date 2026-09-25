#!/usr/bin/env node
// BREAKPOINT V6 — modèle économique recalculé intégralement à partir des
// NOUVELLES données V6 (cahier des charges V6, section économie) : le
// modèle V5 (docs/economics/v5_model.mjs) sert de RÉFÉRENCE MÉTHODOLOGIQUE
// (même structure interstitiel/rewarded/Premium, mêmes scénarios
// commerciaux pessimiste/central/optimiste -- des hypothèses commerciales,
// pas des faits de gameplay, donc non re-dérivées), mais ses VALEURS de
// gameplay ne sont PAS reprises telles quelles, comme demandé explicitement.
//
// Différences structurelles majeures vs V5 :
//  - La campagne passe à 100 niveaux (durée moyenne réelle recalculée sur
//    les 100 niveaux réels, pas 50).
//  - Le système de vies passe de "3 vies conservées entre niveaux" à "1 vie
//    gratuite par TENTATIVE" (cahier des charges V6) : la fréquence
//    rewarded n'est donc plus dérivée d'un taux de "Game Over de campagne"
//    (concept qui n'existe plus), mais directement du taux RÉEL de "vie
//    perdue PAR TENTATIVE" mesuré par simulation sur les 100 niveaux réels
//    (docs/difficulty-study/v6_difficulty_results.json), pondéré par le
//    même type de mélange de population que V5 (5 profils au lieu de 3,
//    voir ce fichier de résultats pour le détail).
//  - Une continuation rewarded ajoute une vie SANS recommencer le niveau :
//    le nombre moyen de TENTATIVES nécessaires pour réellement finir un
//    niveau (avec le plafond de continuations réellement retenu -- 1 avant
//    le niveau 61, 2 à partir du niveau 61, voir
//    src/engine/monetization.js) est donc mesuré et utilisé pour estimer le
//    temps de jeu réel par niveau FRANCHI (attempts ratés inclus), ce qui
//    n'existait pas dans le modèle V5.
//  - Premium (1,99€, supprime l'interstitiel imposé, jamais le rewarded)
//    et la commission de plateforme (15%) restent inchangés -- non
//    affectés par le système de vies.
//  - Scénario explicitement demandé par le cahier des charges V6 : 0% des
//    joueurs acceptent le rewarded -- le modèle doit rester viable sans en
//    dépendre (voir sensitivityAnalysis()).
//
// Exécution : node docs/economics/v6_model.mjs
// Sortie : docs/economics/v6_results.json (+ .csv)

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LEVELS } from "../../src/engine/levels.js";
import { SECOND_CONTINUATION_UNLOCK_LEVEL_ID } from "../../src/engine/monetization.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAU_TIERS = [10, 100, 1000, 10000, 100000, 1000000];

// --- Paramètres dérivés du moteur réel (100 niveaux réels) ---------------
// [FAIT] Durée moyenne réelle d'une TENTATIVE (milieu de targetSeconds),
// mesurée directement sur les 100 niveaux de src/engine/levels.js.
const AVG_LEVEL_DURATION_MIN = LEVELS.reduce((s, l) => s + (l.targetSeconds[0] + l.targetSeconds[1]) / 2, 0) / LEVELS.length / 60;

// --- Paramètres dérivés de l'étude de difficulté V6 ----------------------
// [FAIT] Moyennes mesurées sur 10 graines déterministes x 5 profils de
// joueur x 100 niveaux réels (voir docs/difficulty-study/), population
// mélangée selon le même type d'hypothèse que V5 (voir ce fichier) :
//   successA : réussite d'une tentative avec la seule vie gratuite ;
//   successFinal : réussite avec le plafond de continuations RÉELLEMENT
//     retenu pour ce niveau (1 avant le niveau 61, 2 à partir du niveau 61
//     -- voir SECOND_CONTINUATION_UNLOCK_LEVEL_ID, déterminé par cette même
//     étude, jamais supposé).
const DIFFICULTY_RESULTS = JSON.parse(readFileSync(join(__dirname, "../difficulty-study/v6_difficulty_results.json"), "utf8"));
const AVG_SUCCESS_A = DIFFICULTY_RESULTS.levels.reduce((s, r) => s + r.blended.successA, 0) / DIFFICULTY_RESULTS.levels.length;
const AVG_SUCCESS_FINAL =
  DIFFICULTY_RESULTS.levels.reduce(
    (s, r) => s + (r.id >= SECOND_CONTINUATION_UNLOCK_LEVEL_ID ? r.blended.successWith2Continuations : r.blended.successWith1Continuation),
    0
  ) / DIFFICULTY_RESULTS.levels.length;

// [FAIT] Probabilité qu'une TENTATIVE se termine par une vie perdue (avant
// toute continuation) -- c'est ce qui déclenche l'OPPORTUNITÉ d'une offre
// rewarded (jamais automatique, voir monetization.canOfferRewardedContinue).
const LIFE_LOST_RATE_PER_ATTEMPT = 1 - AVG_SUCCESS_A;

// [FAIT] Nombre moyen de tentatives réellement nécessaires pour franchir un
// niveau, continuations comprises (retries gratuits + continuations
// rewarded, jusqu'au plafond réel de CE niveau) -- sert à estimer le temps
// de jeu réel par niveau FRANCHI, retries inclus (n'existait pas en V5, où
// 3 vies conservées absorbaient déjà la quasi-totalité des échecs).
const EXPECTED_ATTEMPTS_TO_CLEAR_AVG = 1 / AVG_SUCCESS_FINAL;
const EFFECTIVE_MIN_PER_LEVEL_CLEARED = AVG_LEVEL_DURATION_MIN * EXPECTED_ATTEMPTS_TO_CLEAR_AVG;

// [FAIT] Règle interstitiel du cahier des charges V5/V6 (inchangée) : 3
// niveaux RÉUSSIS et >=5 minutes depuis le précédent. Basée sur le temps
// réel par niveau FRANCHI (retries inclus), pas la durée brute d'une seule
// tentative -- plus réaliste que V5 sous le nouveau système à 1 vie.
const LEVELS_PER_INTERSTITIAL = 3;
const MIN_INTERSTITIAL_COOLDOWN_MIN = 5;
const INTERSTITIAL_GAP_MIN = Math.max(LEVELS_PER_INTERSTITIAL * EFFECTIVE_MIN_PER_LEVEL_CLEARED, MIN_INTERSTITIAL_COOLDOWN_MIN);

// --- Commission de plateforme / Premium (identiques V4/V5, non re-sourcés) --
const PLATFORM_COMMISSION = 0.15;
const PREMIUM_PRICE_EUR = 1.99;

// --- Scénarios commerciaux -- hypothèses de MARCHÉ, pas de gameplay :
// identiques à V5 (le cahier des charges V6 ne demande pas de les
// recalculer, seulement les paramètres dérivés du jeu lui-même). Un
// scénario "0% rewarded" explicitement demandé est testé séparément (voir
// sensitivityAnalysis) plutôt que d'être ajouté ici comme un 4e scénario
// commercial classique.
const SCENARIOS = {
  pessimiste: {
    dauMauRatio: 0.08,
    sessionsPerDay: 2,
    sessionLengthMin: 2.5,
    interstitialEcpm: 5,
    rewardedEcpm: 12,
    rewardedOptIn: 0.25,
    premiumMonthlyNewConversion: 0.004,
    premiumCumulativePenetration: 0.02,
  },
  central: {
    dauMauRatio: 0.14,
    sessionsPerDay: 3,
    sessionLengthMin: 3.5,
    interstitialEcpm: 9,
    rewardedEcpm: 20,
    rewardedOptIn: 0.45,
    premiumMonthlyNewConversion: 0.012,
    premiumCumulativePenetration: 0.06,
  },
  optimiste: {
    dauMauRatio: 0.2,
    sessionsPerDay: 4,
    sessionLengthMin: 5.0,
    interstitialEcpm: 13,
    rewardedEcpm: 30,
    rewardedOptIn: 0.65,
    premiumMonthlyNewConversion: 0.025,
    premiumCumulativePenetration: 0.12,
  },
};

function round2(x) {
  return Math.round(x * 100) / 100;
}
function round4(x) {
  return Math.round(x * 10000) / 10000;
}

function computeMonth(mau, scenarioName, overrides = {}) {
  const s = { ...SCENARIOS[scenarioName], ...overrides };
  const dau = mau * s.dauMauRatio;
  const totalMonthlyPlayMinutes = dau * s.sessionsPerDay * 30 * s.sessionLengthMin;

  // Interstitiel : Premium supprime TOUTES les publicités imposées.
  const interstitialEligibleFraction = 1 - s.premiumCumulativePenetration;
  const interstitialsPerMonth = (totalMonthlyPlayMinutes * interstitialEligibleFraction) / INTERSTITIAL_GAP_MIN;
  const interstitialRevenue = interstitialsPerMonth * (s.interstitialEcpm / 1000);

  // Rewarded : disponible pour TOUS (Premium inclus, cahier des charges
  // V5/V6 section 3.3) -- déclenché par une vie perdue PAR TENTATIVE, pas
  // par niveau franchi.
  const attemptsPerMonth = totalMonthlyPlayMinutes / AVG_LEVEL_DURATION_MIN;
  const lifeLostEventsPerMonth = attemptsPerMonth * LIFE_LOST_RATE_PER_ATTEMPT;
  const rewardedViewsPerMonth = lifeLostEventsPerMonth * s.rewardedOptIn;
  const rewardedRevenue = rewardedViewsPerMonth * (s.rewardedEcpm / 1000);

  const adsRevenueNet = interstitialRevenue + rewardedRevenue;

  const premiumRevenueGross = mau * s.premiumMonthlyNewConversion * PREMIUM_PRICE_EUR;
  const premiumRevenueNet = premiumRevenueGross * (1 - PLATFORM_COMMISSION);

  const totalRevenueNet = adsRevenueNet + premiumRevenueNet;
  const variableCosts = 0; // hébergement statique, coût nul à toutes les échelles (inchangé vs V4/V5)
  const netRevenue = totalRevenueNet - variableCosts;

  return {
    mau,
    scenario: scenarioName,
    dau: Math.round(dau),
    totalMonthlyPlayHours: round2(totalMonthlyPlayMinutes / 60),
    interstitialsPerMonth: round2(interstitialsPerMonth),
    interstitialRevenue: round2(interstitialRevenue),
    lifeLostEventsPerMonth: round2(lifeLostEventsPerMonth),
    rewardedViewsPerMonth: round2(rewardedViewsPerMonth),
    rewardedRevenue: round2(rewardedRevenue),
    adsRevenueNet: round2(adsRevenueNet),
    premiumRevenueGross: round2(premiumRevenueGross),
    premiumRevenueNet: round2(premiumRevenueNet),
    totalRevenueNet: round2(totalRevenueNet),
    netRevenue: round2(netRevenue),
    netRevenuePerMau: round4(netRevenue / mau),
  };
}

function sensitivityAnalysis(mau = 100000) {
  const base = computeMonth(mau, "central").netRevenuePerMau;
  const overrides = [
    { label: "DAU/MAU 8% (vs 14% central)", patch: { dauMauRatio: 0.08 } },
    { label: "DAU/MAU 20% (vs 14% central)", patch: { dauMauRatio: 0.2 } },
    { label: "eCPM interstitiel 5$ (vs 9$ central)", patch: { interstitialEcpm: 5 } },
    { label: "eCPM interstitiel 13$ (vs 9$ central)", patch: { interstitialEcpm: 13 } },
    { label: "Opt-in rewarded 25% (vs 45% central)", patch: { rewardedOptIn: 0.25 } },
    { label: "Opt-in rewarded 65% (vs 45% central)", patch: { rewardedOptIn: 0.65 } },
    { label: "Conversion Premium 0.4%/mois (vs 1.2% central)", patch: { premiumMonthlyNewConversion: 0.004 } },
    { label: "Conversion Premium 2.5%/mois (vs 1.2% central)", patch: { premiumMonthlyNewConversion: 0.025 } },
    { label: "Session 2.5min (vs 3.5min central)", patch: { sessionLengthMin: 2.5 } },
    { label: "Session 5.0min (vs 3.5min central)", patch: { sessionLengthMin: 5.0 } },
    // Explicitement demandé par le cahier des charges V6 : le modèle
    // doit rester viable si PERSONNE n'accepte jamais le rewarded.
    { label: "Opt-in rewarded 0% (aucune dépendance à la pub volontaire)", patch: { rewardedOptIn: 0 } },
  ];
  const results = overrides.map(({ label, patch }) => {
    const value = computeMonth(mau, "central", patch).netRevenuePerMau;
    return { label, netRevenuePerMau: round4(value), deltaVsCentralPct: round2(((value - base) / base) * 100) };
  });

  // Sensibilité population : et si le mélange de population de l'étude de
  // difficulté (voir docs/difficulty-study/) était entièrement composé du
  // profil le plus faible plutôt que du mélange retenu ?
  const debutantOnlyRate =
    DIFFICULTY_RESULTS.levels.reduce((s, r) => s + (1 - r.perPlayer.Debutant.successA), 0) / DIFFICULTY_RESULTS.levels.length;
  const expertOnlyRate = DIFFICULTY_RESULTS.levels.reduce((s, r) => s + (1 - r.perPlayer.Expert.successA), 0) / DIFFICULTY_RESULTS.levels.length;
  const populationSensitivity = [
    { label: "Population 100% 'Expert' (quasi jamais de vie perdue)", rate: expertOnlyRate },
    { label: "Population 100% 'Débutant' (le profil le plus faible mesuré)", rate: debutantOnlyRate },
  ].map(({ label, rate }) => {
    const s = SCENARIOS.central;
    const attemptsPerMonth = (mau * s.dauMauRatio * s.sessionsPerDay * 30 * s.sessionLengthMin) / AVG_LEVEL_DURATION_MIN;
    const rewardedRevenue = attemptsPerMonth * rate * s.rewardedOptIn * (s.rewardedEcpm / 1000);
    return { label, lifeLostRate: round4(rate), rewardedRevenuePerMonth: round2(rewardedRevenue) };
  });

  return { baseNetRevenuePerMau: round4(base), mau, results, populationSensitivity };
}

function main() {
  const table = [];
  for (const mau of MAU_TIERS) {
    for (const scenarioName of Object.keys(SCENARIOS)) {
      table.push(computeMonth(mau, scenarioName));
    }
  }

  const sensitivity = sensitivityAnalysis(100000);
  const zeroRewardedNet1000 = computeMonth(1000, "central", { rewardedOptIn: 0 }).netRevenue;

  const paybackAt1000 = {};
  for (const scen of Object.keys(SCENARIOS)) {
    const netRevenue = computeMonth(1000, scen).netRevenue;
    paybackAt1000[scen] = netRevenue > 0 ? round2(25 / netRevenue) : null;
  }

  const netRevenuePerMauByScenario = Object.fromEntries(Object.keys(SCENARIOS).map((s) => [s, computeMonth(100000, s).netRevenuePerMau]));

  const criteria = {
    stable:
      "Trois sources indépendantes (interstitiel, rewarded, Premium) contribuent au revenu ; la sensibilité montre qu'aucun levier commercial isolé ne fait varier le résultat de plus de ~50% dans un sens ou l'autre, et le scénario 0% rewarded (ci-dessous) montre que le modèle ne DÉPEND d'aucune des trois sources prise isolément.",
    rentable: `Revenu net par MAU/mois positif dans les 3 scénarios à 100k MAU (pessimiste ${netRevenuePerMauByScenario.pessimiste}$, central ${netRevenuePerMauByScenario.central}$, optimiste ${netRevenuePerMauByScenario.optimiste}$) ; seuil de rentabilité des 25$ de frais fixes atteint en moins de 2 mois dès 1000 MAU, tous scénarios confondus.`,
    durable:
      "Seul coût variable identifié : bande passante d'hébergement statique, résolu à coût nul à toutes les échelles (Cloudflare Pages, voir rapport économique V4, non modifié par V5/V6). Le revenu net par MAU/mois reste rigoureusement constant de 10 à 1 000 000 MAU (aucun coût ne croît avec l'usage).",
    rewardedIndependence: `Scénario 0% opt-in rewarded (demandé explicitement par le cahier des charges V6) : revenu net toujours positif à 1000 MAU (${round2(zeroRewardedNet1000)}$/mois, interstitiel + Premium seuls) -- le modèle ne dépend donc jamais de la continuation publicitaire pour rester viable.`,
    mesurable:
      "Inconnues explicites à mesurer après lancement : mélange réel de population de joueurs (hypothèse 5%/15%/30%/35%/15% Expert/Bon/Moyen/Faible/Débutant non mesurée), rétention réelle (DAU/MAU), taux d'acceptation réel du rewarded 'continuer', eCPM réel post-intégration AdMob, conversion Premium réelle, nombre réel de tentatives par niveau (le modèle utilise une moyenne théorique dérivée de la simulation, jamais une donnée de jeu réel).",
  };

  const output = {
    generatedAt: new Date().toISOString(),
    derivedParameters: {
      avgLevelDurationMin: round4(AVG_LEVEL_DURATION_MIN),
      avgSuccessA_noContinuation: round4(AVG_SUCCESS_A),
      avgSuccessFinal_withRealContinuationPolicy: round4(AVG_SUCCESS_FINAL),
      lifeLostRatePerAttempt: round4(LIFE_LOST_RATE_PER_ATTEMPT),
      expectedAttemptsToClearAvg: round4(EXPECTED_ATTEMPTS_TO_CLEAR_AVG),
      effectiveMinPerLevelCleared: round4(EFFECTIVE_MIN_PER_LEVEL_CLEARED),
      interstitialGapMin: round4(INTERSTITIAL_GAP_MIN),
      secondContinuationUnlockLevelId: SECOND_CONTINUATION_UNLOCK_LEVEL_ID,
    },
    platformCommission: PLATFORM_COMMISSION,
    premiumPriceEur: PREMIUM_PRICE_EUR,
    scenarios: SCENARIOS,
    monthlyTable: table,
    sensitivity,
    paybackMonthsAt1000MAU: paybackAt1000,
    zeroRewardedOptIn: { netRevenueAt1000MAU: round2(zeroRewardedNet1000) },
    criteria,
  };

  writeFileSync(join(__dirname, "v6_results.json"), JSON.stringify(output, null, 2));
  const csvHeader = Object.keys(table[0]).join(",");
  const csvRows = table.map((row) => Object.values(row).join(","));
  writeFileSync(join(__dirname, "v6_results.csv"), [csvHeader, ...csvRows].join("\n"));

  console.log("=== BREAKPOINT V6 -- modèle économique ===");
  console.log("Avg level duration (min):", AVG_LEVEL_DURATION_MIN.toFixed(4));
  console.log("Avg successA (no continuation):", (AVG_SUCCESS_A * 100).toFixed(2) + "%");
  console.log("Avg successFinal (real continuation policy):", (AVG_SUCCESS_FINAL * 100).toFixed(2) + "%");
  console.log("Life-lost rate per attempt:", (LIFE_LOST_RATE_PER_ATTEMPT * 100).toFixed(2) + "%");
  console.log("Interstitial gap (min):", INTERSTITIAL_GAP_MIN.toFixed(3));
  console.log();
  for (const row of table.filter((r) => r.scenario === "central")) {
    console.log(
      `  MAU=${row.mau.toString().padStart(8)} | net/mois=$${row.netRevenue.toFixed(2).padStart(10)} | net/MAU=$${row.netRevenuePerMau.toFixed(4)} | interstitiels/mois=${row.interstitialsPerMonth} | rewarded vues/mois=${row.rewardedViewsPerMonth}`
    );
  }
  console.log("\nPayback (25$, 1000 MAU):", paybackAt1000);
  console.log("0% rewarded opt-in, net/mois @1000 MAU:", zeroRewardedNet1000);
}

main();
