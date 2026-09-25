#!/usr/bin/env node
// BREAKPOINT V4 — modèle économique reproductible.
//
// Calcule les revenus publicitaires (interstitiel + rewarded), Premium et
// IAP cosmétique, nets de commission de plateforme, pour 3 scénarios
// (pessimiste/central/optimiste) x 6 paliers de MAU (10 à 1 000 000),
// conformément au cahier des charges V4. Aucune valeur n'est codée en dur
// dans le rapport PDF : ce script est la source de vérité, son JSON de
// sortie (v4_results.json) est ce que le rapport cite.
//
// Toutes les hypothèses de MARCHÉ (eCPM, conversion IAP, DAU/MAU, opt-in
// rewarded, commission de plateforme) sont sourcées dans le rapport avec
// leurs URLs -- ce fichier ne fait que les nommer et les combiner. Les
// hypothèses spécifiques à BREAKPOINT (fréquence des pubs, opt-in rewarded
// réduit par design anti-manipulation, cadence dérivée des 50 niveaux
// réels) sont marquées [HYPOTHÈSE PROJET] dans les commentaires.
//
// Exécution : node docs/economics/v4_model.mjs
// Sortie : docs/economics/v4_results.json (+ un résumé sur stdout)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAU_TIERS = [10, 100, 1000, 10000, 100000, 1000000];

// --- Coûts fixes (non liés à l'usage) ------------------------------------
const FIXED_COSTS = {
  googlePlayDevAccountOneTime: 25, // $, frais unique à vie (Google Play Console)
  appleDevAccountPerYear: 99, // $/an -- optionnel, seulement si sortie iOS également visée
  hostingPerMonth: 0, // GitHub Pages (gratuit) tant que sous le seuil souple de bande passante -- voir hostingRisk()
  adSdkIntegrationCost: 0, // AdMob : intégration gratuite, modèle de partage de revenu, aucun coût à l'impression pour l'éditeur
};

// --- Coût de bande passante (le seul coût qui croît avec l'usage) -------
// [FAIT] GitHub Pages : limite souple documentée de 100 Go/mois
// (docs.github.com/.../github-pages-limits). [FAIT] Cloudflare Pages :
// bande passante gratuite illimitée pour du contenu statique (site
// documenté, cf. rapport). BREAKPOINT est 100% statique (aucun backend,
// aucune fonction serveur) -- donc la migration Cloudflare Pages, si
// jamais nécessaire, a un coût de 0$ à toutes les échelles.
const SITE_WEIGHT_BYTES = 72 * 1024; // poids réel mesuré du build dist/ (voir rapport, section audit)
const CACHED_REVISIT_BYTES = 5 * 1024; // hypothèse prudente : requêtes conditionnelles + cache SW (V2/V3)
const GITHUB_PAGES_SOFT_LIMIT_GB = 100;

function estimateMonthlyBandwidthGB(dau, sessionsPerDay) {
  const sessionsPerMonth = dau * sessionsPerDay * 30;
  const worstCaseGB = (sessionsPerMonth * SITE_WEIGHT_BYTES) / 1024 ** 3;
  const cacheOptimizedGB = (sessionsPerMonth * CACHED_REVISIT_BYTES) / 1024 ** 3;
  return { worstCaseGB, cacheOptimizedGB };
}

// --- Paramètres de marché sourcés (partagés entre scénarios sauf mention) -
// Commission de plateforme (Google Play) : 15% "small business program"
// (<1M$/an, cas de BREAKPOINT à toutes les échelles étudiées ici -- voir
// vérification dans main()), 20% standard IAP au-delà (nouveau taux 2026,
// abaissé de 30%). Voir rapport pour sources.
const PLATFORM_COMMISSION = { base: 0.15, standard: 0.20, legacy: 0.30 };

// --- Scénarios ------------------------------------------------------------
// Chaque scénario est un jeu de paramètres complet et cohérent, pas
// seulement 2 curseurs isolés (contrairement au modèle V0). Les valeurs
// [FAIT] sont bornées par les fourchettes sourcées dans le rapport ; les
// choix de position DANS la fourchette et tous les paramètres propres à
// BREAKPOINT sont [HYPOTHÈSE].
const SCENARIOS = {
  pessimiste: {
    dauMauRatio: 0.08, // bas de fourchette casual solo [FAIT fourchette, position HYPOTHÈSE]
    sessionsPerDay: 2,
    interstitialImpressionsPerSession: 0.5, // [HYPOTHÈSE PROJET] cadence légère, voir section placement
    interstitialEcpm: 5, // bas de fourchette globale interstitiel 2026
    rewardedOptIn: 0.08, // très inférieur au benchmark générique (30-70%) -- voir justification anti-manipulation
    rewardedEcpm: 12,
    premiumMonthlyNewConversion: 0.004, // 0.4% des MAU achètent Premium ce mois-ci
    premiumCumulativePenetration: 0.02, // 2% des MAU possèdent déjà Premium (retire ces users du pool pub)
    iapMonthlyNewConversion: 0.002,
    platformCommission: PLATFORM_COMMISSION.base,
  },
  central: {
    dauMauRatio: 0.14,
    sessionsPerDay: 3,
    interstitialImpressionsPerSession: 1.0,
    interstitialEcpm: 9,
    rewardedOptIn: 0.18,
    rewardedEcpm: 20,
    premiumMonthlyNewConversion: 0.012,
    premiumCumulativePenetration: 0.06,
    iapMonthlyNewConversion: 0.006,
    platformCommission: PLATFORM_COMMISSION.base,
  },
  optimiste: {
    dauMauRatio: 0.20,
    sessionsPerDay: 4,
    interstitialImpressionsPerSession: 1.4,
    interstitialEcpm: 13,
    rewardedOptIn: 0.30,
    rewardedEcpm: 30,
    premiumMonthlyNewConversion: 0.025,
    premiumCumulativePenetration: 0.12,
    iapMonthlyNewConversion: 0.013,
    platformCommission: PLATFORM_COMMISSION.base,
  },
};

const PREMIUM_PRICE = 1.99; // EUR TTC -- validé par comparable direct (Space Outlaw facture exactement 1.99$ pour "remove ads")
const IAP_COSMETIC_PRICE = 0.99; // EUR TTC -- palier standard le plus bas de l'échelle de prix casual (0.99/1.99/4.99...)

function computeMonth(mau, scenarioName) {
  const s = SCENARIOS[scenarioName];
  const dau = mau * s.dauMauRatio;
  const sessionsPerMonth = dau * s.sessionsPerDay * 30;
  const adEligibleFraction = 1 - s.premiumCumulativePenetration; // Premium retire l'utilisateur de TOUTES les pubs (interstitiel + rewarded)
  const adEligibleSessions = sessionsPerMonth * adEligibleFraction;

  // Revenu pub : les eCPM benchmarks cités sont déjà nets pour l'éditeur
  // (le réseau publicitaire a déjà pris sa part avant de publier son
  // eCPM) -- aucune commission de plateforme supplémentaire ne s'applique
  // au revenu publicitaire, seulement à l'IAP/Premium via Billing.
  const interstitialRevenue =
    adEligibleSessions * s.interstitialImpressionsPerSession * (s.interstitialEcpm / 1000);
  const rewardedRevenue = adEligibleSessions * s.rewardedOptIn * (s.rewardedEcpm / 1000);
  const adsRevenueNet = interstitialRevenue + rewardedRevenue;

  const premiumRevenueGross = mau * s.premiumMonthlyNewConversion * PREMIUM_PRICE;
  const iapRevenueGross = mau * s.iapMonthlyNewConversion * IAP_COSMETIC_PRICE;
  const premiumRevenueNet = premiumRevenueGross * (1 - s.platformCommission);
  const iapRevenueNet = iapRevenueGross * (1 - s.platformCommission);

  const totalRevenueNet = adsRevenueNet + premiumRevenueNet + iapRevenueNet;

  const bandwidth = estimateMonthlyBandwidthGB(dau, s.sessionsPerDay);
  const hostingCost = 0; // voir estimateMonthlyBandwidthGB + note de migration Cloudflare Pages, coût nul aux deux hypothèses
  const variableCosts = hostingCost; // seul poste variable identifié ; commission déjà nette dans les lignes ci-dessus
  const fixedCostsMonthly = 0; // frais Google Play amortis (25$ unique) -- négligeable après le premier mois, voir rapport

  const totalCostsNet = variableCosts + fixedCostsMonthly;
  const netRevenue = totalRevenueNet - totalCostsNet;
  const netRevenuePerMau = netRevenue / mau;

  return {
    mau,
    scenario: scenarioName,
    dau: Math.round(dau),
    sessionsPerMonth: Math.round(sessionsPerMonth),
    interstitialRevenue: round2(interstitialRevenue),
    rewardedRevenue: round2(rewardedRevenue),
    adsRevenueNet: round2(adsRevenueNet),
    premiumRevenueGross: round2(premiumRevenueGross),
    premiumRevenueNet: round2(premiumRevenueNet),
    iapRevenueGross: round2(iapRevenueGross),
    iapRevenueNet: round2(iapRevenueNet),
    totalRevenueNet: round2(totalRevenueNet),
    variableCosts: round2(variableCosts),
    netRevenue: round2(netRevenue),
    netRevenuePerMau: round4(netRevenuePerMau),
    bandwidthWorstCaseGB: round2(bandwidth.worstCaseGB),
    bandwidthCacheOptimizedGB: round2(bandwidth.cacheOptimizedGB),
    exceedsGithubPagesSoftLimitWorstCase: bandwidth.worstCaseGB > GITHUB_PAGES_SOFT_LIMIT_GB,
    exceedsGithubPagesSoftLimitCacheOptimized: bandwidth.cacheOptimizedGB > GITHUB_PAGES_SOFT_LIMIT_GB,
  };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}
function round4(x) {
  return Math.round(x * 10000) / 10000;
}

// --- Seuil de rentabilité / délai de récupération -------------------------
// Coûts fixes pertinents : 25$ (Google Play, unique). Calcule le nombre de
// mois pour que le revenu net cumulé dépasse ce montant, par scénario, au
// palier de MAU le plus bas réaliste pour un lancement (1 000 MAU).
function computePayback(mau, scenarioName, fixedCostOneTime) {
  const month = computeMonth(mau, scenarioName);
  if (month.netRevenue <= 0) return null;
  return fixedCostOneTime / month.netRevenue;
}

// --- Analyse de sensibilité ------------------------------------------------
// Fait varier un paramètre à la fois autour du scénario central, à MAU
// constant (100 000, palier intermédiaire représentatif), et mesure
// l'effet sur le revenu net par MAU/mois.
function sensitivityAnalysis(mau = 100000) {
  const base = computeMonth(mau, "central").netRevenuePerMau;
  const overrides = [
    { label: "DAU/MAU 8% (vs 14% central)", patch: { dauMauRatio: 0.08 } },
    { label: "DAU/MAU 20% (vs 14% central)", patch: { dauMauRatio: 0.20 } },
    { label: "eCPM interstitiel 5$ (vs 9$ central)", patch: { interstitialEcpm: 5 } },
    { label: "eCPM interstitiel 13$ (vs 9$ central)", patch: { interstitialEcpm: 13 } },
    { label: "Opt-in rewarded 8% (vs 18% central)", patch: { rewardedOptIn: 0.08 } },
    { label: "Opt-in rewarded 30% (vs 18% central)", patch: { rewardedOptIn: 0.30 } },
    { label: "Conversion Premium 0.4%/mois (vs 1.2% central)", patch: { premiumMonthlyNewConversion: 0.004 } },
    { label: "Conversion Premium 2.5%/mois (vs 1.2% central)", patch: { premiumMonthlyNewConversion: 0.025 } },
    { label: "Commission plateforme 20% (vs 15% central)", patch: { platformCommission: 0.20 } },
    { label: "Commission plateforme 30% (vs 15% central, hors petit éditeur)", patch: { platformCommission: 0.30 } },
  ];
  const results = overrides.map(({ label, patch }) => {
    const scenario = { ...SCENARIOS.central, ...patch };
    const savedCentral = SCENARIOS.central;
    SCENARIOS.central = scenario;
    const value = computeMonth(mau, "central").netRevenuePerMau;
    SCENARIOS.central = savedCentral;
    const deltaPct = ((value - base) / base) * 100;
    return { label, netRevenuePerMau: round4(value), deltaVsCentralPct: round2(deltaPct) };
  });
  return { baseNetRevenuePerMau: round4(base), mau, results };
}

function main() {
  const table = [];
  for (const mau of MAU_TIERS) {
    for (const scenarioName of Object.keys(SCENARIOS)) {
      table.push(computeMonth(mau, scenarioName));
    }
  }

  const paybackAt1000 = {
    pessimiste: computePayback(1000, "pessimiste", FIXED_COSTS.googlePlayDevAccountOneTime),
    central: computePayback(1000, "central", FIXED_COSTS.googlePlayDevAccountOneTime),
    optimiste: computePayback(1000, "optimiste", FIXED_COSTS.googlePlayDevAccountOneTime),
  };

  // Vérifie explicitement la règle de viabilité : le coût variable moyen
  // par MAU ne doit jamais dépasser le revenu moyen par MAU, à AUCUNE
  // échelle testée -- et confirme si le seuil des 1M$/an (programme petit
  // éditeur Google Play) est franchi à un des paliers étudiés.
  const viability = table.map((row) => ({
    mau: row.mau,
    scenario: row.scenario,
    netRevenuePerMau: row.netRevenuePerMau,
    variableCostPerMau: round4(row.variableCosts / row.mau),
    viable: row.netRevenuePerMau >= 0,
    annualRevenueUsd: round2(row.totalRevenueNet * 12),
    exceedsSmallBusinessThreshold: row.totalRevenueNet * 12 > 1_000_000,
  }));

  const sensitivity = sensitivityAnalysis(100000);

  const output = {
    generatedAt: new Date().toISOString(),
    baseCommit: "b62b2f3c048a53ddded9a28dbdc8233694ee1863",
    fixedCosts: FIXED_COSTS,
    githubPagesSoftLimitGB: GITHUB_PAGES_SOFT_LIMIT_GB,
    siteWeightBytesMeasured: SITE_WEIGHT_BYTES,
    scenarios: SCENARIOS,
    premiumPriceEur: PREMIUM_PRICE,
    iapCosmeticPriceEur: IAP_COSMETIC_PRICE,
    monthlyTable: table,
    paybackMonthsAt1000MAU: paybackAt1000,
    viabilityCheck: viability,
    sensitivity,
  };

  const outPath = join(__dirname, "v4_results.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  const csvHeader = Object.keys(table[0]).join(",");
  const csvRows = table.map((row) => Object.values(row).join(","));
  writeFileSync(join(__dirname, "v4_results.csv"), [csvHeader, ...csvRows].join("\n"));

  console.log("=== BREAKPOINT V4 — résultats du modèle économique ===");
  console.log(`Écrit dans ${outPath}\n`);
  console.log("Revenu net par MAU/mois (central), échantillon de paliers :");
  for (const row of table.filter((r) => r.scenario === "central")) {
    console.log(
      `  MAU=${row.mau.toString().padStart(8)} | revenu net/mois=$${row.netRevenue.toFixed(2).padStart(10)} | net/MAU=$${row.netRevenuePerMau.toFixed(4)}`
    );
  }
  console.log("\nViabilité (coût variable jamais > revenu) :", viability.every((v) => v.viable) ? "OK sur tous les paliers/scénarios" : "ÉCHEC -- voir détail");
  console.log("\nPayback (frais Google Play 25$, 1000 MAU) :", paybackAt1000);
}

main();
