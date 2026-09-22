import { createLevelState, brickRect } from "./engine/state.js";
import { tick } from "./engine/simulation.js";
import { LEVELS } from "./engine/levels.js";
import { loadSave, writeSave, markLevelUnlocked, markTutorialSeen } from "./engine/save.js";
import { createInputController } from "./ui/input.js";
import { drawFrame } from "./ui/render.js";
import { createParticleSystem } from "./ui/particles.js";
import { createTutorialController } from "./ui/tutorial.js";
import { sfx, setAudioEnabled, vibrate } from "./ui/audio.js";
import { ARENA_H } from "./engine/constants.js";

const FIXED_DT = 1000 / 60;
const MAX_FRAME_MS = 250; // clamp après un long gel (onglet en arrière-plan) : jamais rattraper des secondes d'un coup

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const overlayRoot = document.getElementById("overlay-root");
const tutorialToast = document.getElementById("tutorial-toast");
const countdownEl = document.getElementById("countdown");
const scoreEl = document.getElementById("score-value");
const levelEl = document.getElementById("level-value");
const livesEl = document.getElementById("lives-value");
const pauseBtn = document.getElementById("pause-btn");

const save = loadSave();
setAudioEnabled(save.settings.sfx);

const input = createInputController(canvas);
const particles = createParticleSystem();
const tutorial = createTutorialController(save, tutorialToast);

let state = null;
let levelIndex = 0;
let runLives = 3;
let runScore = 0;
let appPhase = "menu"; // menu | countdown | playing | paused | level_result
let ballTrail = [];
let hasMovedOnce = false;
let countdownValue = 0;
let countdownTimer = null;

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  input.updateViewport();
}
window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 50));

function updateHud() {
  scoreEl.textContent = String(runScore);
  levelEl.textContent = String(levelIndex + 1);
  livesEl.textContent = String(runLives);
}

function renderOverlay(html) {
  overlayRoot.innerHTML = html;
}
function clearOverlay() {
  overlayRoot.innerHTML = "";
}

function showMenu() {
  appPhase = "menu";
  clearOverlay();
  const unlocked = save.unlockedLevelIndex;
  renderOverlay(`
    <div class="overlay">
      <h1>BREAKPOINT</h1>
      <p>Rétro dans l'ADN, moderne dans les sensations.</p>
      <button class="overlay-btn" id="btn-play">${unlocked > 0 ? "Continuer" : "Jouer"}</button>
      <button class="overlay-btn secondary" id="btn-settings">Réglages</button>
    </div>
  `);
  document.getElementById("btn-play").addEventListener("click", () => {
    startLevel(unlocked);
  });
  document.getElementById("btn-settings").addEventListener("click", showSettings);
}

function showSettings() {
  clearOverlay();
  renderOverlay(`
    <div class="overlay">
      <h1>Réglages</h1>
      <div class="settings-row"><span>Effets sonores</span><input type="checkbox" id="opt-sfx" ${save.settings.sfx ? "checked" : ""}/></div>
      <div class="settings-row"><span>Vibrations</span><input type="checkbox" id="opt-haptics" ${save.settings.haptics ? "checked" : ""}/></div>
      <button class="overlay-btn" id="btn-back">Retour</button>
    </div>
  `);
  document.getElementById("opt-sfx").addEventListener("change", (e) => {
    save.settings.sfx = e.target.checked;
    setAudioEnabled(save.settings.sfx);
    writeSave(save);
  });
  document.getElementById("opt-haptics").addEventListener("change", (e) => {
    save.settings.haptics = e.target.checked;
    writeSave(save);
  });
  document.getElementById("btn-back").addEventListener("click", showMenu);
}

function startLevel(index) {
  levelIndex = Math.max(0, Math.min(LEVELS.length - 1, index));
  state = createLevelState(levelIndex, { lives: runLives, score: runScore });
  ballTrail = [];
  updateHud();
  clearOverlay();
  appPhase = "playing";
  if (!save.tutorialsSeen.first_move) tutorial.show("first_move");
}

function showPauseMenu() {
  appPhase = "paused";
  clearOverlay();
  renderOverlay(`
    <div class="overlay">
      <h1>Pause</h1>
      <button class="overlay-btn" id="btn-resume">Reprendre</button>
      <button class="overlay-btn secondary" id="btn-restart">Recommencer</button>
      <button class="overlay-btn secondary" id="btn-menu">Retour au menu</button>
    </div>
  `);
  document.getElementById("btn-resume").addEventListener("click", beginResumeCountdown);
  document.getElementById("btn-restart").addEventListener("click", () => confirmAbandon(() => startLevel(levelIndex)));
  document.getElementById("btn-menu").addEventListener("click", () => confirmAbandon(showMenu));
  history.pushState({ breakpointPause: true }, "");
}

function confirmAbandon(onConfirm) {
  clearOverlay();
  renderOverlay(`
    <div class="overlay">
      <h1>Abandonner ce niveau ?</h1>
      <p>La progression de ce niveau en cours sera perdue.</p>
      <button class="overlay-btn" id="btn-yes">Oui, abandonner</button>
      <button class="overlay-btn secondary" id="btn-no">Annuler</button>
    </div>
  `);
  document.getElementById("btn-yes").addEventListener("click", onConfirm);
  document.getElementById("btn-no").addEventListener("click", showPauseMenu);
}

function beginResumeCountdown() {
  clearOverlay();
  appPhase = "countdown";
  countdownValue = 3;
  countdownEl.hidden = false;
  countdownEl.textContent = String(countdownValue);
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    countdownValue -= 1;
    if (countdownValue <= 0) {
      clearInterval(countdownTimer);
      countdownEl.hidden = true;
      appPhase = "playing";
    } else {
      countdownEl.textContent = String(countdownValue);
    }
  }, 700);
}

pauseBtn.addEventListener("click", () => {
  if (appPhase === "playing") showPauseMenu();
});

window.addEventListener("popstate", () => {
  if (appPhase === "paused") beginResumeCountdown();
});

// Perte de focus (changement d'onglet, appel entrant) : pause automatique,
// jamais une simulation qui continue hors champ.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && appPhase === "playing") showPauseMenu();
});

function showLevelResult(won) {
  appPhase = "level_result";
  clearOverlay();
  if (won) {
    sfx.win();
    const isLast = levelIndex >= LEVELS.length - 1;
    markLevelUnlocked(save, Math.min(LEVELS.length - 1, levelIndex + 1));
    renderOverlay(`
      <div class="overlay">
        <h1>Niveau réussi !</h1>
        <p>Score : ${runScore}</p>
        <button class="overlay-btn" id="btn-next">${isLast ? "Rejouer depuis le début" : "Niveau suivant"}</button>
        <button class="overlay-btn secondary" id="btn-menu2">Menu</button>
      </div>
    `);
    document.getElementById("btn-next").addEventListener("click", () => {
      startLevel(isLast ? 0 : levelIndex + 1);
    });
  } else {
    renderOverlay(`
      <div class="overlay">
        <h1>Partie terminée</h1>
        <p>Score : ${runScore}</p>
        <button class="overlay-btn" id="btn-retry">Recommencer</button>
        <button class="overlay-btn secondary" id="btn-menu2">Menu</button>
      </div>
    `);
    document.getElementById("btn-retry").addEventListener("click", () => {
      runLives = 3;
      runScore = 0;
      startLevel(levelIndex);
    });
  }
  document.getElementById("btn-menu2").addEventListener("click", () => {
    runLives = 3;
    runScore = 0;
    showMenu();
  });
}

function handleEvents(events) {
  for (const ev of events) {
    if (ev.type === "brick_hit") sfx.brickReinforced();
    else if (ev.type === "brick_destroyed") {
      sfx.destroy();
      const brick = state.bricks.find((b) => b.id === ev.id);
      if (brick) {
        const r = brickRect(brick);
        particles.burst(r.x + r.w / 2, r.y + r.h / 2, "#ffd166", 10);
      }
      if (!save.tutorialsSeen.first_reinforced_brick) {
        // déclenché seulement quand une brique renforcée a réellement été
        // rencontrée, voir plus bas au moment du hit initial
      }
    } else if (ev.type === "powerup_collected") {
      sfx.powerup();
      if (save.settings.haptics) vibrate(15);
      if (!save.tutorialsSeen.first_powerup) tutorial.show("first_powerup");
      if (ev.kind === "multiball" && !save.tutorialsSeen.first_multiball) tutorial.show("first_multiball");
    } else if (ev.type === "ball_lost") {
      sfx.ballLost();
    } else if (ev.type === "life_lost") {
      if (save.settings.haptics) vibrate([20, 40, 20]);
    } else if (ev.type === "level_won") {
      showLevelResult(true);
    }
  }
}

let lastTime = null;
function frame(now) {
  requestAnimationFrame(frame);
  if (lastTime == null) lastTime = now;
  let delta = now - lastTime;
  lastTime = now;
  if (delta > MAX_FRAME_MS) delta = MAX_FRAME_MS;

  if (appPhase === "playing" && state) {
    state.accMs = (state.accMs || 0) + delta;
    let first = true;
    const sample = input.sample();
    while (state.accMs >= FIXED_DT) {
      const wasReady = state.status === "ready";
      const stepInput = {
        pointerX: sample.pointerX,
        launchRequested: first && input.consumeLaunch(),
        fire: sample.pointerDown,
      };
      if (stepInput.pointerX != null && !hasMovedOnce) {
        hasMovedOnce = true;
      }
      tick(state, FIXED_DT, stepInput);
      if (wasReady && state.status === "playing" && !save.tutorialsSeen.first_launch) {
        tutorial.show("first_launch");
      }
      for (const ev of state.events) {
        if (ev.type === "brick_hit") {
          const brick = state.bricks.find((b) => b.id === ev.id);
          if (brick && brick.maxHp > 1 && !save.tutorialsSeen.first_reinforced_brick) {
            tutorial.show("first_reinforced_brick");
          }
        }
      }
      handleEvents(state.events);
      runScore = state.score;
      runLives = state.lives;
      state.accMs -= FIXED_DT;
      first = false;

      if (state.status === "lost") {
        updateHud();
        showLevelResult(false);
        break;
      }
    }
    updateHud();

    ballTrail.push(...state.balls.map((b) => ({ x: b.x, y: b.y, r: b.r })));
    if (ballTrail.length > state.balls.length * 5) {
      ballTrail.splice(0, ballTrail.length - state.balls.length * 5);
    }
    particles.update(delta / 1000);
  }

  if (state) {
    drawFrame(ctx, canvas.width, canvas.height, state, ballTrail);
    const viewport = input.getViewport();
    ctx.save();
    ctx.translate(viewport.offsetX, viewport.offsetY);
    ctx.scale(viewport.scale, viewport.scale);
    particles.draw(ctx);
    ctx.restore();
  }
}

resizeCanvas();
showMenu();
requestAnimationFrame(frame);

// Hook de test UNIQUEMENT (utilisé par scripts/check-performance.mjs pour
// forcer un scénario de stress reproductible — multiball + beaucoup de
// briques). Ne fait rien en usage normal, jamais appelé par l'UI du jeu.
window.__breakpointDebugAddBalls = (count) => {
  if (!state || !state.balls.length) return;
  const ref = state.balls[0];
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    state.balls.push({
      x: ref.x,
      y: ref.y,
      r: ref.r,
      vx: Math.cos(angle) * 300,
      vy: -Math.abs(Math.sin(angle) * 300) - 50,
      launched: true,
      perforateUntil: 0,
    });
  }
};

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // PWA non critique : le jeu doit rester jouable même si l'enregistrement échoue.
    });
  });
}
