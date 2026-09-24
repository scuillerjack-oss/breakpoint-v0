// Effets sonores ET musique de fond, entièrement synthétisés (WebAudio,
// AUCUN fichier audio externe -- rien à charger, aucune dépendance, et
// surtout : aucune question de provenance/droits ne se pose, puisqu'il n'y
// a aucun asset tiers. C'est la provenance documentée pour une exploitation
// commerciale Android/Google Play (cahier des charges V3, section 6) :
// 100% synthèse procédurale par ce code, propriété entière du projet,
// aucun échantillon, aucune licence tierce à vérifier. Sons courts, ondes
// sinus/triangle plutôt que carrées pures pour éviter le "aigu fatigant"
// que le cahier des charges demande explicitement d'éviter sur sessions
// prolongées.
let ctx = null;
let enabled = true;
let volume = 0.5;
let musicEnabled = true;
let musicVolume = 0.16; // volontairement bas -- ne doit jamais masquer les SFX de gameplay

let audioContextCreations = 0; // QA uniquement -- doit toujours rester à 1 réel (jamais recréé)

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    audioContextCreations++;
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Hook de QA/tests UNIQUEMENT (scripts/check-mobile.mjs) -- lecture seule,
// jamais utilisé par le jeu lui-même. Permet de vérifier depuis l'extérieur
// qu'il n'existe jamais deux instances de musique superposées et qu'un seul
// AudioContext réel est jamais créé (cahier des charges V3, section 6).
export function getAudioDebugState() {
  return {
    musicEnabled,
    musicRunning: musicTimer !== null,
    audioContextState: ctx ? ctx.state : "none",
    audioContextCreations,
  };
}

function tone({ freq, duration, type = "sine", gain = 0.2, glideTo = null }) {
  if (!enabled) return;
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime);
  if (glideTo) osc.frequency.linearRampToValueAtTime(glideTo, c.currentTime + duration);
  g.gain.setValueAtTime(gain * volume, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  osc.connect(g).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + duration + 0.02);
}

export const sfx = {
  paddle: () => tone({ freq: 220, duration: 0.07, type: "triangle", gain: 0.18 }),
  brick: () => tone({ freq: 520, duration: 0.06, type: "sine", gain: 0.16 }),
  brickReinforced: () => tone({ freq: 340, duration: 0.08, type: "square", gain: 0.12 }),
  destroy: () => tone({ freq: 660, duration: 0.12, type: "sine", gain: 0.18, glideTo: 300 }),
  powerup: () => tone({ freq: 440, duration: 0.18, type: "triangle", gain: 0.2, glideTo: 880 }),
  ballLost: () => tone({ freq: 200, duration: 0.35, type: "sawtooth", gain: 0.16, glideTo: 60 }),
  win: () => tone({ freq: 523, duration: 0.4, type: "triangle", gain: 0.2, glideTo: 1046 }),
};

export function setAudioEnabled(value) {
  enabled = value;
}

export function setAudioVolume(value) {
  volume = value;
}

export function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// --- Musique de fond ---------------------------------------------------
// Boucle de 8 mesures en La mineur (Am-F-C-G), ~104 BPM, jouée deux fois
// avec DEUX variantes de mélodie principale différentes sur chaque moitié
// (cahier des charges V3 : refuser "quelques notes pauvres répétées").
// Basse en marche (walking bass, root-root-quinte-root par mesure), nappe
// d'accord tenue en triangle très douce, mélodie en arpèges consonants sur
// une octave modérée (jamais perçante), et un tick percussif filtré, très
// discret, pour marquer le temps sans jamais dominer les SFX de gameplay.
// Ordonnancement par "lookahead scheduler" (motif standard WebAudio) : on
// planifie les notes un peu à l'avance sur l'horloge audio elle-même
// (AudioContext.currentTime), jamais sur setTimeout/Date.now(), pour une
// boucle sans dérive ni coupure audible, y compris sur mobile.
const BPM = 104;
const SEC_PER_BEAT = 60 / BPM;
const SEC_PER_BAR = SEC_PER_BEAT * 4;
const SCHEDULE_AHEAD_SEC = 0.15;
const SCHEDULER_INTERVAL_MS = 40;

// Fréquences (Hz) des notes utilisées, en La mineur naturel.
const NOTE = {
  A2: 110.0,
  C3: 130.81,
  D3: 146.83,
  E3: 164.81,
  F3: 174.61,
  G3: 196.0,
  A3: 220.0,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.0,
  A4: 440.0,
};

// Une entrée par mesure : Am, F, C, G (progression demandée), répétée deux
// fois pour former les 8 mesures de la boucle.
const CHORDS = [
  { root: NOTE.A2, third: NOTE.C3, fifth: NOTE.E3 }, // Am
  { root: NOTE.F3 / 2, third: NOTE.A3 / 2, fifth: NOTE.C4 / 2 }, // F (renversé grave)
  { root: NOTE.C3, third: NOTE.E3, fifth: NOTE.G3 }, // C
  { root: NOTE.G3 / 2, third: NOTE.C3, fifth: NOTE.D3 }, // G (approx. grave)
];

// Basse : root-root-quinte-root par mesure (walking bass simple).
function bassNotesForBar(barInLoop) {
  const chord = CHORDS[barInLoop % 4];
  return [chord.root, chord.root, chord.fifth, chord.root];
}

// Mélodie principale : arpège consonant sur l'accord de la mesure. Deux
// variantes (motif A pour les mesures 0-3, motif B pour les mesures 4-7)
// afin que la répétition de la boucle ne soit jamais note pour note.
const LEAD_PATTERN_A = [
  [0, 1, 2, 1],
  [0, 2, 1, 0],
  [2, 1, 0, 1],
  [0, 1, 2, 2],
];
const LEAD_PATTERN_B = [
  [2, 1, 0, 2],
  [1, 2, 0, 1],
  [0, 1, 2, 0],
  [1, 0, 2, 1],
];
function leadNotesForBar(barInLoop) {
  const chord = CHORDS[barInLoop % 4];
  const degrees = [chord.root * 2, chord.third * 2, chord.fifth * 2];
  const pattern = barInLoop < 4 ? LEAD_PATTERN_A : LEAD_PATTERN_B;
  return pattern[barInLoop % 4].map((d) => degrees[d]);
}

let musicTimer = null;
let nextNoteTime = 0;
let currentBar = 0; // 0..7 sur toute la boucle de 8 mesures
let currentBeat = 0; // 0..3 dans la mesure

function scheduleBassNote(freq, time, dur) {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, time);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(0.5 * musicVolume, time + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, time + dur);
  osc.connect(g).connect(c.destination);
  osc.start(time);
  osc.stop(time + dur + 0.02);
}

function scheduleLeadNote(freq, time, dur) {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, time);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(0.32 * musicVolume, time + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, time + dur);
  osc.connect(g).connect(c.destination);
  osc.start(time);
  osc.stop(time + dur + 0.02);
}

function scheduleChordPad(chord, time, dur) {
  const c = getCtx();
  const g = c.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(0.1 * musicVolume, time + 0.3);
  g.gain.exponentialRampToValueAtTime(0.001, time + dur);
  g.connect(c.destination);
  for (const freq of [chord.root, chord.third, chord.fifth]) {
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, time);
    osc.connect(g);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }
}

function scheduleTick(time) {
  const c = getCtx();
  const bufferSize = Math.floor(c.sampleRate * 0.03);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.setValueAtTime(2500, time);
  const g = c.createGain();
  g.gain.setValueAtTime(0.08 * musicVolume, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
  src.connect(filter).connect(g).connect(c.destination);
  src.start(time);
  src.stop(time + 0.04);
}

function scheduleBeat(barInLoop, beat, time) {
  const chord = CHORDS[barInLoop % 4];
  if (beat === 0) scheduleChordPad(chord, time, SEC_PER_BAR * 0.95);
  const bassNote = bassNotesForBar(barInLoop)[beat];
  scheduleBassNote(bassNote, time, SEC_PER_BEAT * 0.85);
  const leadNote = leadNotesForBar(barInLoop)[beat];
  scheduleLeadNote(leadNote, time + SEC_PER_BEAT * 0.02, SEC_PER_BEAT * 0.4);
  scheduleTick(time);
}

function musicSchedulerStep() {
  const c = getCtx();
  while (nextNoteTime < c.currentTime + SCHEDULE_AHEAD_SEC) {
    scheduleBeat(currentBar, currentBeat, nextNoteTime);
    nextNoteTime += SEC_PER_BEAT;
    currentBeat++;
    if (currentBeat >= 4) {
      currentBeat = 0;
      currentBar = (currentBar + 1) % 8;
    }
  }
}

export function startMusic() {
  if (!musicEnabled || musicTimer) return; // jamais deux instances superposées
  const c = getCtx();
  currentBar = 0;
  currentBeat = 0;
  nextNoteTime = c.currentTime + 0.05;
  musicSchedulerStep();
  musicTimer = setInterval(musicSchedulerStep, SCHEDULER_INTERVAL_MS);
}

export function stopMusic() {
  if (musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
}

// Reprise après une pause (retour au premier plan) : redémarre proprement
// depuis le début de la boucle plutôt que de tenter de retrouver une
// position exacte -- plus simple et strictement sans risque de superposer
// une instance fantôme laissée par un throttling d'onglet en arrière-plan.
export function resumeMusic() {
  if (musicEnabled && !musicTimer) startMusic();
}

// Ne démarre JAMAIS la lecture elle-même (contrainte autoplay mobile/PWA :
// seul un vrai geste utilisateur peut le faire, voir startMusic/resumeMusic
// appelés depuis main.js sur un clic réel). Se contente d'arrêter proprement
// si on désactive, et de mémoriser l'état pour le prochain geste sinon.
export function setMusicEnabled(value) {
  musicEnabled = value;
  if (!musicEnabled) stopMusic();
}
