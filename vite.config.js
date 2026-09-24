import { defineConfig } from "vite";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"));

// Identifiant de build 100% automatique (jamais maintenu à la main) :
// version de package.json + hash court du commit réellement construit.
// GITHUB_SHA (fourni par le runner CI) est prioritaire sur un `git`
// local, car un clone CI (actions/checkout) est parfois "shallow" et,
// surtout, GITHUB_SHA est la source de vérité du commit qui déclenche
// CE build précis -- directement motivé par l'incident de cache V2 où
// un déploiement à jour n'était pas distinguable d'un ancien depuis
// l'appareil de test (cahier des charges V3, section 8).
function resolveCommitHash() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "local"; // jamais bloquant pour un build hors dépôt git
  }
}

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
  },
  define: {
    __BUILD_ID__: JSON.stringify(`v${pkg.version}+${resolveCommitHash()}`),
  },
});
