// summit: time-trial up a climb. the trainer's resistance follows the gradient (ftms simulation mode)
// and a ghost of your best run rides along
import { setup_2d, sky, hills, clouds, draw_rider, label, round_rect } from '../draw2d.js?v=7';
import { step_speed } from '../physics.js?v=7';
import { clamp, fmt_time, load, store } from '../util.js?v=7';

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
  const view = setup_2d(env.canvas);
  const c = climbs[env.opts.climb];
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
    render() {
      draw_scene();
      update_hud();
    },
    resize: () => view.resize(),
    dispose() {
      if (feel && env.trainer.available) env.trainer.set_grade(0);   // never leave the trainer on a hill
    },
    result,
  };

  function draw_scene() {
    const { ctx, w, h } = view;
    const ins = env.insets();
    const ex = 3;                           // vertical exaggeration so 5% looks like a hill
    const ppm = clamp(w / 60, 6, 16);       // meters on screen
    const cx = w * 0.4;
    const base_y = h - ins.bottom - Math.max(60, h * 0.12);
    const e0 = elev_at(c, st.x);
    const sy = (x) => base_y - (elev_at(c, x) - e0) * ppm * ex;

    sky(ctx, w, h, '#5d93d6', '#eaf2fb');
    clouds(ctx, w, h * 0.6, st.x * 2);
    // distant mountains with snow caps
    hills(ctx, w, base_y - 40, st.x * 0.8, Math.min(220, h * 0.3), '#9fb3c8', 1);
    hills(ctx, w, base_y - 10, st.x * 2, Math.min(130, h * 0.18), '#7d9a78', 3);

    // terrain: filled polygon of the road profile around the rider
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let px = 0; px <= w + 8; px += 8) {
      const x = st.x + (px - cx) / ppm;
      ctx.lineTo(px, sy(x));
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = '#5f8f4a';
    ctx.fill();
    // road surface coloured by grade
    ctx.lineWidth = 10;
    for (let px = 0; px <= w; px += 8) {
      const x = st.x + (px - cx) / ppm;
      ctx.strokeStyle = x > c.length || x < 0 ? '#555' : grade_color(grade_at(c, x));
      ctx.beginPath();
      ctx.moveTo(px, sy(x) + 4);
      ctx.lineTo(px + 8, sy(x + 8 / ppm) + 4);
      ctx.stroke();
    }

    // summit banner
    const fx = cx + (c.length - st.x) * ppm;
    if (fx < w + 40) {
      const fy = sy(c.length);
      ctx.fillStyle = '#ddd';
      ctx.fillRect(fx - 2, fy - 70, 4, 70);
      ctx.fillStyle = '#d32f2f';
      ctx.fillRect(fx, fy - 70, 46, 26);
      ctx.fillStyle = '#fff';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('KOM', fx + 8, fy - 52);
    }

    // ghost and rider, tilted to the visual slope
    const s = clamp(h * 0.06, 32, 54);
    const tilt_at = (x) => Math.atan((grade_at(c, x) / 100) * ex);
    const gx = ghost_x(st.time);
    if (gx !== null) {
      const gpx = cx + (gx - st.x) * ppm;
      if (gpx > -60 && gpx < w + 60) draw_rider(ctx, gpx, sy(gx), s, { color: '#b0bec5', crank: st.time * 9, wheel: gx / 0.34, tilt: tilt_at(gx), alpha: 0.45 });
    }
    draw_rider(ctx, cx, sy(st.x), s, { color: '#ffd400', crank: st.crank, wheel: st.x / 0.34, tilt: tilt_at(st.x) });

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
      note: `${Math.round(st.energy / t)} W avg`,
    };
  }

  sync_trainer(true);
  return game;
}
