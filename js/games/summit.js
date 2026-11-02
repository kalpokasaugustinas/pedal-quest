// summit: time-trial up a climb. the trainer's resistance follows the gradient (ftms simulation mode)
// and a ghost of your best run rides along
import { overlay_2d, label, round_rect } from '../draw2d.js?v=44';
import { create_kit, scenery_option } from '../kit3d.js?v=44';
import { step_speed } from '../physics.js?v=44';
import { clamp, fmt_time, load, store } from '../util.js?v=44';

// climbs as [length m, grade %] segments
const climbs = {
  pine: { name: 'Pine Hill', segs: [[300, 2], [400, 4], [500, 5], [400, 3], [400, 5]] },
  eagle: { name: 'Eagle Pass', segs: [[500, 4], [700, 6], [600, 7], [400, 5], [800, 7], [500, 6], [500, 8]] },
  devil: { name: 'Devil’s Staircase', segs: [[400, 3], [300, 9], [300, 2], [300, 11], [300, 3], [300, 12], [300, 4], [400, 10], [400, 6]] },
  rollers: { name: 'Rolling Hills', segs: [[400, 3], [300, -2], [400, 5], [300, -3], [500, 6], [300, -1], [400, 4], [400, 7]] },
};

// precompute cumulative distance + elevation for each climb
for (const c of Object.values(climbs)) {
  let x = 0, e = 0;
  c.pts = [{ x: 0, e: 0, g: c.segs[0][1] }];
  for (const [len, g] of c.segs) {
    x += len;
    e += (len * g) / 100;
    c.pts.push({ x, e, g });
  }
  c.length = x;
  c.gain = c.segs.reduce((sum, [len, g]) => sum + Math.max(0, (len * g) / 100), 0);
  c.avg = (c.pts[c.pts.length - 1].e / x) * 100;
  c.max = Math.max(...c.segs.map(([, g]) => g));
}

function seg_index(c, x) {
  for (let i = 1; i < c.pts.length; i++) if (x < c.pts[i].x) return i;
  return c.pts.length - 1;
}
function grade_at(c, x) { return c.pts[seg_index(c, clamp(x, 0, c.length - 0.01))].g; }
function elev_at(c, x) {
  if (x <= 0) return (x * c.segs[0][1]) / 100;
  if (x >= c.length) return c.pts[c.pts.length - 1].e;
  const i = seg_index(c, x);
  const a = c.pts[i - 1];
  return a.e + ((x - a.x) * c.pts[i].g) / 100;
}

// colour by steepness (like climb profiles in cycling magazines)
function grade_color(g) {
  if (g < 0) return '#4fc3f7';
  if (g < 3) return '#8bc34a';
  if (g < 6) return '#ffc107';
  if (g < 9) return '#ff7043';
  return '#d32f2f';
}

const ghost_step = 10;   // ghost trace: time at every 10 m

export default {
  id: 'summit',
  name: 'Summit',
  icon: '⛰️',
  tagline: 'Time-trial up a climb. Feel every percent in your legs.',
  uses: ['power', 'cadence', 'resistance'],
  how: [
    'Ride from the bottom to the summit as fast as you can. Gravity is in the physics: steep = slow.',
    'With a trainer that supports it, resistance follows the gradient (like Zwift). 50% = half the gradient, a gentler feel.',
    'Your best run becomes a ghost rider. Beat your ghost!',
    'The profile on top shows what’s coming. Plan your effort for the steep parts.',
  ],
  options: [
    { key: 'climb', label: 'Climb', wide: true, choices: Object.entries(climbs).map(([id, c]) => [id, `${c.name}<small>${(c.length / 1000).toFixed(1)} km · ${c.avg.toFixed(1)}% avg · max ${c.max}%</small>`]), def: 'pine' },
    { key: 'feel', label: 'Trainer resistance', choices: [[0, 'Off'], [0.5, '50%'], [1, '100%']], def: 0.5 },
    scenery_option('meadow'),
  ],
  setup_html: (o) => {
    const best = load(`pq_ghost_summit_${o.climb}`, null);
    return `<p class="small">${best ? `👻 Ghost: your best ${fmt_time(best.time)}` : '👻 No ghost yet. Your first finish becomes the ghost.'}</p>`;
  },
  board: (o) => ({ key: `summit_${o.climb}`, label: `Best times · ${climbs[o.climb].name}`, lower: true, fmt: fmt_time }),
  create,
};

function create(env) {
  const $ = (id) => document.getElementById(id);
  const c = climbs[env.opts.climb];
  // 3d: the road really climbs. distance drawn 1.6x, height 2.2x, so 5% looks like a proper hill
  const vis_d = 1.6, vis_e = 2.2;
  const kit = create_kit(env.canvas, {
    theme: env.opts.scenery,
    road_y: (z) => elev_at(c, Math.min(-z / vis_d, c.length + 400)) * vis_e,
  });
  const me = kit.add_rider(env.look);
  const ghost_model = kit.add_rider('#b0bec5');
  kit.add_arch(-c.length * vis_d, 'KOM', '#c62828');
  // grade boards at every change of gradient
  for (let i = 0; i < c.segs.length; i++) {
    const g = c.segs[i][1];
    kit.add_board(-c.pts[i].x * vis_d - 2, `${g > 0 ? '▲' : '▼'} ${g}%`, i % 2 ? -1 : 1, grade_color(g), '#ffffff');
  }
  const view = overlay_2d(env.overlay);   // profile chart + big grade number on top of the 3d view
  let watts_now = 0;
  const feel = env.opts.feel;
  const ghost = load(`pq_ghost_summit_${env.opts.climb}`, null);
  const st = { x: 0, v: 0, time: 0, crank: 0, energy: 0, trace: [0], finish: null, sent_grade: null, last_send: -10 };

  env.hud.innerHTML = `
    <div class="gh-row">
      <div class="gh-big" id="su-time">0:00.0</div>
      <div><div id="su-title" class="gh-title">${c.name}</div><div id="su-sub" class="gh-sub"></div></div>
    </div>`;
  env.bottom.innerHTML = `
    <div class="target">
      <div class="target-row"><span id="su-grade"></span><span id="su-next"></span></div>
      <div class="meter"><div id="su-fill" class="meter-fill"></div></div>
    </div>`;

  // ghost position at time t, from the best run's trace (time at every 10 m)
  function ghost_x(t) {
    if (!ghost) return null;
    const tr = ghost.trace;
    if (t >= tr[tr.length - 1]) return c.length;
    let i = 1;
    while (i < tr.length && tr[i] < t) i++;
    const f = (t - tr[i - 1]) / Math.max(1e-6, tr[i] - tr[i - 1]);
    return (i - 1 + f) * ghost_step;
  }

  // trainer gradient: send when it changes, at most once per second
  function sync_trainer(force = false) {
    if (!feel || !env.trainer.available) return;
    const target = st.finish !== null ? 0 : grade_at(c, st.x) * feel;
    if (!force && (st.sent_grade !== null && Math.abs(target - st.sent_grade) < 0.1)) return;
    if (!force && st.time - st.last_send < 1) return;
    st.sent_grade = target;
    st.last_send = st.time;
    env.trainer.set_grade(target);
  }

  const game = {
    done: false,
    speed: () => st.v,
    update(dt, input) {
      watts_now = game.done ? 0 : input.watts;
      const grade = grade_at(c, st.x);
      st.v = step_speed(st.v, game.done ? 0 : input.watts, dt, st.finish !== null ? 0 : grade);
      st.crank += (input.cadence / 60) * 2 * Math.PI * dt;
      if (game.done) {
        st.x += st.v * dt;
        return;
      }
      const prev_x = st.x;
      st.x += st.v * dt;
      st.time += dt;
      st.energy += input.watts * dt;
      // record time at each 10 m mark (interpolated) for the ghost
      while (st.x >= st.trace.length * ghost_step && st.trace.length * ghost_step <= c.length) {
        const mark = st.trace.length * ghost_step;
        st.trace.push(st.time - dt + ((mark - prev_x) / Math.max(1e-6, st.x - prev_x)) * dt);
      }
      if (st.x >= c.length) {
        st.finish = st.time - dt + ((c.length - prev_x) / Math.max(1e-6, st.x - prev_x)) * dt;
        game.done = true;
        game.done_text = 'SUMMIT!';
        sync_trainer(true);
        return;
      }
      sync_trainer();
    },
    render(dt) {
      const z = -st.x * vis_d;
      kit.place_rider(me, { z, x: -0.6, watts: watts_now, v: st.v, crank: st.crank, dist: st.x * vis_d, ref: env.profile.ftp }, dt);
      const gx = ghost_x(st.time);
      ghost_model.group.visible = gx !== null;
      if (gx !== null) {
        const gz = -gx * vis_d;
        kit.place_rider(ghost_model, { z: gz, x: 0.6, watts: 200, v: 4, crank: st.time * 9, dist: gx * vis_d, ref: 200, fade: 0.4 }, dt);
      }
      const speed = st.v * vis_d;
      kit.chase({ z, speed }, dt);
      kit.frame(dt, { focus_z: z, speed });
      draw_scene();
      update_hud();
    },
    resize: () => { kit.resize(); view.resize(); },
    dispose() {
      if (feel && env.trainer.available) env.trainer.set_grade(0);   // never leave the trainer on a hill
      kit.dispose();
    },
    result,
  };

  // 2d overlay: climb profile chart + big gradient number (the world itself is 3d)
  function draw_scene() {
    const { ctx, w, h } = view;
    const ins = env.insets();
    view.clear();
    // big gradient number
    const g = grade_at(c, st.x);
    const profile_h = Math.min(90, h * 0.12);
    draw_profile(ctx, w, ins.top + 8, profile_h);

    // big gradient number under the profile, with the next change
    const big = clamp(w * 0.16, 40, 84);
    const gy = ins.top + profile_h + 24 + big * 0.6;
    const gx_label = w > h ? w * 0.82 : w / 2;   // landscape: keep it clear of the rider
    label(ctx, `${g}%`, gx_label, gy, big, grade_color(g));
    const i = seg_index(c, Math.min(st.x, c.length - 0.01));
    const next = c.pts[i + 1];
    if (next && st.finish === null) label(ctx, `then ${next.g}% in ${Math.round(c.pts[i].x - st.x)} m`, gx_label, gy + big * 0.7, 16, '#fff');
  }

  // whole-climb profile chart with rider + ghost dots
  function draw_profile(ctx, w, top, ph) {
    const pad = 16;
    const pw = w - pad * 2;
    const min_e = Math.min(0, ...c.pts.map((p) => p.e));
    const max_e = Math.max(...c.pts.map((p) => p.e));
    const px = (x) => pad + (x / c.length) * pw;
    const py = (e) => top + ph - ((e - min_e) / Math.max(1, max_e - min_e)) * (ph - 10);
    ctx.fillStyle = 'rgba(10,15,20,0.45)';
    round_rect(ctx, pad - 6, top - 4, pw + 12, ph + 10, 8);
    ctx.fill();
    for (let i = 1; i < c.pts.length; i++) {
      const a = c.pts[i - 1], b = c.pts[i];
      ctx.fillStyle = grade_color(b.g);
      ctx.beginPath();
      ctx.moveTo(px(a.x), top + ph);
      ctx.lineTo(px(a.x), py(a.e));
      ctx.lineTo(px(b.x), py(b.e));
      ctx.lineTo(px(b.x), top + ph);
      ctx.closePath();
      ctx.fill();
    }
    const gx = ghost_x(st.time);
    if (gx !== null) dot(ctx, px(gx), py(elev_at(c, gx)), '#b0bec5');
    dot(ctx, px(Math.min(st.x, c.length)), py(elev_at(c, st.x)), '#ffd400');
  }

  function dot(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function update_hud() {
    $('su-time').textContent = fmt_time(st.finish ?? st.time);
    const left = Math.max(0, c.length - st.x);
    const climbed = Math.max(0, elev_at(c, Math.min(st.x, c.length)));
    let ghost_text = '';
    const gx = ghost_x(st.time);
    if (gx !== null && st.finish === null) {
      const gap = st.x - gx;
      ghost_text = ` · 👻 ${gap >= 0 ? '+' : ''}${Math.round(gap)} m`;
    }
    $('su-sub').textContent = `${(left / 1000).toFixed(2)} km left · ${Math.round(climbed)}/${Math.round(c.pts[c.pts.length - 1].e)} m up${ghost_text}`;
    const i = seg_index(c, Math.min(st.x, c.length - 0.01));
    const g = c.pts[i].g;
    const next = c.pts[i + 1];
    $('su-grade').textContent = `Grade ${g}%${feel && env.trainer.available ? ` · trainer ${Math.round(feel * 100)}%` : ''}`;
    $('su-next').textContent = next ? `next ${next.g}% in ${Math.round(c.pts[i].x - st.x)} m` : 'last stretch!';
    $('su-fill').style.width = `${clamp(st.x / c.length, 0, 1) * 100}%`;
    $('su-fill').style.background = grade_color(g);
  }

  function result() {
    const t = st.finish;
    const gain = c.pts[c.pts.length - 1].e;
    const vam = Math.round((gain / t) * 3600);   // vertical meters per hour, a classic climbing metric
    const old = ghost;
    let ghost_note = 'Your ghost is set. Come back and beat it!';
    if (old) ghost_note = t < old.time ? `New best! ${(old.time - t).toFixed(1)} s faster than your ghost.` : `${(t - old.time).toFixed(1)} s behind your ghost.`;
    if (!old || t < old.time) store(`pq_ghost_summit_${env.opts.climb}`, { time: t, trace: st.trace });
    return {
      title: `${c.name}: ${fmt_time(t)}`,
      sub: `avg ${Math.round(st.energy / t)} W · VAM ${vam} m/h · ${Math.round(gain)} m climbed`,
      body: `<p class="result-note">👻 ${ghost_note}</p>`,
      score: t,
      flags: { climb: env.opts.climb },
      note: `${Math.round(st.energy / t)} W avg`,
    };
  }

  sync_trainer(true);
  return game;
}
