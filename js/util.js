// small shared helpers: formatting, random numbers, safe storage

export function fmt_time(t) {
  if (t === null || t === undefined || !isFinite(t)) return '--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

// whole seconds, e.g. 12:05
export function fmt_clock(t) {
  const total = Math.max(0, Math.floor(t));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function ordinal(n) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return n + (teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
}

export const rand = (min, max) => min + Math.random() * (max - min);
export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// seeded random generator (same seed = same sequence), used for repeatable tracks
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// localstorage can be blocked (private mode, previews): never let that break the game
export function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(player_key(key)));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
export function store(key, value) {
  try { localStorage.setItem(player_key(key), JSON.stringify(value)); } catch { /* storage blocked */ }
  if (!device_keys.has(key)) on_store?.();
}
export function remove(key) {
  try { localStorage.removeItem(player_key(key)); } catch { /* storage blocked */ }
}

// everything that syncs: all pq_* keys of all players (raw strings), except device-only keys
export function all_data() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('pq_') && !device_keys.has(k)) out[k] = localStorage.getItem(k);
    }
  } catch { /* storage blocked */ }
  return out;
}
// replace this device's synced keys with the ones from the account
export function apply_data(data) {
  try {
    for (const k of Object.keys(all_data())) if (!(k in data)) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(data)) if (k.startsWith('pq_') && !device_keys.has(k)) localStorage.setItem(k, v);
    const p = JSON.parse(localStorage.getItem(players_key));
    if (p && Array.isArray(p.list) && p.list.length) { players.list = p.list; }
  } catch { /* storage blocked */ }
  if (!players.list.some((p) => p.id === active_id)) set_active_player(players.list[0].id);
}

// ---- players: several people on one device, each with their own profile, scores and history ----
// every pq_* key belongs to the active player. the first player ("me") keeps the plain keys, so data saved
// before players existed stays theirs; other players get "<key>@<player id>".
// device-only keys (which player is active, sync bookkeeping) are not per player and never sync.
const players_key = 'pq_players';
const active_key = 'pq_active_player';
const device_keys = new Set([active_key, 'pq_sync_meta']);
export const players = (() => {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(players_key)); } catch { /* storage blocked */ }
  return p && Array.isArray(p.list) && p.list.length ? p : { list: [{ id: 'me', name: 'Me' }] };
})();
let active_id = (() => {
  try { return localStorage.getItem(active_key); } catch { return null; }
})();
if (!players.list.some((p) => p.id === active_id)) active_id = players.list[0].id;

export const active_player = () => players.list.find((p) => p.id === active_id) || players.list[0];
export function set_active_player(id) {
  active_id = id;
  try { localStorage.setItem(active_key, id); } catch { /* storage blocked */ }
}
export function save_players() { store(players_key, players); }

// storage key for the active player (the player list itself is shared)
const player_key = (key) => (key === players_key || device_keys.has(key) || active_id === 'me' ? key : `${key}@${active_id}`);

// sync hook: called after every saved change (cloud.js uses it to upload)
let on_store = null;
export function set_store_hook(fn) { on_store = fn; }

// delete every key of one player (not the first player "me", whose keys are the plain ones)
export function delete_player_data(id) {
  try {
    for (const k of Object.keys(all_data())) if (k.endsWith(`@${id}`)) localStorage.removeItem(k);
  } catch { /* storage blocked */ }
  on_store?.();
}

// the active player's keys that start with prefix (returned without the player suffix, ready for load())
export function player_board_keys(prefix) {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k.startsWith(prefix)) continue;
      const at = k.indexOf('@');
      if (active_id === 'me' ? at < 0 : k.endsWith(`@${active_id}`)) out.push(at < 0 ? k : k.slice(0, at));
    }
  } catch { /* storage blocked */ }
  return out.sort();
}
