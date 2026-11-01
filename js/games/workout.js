// workout: structured interval sessions scaled to your ftp, scored by how well you hold the targets.
// optional erg mode makes the trainer hold the target power for you. includes a ramp test that estimates ftp
import { setup_2d, round_rect, label } from '../draw2d.js?v=18';
import { clamp, fmt_clock } from '../util.js?v=18';

// segment helpers: durations in seconds, power as a share of ftp (ramp = from -> to)
const steady = (dur, pct, name) => ({ dur, from: pct, to: pct, name });
const ramp = (dur, from, to, name) => ({ dur, from, to, name });
const repeat = (n, block) => Array.from({ length: n }, () => block.map((s) => ({ ...s }))).flat();

const workouts = {
  quick: {
    name: 'Quick Spin', min: 15, desc: '4 × 1 min hard',
    segs: () => [ramp(180, 0.45, 0.65, 'Warm-up'), ...repeat(4, [steady(60, 1.05, 'Hard'), steady(60, 0.55, 'Easy')]), steady(120, 0.75, 'Tempo'), steady(120, 0.5, 'Cool-down')],
  },
  sweetspot: {
    name: 'Sweet Spot', min: 30, desc: '3 × 6 min at 90%',
    segs: () => [ramp(180, 0.45, 0.7, 'Warm-up'), ...repeat(3, [steady(360, 0.9, 'Sweet spot'), steady(120, 0.55, 'Recover')]), steady(180, 0.5, 'Cool-down')],
  },
  vo2: {
    name: 'VO2 30/30', min: 22, desc: '2 sets of 6 × 30 s at 120%',
    segs: () => [ramp(240, 0.45, 0.75, 'Warm-up'), ...repeat(6, [steady(30, 1.2, 'ON'), steady(30, 0.5, 'off')]), steady(180, 0.55, 'Recover'),
      ...repeat(6, [steady(30, 1.2, 'ON'), steady(30, 0.5, 'off')]), steady(180, 0.5, 'Cool-down')],
  },
  pyramid: {
    name: 'Pyramid', min: 23, desc: '1-2-3-2-1 min above FTP',
    segs: () => [ramp(180, 0.45, 0.7, 'Warm-up'), steady(60, 1.0, 'Step 1'), steady(60, 0.55, 'Recover'), steady(120, 1.05, 'Step 2'), steady(120, 0.55, 'Recover'),
      steady(180, 1.08, 'Top'), steady(180, 0.55, 'Recover'), steady(120, 1.05, 'Step 2'), steady(120, 0.55, 'Recover'), steady(60, 1.0, 'Step 1'), steady(180, 0.5, 'Cool-down')],
  },
  overunder: {
    name: 'Over-Unders', min: 31, desc: '3 × (95% / 110%) blocks',
    segs: () => [ramp(240, 0.45, 0.75, 'Warm-up'),
      ...repeat(3, [steady(120, 0.95, 'Under'), steady(60, 1.1, 'Over'), steady(120, 0.95, 'Under'), steady(60, 1.1, 'Over'), steady(180, 0.55, 'Recover')]).slice(0, -1),
      steady(180, 0.5, 'Cool-down')],
  },
  ramp: { name: 'FTP Ramp Test', min: 0, desc: '+20 W per minute until you stop', test: true },
};

// ramp test: 100 w start, +20 w every minute; ftp estimate = 75% of your best 1-min power
const ramp_start = 100, ramp_step = 20;

// zone colour by share of ftp
function zone_color(pct) {
  if (pct < 0.56) return '#78909c';
  if (pct < 0.76) return '#42a5f5';
  if (pct < 0.91) return '#66bb6a';
  if (pct < 1.06) return '#ffca28';
  if (pct < 1.21) return '#ff7043';
  return '#e53935';
}

export default {
  id: 'workout',
  name: 'Workout',
  icon: '📈',
  tagline: 'Structured intervals scaled to your FTP. Hold the target, earn the score.',
  uses: ['power', 'resistance'],
  how: [
    'Each workout is a set of intervals at a share of your FTP (set it in your profile). Hold the target power.',
    'Within ±5% of target = ON TARGET, within ±10% = CLOSE. Your score is the % of the session you were on target.',
    'ERG mode: the trainer sets the resistance so you hit the target at any cadence. Easier, but the score shows “ERG”.',
    'FTP Ramp Test: +20 W every minute until you can’t hold it. Your FTP estimate is 75% of your best 1-min power. You can save it to your profile.',
  ],
  options: [
    { key: 'plan', label: 'Workout', wide: true, choices: Object.entries(workouts).map(([id, w]) => [id, `${w.name}<small>${w.test ? w.desc : `${w.min} min · ${w.desc}`}</small>`]), def: 'quick' },
    { key: 'intensity', label: 'Intensity (not used in the ramp test)', choices: [[0.9, '90%'], [1, '100%'], [1.05, '105%']], def: 1 },
    { key: 'erg', label: 'ERG mode (trainer holds the power)', choices: [[0, 'Off'], [1, 'On']], def: 0 },
  ],
  setup_html: (o, profile) => {
    const w = workouts[o.plan];
    if (w.test) return `<p class="small">Starts at ${ramp_start} W. Typical length 8–20 min. Pedal until you really can’t hold the target.</p>`;
    const segs = w.segs();
    const total = segs.reduce((s, x) => s + x.dur, 0);
    const kj = segs.reduce((s, x) => s + x.dur * ((x.from + x.to) / 2) * profile.ftp * o.intensity, 0) / 1000;
    // mini profile bars: width = duration, height = power
    const bars = segs.map((x) => `<span style="flex:${x.dur};height:${Math.round(Math.max(x.from, x.to) * o.intensity * 60)}%;background:${zone_color(Math.max(x.from, x.to) * o.intensity)}"></span>`).join('');
    return `<div class="wo-profile">${bars}</div><p class="small">${Math.round(total / 60)} min · about ${Math.round(kj)} kJ at FTP ${profile.ftp} W</p>`;
  },
  board: (o) => (workouts[o.plan].test
    ? { key: 'workout_ramp', label: 'Best FTP estimates', lower: false, fmt: (s) => `${s} W` }
    : { key: `workout_${o.plan}_${o.intensity}`, label: `Best scores · ${workouts[o.plan].name} ${Math.round(o.intensity * 100)}%`, lower: false, fmt: (s) => `${s}%` }),
  create,
};

function create(env) {
  const $ = (id) => document.getElementById(id);
  const view = setup_2d(env.canvas);
  const plan = workouts[env.opts.plan];
  const ftp = env.profile.ftp;
  const erg = !!env.opts.erg;
  const is_test = !!plan.test;

  // segments with absolute watts and start times. the ramp test adds steps as you go
  const segs = [];
  let total = 0;
  const add = (s) => { segs.push({ ...s, t: total }); total += s.dur; };
  if (is_test) {
    for (let i = 0; i < 8; i++) add({ dur: 60, w0: ramp_start + i * ramp_step, w1: ramp_start + i * ramp_step, name: `Step ${i + 1}` });
  } else {
    for (const s of plan.segs()) add({ dur: s.dur, w0: s.from * ftp * env.opts.intensity, w1: s.to * ftp * env.opts.intensity, name: s.name });
  }

  const st = {
    time: 0, on_s: 0, close_s: 0, last3: [], avg3: 0, trace: [], sec_acc: 0, sec_w: 0,
    hit: '', seg_i: -1, sent_w: null, sent_t: -9, fail_s: 0, best_1m: 0, last60: [], peak_step: 0,
  };

  const seg_at = (t) => segs.find((s) => t >= s.t && t < s.t + s.dur) || null;
  const target_at = (t) => {
    const s = seg_at(t);
    return s ? s.w0 + (s.w1 - s.w0) * ((t - s.t) / s.dur) : 0;
  };

  env.hud.innerHTML = `
    <div class="gh-row">
      <div class="gh-big" id="wo-target">--</div>
      <div><div id="wo-title" class="gh-title"></div><div id="wo-sub" class="gh-sub"></div></div>
    </div>`;
  env.bottom.innerHTML = `
    <div class="target">
      <div class="target-row"><span id="wo-next"></span><span id="wo-hit"></span></div>
      <div class="meter"><div id="wo-fill" class="meter-fill"></div><div class="meter-mark" style="left:66.6%"></div></div>
    </div>`;

  const game = {
    done: false,
    speed: () => null,
    update(dt, input) {
      if (game.done) return;
      st.time += dt;

      // ramp test keeps adding 1-min steps while you're riding
      if (is_test && st.time > total - 120) {
        const n = segs.length;
        add({ dur: 60, w0: ramp_start + n * ramp_step, w1: ramp_start + n * ramp_step, name: `Step ${n + 1}` });
      }
      const s = seg_at(st.time);
      if (!s) {
        game.done = true;
        game.done_text = 'WORKOUT DONE!';
        return;
      }
      const target = target_at(st.time);

      // new interval: sound cue + erg target
      const i = segs.indexOf(s);
      if (i !== st.seg_i) {
        if (st.seg_i >= 0) env.sfx(s.w0 > segs[st.seg_i].w0 ? 'warn' : 'click');
        st.seg_i = i;
        if (is_test) st.peak_step = s.w0;
      }
      // erg: send the target on change (ramps: at most once per 2 s, in 5 w steps)
      if (erg && env.trainer.available) {
        const w = Math.round(target / 5) * 5;
        if (w !== st.sent_w && st.time - st.sent_t >= 2) {
          env.trainer.set_power(w);
          st.sent_w = w;
          st.sent_t = st.time;
        }
      }

      // 3 s average power vs target
      st.last3.push([st.time, input.watts]);
      while (st.last3.length && st.time - st.last3[0][0] > 3) st.last3.shift();
      st.avg3 = st.last3.reduce((a, x) => a + x[1], 0) / st.last3.length;
      const err = Math.abs(st.avg3 - target) / Math.max(target, 1);
      st.hit = err <= 0.05 ? 'on' : err <= 0.1 ? 'close' : st.avg3 < target ? 'low' : 'high';
      if (st.hit === 'on') st.on_s += dt;
      else if (st.hit === 'close') st.close_s += dt;

      // 1-s samples for the trace + best 1-min power
      st.sec_acc += dt;
      st.sec_w += input.watts * dt;
      if (st.sec_acc >= 1 - 1e-6) {
        const w = st.sec_w / st.sec_acc;
        st.trace.push([st.time, w]);
        st.last60.push(w);
        if (st.last60.length > 60) st.last60.shift();
        if (st.last60.length === 60) st.best_1m = Math.max(st.best_1m, st.last60.reduce((a, x) => a + x, 0) / 60);
        st.sec_acc = Math.max(0, st.sec_acc - 1);   // carry the overshoot into the next second
        st.sec_w = input.watts * st.sec_acc;
      }

      // ramp test ends when you can't hold the step for 5 s (power below 85%, or cadence collapsed in erg)
      if (is_test && st.time > 120) {
        const failing = st.avg3 < target * 0.85 || (erg && input.cadence < 50);
        st.fail_s = failing ? st.fail_s + dt : 0;
        if (st.fail_s > 5) {
          game.done = true;
          game.done_text = 'TEST DONE!';
        }
      }
    },
    render(dt, input) {
      draw_scene();
      update_hud(input);
    },
    resize: () => view.resize(),
    // leave erg: back to a flat-road simulation so the trainer doesn't stay locked to a power
    dispose() { if (erg) env.trainer.set_grade(0); },
    result,
  };

  function draw_scene() {
    const { ctx, w, h } = view;
    const ins = env.insets();
    const top = ins.top + 96, bottom = h - ins.bottom - 22;   // space above the blocks for the big interval clock
    const left = 16, right = w - 16;

    ctx.fillStyle = '#0f1720';
    ctx.fillRect(0, 0, w, h);

    // visible window: the whole workout, or for the ramp test 0..(now + 3 min)
    const span = is_test ? Math.max(600, st.time + 180) : total;
    const max_w = Math.max(...segs.filter((s) => s.t < span).map((s) => Math.max(s.w0, s.w1)), ftp) * 1.15;
    const x_of = (t) => left + (t / span) * (right - left);
    const y_of = (wt) => bottom - (wt / max_w) * (bottom - top);

    // ftp line
    ctx.strokeStyle = 'rgba(255,212,0,.45)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y_of(ftp));
    ctx.lineTo(right, y_of(ftp));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,212,0,.7)';
    ctx.textAlign = 'right';   // right end: the now line starts on the left
    ctx.fillText(`FTP ${ftp} W`, right - 4, y_of(ftp) - 5);

    // interval blocks: past ones dimmed, current one highlighted
    for (const s of segs) {
      if (s.t > span) break;
      const x1 = x_of(s.t), x2 = x_of(Math.min(span, s.t + s.dur));
      const past = s.t + s.dur <= st.time;
      const now = st.time >= s.t && st.time < s.t + s.dur;
      ctx.globalAlpha = past ? 0.35 : now ? 1 : 0.75;
      ctx.fillStyle = zone_color(Math.max(s.w0, s.w1) / ftp);
      ctx.beginPath();
      ctx.moveTo(x1 + 0.5, bottom);
      ctx.lineTo(x1 + 0.5, y_of(s.w0));
      ctx.lineTo(x2 - 0.5, y_of(s.w1));
      ctx.lineTo(x2 - 0.5, bottom);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // your power trace (1-s samples, smoothed over 5 s)
    if (st.trace.length > 1) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      st.trace.forEach(([t], i) => {
        const a = st.trace.slice(Math.max(0, i - 4), i + 1);
        const v = a.reduce((s, x) => s + x[1], 0) / a.length;
        const p = [x_of(t), y_of(clamp(v, 0, max_w))];
        if (i === 0) ctx.moveTo(...p); else ctx.lineTo(...p);
      });
      ctx.stroke();
    }

    // now line + target marker
    const nx = x_of(st.time);
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(nx, top - 6);
    ctx.lineTo(nx, bottom);
    ctx.stroke();
    const tgt = target_at(st.time);
    if (tgt) {
      const col = st.hit === 'on' ? '#7ee08a' : st.hit === 'close' ? '#ffd54f' : '#ff5252';
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(nx, y_of(clamp(st.avg3, 0, max_w)), 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // time axis
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const step = span > 1500 ? 300 : 120;
    for (let t = step; t < span; t += step) ctx.fillText(`${t / 60}m`, x_of(t), bottom + 13);

    // big countdown of the current interval in the middle of the empty space above the blocks
    const s = seg_at(st.time);
    if (s) {
      const left_s = s.t + s.dur - st.time;
      label(ctx, fmt_clock(Math.ceil(left_s)), w / 2, ins.top + 36, 40, left_s <= 5 ? '#ffd54f' : '#fff');
      label(ctx, s.name, w / 2, ins.top + 68, 16, 'rgba(255,255,255,.7)');
    }
  }

  function update_hud(input) {
    const s = seg_at(st.time);
    const tgt = Math.round(target_at(st.time));
    $('wo-target').textContent = tgt ? `${tgt} W` : '--';
    $('wo-title').textContent = `${plan.name}${erg ? ' · ERG' : ''}`;
    const pct = Math.round(((st.on_s + st.close_s * 0.5) / Math.max(1, st.time)) * 100);
    $('wo-sub').textContent = is_test
      ? `${fmt_clock(st.time)} · best 1 min ${Math.round(st.best_1m)} W`
      : `${fmt_clock(Math.max(0, total - st.time))} left · ${pct}% on target`;
    const next = s ? segs[segs.indexOf(s) + 1] : null;
    $('wo-next').textContent = next ? `Next: ${next.name} ${Math.round(next.w0)}${next.w1 !== next.w0 ? `→${Math.round(next.w1)}` : ''} W` : 'Last interval';
    $('wo-hit').textContent = { on: 'ON TARGET', close: 'CLOSE', low: 'push ▲', high: 'ease ▼' }[st.hit] || '';
    $('wo-hit').style.color = { on: '#7ee08a', close: '#ffd54f' }[st.hit] || '#ff8a80';
    // meter: target sits at 2/3 of the bar
    $('wo-fill').style.width = `${clamp(st.avg3 / Math.max(tgt, 1) / 1.5, 0, 1) * 100}%`;
    $('wo-fill').classList.toggle('bad', st.hit === 'low' || st.hit === 'high');
  }

  function result() {
    if (is_test) {
      const est = Math.round((st.best_1m * 0.75) / 5) * 5;
      const valid = st.best_1m > 0;
      return {
        title: valid ? `FTP estimate: ${est} W` : 'Test too short',
        sub: `Lasted ${fmt_clock(st.time)} · top step ${st.peak_step} W · best 1 min ${Math.round(st.best_1m)} W`,
        body: valid ? `<p class="result-note">${est > ftp ? `That’s ${est - ftp} W more than your profile FTP (${ftp} W).` : est < ftp ? `That’s ${ftp - est} W below your profile FTP (${ftp} W).` : 'Same as your profile FTP.'} Games scale their targets to your FTP.</p>` : '',
        score: valid ? est : null,
        flags: { ramp: valid },
        note: `${fmt_clock(st.time)}${erg ? ' · ERG' : ''}`,
        // offered as a button on the results screen
        actions: valid && est !== ftp ? [{ label: `Set my FTP to ${est} W`, done_label: `FTP set to ${est} W ✓`, run: (profile) => { profile.ftp = est; } }] : [],
      };
    }
    const done_s = Math.min(st.time, total);
    const pct = Math.round(((st.on_s + st.close_s * 0.5) / Math.max(1, done_s)) * 100);
    const rows = segs.filter((s) => s.w0 >= ftp * 0.85 && s.t < done_s).length;
    return {
      title: `${pct}% on target`,
      sub: `${plan.name} ${Math.round(env.opts.intensity * 100)}% · ${fmt_clock(done_s)} · ${rows} hard intervals${erg ? ' · ERG' : ''}`,
      body: `<p class="result-note">On target ${fmt_clock(st.on_s)} · close ${fmt_clock(st.close_s)} · off ${fmt_clock(Math.max(0, done_s - st.on_s - st.close_s))}</p>`,
      score: pct,
      flags: { pct, erg },
      note: `FTP ${ftp}${erg ? ' · ERG' : ''}`,
    };
  }

  return game;
}
