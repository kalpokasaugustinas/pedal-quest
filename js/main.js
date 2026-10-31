// pedal quest shell: game picker, shared sensors + profile, setup -> countdown -> play -> results, local leaderboards.
// every game is a module with the same interface (see docs/GAMES.md), mounted into one shared play screen
import { sensors, profile, save_profile, connect, ble_supported, on_change } from './sensors.js?v=5';
import { control } from './ble.js?v=5';
import { load, store, clamp } from './util.js?v=5';
import race from './games/race.js?v=5';
import crossroads from './games/crossroads.js?v=5';
import summit from './games/summit.js?v=5';
import pulse from './games/pulse.js?v=5';
import spinbeat from './games/spinbeat.js?v=5';
import escape from './games/escape.js?v=5';

const games = [race, crossroads, summit, pulse, spinbeat, escape];
const $ = (id) => document.getElementById(id);

// test helper: ?warp=20 runs game time 20x faster (physics stays stable via sub-steps)
const warp = clamp(+new URLSearchParams(location.search).get('warp') || 1, 1, 100);

// ---- screens ----
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  document.body.classList.toggle('playing', id === 'screen-play');
  window.scrollTo(0, 0);
}

// ---- game options (saved per game) ----
function game_opts(g) {
  const saved = load(`pq_opts_${g.id}`, {});
  const o = {};
  for (const opt of g.options) {
    const v = saved[opt.key];
    const valid = opt.type === 'stepper'
      ? typeof v === 'number' && v >= opt.min && v <= opt.max
      : opt.choices.some(([cv]) => cv === v);
    o[opt.key] = valid ? v : opt.def;
  }
  return o;
}
function save_opts(g, o) { store(`pq_opts_${g.id}`, o); }

// ---- leaderboards: top 10 per board key ----
function board_html(b, list, rank) {
  if (!list.length) return '<li class="empty">No results yet. Be the first!</li>';
  return list.map((e, i) => `<li class="${i === rank ? 'new' : ''}"><span class="b-pos">${i + 1}</span><span class="b-score">${b.fmt(e.score)}</span><span class="b-note">${e.note || ''}</span><span class="b-date">${e.date}</span></li>`).join('');
}

function board_add(b, entry) {
  let list = load(`pq_board_${b.key}`, []);
  list.push(entry);
  list.sort((x, y) => (b.lower ? x.score - y.score : y.score - x.score));
  list = list.slice(0, 10);
  store(`pq_board_${b.key}`, list);
  return { list, rank: list.indexOf(entry) };
}

// ---- top navigation ----
let current = games[0];

function render_nav() {
  $('game-nav').innerHTML = games
    .map((g) => `<button data-id="${g.id}" class="${g === current ? 'on' : ''}"><span class="nav-icon">${g.icon}</span>${g.name}</button>`)
    .join('');
  $('game-nav').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { location.hash = b.dataset.id; };
  });
  $('game-nav').querySelector('.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function select_game(id) {
  current = games.find((g) => g.id === id) || games[0];
  render_nav();
  render_setup();
}

window.addEventListener('hashchange', () => {
  if (phase !== 'idle') return;
  select_game(location.hash.slice(1));
  show('screen-setup');
});

// ---- sensors panel + profile ----
function status_class(text) {
  if (text.startsWith('connected')) return 'ok';
  if (/^(reconnecting|disconnected|cancelled|failed)/.test(text)) return 'err';
  return '';
}

function render_sensors() {
  for (const kind of ['trainer', 'hr']) {
    const el = $(`st-${kind}`);
    el.textContent = sensors.status[kind];
    el.className = `st ${status_class(sensors.status[kind])}`;
  }
  $('mode-note').textContent = sensors.trainer
    ? 'Trainer connected: your watts drive the game.'
    : 'No trainer connected: games run in demo mode with sliders for watts, cadence and heart rate.';
}

$('btn-trainer').onclick = () => connect('trainer');
$('btn-hr').onclick = () => connect('hr');
if (!ble_supported) {
  $('ble-warning').classList.remove('hidden');
  $('btn-trainer').disabled = true;
  $('btn-hr').disabled = true;
}

$('p-ftp').value = profile.ftp;
$('p-maxhr').value = profile.max_hr;
$('p-ftp').onchange = () => {
  profile.ftp = clamp(Math.round(+$('p-ftp').value || 200), 60, 600);
  $('p-ftp').value = profile.ftp;
  save_profile();
  render_setup();
};
$('p-maxhr').onchange = () => {
  profile.max_hr = clamp(Math.round(+$('p-maxhr').value || 185), 120, 220);
  $('p-maxhr').value = profile.max_hr;
  save_profile();
  render_setup();
};

on_change((e) => {
  render_sensors();
  if (phase === 'idle' || e.kind !== 'trainer') return;
  show_banner({ connected: '', reconnecting: 'Trainer reconnecting…', disconnected: 'Trainer disconnected' }[e.state] || '');
});

// ---- setup screen for the selected game ----
function render_setup() {
  const g = current;
  const o = game_opts(g);
  $('g-title').textContent = `${g.icon} ${g.name}`;
  $('g-tagline').textContent = g.tagline;
  $('g-how').innerHTML = g.how.map((t) => `<li>${t}</li>`).join('');
  $('g-needs').innerHTML = needs_html(g);

  $('g-options').innerHTML = g.options.map((opt) => {
    if (opt.type === 'stepper') {
      return `<div class="label">${opt.label}</div>
        <div class="stepper" data-key="${opt.key}"><button data-d="-1" aria-label="less">−</button><span>${o[opt.key]} ${opt.unit}</span><button data-d="1" aria-label="more">+</button></div>`;
    }
    return `<div class="label">${opt.label}</div>
      <div class="seg${opt.wide ? ' wide' : ''}" data-key="${opt.key}">${opt.choices.map(([v, text], i) => `<button data-i="${i}" class="${v === o[opt.key] ? 'on' : ''}">${text}</button>`).join('')}</div>`;
  }).join('') + (g.setup_html ? g.setup_html(o, profile) : '');

  $('g-options').querySelectorAll('.seg').forEach((seg) => {
    const opt = g.options.find((x) => x.key === seg.dataset.key);
    seg.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { o[opt.key] = opt.choices[+b.dataset.i][0]; save_opts(g, o); render_setup(); };
    });
  });
  $('g-options').querySelectorAll('.stepper').forEach((st) => {
    const opt = g.options.find((x) => x.key === st.dataset.key);
    st.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { o[opt.key] = clamp(o[opt.key] + +b.dataset.d * opt.step, opt.min, opt.max); save_opts(g, o); render_setup(); };
    });
  });

  const b = g.board(o);
  $('g-board-label').textContent = b.label;
  $('g-board').innerHTML = board_html(b, load(`pq_board_${b.key}`, []), -1);
  $('btn-start').textContent = `Start ${g.name}`;
  render_sensors();
}

// which sensors this game uses, shown as small chips
function needs_html(g) {
  const chips = [['power', '⚡ Power'], ['cadence', '🔄 Cadence'], ['hr', '❤️ Heart rate'], ['resistance', '⛰️ Trainer resistance']];
  return chips.filter(([k]) => g.uses.includes(k)).map(([, t]) => `<span class="chip">${t}</span>`).join('');
}

// ---- play loop ----
let instance = null;          // running game
let active_opts = null;
let phase = 'idle';           // idle | countdown | play | ending
let phase_end = 0;
let last_ts = 0;
let demo = false;
let wake_lock = null;

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

let big_timer = null;
function show_big_text(text, hide_after_ms, cls = '') {
  const el = $('countdown');
  el.textContent = text;
  el.className = `countdown ${cls}`;
  clearTimeout(big_timer);
  if (hide_after_ms) big_timer = setTimeout(() => el.classList.add('hidden'), hide_after_ms);
}

// distances of the play screen covered by the hud (games keep important drawing out of these)
function insets() {
  return { top: $('play-top').offsetHeight, bottom: $('hud-bottom').offsetHeight };
}

function start_game() {
  active_opts = game_opts(current);
  demo = !sensors.trainer;
  const hr_slider = sensors.hr === null && !sensors.hr_strap;
  $('demo-w').classList.toggle('hidden', !demo);
  $('demo-rpm').classList.toggle('hidden', !demo);
  $('demo-hr').classList.toggle('hidden', !hr_slider);
  $('demo').classList.toggle('hidden', !demo && !hr_slider);
  $('in-watts').value = 0;

  // a fresh canvas per game: a canvas can't switch between webgl (3d) and 2d
  $('canvas-slot').innerHTML = '<canvas class="game-canvas"></canvas>';
  const canvas = $('canvas-slot').firstChild;
  $('game-hud').innerHTML = '';
  $('overlay').innerHTML = '';
  $('game-bottom').innerHTML = '';
  show_banner('');

  show('screen-play');
  document.documentElement.requestFullscreen?.().catch(() => {});
  request_wake_lock();

  instance = current.create({
    canvas,
    hud: $('game-hud'),
    overlay: $('overlay'),
    bottom: $('game-bottom'),
    opts: active_opts,
    profile,
    trainer: control,
    big_text: show_big_text,
    insets,
  });
  phase = 'countdown';
  phase_end = performance.now() + 3000;
  last_ts = performance.now();
  requestAnimationFrame(loop);
}

// current inputs: trainer (or demo sliders) + hr (strap, trainer-relayed, or demo slider)
function read_input(ts) {
  let watts, cadence;
  if (demo) {
    watts = +$('in-watts').value;
    cadence = +$('in-rpm').value;
  } else {
    const stale = ts - sensors.last_trainer_ms > 3000;   // no data for 3 s = not pedalling
    watts = stale ? 0 : sensors.watts;
    cadence = stale ? 0 : sensors.cadence;
  }
  let hr = sensors.hr;
  if (hr === null && !$('demo-hr').classList.contains('hidden')) hr = +$('in-hr').value;
  return { watts, cadence, hr };
}

function loop(ts) {
  if (phase === 'idle' || !instance) return;
  const real_dt = Math.min(0.1, Math.max(0, (ts - last_ts) / 1000));   // app in background = pause
  last_ts = ts;
  const input = read_input(ts);

  if (phase === 'countdown') {
    const left = phase_end - ts;
    if (left > 0) {
      show_big_text(String(Math.ceil(left / 1000)));
    } else {
      phase = 'play';
      show_big_text('GO!', 800);
    }
  } else {
    // fixed sub-steps keep physics stable when warp is on
    let remaining = real_dt * warp;
    while (remaining > 1e-6) {
      const step = Math.min(0.1, remaining);
      remaining -= step;
      if (phase === 'play') {
        instance.update(step, input);
        if (instance.done) {
          phase = 'ending';
          phase_end = ts + 2500;
          show_big_text(instance.done_text || 'FINISH', 2500, instance.done_class || '');
        }
      } else {
        instance.update(step, { watts: 0, cadence: 0, hr: input.hr });
      }
    }
    if (phase === 'ending' && ts > phase_end) {
      finish_game();
      return;
    }
  }

  instance.render(real_dt * warp, input);
  update_metrics(input);
  requestAnimationFrame(loop);
}

function update_metrics(input) {
  $('m-watts').textContent = Math.round(input.watts);
  const v = instance.speed ? instance.speed() : null;
  $('m-speed').textContent = v === null ? '--' : (v * 3.6).toFixed(1);
  $('m-cad').textContent = Math.round(input.cadence);
  $('m-hr').textContent = input.hr ?? '--';
}

window.addEventListener('resize', () => { if (phase !== 'idle') instance?.resize?.(); });

function leave_play() {
  phase = 'idle';
  instance?.dispose?.();
  instance = null;
  clearTimeout(big_timer);
  $('countdown').classList.add('hidden');
  wake_lock?.release().catch(() => {});
  wake_lock = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function finish_game() {
  const res = instance.result();
  leave_play();
  const b = current.board(active_opts);
  let list = load(`pq_board_${b.key}`, []);
  let rank = -1;
  if (res.score !== null && res.score !== undefined) {
    ({ list, rank } = board_add(b, { score: res.score, note: res.note || '', date: new Date().toISOString().slice(0, 10) }));
  }
  $('r-title').textContent = res.title;
  $('r-sub').textContent = res.sub || '';
  $('r-body').innerHTML = res.body || '';
  $('r-board-label').textContent = b.label + (rank === 0 ? ' · new record! 🎉' : rank > 0 ? ` · you placed #${rank + 1}` : '');
  $('r-board').innerHTML = board_html(b, list, rank);
  render_nav();
  show('screen-results');
}

$('btn-start').onclick = start_game;
$('btn-again').onclick = start_game;
$('btn-setup').onclick = () => { render_setup(); show('screen-setup'); };
$('btn-quit').onclick = () => { leave_play(); render_setup(); show('screen-setup'); };

// keyboard controls for demo mode on a pc: arrows = watts, [ ] = cadence, - + = heart rate
window.addEventListener('keydown', (e) => {
  if (phase === 'idle') return;
  const nudge = (id, d) => { $(id).value = +$(id).value + d; };
  if (e.key === 'ArrowUp') nudge('in-watts', 10);
  if (e.key === 'ArrowDown') nudge('in-watts', -10);
  if (e.key === ']') nudge('in-rpm', 5);
  if (e.key === '[') nudge('in-rpm', -5);
  if (e.key === '=' || e.key === '+') nudge('in-hr', 1);
  if (e.key === '-') nudge('in-hr', -1);
});

select_game(location.hash.slice(1));
