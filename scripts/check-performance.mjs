// Mesure de performance réelle (Playwright, pas une estimation) : ouvre le
// build, force un scénario de stress (multiball + beaucoup de briques —
// cahier des charges section 2 : "tester les cas extrêmes"), échantillonne
// les intervalles entre frames pendant plusieurs secondes, rapporte le FPS
// moyen/minimum et le nombre de chutes sous 50fps. Ne conclut PAS que la
// sensation de jeu est bonne : seulement que le rendu ne s'écroule pas
// techniquement dans ce scénario.
import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 4174;
const BASE_URL = `http://localhost:${PORT}`;

function log(...args) {
  console.log("[check-performance]", ...args);
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  if (!existsSync(join(ROOT, "dist", "index.html"))) {
    log("dist/ absent, build...");
    const build = spawnSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
    if (build.status !== 0) throw new Error("build a échoué");
  }

  const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT,
    stdio: "ignore",
  });

  try {
    const ready = await waitForServer(BASE_URL, 20_000);
    if (!ready) throw new Error("le serveur de preview n'a jamais répondu");

    const knownChromiumPath = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
    const browser = await chromium.launch({
      executablePath: existsSync(knownChromiumPath) ? knownChromiumPath : undefined,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.click("#btn-play");
    await page.waitForTimeout(200);

    // Force un scénario de stress directement via l'état du jeu (accessible
    // en dev via une fenêtre globale exposée uniquement pour les scripts de
    // test — voir main.js) : beaucoup de briques déjà présentes (niveau
    // normal) + plusieurs balles simultanées + une seule pression pour lancer.
    await page.touchscreen.tap(195, 750);
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      window.__breakpointDebugAddBalls?.(6);
    });

    const samples = await page.evaluate(() => {
      return new Promise((resolve) => {
        const frameTimes = [];
        let last = performance.now();
        function loop(now) {
          frameTimes.push(now - last);
          last = now;
          if (frameTimes.length < 240) {
            requestAnimationFrame(loop);
          } else {
            resolve(frameTimes);
          }
        }
        requestAnimationFrame(loop);
      });
    });

    const fpsSamples = samples.slice(5).map((ms) => 1000 / ms); // ignore la 1ère frame (souvent un pic de démarrage)
    const avgFps = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
    const minFps = Math.min(...fpsSamples);
    const under50 = fpsSamples.filter((f) => f < 50).length;
    const under30 = fpsSamples.filter((f) => f < 30).length;

    log(`FPS moyen: ${avgFps.toFixed(1)}, FPS minimum: ${minFps.toFixed(1)}`);
    log(`Frames sous 50fps: ${under50}/${fpsSamples.length}, sous 30fps: ${under30}/${fpsSamples.length}`);
    log(`Erreurs console pendant le test: ${consoleErrors.length}`, consoleErrors);

    await page.screenshot({ path: join(ROOT, "docs", "perf-stress-screenshot.png") });
    await browser.close();

    const result = { avgFps, minFps, under50, under30, totalSamples: fpsSamples.length, consoleErrors };
    const fs = await import("node:fs");
    fs.writeFileSync(join(ROOT, "docs", "performance-results.json"), JSON.stringify(result, null, 2));
    log("Résultats écrits dans docs/performance-results.json");
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
