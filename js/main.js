// pedal quest shell: game picker, shared sensors + profile, setup -> countdown -> play -> results, local leaderboards.
// every game is a module with the same interface (see docs/GAMES.md), mounted into one shared play screen
import { sensors, profile, save_profile, connect, ble_supported, on_change } from './sensors.js?v=17';
import { control } from './ble.js?v=17';
import { load, store, clamp } from './util.js?v=17';
import { set_rider_mass, steady_speed } from './physics.js?v=17';
import { unlock as unlock_sound, play as sfx, set_sound } from './sfx.js?v=17';
import * as ride_log from './ride_log.js?v=17';
import { check_badges, fresh_html, collection_html } from './achievements.js?v=17';
import * as daily from './daily.js?v=17';
import race from './games/race.js?v=17';
import crossroads from './games/crossroads.js?v=17';
import summit from './games/summit.js?v=17';
import pulse from './games/pulse.js?v=17';
import spinbeat from './games/spinbeat.js?v=17';
import escape from './games/escape.js?v=17';
import sprint from './games/sprint.js?v=17';
import workout from './games/workout.js?v=17';

const games = [race, crossroads, summit, pulse, spinbeat, escape, sprint, workout];
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
  const life = load('pq_stats', null);
  $('lifetime').textContent = life
    ? `Lifetime: ${life.rides} games · ${Math.floor(life.secs / 3600)} h ${Math.floor((life.secs % 3600) / 60)} min · ${Math.round(life.km)} km · ${Math.round(life.kj)} kJ`
    : '';
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
$('p-weight').value = profile.weight;
$('p-sound').checked = profile.sound;
set_sound(profile.sound);
$('p-weight').onchange = () => {
  profile.weight = clamp(Math.round(+$('p-weight').value || 75), 35, 150);
  $('p-weight').value = profile.weight;
  save_profile();
};
$('p-sound').onchange = () => {
  profile.sound = $('p-sound').checked;
  set_sound(profile.sound);
  save_profile();
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
  render_daily();
  const open = $('badges').open, h_open = $('history').open;
  $('badges').innerHTML = collection_html();
  $('badges').open = open;
  $('history').innerHTML = ride_log.history_html(Object.fromEntries(games.map((x) => [x.id, x.icon])));
  $('history').open = h_open;
  render_sensors();
}

// daily challenge card: today's game, settings, goal and streak
let daily_run = null;   // today's challenge while a daily attempt is running
function render_daily() {
  const ch = daily.today(profile.ftp);
  const st = daily.state();
  const g = games.find((x) => x.id === ch.game);
  if (!g) { $('daily').classList.add('hidden'); return; }
  $('daily').innerHTML = `
    <div class="daily-row">
      <div><div class="label">📅 Daily challenge${st.streak ? ` · 🔥 ${st.streak} day${st.streak > 1 ? 's' : ''}` : ''}</div>
        <b>${g.icon} ${g.name}</b> · ${ch.text}<div class="small">Goal: ${ch.goal}${st.done_today ? ' · ✓ done today' : ''}</div></div>
      <button id="btn-daily" class="${st.done_today ? 'secondary' : ''}">${st.done_today ? 'Again' : 'Play'}</button>
    </div>`;
  $('btn-daily').onclick = () => {
    // switch to the game, apply the day's settings (other options stay as the rider set them), start
    location.hash = g.id;
    select_game(g.id);
    save_opts(g, { ...game_opts(g), ...ch.opts });
    render_setup();
    daily_run = ch;
    start_game();
  };
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
let run = null;               // this game's totals for lifetime stats
let last_count = 0;           // countdown number already beeped
let paused = false;
let last_result = null;       // for the share button

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
  unlock_sound();                       // must happen inside the tap
  set_rider_mass(profile.weight + 9);   // rider + bike
  run = { secs: 0, kj: 0, km: 0 };
  ride_log.reset();
  last_count = 0;
  set_paused(false);
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
    sfx,
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

  if (paused) {
    instance.render(0, input);
    update_metrics(input);
    requestAnimationFrame(loop);
    return;
  }

  if (phase === 'countdown') {
    const left = phase_end - ts;
    if (left > 0) {
      const n = Math.ceil(left / 1000);
      if (n !== last_count) { last_count = n; sfx('tick'); }
      show_big_text(String(n));
    } else {
      phase = 'play';
      sfx('go');
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
        run.secs += step;
        run.kj += (input.watts * step) / 1000;
        run.km += ((instance.speed?.() ?? 0) * step) / 1000;
        ride_log.record(step, input, instance.speed?.() ?? null);
        if (instance.done) {
          sfx(instance.done_class === 'bad' ? 'bad' : 'finish');
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
  $('m-hr').style.color = hr_zone_color(input.hr);
}

// heart rate colour by zone (share of max hr): grey, blue, green, orange, red
function hr_zone_color(hr) {
  if (hr === null) return '';
  const pct = hr / profile.max_hr;
  if (pct < 0.6) return '#b0bec5';
  if (pct < 0.7) return '#64b5f6';
  if (pct < 0.8) return '#81c784';
  if (pct < 0.9) return '#ffb74d';
  return '#ef5350';
}

// add this game's riding to lifetime totals (only real rides: > 1 min)
function save_run_stats() {
  if (!run || run.secs < 60) return;
  const life = load('pq_stats', { rides: 0, secs: 0, kj: 0, km: 0 });
  life.rides += 1;
  life.secs += run.secs;
  life.kj += run.kj;
  life.km += run.km;
  store('pq_stats', life);
  run = null;
}

window.addEventListener('resize', () => { if (phase !== 'idle') instance?.resize?.(); });

function leave_play() {
  save_run_stats();
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
  last_result = res;
  $('r-title').textContent = res.title;
  $('r-sub').textContent = res.sub || '';
  $('r-body').innerHTML = res.body || '';
  $('r-ride').innerHTML = ride_log.ride_html(profile.ftp);
  ride_log.save_history(current.id, res.title);
  $('btn-export').classList.toggle('hidden', ride_log.summary(profile.ftp).secs < 60);
  // daily challenge result (before badges, so streak badges see the new streak)
  $('r-daily').innerHTML = '';
  if (daily_run && daily_run.game === current.id) {
    const d = daily.complete(daily_run, res.flags);
    $('r-daily').innerHTML = `<div class="panel daily ${d.ok ? 'ok' : ''}"><div class="label">📅 Daily challenge</div>
      <b>${d.ok ? (d.new_day ? `Done! 🔥 Streak: ${d.streak} day${d.streak > 1 ? 's' : ''}` : 'Done again ✓') : `Not this time. Goal: ${daily_run.goal}`}</b></div>`;
  }
  const fresh = check_badges({ game: current.id, opts: active_opts, flags: res.flags, ride: ride_log.summary(profile.ftp), ftp: profile.ftp, game_count: games.length });
  $('r-badges').innerHTML = fresh_html(fresh);
  if (fresh.length) setTimeout(() => sfx('perfect'), 400);
  // optional result actions (e.g. the ramp test's "set my ftp"): buttons that change the profile
  for (const a of res.actions || []) {
    const btn = document.createElement('button');
    btn.className = 'secondary wide';
    btn.textContent = a.label;
    btn.onclick = () => {
      a.run(profile);
      save_profile();
      $('p-ftp').value = profile.ftp;
      btn.textContent = a.done_label || 'Done ✓';
      btn.disabled = true;
    };
    $('r-body').appendChild(btn);
  }
  $('r-board-label').textContent = b.label + (rank === 0 ? ' · new record! 🎉' : rank > 0 ? ` · you placed #${rank + 1}` : '');
  $('r-board').innerHTML = board_html(b, list, rank);
  render_nav();
  show('screen-results');
}

// pause: the game clock stops, the screen keeps showing your live numbers
let paused_at = 0;
function set_paused(on) {
  // the countdown runs on wall-clock time, so shift its end by the pause length
  if (on && !paused) paused_at = performance.now();
  if (!on && paused) phase_end += performance.now() - paused_at;
  paused = on;
  $('btn-pause').textContent = on ? '▶' : '⏸';
  $('btn-pause').setAttribute('aria-label', on ? 'resume' : 'pause');
  if (on) show_big_text('PAUSED');
  else if (phase !== 'idle') $('countdown').classList.add('hidden');
}
$('btn-pause').onclick = () => {
  if (phase === 'play' || phase === 'countdown') set_paused(!paused);
};

// share: phone share sheet, or copy to clipboard on a pc
$('btn-share').onclick = async () => {
  if (!last_result) return;
  const text = `${current.icon} ${current.name}: ${last_result.title}. ${last_result.sub}`;
  const url = location.origin + location.pathname + '#' + current.id;
  try {
    if (navigator.share) await navigator.share({ title: 'Pedal Quest', text, url });
    else {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      $('btn-share').textContent = 'Copied!';
      setTimeout(() => { $('btn-share').textContent = 'Share result'; }, 1500);
    }
  } catch { /* share cancelled */ }
};

// export the last ride as a .tcx file (strava / garmin connect upload)
$('btn-export').onclick = () => {
  const xml = ride_log.tcx(current.name, (w) => steady_speed(w));
  if (!xml) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.garmin.tcx+xml' }));
  a.download = `pedal-quest-${current.id}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.tcx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

$('btn-start').onclick = () => { daily_run = null; start_game(); };
$('btn-again').onclick = start_game;
$('btn-setup').onclick = () => { daily_run = null; render_setup(); show('screen-setup'); };
$('btn-quit').onclick = () => {
  if (phase === 'play' && run && run.secs > 20 && !confirm('Quit this game? Progress will be lost.')) return;
  leave_play();
  render_setup();
  show('screen-setup');
};

// keyboard controls for demo mode on a pc: arrows = watts, [ ] = cadence, - + = heart rate
window.addEventListener('keydown', (e) => {
  if (phase === 'idle') return;
  const nudge = (id, d) => { $(id).value = +$(id).value + d; };
  if (e.key === ' ' || e.key === 'p') $('btn-pause').click();
  if (e.key === 'ArrowUp') nudge('in-watts', 10);
  if (e.key === 'ArrowDown') nudge('in-watts', -10);
  if (e.key === ']') nudge('in-rpm', 5);
  if (e.key === '[') nudge('in-rpm', -5);
  if (e.key === '=' || e.key === '+') nudge('in-hr', 1);
  if (e.key === '-') nudge('in-hr', -1);
});

// one-time move of race best times saved before build 5 (pq_best_<km>) into the leaderboards
for (const km of [1, 2, 5, 10]) {
  const best = load(`pq_best_${km}`, null);
  if (typeof best !== 'number') continue;
  const key = `pq_board_race_${km}km`;
  if (!load(key, []).length) store(key, [{ score: best, note: 'from v1', date: '2026-10-31' }]);
  try { localStorage.removeItem(`pq_best_${km}`); } catch { /* storage blocked */ }
}

select_game(location.hash.slice(1));
