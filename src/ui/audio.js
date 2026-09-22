// Effets sonores synthétisés (WebAudio, aucun fichier externe : rien à
// charger, rien à propager comme dépendance). Sons courts, ondes
// sinus/triangle plutôt que carrées pures pour éviter le "aigu fatigant"
// que le cahier des charges demande explicitement d'éviter sur sessions
// prolongées. Musique non prioritaire pour la V0 (cahier des charges,
// section 9) : volontairement absente ici, seul le réglage existe déjà
// (settings.music) pour ne pas avoir à retoucher la sauvegarde plus tard.
let ctx = null;
let enabled = true;
let volume = 0.5;

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
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
