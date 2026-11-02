// pedal quest shell: game picker, shared sensors + profile, setup -> countdown -> play -> results, local leaderboards.
// every game is a module with the same interface (see docs/GAMES.md), mounted into one shared play screen
import { sensors, profile, save_profile, reload_profile, connect, ble_supported, on_change } from './sensors.js?v=41';
import { control } from './ble.js?v=41';
import { load, store, clamp, players, active_player, set_active_player, save_players } from './util.js?v=41';
import { init_cloud, flush as cloud_flush } from './cloud.js?v=41';
import { stats_html } from './stats.js?v=41';
import { set_rider_mass, steady_speed } from './physics.js?v=41';
import { unlock as unlock_sound, play as sfx, set_sound, set_music, set_track, music_tracks, now_playing, next_song, update_ride, stop_ride } from './sfx.js?v=41';
import * as ride_log from './ride_log.js?v=41';
import { check_badges, fresh_html, collection_html } from './achievements.js?v=41';
import * as daily from './daily.js?v=41';
import { pp_state, level_info, look, set_look, catalog, award, award_html } from './progress.js?v=41';
import { rider_preview, ambience } from './kit3d.js?v=41';
import { start_menu3d } from './menu3d.js?v=41';
import { option_html } from './menu_ui.js?v=41';
import race from './games/race.js?v=41';
import crossroads from './games/crossroads.js?v=41';
import summit from './games/summit.js?v=41';
import pulse from './games/pulse.js?v=41';
import spinbeat from './games/spinbeat.js?v=41';
import escape from './games/escape.js?v=41';
import sprint from './games/sprint.js?v=41';
import workout from './games/workout.js?v=41';

// main games are in the picker; archived ones are still playable from the stats tab (or a #link)
const games = [race, crossroads, sprint, workout, summit, pulse, spinbeat, escape];
const main_games = ['race', 'crossroads', 'sprint', 'workout'];
const $ = (id) => document.getElementById(id);

// the game world behind the menus with cinematic camera shots (stopped while a game runs)
const menu_bg = start_menu3d($('menu-bg'), look);

// test helper: ?warp=20 runs game time 20x faster (physics stays stable via sub-steps)
const warp = clamp(+new URLSearchParams(location.search).get('warp') || 1, 1, 100);

// ---- screens ----
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  document.body.classList.toggle('playing', id === 'screen-play');
  document.body.classList.toggle('results', id === 'screen-results');
  menu_bg.show(id !== 'screen-play');
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
  // top 3 get medals
  return list.map((e, i) => `<li class="${i === rank ? 'new' : ''}${i < 3 ? ` podium p${i + 1}` : ''}"><span class="b-pos">${['🥇', '🥈', '🥉'][i] || i + 1}</span><span class="b-score">${b.fmt(e.score)}</span><span class="b-note">${e.note || ''}</span><span class="b-date">${e.date}</span></li>`).join('');
}

function board_add(b, entry) {
  let list = load(`pq_board_${b.key}`, []);
  list.push(entry);
  list.sort((x, y) => (b.lower ? x.score - y.score : y.score - x.score));
  list = list.slice(0, 10);
  store(`pq_board_${b.key}`, list);
  // remember the board's name for the stats tab (keys alone don't say "2 km" or "5 stages × 2 min")
  const labels = load('pq_board_labels', {});
  if (labels[b.key] !== b.label) { labels[b.key] = b.label; store('pq_board_labels', labels); }
  return { list, rank: list.indexOf(entry) };
}

// ---- top navigation: main games, an opened archived game, the stats tab and the garage ----
let current = games[0];
let stats_view = false;
let garage_view = false;

function render_nav() {
  const shown = games.filter((g) => main_games.includes(g.id) || g === current);
  // game select: one card per game
  $('game-nav').innerHTML = shown
    .map((g) => `<button data-id="${g.id}" class="game-card${g === current && !stats_view && !garage_view ? ' on' : ''}"><span class="gc-icon">${g.icon}</span><span class="gc-name">${g.name}</span></button>`)
    .join('');
  // top right: level badge with pp progress, stats and garage
  const li = level_info(pp_state().total);
  $('menu-icons').innerHTML = `<button data-id="garage" class="lvl-chip" aria-label="level ${li.level}, open garage"><b>${li.level}</b>
      <span><small>LEVEL</small><i><em style="width:${Math.round((li.into / li.need) * 100)}%"></em></i></span></button>`
    + `<button data-id="stats" class="icon-btn${stats_view ? ' on' : ''}" aria-label="stats">📊</button>`
    + `<button data-id="garage" class="icon-btn${garage_view ? ' on' : ''}" aria-label="garage">🎨</button>`;
  document.querySelectorAll('#game-nav button, #menu-icons button').forEach((b) => {
    b.onclick = () => { location.hash = b.dataset.id; };
  });
  $('game-nav').querySelector('.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function select_game(id) {
  stats_view = id === 'stats';
  garage_view = id === 'garage';
  if (!garage_view && preview) { preview.dispose(); preview = null; }   // stop the turntable
  if (garage_view) {
    render_nav();
    render_garage();
    show('screen-garage');
    return;
  }
  if (stats_view) {
    render_nav();
    render_stats();
    show('screen-stats');
    return;
  }
  current = games.find((g) => g.id === id) || games[0];
  render_nav();
  render_setup();
  show('screen-setup');
}

window.addEventListener('hashchange', () => {
  if (phase !== 'idle') return;
  select_game(location.hash.slice(1));
});

function render_stats() {
  $('stats-body').innerHTML = stats_html({ games, main: main_games, opts_of: game_opts, player: active_player().name, daily: daily.state() });
  const open = $('badges').open, h_open = $('history').open;
  $('badges').innerHTML = collection_html();
  $('badges').open = open;
  $('history').innerHTML = ride_log.history_html(Object.fromEntries(games.map((x) => [x.id, x.icon])));
  $('history').open = h_open;
}

// ---- garage: level, pp and the cyclist look (items unlock with levels) ----
let preview = null;
// small sample shown on each item button
function swatch(slot, id) {
  if (id === 'auto') return `<i style="background:${look().jersey}"></i>`;
  if (id === 'rainbow') return '<i class="sw-rainbow"></i>';
  if (id.startsWith('#')) return `<i style="background:${id}"></i>`;
  return `<i class="sw-icon">${{ none: '∅', sparks: '✨', smoke: '💨', stars: '⭐', plain: '▬', hoops: '☰', stripes: '⫼', sash: '⟋', dots: '⁘', twotone: '◧', chevron: '⌄', checks: '▦' }[id] || '•'}</i>`;
}
function render_garage() {
  const s = pp_state(), li = level_info(s.total), lk = look();
  $('garage-level').innerHTML = `<div class="pp-head"><b>Level ${li.level}</b><span>${s.total} PP</span></div>
    <div class="pp-bar"><div style="width:${Math.round((li.into / li.need) * 100)}%"></div></div>
    <div class="small">${li.into} / ${li.need} PP to level ${li.level + 1}. Earn PP: 10 per km · +10 per finished game · win +50, 2nd +30, 3rd +20 ·
    personal best +30 · daily challenge +40 · new badge +20 · workout ≥ 80% on target +20.</div>`;
  $('garage-slots').innerHTML = Object.entries(catalog).map(([k, c]) => `<div class="label">${c.label}</div><div class="swatches">${
    c.items.map(([id, name, lvl]) => {
      const locked = lvl > li.level;
      return `<button class="sw${lk[k] === id ? ' on' : ''}${locked ? ' locked' : ''}" data-slot="${k}" data-id="${id}" ${locked ? 'disabled' : ''}>${swatch(k, id)}<span>${locked ? `🔒 Lv ${lvl}` : name}</span></button>`;
    }).join('')}</div>`).join('');
  $('garage-slots').querySelectorAll('button.sw').forEach((b) => {
    b.onclick = () => { set_look(b.dataset.slot, b.dataset.id); menu_bg.set_look(look()); render_garage(); };
  });
  preview ??= rider_preview($('garage-canvas'));
  preview.set(look());
  render_rider_sum();
}

// ---- player: one rider per app (name can be changed), details shared by every game ----
// (storage still supports several players per device; the ui uses the first one)
if (active_player() !== players.list[0]) set_active_player(players.list[0].id);
function render_players() {
  $('player-name').value = active_player().name;
  render_rider_sum();
}
$('player-name').onchange = () => {
  const name = $('player-name').value.trim().slice(0, 24);
  if (name) { active_player().name = name; save_players(); }
  render_players();
  if (stats_view) render_stats();
};

// rider bar summary (always visible): who, ftp, and which sensors are live
function render_rider_sum() {
  const dot = (ok) => (ok ? '<i class="dot-ok"></i>' : '<i class="dot-off"></i>');
  $('rider-sum').innerHTML = `<b>👤 ${active_player().name.replace(/</g, '&lt;')}</b>`
    + `<span>Lv ${level_info(pp_state().total).level}</span><span>FTP ${profile.ftp} W</span><span>${dot(sensors.trainer)}Trainer</span><span>${dot(sensors.hr_strap)}HR</span>`;
}
// open until the trainer is connected; after that the rider bar stays folded (tap to open)
$('rider').open = true;

// show the active player's profile in the setup inputs
function show_profile() {
  $('p-ftp').value = profile.ftp;
  $('p-maxhr').value = profile.max_hr;
  $('p-weight').value = profile.weight;
  $('p-sound').checked = profile.sound;
  $('p-music').checked = profile.music;
  $('p-comm').checked = profile.commentator !== false;
  // music track: shuffle (a new song each ride) or one favourite
  $('p-track').innerHTML = `<option value="shuffle">🔀 Shuffle</option>` + music_tracks().map(([id, name, style]) => `<option value="${id}">${name} (${style})</option>`).join('');
  $('p-track').value = profile.track || 'shuffle';
  set_track($('p-track').value);
  set_sound(profile.sound);
  set_music(profile.music);
}


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
  render_rider_sum();
  if ($('how-mode')) $('how-mode').textContent = sensors.trainer
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

show_profile();
$('p-ftp').onchange = () => {
  profile.ftp = clamp(Math.round(+$('p-ftp').value || 200), 60, 600);
  $('p-ftp').value = profile.ftp;
  save_profile();
  render_setup();
};
$('p-weight').onchange = () => {
  profile.weight = clamp(Math.round(+$('p-weight').value || 75), 35, 150);
  $('p-weight').value = profile.weight;
  save_profile();
};
$('p-music').onchange = () => {
  profile.music = $('p-music').checked;
  set_music(profile.music);
  save_profile();
};
$('p-comm').onchange = () => {
  profile.commentator = $('p-comm').checked;
  save_profile();
};
// in a ride: skip to another song
$('btn-song').onclick = () => { if (next_song()) show_song(true); };
$('p-track').onchange = () => {
  profile.track = $('p-track').value;
  set_track(profile.track);
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
  if (e.kind === 'trainer' && e.state === 'connected') $('rider').open = false;
  if (phase === 'idle' || e.kind !== 'trainer') return;
  show_banner({ connected: '', reconnecting: 'Trainer reconnecting…', disconnected: 'Trainer disconnected' }[e.state] || '');
});

// ---- setup screen for the selected game ----
function render_setup() {
  const g = current;
  const o = game_opts(g);
  $('g-title').textContent = `${g.icon} ${g.name}`;
  $('g-tagline').textContent = g.tagline;
  // game extras: notes (p.small) go into how to play, visuals (e.g. the workout profile) stay on the screen
  const extra = document.createElement('div');
  extra.innerHTML = g.setup_html ? g.setup_html(o, profile) : '';
  const notes = [...extra.querySelectorAll('p.small')].map((p) => { p.remove(); return p.innerHTML; });
  $('g-how').innerHTML = g.how.map((t) => `<li>${t}</li>`).join('')
    + notes.map((t) => `<li class="how-note">${t}</li>`).join('')
    + '<li class="how-note" id="how-mode"></li>'
    + '<li class="how-note">FTP, max HR and weight (rider panel) scale every game: FTP sizes targets and rivals, max HR sets heart rate zones, weight sets how fast your watts move you.</li>'
    + '<li class="how-note">Trouble connecting? <a href="test.html">Connection test page</a></li>';
  $('g-needs').innerHTML = needs_html(g);

  // game-style sections (menu_ui.js), then the game's own extras (rival lineup, workout profile...)
  $('g-options').innerHTML = g.options.map((opt) => option_html(opt, o[opt.key], profile)).join('')
    + (extra.innerHTML.trim() ? `<div class="opt-extra">${extra.innerHTML}</div>` : '');

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
  $('btn-start').innerHTML = `<span class="go-arrow">▶</span> Ride ${g.name}`;
  render_daily();
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
let phase = 'idle';           // idle | loading | countdown | play | ending
let load_frames = 0;          // frames drawn while loading
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

// "now playing" label for a few seconds after the start
function show_song(force = false) {
  const name = now_playing();
  if (!name || (phase !== 'play' && !force)) return;
  document.querySelectorAll('.music-toast').forEach((e) => e.remove());
  const el = document.createElement('div');
  el.className = 'music-toast';
  el.textContent = `♪ ${name}`;
  $('screen-play').appendChild(el);
  setTimeout(() => el.classList.add('gone'), 4000);
  setTimeout(() => el.remove(), 5500);
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
    look: look(),
  });
  // preload: draw the world (frozen) for ~1.5 s before the countdown. the first frames compile every shader,
  // upload geometry + textures and let auto resolution settle, so none of that stutters once you ride
  phase = 'loading';
  load_frames = 0;
  phase_end = performance.now() + 1500;
  show_big_text('Loading…', 0, 'callout');
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
  track_hud_top(ts);
  const real_dt = Math.min(0.1, Math.max(0, (ts - last_ts) / 1000));   // app in background = pause
  last_ts = ts;
  const input = read_input(ts);

  if (paused) {
    stop_ride();   // silence while paused
    instance.render(0, input);
    update_metrics(input);
    requestAnimationFrame(loop);
    return;
  }

  if (phase === 'loading') {
    instance.render(0, input);
    load_frames += 1;
    if (ts > phase_end && load_frames >= 40) {
      phase = 'countdown';
      phase_end = ts + 3000;
    }
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
      setTimeout(show_song, 1500);
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
  // ride sound: wind with your speed, weather / water / crowd from the scenery, music on your cadence
  update_ride(real_dt, { speed: instance?.speed?.() ?? 0, cadence: input.cadence, effort: input.watts / profile.ftp, ...ambience });
  update_metrics(input);
  requestAnimationFrame(loop);
}

// the leaderboard and banners sit under the top hud, whose height changes (fullscreen notch, wrapped text)
let hud_top = 0, hud_top_t = 0;
function track_hud_top(ts) {
  if (ts - hud_top_t < 500) return;
  hud_top_t = ts;
  const h = $('play-top').offsetHeight, hb = $('hud-bottom').offsetHeight;
  if (h !== hud_top) { hud_top = h; document.documentElement.style.setProperty('--hud-top', `${h}px`); }
  document.documentElement.style.setProperty('--hud-bottom', `${hb}px`);
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
  ride_log.save_totals(current.id, run.km);
  run = null;
}

window.addEventListener('resize', () => { if (phase !== 'idle') instance?.resize?.(); });

function leave_play() {
  stop_ride();
  save_run_stats();
  phase = 'idle';
  instance?.dispose?.();
  instance = null;
  clearTimeout(big_timer);
  $('countdown').classList.add('hidden');
  wake_lock?.release().catch(() => {});
  wake_lock = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  cloud_flush();   // a sync that arrived during the game
}

function finish_game() {
  const res = instance.result();
  const ran = run ? { ...run } : { secs: 0, km: 0 };   // leave_play() files the run into the stats
  leave_play();
  const b = current.board(active_opts);
  let list = load(`pq_board_${b.key}`, []);
  let rank = -1;
  if (res.score !== null && res.score !== undefined) {
    ({ list, rank } = board_add(b, { score: res.score, text: b.fmt(res.score), note: res.note || '', date: new Date().toISOString().slice(0, 10) }));
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
  let daily_new = false;
  if (daily_run && daily_run.game === current.id) {
    const d = daily.complete(daily_run, res.flags);
    daily_new = d.ok && d.new_day;
    $('r-daily').innerHTML = `<div class="panel daily ${d.ok ? 'ok' : ''}"><div class="label">📅 Daily challenge</div>
      <b>${d.ok ? (d.new_day ? `Done! 🔥 Streak: ${d.streak} day${d.streak > 1 ? 's' : ''}` : 'Done again ✓') : `Not this time. Goal: ${daily_run.goal}`}</b></div>`;
  }
  const fresh = check_badges({ game: current.id, opts: active_opts, flags: res.flags, ride: ride_log.summary(profile.ftp), ftp: profile.ftp, main: main_games });
  $('r-badges').innerHTML = fresh_html(fresh);
  if (fresh.length) setTimeout(() => sfx('perfect'), 400);
  // pedal points + level
  const pp = award({ secs: ran.secs, km: ran.km, flags: res.flags, rank, daily_new, badges: fresh.length });
  $('r-pp').innerHTML = award_html(pp);
  if (pp && pp.after.level > pp.before.level) setTimeout(() => sfx('finish'), 900);
  render_rider_sum();
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
  // confetti for a podium, a new record or a level up
  if ((res.flags?.pos ?? 99) <= 3 || rank === 0 || (pp && pp.after.level > pp.before.level)) menu_bg.celebrate();
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

// one-time (build 25): every game's scenery becomes "surprise me", the new default
if (!load('pq_mig_surprise', false)) {
  for (const g of games) {
    const o = load(`pq_opts_${g.id}`, null);
    if (o?.scenery) { o.scenery = 'random'; store(`pq_opts_${g.id}`, o); }
  }
  store('pq_mig_surprise', true);
}

ride_log.backfill_totals();
render_players();
select_game(location.hash.slice(1));
init_cloud({
  button: $('sync'),
  can_apply: () => phase === 'idle',
  // data from another device: reload the player and redraw whatever screen is open
  on_remote: () => {
    reload_profile();
    show_profile();
    render_players();
    if (stats_view) render_stats(); else if (garage_view) render_garage(); else render_setup();
  },
});
