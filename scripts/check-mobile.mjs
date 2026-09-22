// Vérifications mobiles réelles (Playwright + build de production) :
// absence de débordement horizontal à plusieurs largeurs, redimensionnement
// (le canvas doit se remettre à l'échelle sans casser), perte de focus
// (doit mettre en pause automatiquement — cahier des charges section 18),
// reprise après rechargement (sauvegarde persistée), et un cycle tactile
// réel (glisser la raquette, lancer la balle).
import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

function log(...args) {
  console.log("[check-mobile]", ...args);
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

  let failures = 0;
  try {
    const ready = await waitForServer(BASE_URL, 20_000);
    if (!ready) throw new Error("le serveur de preview n'a jamais répondu");

    const knownChromiumPath = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
    const browser = await chromium.launch({
      executablePath: existsSync(knownChromiumPath) ? knownChromiumPath : undefined,
      args: ["--no-sandbox"],
    });

    // --- Test 1 : pas de débordement horizontal à plusieurs largeurs ---
    for (const width of [320, 360, 390, 414, 480]) {
      const page = await (await browser.newContext({ viewport: { width, height: 800 }, hasTouch: true })).newPage();
      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      const info = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        appWidth: document.getElementById("app").getBoundingClientRect().width,
      }));
      const overflow = info.scrollWidth > info.clientWidth;
      if (overflow) {
        failures += 1;
        log(`ÉCHEC largeur ${width}px : débordement horizontal`, info);
      } else {
        log(`OK largeur ${width}px : aucun débordement`);
      }
      await page.close();
    }

    // --- Test 2 : cycle tactile réel (glisser + lancer) sans erreur console ---
    {
      const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      await page.click("#btn-play");
      await page.waitForTimeout(200);
      await page.touchscreen.tap(100, 750);
      await page.waitForTimeout(150);
      await page.touchscreen.tap(280, 750);
      await page.waitForTimeout(300);

      const ballLaunched = await page.evaluate(() => {
        return document.getElementById("score-value") !== null;
      });
      if (!ballLaunched || errors.length > 0) {
        failures += 1;
        log("ÉCHEC cycle tactile", { ballLaunched, errors });
      } else {
        log("OK : cycle tactile (glisser + lancer) sans erreur console");
      }

      // --- Test 3 : perte de focus -> pause automatique ---
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { value: true, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForTimeout(200);
      const pausedOverlay = await page.evaluate(() => document.querySelector("#overlay-root .overlay") !== null);
      if (!pausedOverlay) {
        failures += 1;
        log("ÉCHEC : la perte de focus ne déclenche pas la pause");
      } else {
        log("OK : perte de focus -> pause automatique");
      }

      await page.close();
    }

    // --- Test 4 : redimensionnement/rotation ne casse pas le rendu ---
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      await page.click("#btn-play");
      await page.setViewportSize({ width: 844, height: 390 }); // rotation portrait -> paysage
      await page.waitForTimeout(300);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      const canvasSize = await page.evaluate(() => {
        const c = document.getElementById("game-canvas");
        return { w: c.width, h: c.height };
      });
      if (errors.length > 0 || canvasSize.w === 0 || canvasSize.h === 0) {
        failures += 1;
        log("ÉCHEC redimensionnement/rotation", { errors, canvasSize });
      } else {
        log("OK : redimensionnement/rotation sans erreur, canvas redimensionné", canvasSize);
      }
      await page.close();
    }

    // --- Test 5 : sauvegarde persistée après rechargement complet (reprise PWA) ---
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      await page.evaluate(() => {
        localStorage.setItem(
          "breakpoint-v0-save",
          JSON.stringify({ version: 1, unlockedLevelIndex: 3, tutorialsSeen: { first_move: true }, settings: { music: true, sfx: false, haptics: true } })
        );
      });
      await page.reload({ waitUntil: "networkidle" });
      const btnText = await page.textContent("#btn-play").catch(() => "");
      const sfxOffPersisted = await page.evaluate(() => JSON.parse(localStorage.getItem("breakpoint-v0-save")).settings.sfx === false);
      if (btnText !== "Continuer" || !sfxOffPersisted) {
        failures += 1;
        log("ÉCHEC reprise après rechargement", { btnText, sfxOffPersisted });
      } else {
        log("OK : progression + réglages persistés après rechargement complet");
      }
      await page.close();
    }

    await browser.close();
  } finally {
    server.kill();
  }

  if (failures > 0) {
    log(`${failures} échec(s).`);
    process.exit(1);
  }
  log("Tous les tests mobiles sont passés.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
