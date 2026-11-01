// crossroads: each stage pick one of three paths. every path shows the watts to hold and the points it pays.
// the exchange rate (points per watt) differs per path, so the best pick is your own math - and your legs
import { setup_2d, sky, hills, clouds, draw_rider, round_rect, label } from '../draw2d.js?v=15';
import { step_speed } from '../physics.js?v=15';
import { rand, clamp, fmt_clock } from '../util.js?v=15';

const themes = [
  { name: 'Valley Road', sky: ['#6fb8ec', '#d4eefa'], far: '#8fbf86', near: '#6aa25a', ground: '#5f9a4a', road: '#3a3d42', dash: '#ffffff' },
  { name: 'Ridge Climb', sky: ['#7a9cc6', '#e0e6ef'], far: '#a59a90', near: '#857868', ground: '#8a7d6b', road: '#45464a', dash: '#ffffff' },
  { name: 'Forest Trail', sky: ['#5fa6c9', '#cfe9d8'], far: '#3f7a4d', near: '#2f6040', ground: '#3d6b35', road: '#6b5a44', dash: '#d9c7a0' },
  { name: 'Coastal Sprint', sky: ['#4fb0e8', '#e6f6ff'], far: '#3b8fc4', near: '#e8d9a8', ground: '#d9c58f', road: '#3a3d42', dash: '#ffffff' },
  { name: 'Desert Highway', sky: ['#f0a560', '#fbe3b8'], far: '#d9a066', near: '#c98a52', ground: '#d8b27a', road: '#4a4440', dash: '#ffd27a' },
  { name: 'Night Express', tag: '#7986cb', sky: ['#141a3a', '#3a3f74'], far: '#2a3060', near: '#1a1f40', ground: '#1f2a24', road: '#2a2c30', dash: '#ffe066' },
  { name: 'Alpine Pass', sky: ['#5d93d6', '#eaf2fb'], far: '#e9eef5', near: '#8aa0b3', ground: '#6f8f5a', road: '#3f4146', dash: '#ffffff' },
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
    'Each stage you get 15 s to pick one of 3 paths. Every path shows the watts to hold and the points it pays.',
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
  ],
  setup_html: (o, profile) => `<p class="small">Path targets are based on your FTP (${profile.ftp} W): easy 55–72%, medium 75–92%, hard 95–120%. Total ride ≈ ${o.stages * o.stage_min + Math.round(o.stages * 0.25)} min.</p>`,
  board: (o) => ({ key: `crossroads_${o.stages}x${o.stage_min}`, label: `Top scores · ${o.stages} stages × ${o.stage_min} min`, lower: false, fmt: (s) => `${s} pts` }),
  create,
};

function create(env) {
  const $ = (id) => document.getElementById(id);
  const view = setup_2d(env.canvas);
  const ftp = env.profile.ftp;
  const stage_s = env.opts.stage_min * 60;
  const st = {
    stage: 0, phase: 'choose', t_phase: 0, paths: make_paths(ftp), path: null,
    avg_w: 0, on_target: 0, total: 0, streak: 0, log: [],
    x: 0, v: 0, crank: 0, energy: 0, time: 0, flash: 0,
  };

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

  // path choice cards
  function show_choice() {
    env.overlay.innerHTML = `
      <div class="choice">
        <div class="choice-title">Stage ${st.stage + 1}/${env.opts.stages}: choose your path <span id="cr-count" class="choice-count"></span></div>
        <div class="choice-paths">${st.paths.map((p, i) => `
          <button class="path" data-i="${i}" style="--c:${p.theme.tag || p.theme.near}">
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
    env.big_text(st.path.mystery ? `${st.path.watts} W!` : 'GO!', 1200);
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
      if (game.done) return;
      st.time += dt;
      st.t_phase += dt;
      st.energy += input.watts * dt;
      st.avg_w += (input.watts - st.avg_w) * Math.min(1, dt / 3);   // ~3 s rolling average
      st.flash = Math.max(0, st.flash - dt);
      if (st.phase === 'choose') {
        if (st.t_phase >= choose_s) {
          // hesitation: you get the easiest path
          const easiest = st.paths.reduce((best, p, i) => (p.watts < st.paths[best].watts ? i : best), 0);
          pick(easiest);
        }
        return;
      }
      if (st.avg_w >= st.path.watts * on_target_ratio) st.on_target += dt;
      if (st.t_phase >= stage_s) end_stage();
    },
    render() {
      draw_scene();
      update_hud();
    },
    resize: () => view.resize(),
    dispose() {},
    result,
  };

  function draw_scene() {
    const { ctx, w, h } = view;
    const { bottom } = env.insets();
    const th = st.phase === 'ride' ? st.path.theme : themes[0];
    const ground_y = Math.max(h * 0.45, h - bottom - h * 0.16);
    const ppm = 30;   // world scroll speed in pixels per meter
    sky(ctx, w, ground_y, th.sky[0], th.sky[1]);
    clouds(ctx, w, ground_y, st.x * ppm * 0.05, th.name === 'Night Express' ? 'rgba(255,255,255,0.15)' : undefined);
    if (th.name === 'Night Express') draw_stars(ctx, w, ground_y);
    hills(ctx, w, ground_y, st.x * ppm * 0.15, Math.min(140, ground_y * 0.4), th.far, 0);
    hills(ctx, w, ground_y, st.x * ppm * 0.35, Math.min(80, ground_y * 0.22), th.near, 2.1);
    ctx.fillStyle = th.ground;
    ctx.fillRect(0, ground_y, w, h - ground_y);

    // road with moving centre dashes
    const road_h = Math.min(60, h * 0.07);
    ctx.fillStyle = th.road;
    ctx.fillRect(0, ground_y, w, road_h);
    ctx.fillStyle = th.dash;
    const off = (st.x * ppm) % 60;
    for (let x = -off; x < w; x += 60) ctx.fillRect(x, ground_y + road_h / 2 - 2, 30, 4);

    // at the crossroads: a signpost with the three options ahead
    if (st.phase === 'choose') draw_signpost(ctx, w * 0.72, ground_y, Math.min(1, h / 700));

    const s = clamp(h * 0.06, 34, 56);
    draw_rider(ctx, w * 0.35, ground_y + road_h * 0.7, s, { color: '#ffd400', crank: st.crank, wheel: st.x / 0.34 });

    // target gauge drawn in the sky: your 3 s avg against the target
    if (st.phase === 'ride') {
      const ok = st.avg_w >= st.path.watts * on_target_ratio;
      label(ctx, `${Math.round(st.avg_w)} / ${st.path.watts} W`, w / 2, Math.max(env.insets().top + 40, ground_y * 0.45), clamp(w * 0.08, 26, 52), ok ? '#7ee08a' : '#ff8a80');
    }
  }

  function draw_signpost(ctx, x, ground_y, k) {
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(x - 4 * k, ground_y - 150 * k, 8 * k, 150 * k);
    st.paths.forEach((p, i) => {
      const y = ground_y - (140 - i * 40) * k;
      const dir = i === 1 ? 0 : (i === 0 ? -1 : 1);
      ctx.fillStyle = p.theme.near;
      round_rect(ctx, x - 50 * k + dir * 12 * k, y, 100 * k, 28 * k, 6 * k);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${12 * k}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(p.theme.name, x + dir * 12 * k, y + 18 * k);
    });
  }

  function draw_stars(ctx, w, h) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 60; i++) {
      const x = (i * 97.3) % w;
      const y = (i * 53.7) % (h * 0.7);
      ctx.fillRect(x, y, 2, 2);
    }
  }

  function update_hud() {
    $('cr-total').textContent = st.total;
    const mult = (1 + 0.1 * st.streak).toFixed(1);
    if (st.phase === 'choose') {
      $('cr-stage').textContent = `Stage ${st.stage + 1}/${env.opts.stages} · crossroads`;
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
