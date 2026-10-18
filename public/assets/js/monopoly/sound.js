// geräusche ohne audiodateien (webaudio), stumm schalten wird gemerkt

const KEY = 'lcd-monopoly-muted';
let ctx = null;
let muted = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();

export const isMuted = () => muted;

export function setMuted(value) {
  muted = value;
  try { localStorage.setItem(KEY, value ? '1' : '0'); } catch { /* egal */ }
}

function tone(freq, { at = 0, length = 0.12, type = 'sine', gain = 0.08, slide = 0 } = {}) {
  if (muted) return;
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + length);
    vol.gain.setValueAtTime(gain, t);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(vol).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + length + 0.02);
  } catch {
    /* kein audio */
  }
}

export const sound = {
  dice() { for (let i = 0; i < 6; i++) tone(180 + Math.random() * 220, { at: i * 0.07, length: 0.05, type: 'square', gain: 0.03 }); },
  step() { tone(520, { length: 0.05, type: 'triangle', gain: 0.025 }); },
  coin() { tone(880, { length: 0.08, type: 'triangle' }); tone(1320, { at: 0.07, length: 0.14, type: 'triangle' }); },
  pay() { tone(330, { length: 0.16, type: 'sawtooth', gain: 0.03, slide: 0.7 }); },
  card() { tone(660, { length: 0.1 }); tone(990, { at: 0.08, length: 0.18 }); },
  turn() { tone(587, { length: 0.12, type: 'triangle' }); tone(784, { at: 0.1, length: 0.2, type: 'triangle' }); },
  prison() { tone(220, { length: 0.3, type: 'sawtooth', gain: 0.04, slide: 0.5 }); },
  build() { tone(440, { length: 0.08, type: 'square', gain: 0.03 }); tone(660, { at: 0.06, length: 0.12, type: 'square', gain: 0.03 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.12, length: 0.3, type: 'triangle' })); },
  offer() { [659, 880, 1175].forEach((f, i) => tone(f, { at: i * 0.09, length: 0.22, type: 'triangle', gain: 0.07 })); },
  trade() { tone(523, { length: 0.16, type: 'triangle' }); tone(784, { at: 0.12, length: 0.16, type: 'triangle' }); tone(1047, { at: 0.24, length: 0.3, type: 'sine', gain: 0.06 }); },
  bid() { tone(740, { length: 0.07, type: 'square', gain: 0.03 }); },
  // fremder handel auf dem tisch: leise, damit es nicht nervt
  watch() { tone(523, { length: 0.09, type: 'sine', gain: 0.04 }); tone(392, { at: 0.09, length: 0.14, type: 'sine', gain: 0.035 }); },
  decline() { tone(392, { length: 0.12, type: 'sawtooth', gain: 0.025, slide: 0.7 }); tone(262, { at: 0.1, length: 0.2, type: 'sawtooth', gain: 0.025, slide: 0.78 }); },
};
