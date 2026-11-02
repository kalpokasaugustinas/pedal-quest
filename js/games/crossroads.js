// crossroads: each stage pick one of three paths. every path shows the watts to hold and the points it pays.
// the exchange rate (points per watt) differs per path, so the best pick is your own math - and your legs
import { create_kit, vis_scale, scenery_option, curve_x } from '../kit3d.js?v=33';
import { step_speed } from '../physics.js?v=33';
import { rand, clamp, fmt_clock } from '../util.js?v=33';

// path looks: sign colour + trail surface in 3d
const themes = [
  { name: 'Valley Road', surface: 'asphalt', sky: ['#6fb8ec', '#d4eefa'], far: '#8fbf86', near: '#6aa25a', ground: '#5f9a4a', road: '#3a3d42', dash: '#ffffff' },
  { name: 'Ridge Climb', surface: 'asphalt', sky: ['#7a9cc6', '#e0e6ef'], far: '#a59a90', near: '#857868', ground: '#8a7d6b', road: '#45464a', dash: '#ffffff' },
  { name: 'Forest Trail', surface: 'dirt', sky: ['#5fa6c9', '#cfe9d8'], far: '#3f7a4d', near: '#2f6040', ground: '#3d6b35', road: '#6b5a44', dash: '#d9c7a0' },
  { name: 'Coastal Sprint', surface: 'asphalt', sky: ['#4fb0e8', '#e6f6ff'], far: '#3b8fc4', near: '#e8d9a8', ground: '#d9c58f', road: '#3a3d42', dash: '#ffffff' },
  { name: 'Desert Highway', surface: 'dirt', sky: ['#f0a560', '#fbe3b8'], far: '#d9a066', near: '#c98a52', ground: '#d8b27a', road: '#4a4440', dash: '#ffd27a' },
  { name: 'Night Express', surface: 'asphalt', tag: '#7986cb', sky: ['#141a3a', '#3a3f74'], far: '#2a3060', near: '#1a1f40', ground: '#1f2a24', road: '#2a2c30', dash: '#ffe066' },
  { name: 'Alpine Pass', surface: 'gravel', sky: ['#5d93d6', '#eaf2fb'], far: '#e9eef5', near: '#8aa0b3', ground: '#6f8f5a', road: '#3f4146', dash: '#ffffff' },
];

const choose_s = 15;          // seconds to pick a path
const on_target_ratio = 0.95; // 3 s average must be at least 95% of the target
const clean_share = 0.9;      // 90% of the stage on target = clean stage
const max_streak = 5;         // streak multiplier caps at x1.5

const round5 = (x) => Math.round(x / 5) * 5;

// three paths: one easy, one medium, one hard (as % of ftp). points follow effort,
// but each path's exchange rate is randomised by +-35%, so the obvious pick is not always the best
function make_paths(ftp) {
  const bands = [[0.55, 0.72], [0.75, 0.92], [0.95, 1.2]];
  const pool = [...themes].sort(() => Math.random() - 0.5);
  const paths = bands.map(([lo, hi], i) => {
    const pct = rand(lo, hi);
    return { watts: round5(ftp * pct), points: round5(pct * 100 * rand(0.65, 1.35)), theme: pool[i], mystery: false };
  });
  // one stage in four: a mystery path. watts hidden until you commit, but it pays 1.5x a fair path
  if (Math.random() < 0.25) {
    const pct = rand(0.6, 1.15);
    paths[Math.floor(Math.random() * 3)] = { watts: round5(ftp * pct), points: round5(pct * 150), theme: pool[3], mystery: true };
  }
  return paths.sort(() => Math.random() - 0.5);
}

export default {
  id: 'crossroads',
  name: 'Crossroads',
  icon: '🔀',
  tagline: 'Pick a path every stage. Watts vs points: do the math.',
  uses: ['power', 'cadence'],
  how: [
    'Each stage the road forks into 3 paths. Pick one (tap a card) within 15 s or before you reach the fork. Every path shows the watts to hold and the points it pays.',
    'Points per watt differ on every path, so the best deal isn’t always obvious. Do the math!',
    'Hold your 3-second average at 95%+ of the target. You get the path’s points × the share of time on target.',
    'Clean stage (90%+ on target) grows your streak multiplier: ×1.1, ×1.2 … up to ×1.5. A missed stage resets it.',
    '❓ Mystery paths hide their watts until you commit, but they pay 1.5× more.',
    'After the ride you see whether each pick was the best points-per-watt deal.',
    'Pick nothing in time and you get the easiest path.',
  ],
  options: [
    { key: 'stages', label: 'Stages', choices: [[5, '5'], [8, '8'], [12, '12']], def: 5 },
    { key: 'stage_min', label: 'Stage length', choices: [[1, '1 min'], [2, '2 min'], [3, '3 min']], def: 2 },
    scenery_option('valley'),
  ],
  setup_html: (o, profile) => `<p class="small">Path targets are based on your FTP (${profile.ftp} W): easy 55–72%, medium 75–92%, hard 95–120%. Total ride ≈ ${o.stages * o.stage_min + Math.round(o.stages * 0.25)} min.</p>`,
  board: (o) => ({ key: `crossroads_${o.stages}x${o.stage_min}`, label: `Top scores · ${o.stages} stages × ${o.stage_min} min`, lower: false, fmt: (s) => `${s} pts` }),
  create,
};

function create(env) {
  const $ = (id) => document.getElementById(id);
  const ftp = env.profile.ftp;
  const stage_s = env.opts.stage_min * 60;
  const st = {
    stage: 0, phase: 'choose', t_phase: 0, paths: make_paths(ftp), path: null,
    avg_w: 0, on_target: 0, total: 0, streak: 0, log: [],
    x: 0, v: 0, crank: 0, energy: 0, time: 0, flash: 0, watts: 0,
  };

  // ---- 3d world: the road bends into the chosen path at every fork ----
  const vis = vis_scale;                 // visual speed multiplier
  const fork_ahead = 92 * vis;     // a new fork appears 92 m ahead (same warning time at any visual speed)
  const branch_w = 26, branch_len = 90;   // branches spread 26 m sideways over 90 m
  const bends = [];                // { z, dx } road bends (one per chosen path)
  const surfaces = [{ z: Infinity, surf: 'asphalt' }];
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const road_x = (z) => curve_x(z) + bends.reduce((x, b) => x + b.dx * ease((b.z - z) / branch_len), 0);
  const kit = create_kit(env.canvas, {
    theme: env.opts.scenery, road_x, road_w: 2.6, lanes: 2,   // a single bike track with a centre dash
    surface: (z) => surfaces.filter((s) => z <= s.z).pop().surf,
  });
  const me = kit.add_rider(env.look);
  let fork = null;   // { z, x, trails: [mesh], signs: [mesh] }
  const rider_z = () => -st.x * vis;

  // trail points for branch dir d (-1 left, 0 straight, 1 right) from the fork
  function branch_pts(f, d) {
    const pts = [];
    // follows the winding road as it is before the pick, spreading out sideways
    for (let t = 0; t <= 240; t += 6) pts.push({ x: road_x(f.z - t) + d * branch_w * ease(t / branch_len), z: f.z - t });
    return pts;
  }

  // sign board texture: path name, watts, points, arrow
  function sign_draw(p, d) {
    return (g, w, h) => {
      const col = p.theme.tag || p.theme.near;
      g.fillStyle = 'rgba(20,24,30,0.92)';
      g.beginPath();
      g.roundRect(4, 4, w - 8, h - 8, 26);
      g.fill();
      g.fillStyle = col;
      g.fillRect(4, 4, w - 8, 22);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = '800 44px system-ui, sans-serif';
      g.fillText(`${['⬅', '⬆', '➡'][d + 1]} ${p.mystery ? '❓ ' : ''}${p.theme.name}`, w / 2, 86);
      g.font = '900 78px system-ui, sans-serif';
      g.fillStyle = '#ffd54f';
      g.fillText(p.mystery ? '??? W' : `${p.watts} W`, w / 2, 176);
      g.font = '800 54px system-ui, sans-serif';
      g.fillStyle = '#9be7a0';
      g.fillText(`${p.points} pts`, w / 2, 250);
    };
  }

  // a new fork ahead: the road stops in a clearing and three signed trails branch off
  function place_fork() {
    if (fork) for (const o of [...fork.trails, ...fork.signs]) kit.remove(o);
    const z = rider_z() - fork_ahead;
    fork = { z, x: road_x(z), trails: [], signs: [] };
    kit.clear_flat_zones();
    kit.add_flat_zone(fork.x, z - 45, 120);
    kit.set_road_end(z);
    kit.invalidate(z + 130, z - 260);
    fork.pts = [-1, 0, 1].map((d) => branch_pts(fork, d));   // kept: the road changes after the pick
    st.paths.forEach((p, i) => {
      const d = i - 1;
      fork.trails.push(kit.add_trail(fork.pts[i], 2.6, p.theme.surface));
      // signs stand just before the fork, spread across the junction, facing the rider
      fork.signs.push(kit.add_sign(fork.x + d * 6, z + 8, sign_draw(p, d), 0, 4.4, 2.5));
    });
  }

  // after a pick: the road continues into the chosen branch (and takes its surface)
  function commit_fork(i) {
    const d = i - 1;
    bends.push({ z: fork.z, dx: d * branch_w });
    surfaces.push({ z: fork.z, surf: st.path.theme.surface });
    kit.set_road_end(-Infinity);
    kit.invalidate(fork.z + 130, -Infinity);
    // the ground changed shape around the new road: re-drape the trails not taken
    for (const t of fork.trails) kit.remove(t);
    fork.trails = st.paths.map((p, k) => (k === i ? null : kit.add_trail(fork.pts[k], 2.6, p.theme.surface))).filter(Boolean);
  }

  env.hud.innerHTML = `
    <div class="gh-row">
      <div class="gh-big" id="cr-total">0</div>
      <div><div id="cr-stage" class="gh-title"></div><div id="cr-sub" class="gh-sub"></div></div>
    </div>`;
  env.bottom.innerHTML = `
    <div class="target">
      <div class="target-row"><span id="cr-target"></span><span id="cr-avg"></span></div>
      <div class="meter"><div id="cr-fill" class="meter-fill"></div><div class="meter-mark" style="left:${clean_share * 100}%"></div></div>
    </div>`;

  // path choice cards, docked low so the 3d fork stays visible; left / straight / right like the road
  function show_choice() {
    place_fork();
    env.overlay.innerHTML = `
      <div class="choice dock" style="bottom:${env.insets().bottom + 8}px">
        <div class="choice-title">Stage ${st.stage + 1}/${env.opts.stages}: choose your path <span id="cr-count" class="choice-count"></span></div>
        <div class="choice-paths">${st.paths.map((p, i) => `
          <button class="path" data-i="${i}" style="--c:${p.theme.tag || p.theme.near}">
            <span class="path-dir">${['⬅', '⬆', '➡'][i]}</span>
            <span class="path-name">${p.mystery ? '❓ ' : ''}${p.theme.name}</span>
            <span class="path-w">${p.mystery ? '??? W' : `${p.watts} W`}</span>
            <span class="path-p">${p.points} pts</span>
          </button>`).join('')}
        </div>
        <div class="choice-foot">Streak ×${(1 + 0.1 * st.streak).toFixed(1)} · ${stage_s / 60} min per stage</div>
      </div>`;
    env.overlay.querySelectorAll('.path').forEach((b) => { b.onclick = () => pick(+b.dataset.i); });
  }

  function pick(i) {
    st.path = st.paths[i];
    st.phase = 'ride';
    st.t_phase = 0;
    st.on_target = 0;
    env.overlay.innerHTML = '';
    env.sfx('click');
    env.big_text(st.path.mystery ? `${st.path.watts} W!` : ['⬅ GO!', 'GO! ⬆', 'GO! ➡'][i], 1200);
    commit_fork(i);
  }

  // pick nothing: you get the easiest path
  function auto_pick() {
    pick(st.paths.reduce((best, p, i) => (p.watts < st.paths[best].watts ? i : best), 0));
  }

  function end_stage() {
    const share = clamp(st.on_target / stage_s, 0, 1);
    const mult = 1 + 0.1 * st.streak;
    const pts = Math.round(st.path.points * share * mult);
    const clean = share >= clean_share;
    st.streak = clean ? Math.min(max_streak, st.streak + 1) : 0;
    st.total += pts;
    st.flash = 1;
    // value = points per 100 w; best = the offered path with the highest value
    const value = (p) => (p.points / p.watts) * 100;
    const best = st.paths.reduce((a, b) => (value(b) > value(a) ? b : a));
    st.log.push({
      name: st.path.theme.name, mystery: st.path.mystery, watts: st.path.watts, offered: st.path.points,
      share, mult, pts, clean, value: value(st.path), best_value: value(best), best_name: best.theme.name,
    });
    env.big_text(`+${pts}${clean ? ' ✓' : ''}`, 1400, clean ? 'good' : '');
    env.sfx(clean ? 'good' : 'warn');
    st.stage += 1;
    if (st.stage >= env.opts.stages) {
      game.done = true;
      game.done_text = 'FINISH';
      return;
    }
    st.paths = make_paths(ftp);
    st.phase = 'choose';
    st.t_phase = 0;
    show_choice();
  }

  const game = {
    done: false,
    speed: () => st.v,
    update(dt, input) {
      st.v = step_speed(st.v, input.watts, dt);
      st.x += st.v * dt;
      st.crank += (input.cadence / 60) * 2 * Math.PI * dt;
      st.watts = input.watts;
      if (game.done) return;
      st.time += dt;
      st.t_phase += dt;
      st.energy += input.watts * dt;
      st.avg_w += (input.watts - st.avg_w) * Math.min(1, dt / 3);   // ~3 s rolling average
      st.flash = Math.max(0, st.flash - dt);
      if (st.phase === 'choose') {
        // out of time, or arrived at the fork without choosing
        if (st.t_phase >= choose_s || rider_z() < fork.z + 6) auto_pick();
        return;
      }
      if (st.avg_w >= st.path.watts * on_target_ratio) st.on_target += dt;
      if (st.t_phase >= stage_s) end_stage();
    },
    render(dt) {
      const z = rider_z();
      const speed = st.v * vis;
      kit.place_rider(me, { z, x: 0, watts: st.watts, v: st.v, crank: st.crank, dist: st.x * vis, ref: ftp }, dt);
      kit.chase({ z, speed, smooth: 5 }, dt);
      kit.frame(dt, { focus_z: z, speed });
      update_hud();
    },
    resize: () => kit.resize(),
    dispose: () => kit.dispose(),
    result,
  };

  function update_hud() {
    $('cr-total').textContent = st.total;
    const mult = (1 + 0.1 * st.streak).toFixed(1);
    if (st.phase === 'choose') {
      const to_fork = Math.max(0, Math.round((rider_z() - fork.z) / vis));
      $('cr-stage').textContent = `Stage ${st.stage + 1}/${env.opts.stages} · crossroads in ${to_fork} m`;
      $('cr-sub').textContent = `streak ×${mult} · ${Math.ceil(choose_s - st.t_phase)} s to choose`;
      $('cr-target').textContent = 'Choose a path…';
      $('cr-avg').textContent = `${Math.round(st.avg_w)} W avg`;
      $('cr-fill').style.width = '0%';
      const c = $('cr-count');
      if (c) c.textContent = `${Math.ceil(choose_s - st.t_phase)} s`;
      return;
    }
    const share = st.on_target / stage_s;
    const live = Math.round(st.path.points * share * (1 + 0.1 * st.streak));
    $('cr-stage').textContent = `Stage ${st.stage + 1}/${env.opts.stages} · ${st.path.theme.name}`;
    $('cr-sub').textContent = `${fmt_clock(stage_s - st.t_phase)} left · streak ×${mult} · +${live} so far`;
    $('cr-target').textContent = `Target ${st.path.watts} W (≥ ${Math.round(st.path.watts * on_target_ratio)})`;
    $('cr-avg').textContent = `3 s avg ${Math.round(st.avg_w)} W`;
    $('cr-fill').style.width = `${clamp(share, 0, 1) * 100}%`;
    $('cr-fill').classList.toggle('bad', st.avg_w < st.path.watts * on_target_ratio);
  }

  function result() {
    const clean = st.log.filter((l) => l.clean).length;
    const rows = st.log.map((l, i) => `
      <tr class="${l.clean ? 'me' : ''}">
        <td>${i + 1}</td>
        <td>${l.mystery ? '❓ ' : ''}${l.name}</td>
        <td class="num">${l.watts} W</td>
        <td class="num">${Math.round(l.share * 100)}%</td>
        <td class="num">${l.offered}×${l.mult.toFixed(1)}</td>
        <td class="num">${l.pts}</td>
      </tr>
      <tr class="sub-row"><td></td><td colspan="5">${l.value >= l.best_value - 0.01
        ? `✓ best value: ${l.value.toFixed(0)} pts per 100 W`
        : `value ${l.value.toFixed(0)} pts/100 W · best was ${l.best_name} (${l.best_value.toFixed(0)})`}</td></tr>`).join('');
    const smart = st.log.filter((l) => l.value >= l.best_value - 0.01).length;
    return {
      title: `${st.total} points`,
      sub: `${clean}/${st.log.length} clean stages · ${smart}/${st.log.length} best-value picks · avg ${Math.round(st.energy / Math.max(1, st.time))} W`,
      body: `<table><tr class="th"><td>#</td><td>Path</td><td class="num">Target</td><td class="num">On target</td><td class="num">Offer</td><td class="num">Pts</td></tr>${rows}</table>`,
      score: st.total,
      flags: { clean_all: clean === st.log.length, smart_all: smart === st.log.length },
      note: `${clean}/${st.log.length} clean · FTP ${ftp}`,
    };
  }

  show_choice();
  return game;
}
