// sound made with web audio (no files to load): short effects, ride ambience (wind with your speed, rain,
// rivers, birds, a cheering finish crowd) and generated songs (music.js) whose tempo follows your cadence.
// unlock() must run inside a tap, otherwise mobile browsers keep audio muted
import { create_music, track_ids, tracks } from './music.js?v=46';
let audio = null;
let enabled = true;
let music_on = true;
let track = 'shuffle';   // a track id, or 'shuffle' (a different one each ride)

export function set_sound(on) { enabled = on; if (!on) stop_ride(); }
export function set_music(on) { music_on = on; if (!on && ride?.song) { ride.song.stop(); ride.song = null; } }
export function set_track(id) { track = id; }
export const music_tracks = () => track_ids.map((id) => [id, tracks[id].name, tracks[id].style]);
// name of the song playing now (or null)
export const now_playing = () => ride?.song?.name ?? null;
// skip to another song (the next in the list, or a random other one on shuffle); returns its name
export function next_song() {
  if (!ride || !audio || !music_on) return null;
  const cur = ride.song?.id;
  const i = track_ids.indexOf(cur);
  const id = track === 'shuffle' ? track_ids.filter((t) => t !== cur)[Math.floor(Math.random() * (track_ids.length - 1))] : track_ids[(i + 1) % track_ids.length];
  ride.song?.stop();
  ride.song = create_music(audio, audio.destination, id);
  return ride.song.name;
}

export function unlock() {
  if (!enabled) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}

// one short tone: frequency (hz), length (s), wave shape, volume, start delay (s), output node
function tone(freq, len, type = 'sine', vol = 0.2, delay = 0, out = audio.destination, at = null) {
  const t = at ?? audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + len);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + len + 0.02);
  return osc;
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

// ---- ride ambience: looping filtered noise layers, each with its own volume ----

let ride = null;
function noise_buffer() {
  const len = audio.sampleRate * 2;
  const b = audio.createBuffer(1, len, audio.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
// a noise source through a filter into its own gain (volume starts at 0)
function layer(buf, type, freq, q = 0.7) {
  const src = audio.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const f = audio.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = audio.createGain();
  g.gain.value = 0;
  src.connect(f).connect(g).connect(audio.destination);
  src.start();
  return { src, f, g };
}
function start_ride() {
  const buf = noise_buffer();
  ride = {
    wind: layer(buf, 'lowpass', 400),
    rain: layer(buf, 'highpass', 2500),
    water: layer(buf, 'bandpass', 700, 0.8),
    crowd: layer(buf, 'bandpass', 1100, 1.2),
    song: null, bird_t: 3, cheer_t: 0,
  };
}
export function stop_ride() {
  if (!ride) return;
  for (const k of ['wind', 'rain', 'water', 'crowd']) { try { ride[k].src.stop(); } catch { /* already stopped */ } }
  ride.song?.stop();
  ride = null;
}
const fade = (node, v) => node.gain.setTargetAtTime(v, audio.currentTime, 0.4);

// call every frame while a game runs. s = { speed (m/s), cadence, effort (watts / ftp), rain, water (0..1), crowd (0..1), birds }
export function update_ride(dt, s) {
  if (!enabled || !audio) return;
  try {
    if (!ride) start_ride();
    fade(ride.wind.g, Math.min(0.12, s.speed * 0.008));
    ride.wind.f.frequency.setTargetAtTime(250 + s.speed * 60, audio.currentTime, 0.3);
    fade(ride.rain.g, s.rain ? 0.05 : 0);
    fade(ride.water.g, s.water * 0.08);
    fade(ride.crowd.g, s.crowd * 0.12);
    // crowd: whistles and "woo"s on top of the roar
    ride.cheer_t -= dt;
    if (s.crowd > 0.3 && ride.cheer_t <= 0) {
      ride.cheer_t = 0.3 + Math.random() * 0.8;
      const w = tone(900 + Math.random() * 900, 0.35, 'sine', 0.05 * s.crowd);
      w.frequency.exponentialRampToValueAtTime(1800 + Math.random() * 600, audio.currentTime + 0.3);
    }
    // birds: a short chirp now and then
    ride.bird_t -= dt;
    if (s.birds && ride.bird_t <= 0) {
      ride.bird_t = 3 + Math.random() * 7;
      const n = 2 + Math.floor(Math.random() * 3), base = 2500 + Math.random() * 1500;
      for (let i = 0; i < n; i++) {
        const c = tone(base, 0.08, 'sine', 0.03, i * 0.12);
        c.frequency.exponentialRampToValueAtTime(base * 1.4, audio.currentTime + i * 0.12 + 0.07);
      }
    }
    // music (music.js): a song whose beat follows your cadence; shuffle picks a new one each ride
    if (music_on) {
      ride.song ??= create_music(audio, audio.destination, track === 'shuffle' || !tracks[track] ? track_ids[Math.floor(Math.random() * track_ids.length)] : track);
      ride.song.update(dt, s.cadence, s.effort);
    }
  } catch { /* audio not available */ }
}
