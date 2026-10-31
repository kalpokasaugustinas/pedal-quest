// tiny sound effects made with web audio (no files to load). unlock() must run inside a tap,
// otherwise mobile browsers keep audio muted
let audio = null;
let enabled = true;

export function set_sound(on) { enabled = on; }

export function unlock() {
  if (!enabled) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}

// one short tone: frequency (hz), length (s), wave shape, volume, start delay (s)
function tone(freq, len, type = 'sine', vol = 0.2, delay = 0) {
  const t = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + len);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + len + 0.02);
}

const sounds = {
  tick: () => tone(660, 0.12, 'square', 0.12),
  go: () => tone(990, 0.35, 'square', 0.15),
  click: () => tone(900, 0.05, 'sine', 0.25),
  good: () => { tone(660, 0.1, 'triangle', 0.2); tone(990, 0.15, 'triangle', 0.2, 0.08); },
  perfect: () => { tone(660, 0.1, 'triangle', 0.2); tone(880, 0.1, 'triangle', 0.2, 0.07); tone(1320, 0.2, 'triangle', 0.2, 0.14); },
  bad: () => tone(160, 0.3, 'sawtooth', 0.15),
  boost: () => { tone(300, 0.4, 'sawtooth', 0.12); tone(600, 0.4, 'sawtooth', 0.08, 0.1); },
  warn: () => tone(440, 0.15, 'square', 0.1),
  finish: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.18, i * 0.12)),
};

export function play(name) {
  if (!enabled || !audio || !sounds[name]) return;
  try { sounds[name](); } catch { /* audio not available */ }
}
