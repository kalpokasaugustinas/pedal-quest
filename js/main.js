// pedal quest: app flow (setup -> countdown -> race -> results), sensors and hud
import { ble_supported, connect_device } from './ble.js';
import { bot_lineup, create_race, update_race, standings, finish_remaining, avg_watts } from './race.js';
import { create_world } from './world.js';

const $ = (id) => document.getElementById(id);

// ---- saved settings and best times (per browser; the game works without storage) ----
function load_settings() {
  const defaults = { km: 2, base_watts: 150 };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('pq_settings') || '{}') }; }
  catch { return defaults; }
}
function save_settings() {
  try { localStorage.setItem('pq_settings', JSON.stringify(settings)); } catch { /* storage blocked */ }
}
function get_best(km) {
  try { const v = parseFloat(localStorage.getItem(`pq_best_${km}`)); return isNaN(v) ? null : v; }
  catch { return null; }
}
function set_best(km, t) {
  try { localStorage.setItem(`pq_best_${km}`, String(t)); } catch { /* storage blocked */ }
}
const settings = load_settings();

// ---- formatting ----
function fmt_time(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
function ordinal(n) {
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n] || 'th');
}

// ---- screens ----
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

// ---- live sensor values ----
const sensors = { watts: 0, cadence: 0, hr: null, trainer: false, hr_strap: false, last_trainer_ms: 0 };

function set_status(id, text, cls = '') {
  $(id).textContent = text;
  $(id).className = `st ${cls}`;
}

function on_trainer_data(d) {
  if (d.power !== undefined) sensors.watts = Math.max(0, d.power);
  if (d.cadence !== undefined) sensors.cadence = d.cadence;
  if (d.hr && !sensors.hr_strap) sensors.hr = d.hr;   // some trainers relay hr
  sensors.last_trainer_ms = performance.now();
}

function on_trainer_status(state, device) {
  sensors.trainer = state === 'connected';
  if (state === 'connected') set_status('st-trainer', `connected: ${device.name}`, 'ok');
  if (state === 'reconnecting') set_status('st-trainer', 'reconnecting…', 'err');
  if (state === 'disconnected') set_status('st-trainer', 'disconnected', 'err');
  show_banner({ connected: '', reconnecting: 'Trainer reconnecting…', disconnected: 'Trainer disconnected' }[state]);
  update_mode_note();
}

function on_hr_data(bpm) {
  sensors.hr = bpm;
}

function on_hr_status(state, device) {
  sensors.hr_strap = state === 'connected';
  if (state === 'connected') set_status('st-hr', `connected: ${device.name}`, 'ok');
  if (state === 'reconnecting') set_status('st-hr', 'reconnecting…', 'err');
  if (state === 'disconnected') {
    set_status('st-hr', 'disconnected', 'err');
    sensors.hr = null;
  }
}

// connect button handler; a cancelled device picker is not an error
async function connect(kind, status_id, on_data, on_status) {
  try {
    set_status(status_id, 'pick your device…');
    await connect_device(kind, on_data, on_status);
  } catch (err) {
    set_status(status_id, err.name === 'NotFoundError' ? 'cancelled' : `failed: ${err.message}`, 'err');
  }
}

$('btn-trainer').onclick = () => connect('trainer', 'st-trainer', on_trainer_data, on_trainer_status);
$('btn-hr').onclick = () => connect('hr', 'st-hr', on_hr_data, on_hr_status);

if (!ble_supported) {
  $('ble-warning').classList.remove('hidden');
  $('btn-trainer').disabled = true;
  $('btn-hr').disabled = true;
}

// ---- setup screen ----
function update_mode_note() {
  $('mode-note').textContent = sensors.trainer
    ? 'Trainer connected: your watts drive your rider.'
    : 'No trainer connected: the race runs in demo mode with a watts slider.';
}

function render_setup() {
  document.querySelectorAll('#seg-distance button').forEach((b) => b.classList.toggle('on', +b.dataset.km === settings.km));
  $('w-value').textContent = `${settings.base_watts} W`;
  // strongest rival first
  $('rivals').innerHTML = bot_lineup(settings.base_watts).reverse()
    .map((b) => `<li><span class="dot" style="background:${b.color}"></span>${b.name}<span class="w">~${b.avg_watts} W avg</span></li>`)
    .join('');
  const best = get_best(settings.km);
  $('best').textContent = best ? `Your best ${settings.km} km: ${fmt_time(best)}` : `No ${settings.km} km race finished yet`;
  update_mode_note();
}

document.querySelectorAll('#seg-distance button').forEach((b) => {
  b.onclick = () => { settings.km = +b.dataset.km; save_settings(); render_setup(); };
});
function change_watts(delta) {
  settings.base_watts = Math.min(500, Math.max(50, settings.base_watts + delta));
  save_settings();
  render_setup();
}
$('w-minus').onclick = () => change_watts(-10);
$('w-plus').onclick = () => change_watts(10);

// ---- race ----
const canvas = $('canvas');
let world = null;            // 3d scene for the current race
let race = null;
let phase = 'idle';          // idle | countdown | racing | finishing
let phase_end = 0;           // timestamp when countdown / finishing ends
let last_ts = 0;
let demo_mode = false;
let progress_dots = [];
let wake_lock = null;
let last_boost_count = 0;    // to flash "NITRO!" once per activation

window.addEventListener('resize', () => { if (phase !== 'idle') world?.resize(); });

// keep the phone screen on while racing
async function request_wake_lock() {
  try { wake_lock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && phase !== 'idle') request_wake_lock();
});

function show_banner(text) {
  $('banner').textContent = text || '';
  $('banner').classList.toggle('hidden', !text);
}

function show_big_text(text, hide_after_ms) {
  const el = $('countdown');
  el.textContent = text;
  el.classList.remove('hidden');
  if (hide_after_ms) setTimeout(() => { if (el.textContent === text) el.classList.add('hidden'); }, hide_after_ms);
}

function start_race() {
  race = create_race({ distance_m: settings.km * 1000, base_watts: settings.base_watts });
  demo_mode = !sensors.trainer;
  $('demo').classList.toggle('hidden', !demo_mode);
  $('demo-hr-label').classList.toggle('hidden', sensors.hr_strap);   // real strap beats the slider
  $('demo-watts').value = 0;
  last_boost_count = 0;
  show_banner('');
  // progress bar: one dot per rider
  $('progress').innerHTML = race.riders
    .map((r) => `<span class="dot${r.is_player ? ' me' : ''}" style="background:${r.color}"></span>`).join('');
  progress_dots = [...$('progress').children];

  show('screen-race');
  document.documentElement.requestFullscreen?.().catch(() => {});
  request_wake_lock();
  world?.dispose();
  world = create_world(canvas, race);

  phase = 'countdown';
  phase_end = performance.now() + 3000;
  last_ts = performance.now();
  requestAnimationFrame(loop);
}

// player power: trainer watts, or the demo slider. trainer data older than 3 s counts as 0 w
function player_input(ts) {
  if (demo_mode) {
    const w = +$('demo-watts').value;
    return { watts: w, cadence: w > 0 ? Math.min(110, 70 + w / 10) : 0 };
  }
  const stale = ts - sensors.last_trainer_ms > 3000;
  return { watts: stale ? 0 : sensors.watts, cadence: stale ? 0 : sensors.cadence };
}

// heart rate for nitro: strap (or trainer-relayed hr), else the demo slider, else none
function current_hr() {
  if (sensors.hr !== null) return sensors.hr;
  return demo_mode ? +$('demo-hr').value : null;
}

function loop(ts) {
  if (phase === 'idle') return;
  const dt = Math.min(0.1, Math.max(0, (ts - last_ts) / 1000));   // clamp: app in background = pause
  last_ts = ts;
  const input = player_input(ts);
  input.hr = current_hr();

  if (phase === 'countdown') {
    const left = phase_end - ts;
    if (left > 0) {
      show_big_text(String(Math.ceil(left / 1000)));
    } else {
      phase = 'racing';
      show_big_text('GO!', 800);
    }
  } else if (phase === 'racing') {
    update_race(race, dt, input.watts, input.cadence, input.hr);
    const n = race.player.nitro;
    if (n.count > last_boost_count) {
      last_boost_count = n.count;
      show_big_text('NITRO!', 1200);
    }
    if (race.player.finish_time !== null) {
      phase = 'finishing';
      phase_end = ts + 2500;
      show_big_text('FINISH', 2500);
    }
  } else if (phase === 'finishing') {
    update_race(race, dt, 0, 0);
    if (ts > phase_end) {
      show_results();
      return;
    }
  }

  world.render(dt);
  update_hud(input);
  requestAnimationFrame(loop);
}

function update_hud(input) {
  const order = standings(race);
  const p = race.player;
  $('h-pos').textContent = `${order.indexOf(p) + 1}/${race.riders.length}`;
  $('h-time').textContent = fmt_time(p.finish_time ?? race.time);
  $('h-left').textContent = `${(Math.max(0, race.distance_m - p.x) / 1000).toFixed(2)} km left`;
  $('h-watts').textContent = Math.round(input.watts);
  $('h-speed').textContent = (p.v * 3.6).toFixed(1);
  $('h-cad').textContent = Math.round(input.cadence);
  $('h-hr').textContent = input.hr ?? '--';
  update_nitro_hud(input.hr);
  race.riders.forEach((r, i) => {
    progress_dots[i].style.left = `${Math.min(100, (r.x / race.distance_m) * 100)}%`;
  });
  // leaderboard: rider names are fixed constants, so innerHTML is safe
  $('leaderboard').innerHTML = order.map((r, i) => {
    const gap = Math.round(r.x - p.x);
    const gap_text = r.is_player ? '' : (gap >= 0 ? `+${gap} m` : `${gap} m`);
    const fire = r.nitro.boost_left > 0 ? ' 🔥' : '';
    return `<li class="${r.is_player ? 'me' : ''}">${i + 1}. <span class="dot" style="background:${r.color}"></span>${r.name}${fire}<span class="gap">${gap_text}</span></li>`;
  }).join('');
}

// nitro bar: charge level (or remaining boost), target hr window, colour by state
function update_nitro_hud(hr) {
  const n = race.player.nitro;
  const boosting = n.boost_left > 0;
  const el = $('nitro');
  el.classList.toggle('boost', boosting);
  el.classList.toggle('in-range', !boosting && n.in_range && hr !== null);
  el.classList.toggle('off', hr === null);
  $('nitro-fill').style.width = `${(boosting ? n.boost_left / 3 : n.charge) * 100}%`;
  $('nitro-range').textContent = hr === null ? 'needs HR strap' : `HR ${n.range[0]}–${n.range[1]}`;
  $('boost-fx').classList.toggle('hidden', !boosting);
}

function leave_race_screen() {
  phase = 'idle';
  $('countdown').classList.add('hidden');
  $('boost-fx').classList.add('hidden');
  wake_lock?.release().catch(() => {});
  wake_lock = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function show_results() {
  leave_race_screen();
  finish_remaining(race);
  const order = standings(race);
  const p = race.player;
  const pos = order.indexOf(p) + 1;
  const winner_time = order[0].finish_time;

  const best = get_best(settings.km);
  const is_best = best === null || p.finish_time < best;
  if (is_best) set_best(settings.km, p.finish_time);

  $('r-title').textContent = pos === 1 ? 'You won! 🏆' : `You finished ${ordinal(pos)}`;
  $('r-sub').textContent = `${settings.km} km in ${fmt_time(p.finish_time)} · avg ${avg_watts(p)} W · nitro ×${p.nitro.count} · `
    + (is_best ? 'new personal best!' : `best ${fmt_time(best)}`);
  $('r-table').innerHTML = order.map((r, i) => `
    <tr class="${r.is_player ? 'me' : ''}">
      <td>${i + 1}</td>
      <td><span class="dot" style="background:${r.color}"></span> ${r.name}</td>
      <td class="num">${fmt_time(r.finish_time)}</td>
      <td class="num">${i === 0 ? '' : `+${(r.finish_time - winner_time).toFixed(1)}s`}</td>
      <td class="num">${avg_watts(r)} W</td>
    </tr>`).join('');
  show('screen-results');
}

$('btn-start').onclick = start_race;
$('btn-again').onclick = start_race;
$('btn-setup').onclick = () => { render_setup(); show('screen-setup'); };
$('btn-quit').onclick = () => { leave_race_screen(); render_setup(); show('screen-setup'); };

// demo mode: arrow keys change watts (for testing on a pc)
window.addEventListener('keydown', (e) => {
  if (!demo_mode || phase === 'idle') return;
  const slider = $('demo-watts');
  if (e.key === 'ArrowUp') slider.value = +slider.value + 10;
  if (e.key === 'ArrowDown') slider.value = +slider.value - 10;
});

render_setup();
