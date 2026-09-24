// Vérifications mobiles réelles (Playwright + build de production) :
// absence de débordement horizontal à plusieurs largeurs, redimensionnement
// (le canvas doit se remettre à l'échelle sans casser), perte de focus
// (doit mettre en pause automatiquement — cahier des charges section 18),
// reprise après rechargement (sauvegarde persistée), et un cycle tactile
// réel (glisser la raquette, lancer la balle).
import { chromium } from "playwright";
import { spawn, spawnSync, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

    // --- Test 6 (V1) : contrôle tactile relatif réel -- aucun saut au
    // toucher initial, déplacement relatif correct, aucune téléportation
    // après un relâchement puis un nouveau toucher ailleurs (cahier des
    // charges V1, sections 4 et 9). Utilise la souris (mêmes événements
    // Pointer que le tactile réel, voir input.js) car Playwright n'offre
    // pas de "glisser" tactile haut niveau simple à driver précisément.
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      await page.click("#btn-play");
      await page.waitForTimeout(150);

      const centerBefore = await page.evaluate(() => window.__breakpointDebugPaddleCenterX());

      // Toucher initial loin du centre : ne doit PAS téléporter la raquette.
      await page.mouse.move(350, 700);
      await page.mouse.down();
      await page.waitForTimeout(30);
      const centerAfterDown = await page.evaluate(() => window.__breakpointDebugPaddleCenterX());

      // Glissement de -80 vers la gauche : déplacement relatif attendu.
      await page.mouse.move(270, 700, { steps: 8 });
      await page.waitForTimeout(30);
      const centerAfterDrag = await page.evaluate(() => window.__breakpointDebugPaddleCenterX());
      await page.mouse.up();
      await page.waitForTimeout(30);
      const centerAfterUp = await page.evaluate(() => window.__breakpointDebugPaddleCenterX());

      // Nouveau toucher ailleurs (loin, à gauche) : ne doit PAS téléporter.
      await page.mouse.move(50, 700);
      await page.mouse.down();
      await page.waitForTimeout(30);
      const centerAfterNewDown = await page.evaluate(() => window.__breakpointDebugPaddleCenterX());
      await page.mouse.up();

      const noTeleportOnFirstTouch = Math.abs(centerAfterDown - centerBefore) < 2;
      const movedRelatively = centerAfterDrag < centerAfterDown - 60; // -80 attendu, marge de clamp/bord
      const keptPositionOnRelease = Math.abs(centerAfterUp - centerAfterDrag) < 2;
      const noTeleportOnNewTouch = Math.abs(centerAfterNewDown - centerAfterUp) < 2;

      if (errors.length > 0 || !noTeleportOnFirstTouch || !movedRelatively || !keptPositionOnRelease || !noTeleportOnNewTouch) {
        failures += 1;
        log("ÉCHEC contrôle tactile relatif", {
          centerBefore, centerAfterDown, centerAfterDrag, centerAfterUp, centerAfterNewDown,
          noTeleportOnFirstTouch, movedRelatively, keptPositionOnRelease, noTeleportOnNewTouch, errors,
        });
      } else {
        log("OK : contrôle tactile relatif (aucun saut, déplacement relatif, pas de téléportation au nouveau toucher)");
      }
      await page.close();
    }

    // --- Test 6b (V2) : scénario humain EXACT reproduit avec de vrais
    // PointerEvent de type "touch" (pas la souris) dispatchés directement
    // dans la page -- c'est le scénario précis fourni par le testeur : "raquette
    // au centre -> lever complètement le doigt -> poser près du bord droit
    // SANS le déplacer -> la raquette doit rester exactement au centre ->
    // glisser ensuite vers la gauche -> elle part vers la gauche depuis le
    // centre." Vérifie aussi l'isolation par pointerId (un second contact
    // fantôme/paume pendant qu'un glissement réel est en cours ne doit
    // jamais l'interrompre ni le corrompre -- diagnostiqué en V2 comme cause
    // plausible de la téléportation constatée sur appareil physique, jamais
    // exercée par un test basé sur la souris qui n'a qu'un seul pointeur
    // implicite). Limite honnête : ceci dispatche des PointerEvent
    // synthétiques avec pointerType "touch" pour exercer fidèlement NOTRE
    // code (les mêmes gestionnaires qu'un vrai tactile), mais ne passe pas
    // par le pipeline natif de synthèse tactile du système d'exploitation
    // réel -- voir le rapport technique V2. ---
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      await page.click("#btn-play");
      await page.waitForTimeout(150);

      async function dispatchTouch(type, x, y, pointerId) {
        await page.evaluate(
          ({ type, x, y, pointerId }) => {
            const el = document.getElementById("game-canvas");
            const ev = new PointerEvent(type, {
              clientX: x,
              clientY: y,
              pointerId,
              pointerType: "touch",
              isPrimary: pointerId === 1,
              bubbles: true,
              cancelable: true,
              buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
            });
            el.dispatchEvent(ev);
          },
          { type, x, y, pointerId }
        );
      }

      const centerOriginal = await page.evaluate(() => window.__breakpointDebugPaddleCenterX());

      // Scénario humain exact : toucher initial près du bord droit, SANS
      // mouvement -> la raquette ne doit PAS bouger.
      await dispatchTouch("pointerdown", 350, 700, 1);
      await page.waitForTimeout(20);
      const centerAfterInitialTouch = await page.evaluate(() => window.__breakpointDebugPaddleCenterX());

      // Contact fantôme (deuxième pointerId) pendant que le premier est actif
      // : doit être totalement ignoré, jamais interrompre ni corrompre le
      // suivi du premier doigt.
      await dispatchTouch("pointerdown", 30, 200, 2);
      await dispatchTouch("pointermove", 10, 780, 2);
      await page.waitForTimeout(20);
      const centerAfterGhost = await page.evaluate(() => window.__breakpointDebugPaddleCenterX());
      await dispatchTouch("pointerup", 10, 780, 2);

      // Glissement du doigt PRINCIPAL vers la gauche de 100px.
      await dispatchTouch("pointermove", 250, 700, 1);
      await page.waitForTimeout(20);
      const centerAfterDrag = await page.evaluate(() => window.__breakpointDebugPaddleCenterX());
      await dispatchTouch("pointerup", 250, 700, 1);

      const noMoveOnInitialTouch = Math.abs(centerAfterInitialTouch - centerOriginal) < 2;
      const ghostIgnored = Math.abs(centerAfterGhost - centerAfterInitialTouch) < 2;
      const draggedLeftFromCenter = centerAfterDrag < centerOriginal - 60; // -100 attendu, marge de clamp

      if (errors.length > 0 || !noMoveOnInitialTouch || !ghostIgnored || !draggedLeftFromCenter) {
        failures += 1;
        log("ÉCHEC scénario humain exact (vrais PointerEvent tactiles)", {
          centerOriginal, centerAfterInitialTouch, centerAfterGhost, centerAfterDrag,
          noMoveOnInitialTouch, ghostIgnored, draggedLeftFromCenter, errors,
        });
      } else {
        log("OK : scénario humain exact reproduit avec de vrais PointerEvent tactiles (aucun saut, contact fantôme ignoré, glissement relatif correct)");
      }
      await page.close();
    }

    // --- Test 7 (V2) : vraie marge verticale entre la raquette et la zone
    // naturelle du pouce -- une simple absence de recouvrement avec le
    // tutoriel n'est plus un critère suffisant (cahier des charges V2,
    // section 7). Vérifié sur plusieurs tailles d'écran (pas un seul
    // téléphone) avec un seuil minimal explicite. ---
    {
      const MIN_THUMB_ZONE_GAP_CSS_PX = 90; // seuil de validation -- distinct de la constante d'implémentation (120px), volontairement un peu plus strict pour laisser une marge de tolérance
      const viewports = [
        { width: 320, height: 568, label: "petit téléphone" },
        { width: 390, height: 844, label: "téléphone courant" },
        { width: 428, height: 926, label: "grand téléphone" },
      ];
      let allOk = true;
      for (const vp of viewports) {
        const page = await (await browser.newContext({ viewport: vp, hasTouch: true })).newPage();
        await page.goto(BASE_URL, { waitUntil: "networkidle" });
        await page.click("#btn-play");
        await page.waitForTimeout(150);
        const toastRect = await page.evaluate(() => document.getElementById("tutorial-toast").getBoundingClientRect());
        const paddleRect = await page.evaluate(() => window.__breakpointDebugPaddleScreenRect());
        const canvasRect = await page.evaluate(() => document.getElementById("game-canvas").getBoundingClientRect());
        const gapToToast = toastRect.top - paddleRect.bottom;
        const gapToCanvasBottom = canvasRect.bottom - paddleRect.bottom;
        const ok = paddleRect && gapToToast >= MIN_THUMB_ZONE_GAP_CSS_PX && gapToCanvasBottom >= MIN_THUMB_ZONE_GAP_CSS_PX;
        if (!ok) {
          allOk = false;
          log(`ÉCHEC marge pouce/raquette insuffisante (${vp.label})`, { gapToToast, gapToCanvasBottom, min: MIN_THUMB_ZONE_GAP_CSS_PX });
        } else {
          log(`OK : marge pouce/raquette (${vp.label})`, { gapToToast: gapToToast.toFixed(0), gapToCanvasBottom: gapToCanvasBottom.toFixed(0) });
        }
        await page.close();
      }

      // Sous-test : la réserve répond bien à un vrai safe-area-inset-bottom
      // simulé (pas seulement à une taille d'écran) -- appareil à encoche.
      {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
        const page = await context.newPage();
        await page.goto(BASE_URL, { waitUntil: "networkidle" });
        await page.click("#btn-play");
        await page.waitForTimeout(100);
        const gapBefore = await page.evaluate(() => {
          const p = window.__breakpointDebugPaddleScreenRect();
          const c = document.getElementById("game-canvas").getBoundingClientRect();
          return c.bottom - p.bottom;
        });
        await page.addStyleTag({ content: ":root { --safe-bottom: 40px; }" });
        await page.evaluate(() => window.dispatchEvent(new Event("resize")));
        await page.waitForTimeout(100);
        const gapAfter = await page.evaluate(() => {
          const p = window.__breakpointDebugPaddleScreenRect();
          const c = document.getElementById("game-canvas").getBoundingClientRect();
          return c.bottom - p.bottom;
        });
        const respondsToSafeArea = gapAfter > gapBefore + 20; // doit augmenter significativement (~40px attendu)
        if (!respondsToSafeArea) {
          allOk = false;
          log("ÉCHEC la réserve ne répond pas à un safe-area-inset-bottom simulé", { gapBefore, gapAfter });
        } else {
          log("OK : la réserve augmente réellement avec un safe-area-inset-bottom simulé", { gapBefore: gapBefore.toFixed(0), gapAfter: gapAfter.toFixed(0) });
        }
        await page.close();
      }

      if (!allOk) failures += 1;
    }

    // --- Test 8 (V1) : PWA -- manifest valide, service worker enregistré,
    // icônes déclarées réellement accessibles (section 8). ---
    {
      const page = await browser.newPage();
      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      const manifestHref = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.href);
      let manifestOk = false;
      let iconsOk = false;
      if (manifestHref) {
        const res = await page.evaluate(async (href) => {
          const r = await fetch(href);
          if (!r.ok) return null;
          return r.json();
        }, manifestHref);
        manifestOk = !!(res && res.icons && res.icons.length > 0 && res.name);
        if (res && res.icons) {
          const iconChecks = await page.evaluate(async (icons) => {
            const results = [];
            for (const icon of icons) {
              try {
                const r = await fetch(icon.src);
                results.push(r.ok);
              } catch {
                results.push(false);
              }
            }
            return results;
          }, res.icons);
          iconsOk = iconChecks.length > 0 && iconChecks.every(Boolean);
        }
      }
      await page.waitForTimeout(300); // laisse le temps à navigator.serviceWorker.register() de s'exécuter
      const swRegistered = await page.evaluate(async () => {
        if (!("serviceWorker" in navigator)) return false;
        const regs = await navigator.serviceWorker.getRegistrations();
        return regs.length > 0;
      });
      if (!manifestOk || !iconsOk || !swRegistered) {
        failures += 1;
        log("ÉCHEC PWA", { manifestHref, manifestOk, iconsOk, swRegistered });
      } else {
        log("OK : PWA (manifest valide, icônes accessibles, service worker enregistré)");
      }
      await page.close();
    }

    // --- Test 9 (V2) : le service worker ne sert JAMAIS une version périmée
    // du document/app-shell alors qu'une version fraîche est disponible sur
    // le réseau -- c'est le bug diagnostiqué en V2 (stratégie "cache
    // d'abord" précédente, plausible cause majeure des écarts constatés en
    // bêta réelle malgré un dépôt/déploiement à jour). On simule ici
    // exactement ce scénario : un appareil qui a déjà une ancienne réponse
    // en cache doit quand même recevoir la version actuelle au rechargement. ---
    {
      const page = await browser.newPage();
      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      // Le tout premier chargement enregistre le SW mais n'est PAS contrôlé
      // par lui (comportement standard du cycle de vie des service workers)
      // -- un rechargement est nécessaire pour que ses fetch handlers
      // s'appliquent réellement et peuplent le cache une première fois.
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      await page.reload({ waitUntil: "networkidle" });
      // Empoisonne délibérément le cache avec une fausse réponse "périmée"
      // pour l'URL exacte du document, comme le ferait une ancienne visite.
      await page.evaluate(async (docUrl) => {
        const keys = await caches.keys();
        const cacheName = keys[0]; // un seul cache géré par ce SW
        if (!cacheName) throw new Error("aucun cache trouvé -- le SW n'a pas encore écrit");
        const cache = await caches.open(cacheName);
        await cache.put(docUrl, new Response("<html><body>VERSION-PERIMEE-V0-TEST</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }));
      }, BASE_URL + "/");
      await page.reload({ waitUntil: "networkidle" });
      const html = await page.content();
      const staleServed = html.includes("VERSION-PERIMEE-V0-TEST");
      const gameLoaded = await page.locator("#btn-play").count();
      if (staleServed || gameLoaded === 0) {
        failures += 1;
        log("ÉCHEC anti-péremption du service worker", { staleServed, gameLoaded });
      } else {
        log("OK : le service worker sert la version fraîche même avec une entrée de cache périmée empoisonnée délibérément");
      }
      await page.close();
    }

    // --- Test 10 (V3) : cycle de vie réel de la musique de fond -- démarre
    // sur un vrai geste utilisateur, jamais plus d'une instance/AudioContext
    // superposée, s'arrête proprement à la mise en pause (y compris via une
    // perte de focus simulée), et reprend correctement sur un nouveau geste
    // réel (cahier des charges V3, section 6). ---
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: "networkidle" });

      const beforePlay = await page.evaluate(() => window.__breakpointDebugAudioState());

      await page.click("#btn-play");
      await page.waitForTimeout(200);
      const afterPlay = await page.evaluate(() => window.__breakpointDebugAudioState());

      // Perte de focus -> la musique doit s'arrêter proprement (pas de fond
      // sonore qui continue hors champ).
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { value: true, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForTimeout(150);
      const afterHidden = await page.evaluate(() => window.__breakpointDebugAudioState());

      // Reprise -> un vrai clic (geste réel) doit relancer la musique SANS
      // recréer un second AudioContext.
      await page.click("#btn-resume");
      await page.waitForTimeout(250); // laisse passer le décompte de reprise
      await page.waitForTimeout(200);
      const afterResume = await page.evaluate(() => window.__breakpointDebugAudioState());

      const startedOnGesture = !beforePlay.musicRunning && afterPlay.musicRunning;
      const stoppedOnBackground = !afterHidden.musicRunning;
      const resumedCleanly = afterResume.musicRunning;
      const singleAudioContext =
        afterPlay.audioContextCreations === 1 &&
        afterHidden.audioContextCreations === 1 &&
        afterResume.audioContextCreations === 1;

      if (errors.length > 0 || !startedOnGesture || !stoppedOnBackground || !resumedCleanly || !singleAudioContext) {
        failures += 1;
        log("ÉCHEC cycle de vie musique", {
          beforePlay, afterPlay, afterHidden, afterResume,
          startedOnGesture, stoppedOnBackground, resumedCleanly, singleAudioContext, errors,
        });
      } else {
        log("OK : musique démarrée sur geste réel, arrêtée en arrière-plan, reprise proprement, un seul AudioContext");
      }
      await page.close();
    }

    // --- Test 11 (V3) : réglage musique persistant et respecté -- désactiver
    // la musique dans les réglages doit l'arrêter immédiatement et empêcher
    // tout redémarrage tant qu'elle reste désactivée. ---
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      await page.click("#btn-settings");
      await page.click("#opt-music"); // désactive (coché par défaut)
      await page.click("#btn-back");
      await page.click("#btn-play");
      await page.waitForTimeout(200);
      const state1 = await page.evaluate(() => window.__breakpointDebugAudioState());
      const musicSettingPersisted = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("breakpoint-v0-save")).settings.music === false
      );
      if (state1.musicRunning || !musicSettingPersisted) {
        failures += 1;
        log("ÉCHEC réglage musique désactivée non respecté", { state1, musicSettingPersisted });
      } else {
        log("OK : musique désactivée dans les réglages -- reste bien silencieuse et persistée");
      }
      await page.close();
    }

    // --- Test 12 (V3) : identifiant de build réellement affiché, non vide,
    // conforme au format "vX.Y.Z+hash", et dont le hash correspond bien au
    // commit RÉELLEMENT construit (jamais une valeur codée en dur qu'on
    // pourrait oublier de mettre à jour -- cahier des charges V3, section 8,
    // motivé par l'incident de cache V2 où un déploiement à jour était
    // indiscernable d'un ancien). ---
    {
      const page = await browser.newPage();
      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      await page.click("#btn-settings");
      const buildId = await page.textContent("#build-id").catch(() => "");
      const pkgVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
      let expectedHash;
      try {
        expectedHash = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
      } catch {
        expectedHash = null;
      }
      const format = /^v\d+\.\d+\.\d+\+[0-9a-f]{7}$/;
      const matchesFormat = format.test(buildId);
      const matchesVersion = buildId.includes(`v${pkgVersion}+`);
      const matchesCommit = !expectedHash || buildId.endsWith(`+${expectedHash}`);
      if (!matchesFormat || !matchesVersion || !matchesCommit) {
        failures += 1;
        log("ÉCHEC identifiant de build", { buildId, pkgVersion, expectedHash, matchesFormat, matchesVersion, matchesCommit });
      } else {
        log(`OK : identifiant de build affiché et exact (${buildId})`);
      }
      await page.close();
    }

    // --- Test 13 (V3) : durcissement du cycle de vie du service worker --
    // un onglet déjà ouvert qui revient au premier plan pendant qu'une
    // NOUVELLE version a été déployée doit détecter la mise à jour et se
    // recharger automatiquement (une seule fois), pour ne jamais continuer
    // à exécuter en mémoire le JS d'un ancien build alors qu'un SW plus
    // récent a pris le contrôle (cahier des charges V3, section 7). ---
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      // Premier chargement non contrôlé par le SW (cycle de vie standard) --
      // un rechargement est nécessaire pour être sous son contrôle actif.
      await page.reload({ waitUntil: "networkidle" });
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      await page.evaluate(() => {
        window.__preUpdateMarker = "present-before-reload";
      });

      // Simule un VRAI nouveau déploiement : le fichier sw.js servi diffère
      // désormais octet pour octet de celui déjà installé.
      const swPath = join(ROOT, "dist", "sw.js");
      const originalSw = readFileSync(swPath, "utf8");
      const updatedSw = originalSw.replace(
        'const CACHE_NAME = "breakpoint-cache-v3";',
        'const CACHE_NAME = "breakpoint-cache-v3-test-update";'
      );
      if (updatedSw === originalSw) throw new Error("le remplacement du CACHE_NAME dans sw.js n'a rien changé -- test invalide");
      writeFileSync(swPath, updatedSw);

      try {
        // Retour au premier plan réel -> doit déclencher registration.update().
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", { value: true, configurable: true });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", { value: false, configurable: true });
          document.dispatchEvent(new Event("visibilitychange"));
        });

        // Laisse le temps réel : détection -> install -> skipWaiting ->
        // activate -> clients.claim() -> événement controllerchange -> reload.
        await page.waitForFunction(
          () => window.__preUpdateMarker === undefined,
          { timeout: 15000 }
        ).catch(() => {});
        await page.waitForTimeout(300);

        const markerGoneAfterReload = await page.evaluate(() => window.__preUpdateMarker === undefined);
        const stillPlayable = (await page.locator("#btn-play").count()) > 0;

        if (errors.length > 0 || !markerGoneAfterReload || !stillPlayable) {
          failures += 1;
          log("ÉCHEC rechargement automatique après mise à jour du service worker", {
            markerGoneAfterReload, stillPlayable, errors,
          });
        } else {
          log("OK : un onglet ouvert se recharge automatiquement dès qu'une nouvelle version du service worker prend le contrôle");
        }
      } finally {
        writeFileSync(swPath, originalSw); // restaure l'état normal pour ne pas polluer le reste de la suite
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
