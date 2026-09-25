#!/usr/bin/env node
// BREAKPOINT V5 — modèle économique recalculé avec les paramètres RÉELLEMENT
// retenus par le propriétaire (cahier des charges V5, section 3), et non
// plus les hypothèses génériques de V4.
//
// Différences structurelles majeures vs V4 (docs/economics/v4_model.mjs) :
//  - L'interstitiel n'est plus une fréquence "par session" arbitraire : il
//    est dérivé de la RÈGLE RÉELLE (3 niveaux réussis ET >=5 minutes depuis
//    le précédent) combinée à la durée RÉELLE mesurée des 50 niveaux
//    (engine réel, pas un benchmark).
//  - Le rewarded n'est plus une opportunité "par session" arbitraire : sa
//    fréquence est dérivée de l'étude des vies V5
//    (docs/lives-study/v5_lives_results.json), donc du taux RÉEL de Game
//    Over mesuré par simulation sur les 50 niveaux réels, pondéré par une
//    hypothèse de mélange de population de joueurs explicitement assumée
//    (aucune vraie donnée de rétention n'existe encore -- voir rapport).
//  - Premium supprime les interstitiels (ads imposées) mais PAS le
//    rewarded (qui reste une option volontaire même pour un joueur
//    Premium, conformément au cahier des charges V5 section 3.3).
//  - Aucun IAP cosmétique (explicitement exclu du scénario de base V5).
//
// Exécution : node docs/economics/v5_model.mjs
// Sortie : docs/economics/v5_results.json (+ .csv)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAU_TIERS = [10, 100, 1000, 10000, 100000, 1000000];

// --- Paramètres dérivés du moteur réel (mesurés, pas des benchmarks) ------
// [FAIT] Durée moyenne réelle d'un niveau (milieu de targetSeconds), mesurée
// directement sur les 50 niveaux de src/engine/levels.js (voir audit V5).
const AVG_LEVEL_DURATION_MIN = 119.78 / 60; // ≈ 1.996 min

// [FAIT] Règle interstitiel du cahier des charges V5 (section 3.1).
const LEVELS_PER_INTERSTITIAL = 3;
const MIN_INTERSTITIAL_COOLDOWN_MIN = 5;
// Le temps nécessaire pour réussir 3 niveaux (≈6.0 min) dépasse déjà le
// garde-fou de 5 minutes -- c'est donc la condition "3 niveaux" qui est
// structurellement la plus contraignante des deux, pas le minuteur.
const INTERSTITIAL_GAP_MIN = Math.max(LEVELS_PER_INTERSTITIAL * AVG_LEVEL_DURATION_MIN, MIN_INTERSTITIAL_COOLDOWN_MIN);

// --- Paramètres dérivés de l'étude des vies V5 (docs/lives-study) --------
// [FAIT] Moyennes mesurées sur 8 graines déterministes, politique A
// (comportement actuel, RETENU -- voir rapport de simulation des vies) :
// Game Over par campagne complète de 50 niveaux, par profil de joueur.
const GAME_OVERS_PER_CAMPAIGN_BY_PROFILE = {
  expertBonMoyen: 0, // 3 profils sur 5 : jamais de Game Over
  faible: 12.13,
  debutant: 15.75,
};
// [HYPOTHÈSE] Mélange de population -- aucune vraie donnée de rétention
// BREAKPOINT n'existe encore (comme documenté dans le rapport économique
// V4). Le retour de bêta positif suggère une majorité de joueurs à l'aise
// (poids dominant sur "jamais de Game Over"), une minorité réelle mais
// non négligeable rencontrant une difficulté réelle -- cohérent avec le
// positionnement casual/niche déjà établi (études V0/V4).
const POPULATION_MIX = { shareNoGameOver: 0.5, shareFaible: 0.35, shareDebutant: 0.15 };
const GAME_OVERS_PER_CAMPAIGN_BLENDED =
  POPULATION_MIX.shareNoGameOver * GAME_OVERS_PER_CAMPAIGN_BY_PROFILE.expertBonMoyen +
  POPULATION_MIX.shareFaible * GAME_OVERS_PER_CAMPAIGN_BY_PROFILE.faible +
  POPULATION_MIX.shareDebutant * GAME_OVERS_PER_CAMPAIGN_BY_PROFILE.debutant;
const TOTAL_ATTEMPTS_PER_CAMPAIGN_BLENDED = 50 + GAME_OVERS_PER_CAMPAIGN_BLENDED; // 50 niveaux réussis + N échecs
const GAME_OVER_RATE_PER_ATTEMPT = GAME_OVERS_PER_CAMPAIGN_BLENDED / TOTAL_ATTEMPTS_PER_CAMPAIGN_BLENDED;

// --- Commission de plateforme (identique V4, toujours valide -- voir
// rapport économique V4 section 2.2, non re-sourcée ici) ------------------
const PLATFORM_COMMISSION = 0.15; // programme "petit éditeur" Google Play, <1M$/an

const PREMIUM_PRICE_EUR = 1.99; // cahier des charges V5, section 3.3 -- validé par comparable direct (voir rapport V4)

// --- Scénarios --------------------------------------------------------
// Les paramètres de POPULATION/JEU (durée de niveau, taux de Game Over)
// restent IDENTIQUES entre les 3 scénarios -- ce sont des faits de gameplay
// mesurés, pas des leviers économiques. Seuls les paramètres commerciaux
// usuels varient (conformément au principe du cahier : "l'économie doit
// s'adapter au jeu, jamais l'inverse").
const SCENARIOS = {
  pessimiste: {
    dauMauRatio: 0.08,
    sessionsPerDay: 2,
    sessionLengthMin: 2.5,
    interstitialEcpm: 5,
    rewardedEcpm: 12,
    rewardedOptIn: 0.25, // accepter l'offre "regarder une pub pour continuer" -- bas de la fourchette 2026 rafraîchie (V4 section 2.2)
    premiumMonthlyNewConversion: 0.004,
    premiumCumulativePenetration: 0.02,
  },
  central: {
    dauMauRatio: 0.14,
    sessionsPerDay: 3,
    sessionLengthMin: 3.5,
    interstitialEcpm: 9,
    rewardedEcpm: 20,
    rewardedOptIn: 0.45, // offre "continuer" à valeur immédiate et claire -- convertit mieux qu'un rewarded générique (voir rapport, [HYPOTHÈSE] documentée)
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

function computeMonth(mau, scenarioName) {
  const s = SCENARIOS[scenarioName];
  const dau = mau * s.dauMauRatio;
  const totalMonthlyPlayMinutes = dau * s.sessionsPerDay * 30 * s.sessionLengthMin;

  // Interstitiel : Premium supprime TOUTES les publicités imposées -- le
  // pool éligible exclut donc les joueurs Premium (pénétration cumulée).
  const interstitialEligibleFraction = 1 - s.premiumCumulativePenetration;
  const interstitialsPerMonth = (totalMonthlyPlayMinutes * interstitialEligibleFraction) / INTERSTITIAL_GAP_MIN;
  const interstitialRevenue = interstitialsPerMonth * (s.interstitialEcpm / 1000);

  // Rewarded : reste disponible pour TOUS les joueurs, y compris Premium
  // (cahier des charges V5, section 3.3 -- jamais imposée, mais jamais
  // retirée non plus). Le pool n'est donc PAS réduit par le Premium ici.
  const attemptsPerMonth = totalMonthlyPlayMinutes / AVG_LEVEL_DURATION_MIN;
  const gameOversPerMonth = attemptsPerMonth * GAME_OVER_RATE_PER_ATTEMPT;
  const rewardedViewsPerMonth = gameOversPerMonth * s.rewardedOptIn;
  const rewardedRevenue = rewardedViewsPerMonth * (s.rewardedEcpm / 1000);

  const adsRevenueNet = interstitialRevenue + rewardedRevenue; // eCPM déjà net pour l'éditeur (voir V4 section méthodologie)

  const premiumRevenueGross = mau * s.premiumMonthlyNewConversion * PREMIUM_PRICE_EUR;
  const premiumRevenueNet = premiumRevenueGross * (1 - PLATFORM_COMMISSION);

  const totalRevenueNet = adsRevenueNet + premiumRevenueNet;
  const variableCosts = 0; // voir section viabilité -- hébergement statique, coût nul à toutes les échelles (inchangé vs V4)
  const netRevenue = totalRevenueNet - variableCosts;

  return {
    mau,
    scenario: scenarioName,
    dau: Math.round(dau),
    totalMonthlyPlayHours: round2(totalMonthlyPlayMinutes / 60),
    interstitialsPerMonth: round2(interstitialsPerMonth),
    interstitialRevenue: round2(interstitialRevenue),
    gameOversPerMonth: round2(gameOversPerMonth),
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

function round2(x) {
  return Math.round(x * 100) / 100;
}
function round4(x) {
  return Math.round(x * 10000) / 10000;
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
  ];
  const results = overrides.map(({ label, patch }) => {
    const saved = SCENARIOS.central;
    SCENARIOS.central = { ...saved, ...patch };
    const value = computeMonth(mau, "central").netRevenuePerMau;
    SCENARIOS.central = saved;
    return { label, netRevenuePerMau: round4(value), deltaVsCentralPct: round2(((value - base) / base) * 100) };
  });

  // Sensibilité spécifique V5 : le mélange de population des vies (le seul
  // paramètre gameplay non mesuré directement -- une hypothèse) fait-il
  // basculer la conclusion "durable" ? Testé séparément des leviers
  // commerciaux ci-dessus.
  const populationSensitivity = [
    { label: "Population 100% joueurs à l'aise (0 Game Over)", rate: 0 },
    { label: "Population 100% 'Faible' (12.13 GO/campagne)", rate: 12.13 / (50 + 12.13) },
    { label: "Population 100% 'Débutant' (15.75 GO/campagne)", rate: 15.75 / (50 + 15.75) },
  ].map(({ label, rate }) => {
    const attemptsPerMonth =
      (mau * SCENARIOS.central.dauMauRatio * SCENARIOS.central.sessionsPerDay * 30 * SCENARIOS.central.sessionLengthMin) /
      AVG_LEVEL_DURATION_MIN;
    const rewardedRevenue =
      attemptsPerMonth * rate * SCENARIOS.central.rewardedOptIn * (SCENARIOS.central.rewardedEcpm / 1000);
    return { label, rewardedRevenuePerMonth: round2(rewardedRevenue) };
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

  // Seuil de rentabilité : coûts fixes = 25$ (compte Google Play, unique).
  const paybackAt1000 = {};
  for (const scen of Object.keys(SCENARIOS)) {
    const netRevenue = computeMonth(1000, scen).netRevenue;
    paybackAt1000[scen] = netRevenue > 0 ? round2(25 / netRevenue) : null;
  }

  // Critères stable/rentable/durable, évalués explicitement à partir des
  // résultats ci-dessus (voir rapport pour la discussion complète).
  const netRevenuePerMauByScenario = Object.fromEntries(
    Object.keys(SCENARIOS).map((s) => [s, computeMonth(100000, s).netRevenuePerMau])
  );
  const criteria = {
    stable:
      "Le revenu ne repose pas sur un seul paramètre fragile : trois sources indépendantes (interstitiel, rewarded, Premium) contribuent, et la sensibilité (section suivante) montre qu'aucun paramètre isolé ne fait varier le résultat de plus de ~45% dans un sens ou l'autre.",
    rentable: `Revenu net par MAU/mois positif dans les 3 scénarios à 100k MAU (pessimiste ${netRevenuePerMauByScenario.pessimiste}$, central ${netRevenuePerMauByScenario.central}$, optimiste ${netRevenuePerMauByScenario.optimiste}$) ; seuil de rentabilité des 25$ de frais fixes atteint en moins de 2 mois dès 1000 MAU, tous scénarios confondus.`,
    durable:
      "Coût variable identifié : uniquement la bande passante d'hébergement statique, dont le risque a été quantifié et résolu à coût nul (migration Cloudflare Pages documentée, voir rapport économique V4 section 7, non modifiée par V5). Aucun autre coût ne croît avec l'usage : le revenu net par MAU/mois reste rigoureusement constant à toutes les échelles testées (10 à 1 000 000 MAU).",
    mesurable:
      "Inconnues explicites (voir rapport) : mélange réel de population de joueurs (hypothèse 50/35/15 non mesurée), rétention réelle (DAU/MAU), taux d'acceptation réel du rewarded 'continuer', eCPM réel post-intégration AdMob, conversion Premium réelle.",
  };

  const output = {
    generatedAt: new Date().toISOString(),
    baseCommit: "en cours (V5)",
    derivedParameters: {
      avgLevelDurationMin: round4(AVG_LEVEL_DURATION_MIN),
      interstitialGapMin: round4(INTERSTITIAL_GAP_MIN),
      gameOverRatePerAttempt: round4(GAME_OVER_RATE_PER_ATTEMPT),
      populationMix: POPULATION_MIX,
      gameOversPerCampaignBlended: round4(GAME_OVERS_PER_CAMPAIGN_BLENDED),
    },
    platformCommission: PLATFORM_COMMISSION,
    premiumPriceEur: PREMIUM_PRICE_EUR,
    scenarios: SCENARIOS,
    monthlyTable: table,
    sensitivity,
    paybackMonthsAt1000MAU: paybackAt1000,
    criteria,
  };

  writeFileSync(join(__dirname, "v5_results.json"), JSON.stringify(output, null, 2));
  const csvHeader = Object.keys(table[0]).join(",");
  const csvRows = table.map((row) => Object.values(row).join(","));
  writeFileSync(join(__dirname, "v5_results.csv"), [csvHeader, ...csvRows].join("\n"));

  console.log("=== BREAKPOINT V5 — modèle économique ===");
  console.log("Interstitial gap (min):", INTERSTITIAL_GAP_MIN.toFixed(3));
  console.log("Game Over rate/attempt (pop. blend):", (GAME_OVER_RATE_PER_ATTEMPT * 100).toFixed(2) + "%");
  console.log();
  for (const row of table.filter((r) => r.scenario === "central")) {
    console.log(
      `  MAU=${row.mau.toString().padStart(8)} | net/mois=$${row.netRevenue.toFixed(2).padStart(10)} | net/MAU=$${row.netRevenuePerMau.toFixed(4)} | interstitiels/mois=${row.interstitialsPerMonth} | rewarded vues/mois=${row.rewardedViewsPerMonth}`
    );
  }
  console.log("\nPayback (25$, 1000 MAU):", paybackAt1000);
}

main();
