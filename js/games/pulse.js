// pulse pilot: your heart rate is your altitude. fly a pedal-powered plane through gates set at target bpm.
// hr reacts slowly to effort, so you have to plan ahead: start pushing (or easing off) well before each gate
import { setup_2d, sky, hills, clouds, round_rect, label } from '../draw2d.js?v=9';
import { step_speed } from '../physics.js?v=9';
import { clamp, rand } from '../util.js?v=9';

const gate_spacing = 320;   // meters between gates (~35 s at 33 km/h)
const perfect_bpm = 2;      // |hr - target| <= 2 -> perfect
const good_bpm = 5;         // <= 5 -> good (the opening of the gate)

export default {
  id: 'pulse',
  name: 'Pulse Pilot',
  icon: '❤️',
  tagline: 'Your heart rate is your altitude. Thread the gates.',
  uses: ['power', 'hr'],
  how: [
    'Your plane flies at the height of your heart rate. Gates are set at target bpm.',
    'Pedal harder to climb (HR up), ease off to descend. Your heart reacts with a 10–30 s delay, so plan ahead!',
    'Your watts set your speed, so pushing hard also brings the next gate closer.',
    'Within ±2 bpm = PERFECT (100), within ±5 = GOOD (50). Hits in a row build a combo bonus.',
    'The dotted line shows where your current HR trend will put you at the next gate: green = on target.',
    'Gate heights are based on your max HR setting.',
  ],
  options: [
    { key: 'gates', label: 'Gates', choices: [[8, '8'], [12, '12'], [20, '20']], def: 8 },
    { key: 'zone', label: 'Heart rate zone', choices: [['easy', 'Easy (55–75%)'], ['mixed', 'Mixed (60–85%)'], ['hard', 'Hard (70–92%)']], def: 'mixed' },
  ],
  setup_html: (o, profile) => {
    const [lo, hi] = zone_range(o.zone, profile.max_hr);
    return `<p class="small">Gates between ${lo} and ${hi} bpm (max HR ${profile.max_hr}). Ride ≈ ${Math.round((o.gates * gate_spacing) / 9 / 60)} min at 32 km/h.</p>`;
  },
  board: (o) => ({ key: `pulse_${o.gates}_${o.zone}`, label: `Top scores · ${o.gates} gates · ${o.zone}`, lower: false, fmt: (s) => `${s} pts` }),
  create,
};

function zone_range(zone, max_hr) {
  const pct = { easy: [0.55, 0.75], mixed: [0.6, 0.85], hard: [0.7, 0.92] }[zone];
  return pct.map((p) => Math.round(max_hr * p));
}

// gate targets: each one 6-18 bpm away from the previous, inside the zone
function make_gates(count, lo, hi) {
  const gates = [];
  let prev = lo + 6;
  for (let i = 0; i < count; i++) {
    let target;
    do {
      const step = rand(6, 18) * (Math.random() < 0.5 ? -1 : 1);
      target = Math.round(prev + step);
    } while (target < lo + 3 || target > hi - 3);
    gates.push({ x: 250 + i * gate_spacing, hr: target, result: null });
    prev = target;
  }
  return gates;
}

function create(env) {
  const $ = (id) => document.getElementById(id);
  const view = setup_2d(env.canvas);
  const [lo, hi] = zone_range(env.opts.zone, env.profile.max_hr);
  const view_lo = lo - 15, view_hi = hi + 10;   // visible bpm range
  const gates = make_gates(env.opts.gates, lo, hi);
  const st = { x: 0, v: 0, alt: null, slope: 0, score: 0, combo: 0, best_combo: 0, time: 0, prop: 0, trail: [], next: 0, energy: 0 };

  env.hud.innerHTML = `
    <div class="gh-row">
      <div class="gh-big" id="pp-score">0</div>
      <div><div id="pp-title" class="gh-title"></div><div id="pp-sub" class="gh-sub"></div></div>
    </div>`;
  env.bottom.innerHTML = `
    <div class="target">
      <div class="target-row"><span id="pp-hr"></span><span id="pp-dist"></span></div>
    </div>`;

  const game = {
    done: false,
    speed: () => st.v,
    update(dt, input) {
      st.v = step_speed(st.v, game.done ? 0 : input.watts, dt);
      st.x += st.v * dt;
      st.prop += (input.cadence / 60) * 2 * Math.PI * dt * 3;
      if (input.hr !== null) {
        const prev = st.alt;
        st.alt = st.alt === null ? input.hr : st.alt + (input.hr - st.alt) * Math.min(1, dt / 1.2);
        // hr trend in bpm per second, smoothed over ~5 s (drives the "where will I be" projection)
        if (prev !== null && dt > 0) st.slope += ((st.alt - prev) / dt - st.slope) * Math.min(1, dt / 5);
      }
      if (game.done) return;
      st.time += dt;
      st.energy += input.watts * dt;

      // trail of past altitude for the flight path
      if (!st.trail.length || st.x - st.trail[st.trail.length - 1][0] > 2) st.trail.push([st.x, st.alt]);
      if (st.trail.length > 400) st.trail.shift();

      const g = gates[st.next];
      if (g && st.x >= g.x) {
        const diff = st.alt === null ? 99 : Math.abs(st.alt - g.hr);
        if (diff <= perfect_bpm) score(g, 'perfect', 100);
        else if (diff <= good_bpm) score(g, 'good', 50);
        else {
          g.result = 'miss';
          st.combo = 0;
          env.big_text('MISS', 900, 'bad');
          env.sfx('bad');
        }
        st.next += 1;
        if (st.next >= gates.length) {
          game.done = true;
          game.done_text = 'LANDED';
        }
      }
    },
    render() {
      draw_scene();
      update_hud();
    },
    resize: () => view.resize(),
    dispose() {},
    result,
  };

  function score(g, kind, base) {
    st.combo += 1;
    st.best_combo = Math.max(st.best_combo, st.combo);
    const pts = Math.round(base * (1 + 0.1 * (st.combo - 1)));
    st.score += pts;
    g.result = kind;
    env.big_text(`${kind === 'perfect' ? 'PERFECT' : 'GOOD'} +${pts}`, 1000, 'good');
    env.sfx(kind);
  }

  function draw_scene() {
    const { ctx, w, h } = view;
    const ins = env.insets();
    const top = ins.top + 30;
    const bottom = h - ins.bottom - 30;
    const y_of = (bpm) => top + ((view_hi - bpm) / (view_hi - view_lo)) * (bottom - top);
    const ppm = clamp(w / 260, 1.4, 5);   // meters -> pixels: ~260 m visible ahead
    const px = w * 0.22;
    const sx = (x) => px + (x - st.x) * ppm;

    sky(ctx, w, h, '#3d7fd1', '#cfe8fa');
    clouds(ctx, w, h * 0.9, st.x * 0.6, 'rgba(255,255,255,0.7)');
    hills(ctx, w, h, st.x * 0.3, Math.min(160, h * 0.2), '#8fb98a', 0);
    hills(ctx, w, h, st.x * 0.8, Math.min(90, h * 0.12), '#6d9c64', 2);

    // bpm grid
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    for (let b = Math.ceil(view_lo / 10) * 10; b <= view_hi; b += 10) {
      const y = y_of(b);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(34, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(String(b), 4, y + 4);
    }

    // gates: two poles with an opening of +-5 bpm around the target
    for (const g of gates) {
      const gx = sx(g.x);
      if (gx < -40 || gx > w + 40) continue;
      const open_top = y_of(g.hr + good_bpm), open_bot = y_of(g.hr - good_bpm);
      const col = g.result === 'perfect' ? '#7ee08a' : g.result === 'good' ? '#ffd54f' : g.result === 'miss' ? '#ef5350' : '#ff7043';
      ctx.fillStyle = col;
      round_rect(ctx, gx - 7, top - 20, 14, open_top - (top - 20), 6);
      ctx.fill();
      round_rect(ctx, gx - 7, open_bot, 14, bottom + 20 - open_bot, 6);
      ctx.fill();
      // perfect band
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(gx - 7, y_of(g.hr + perfect_bpm), 14, y_of(g.hr - perfect_bpm) - y_of(g.hr + perfect_bpm));
      label(ctx, `${g.hr}`, gx + 12, (open_top + open_bot) / 2, 16, '#fff', 'left');
    }

    // flight path
    if (st.trail.length > 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      st.trail.forEach(([x, a], i) => {
        if (a === null) return;
        const p = [sx(x), y_of(a)];
        if (i === 0) ctx.moveTo(...p); else ctx.lineTo(...p);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // projection: where your current hr trend puts you at the next gate (max 30 s ahead)
    const ng = gates[st.next];
    if (ng && st.alt !== null && st.v > 0.5) {
      const eta = Math.min(30, (ng.x - st.x) / st.v);
      const proj = clamp(st.alt + st.slope * eta, view_lo, view_hi);
      const gx = sx(ng.x);
      const hit = Math.abs(proj - ng.hr) <= good_bpm;
      ctx.strokeStyle = hit ? 'rgba(126,224,138,0.9)' : 'rgba(255,138,128,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(px, y_of(clamp(st.alt, view_lo, view_hi)));
      ctx.lineTo(gx, y_of(proj));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(gx, y_of(proj), 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    // plane (only when there's an hr)
    if (st.alt !== null) draw_plane(ctx, px, y_of(clamp(st.alt, view_lo, view_hi)), clamp(h * 0.035, 18, 30));
    else label(ctx, 'No heart rate', w / 2, h / 2, 24, '#ff8a80');
  }

  function draw_plane(ctx, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    // body
    ctx.fillStyle = '#ffd400';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.6, s * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    // wing + tail
    ctx.fillStyle = '#ffb300';
    ctx.beginPath();
    ctx.moveTo(-s * 0.3, 0);
    ctx.lineTo(s * 0.4, 0);
    ctx.lineTo(-s * 0.6, s * 1.1);
    ctx.lineTo(-s * 1.0, s * 1.1);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 1.3, 0);
    ctx.lineTo(-s * 1.7, -s * 0.9);
    ctx.lineTo(-s * 1.4, -s * 0.9);
    ctx.lineTo(-s * 0.9, 0);
    ctx.closePath();
    ctx.fill();
    // cockpit window + pilot helmet
    ctx.fillStyle = '#90caf9';
    ctx.beginPath();
    ctx.ellipse(s * 0.5, -s * 0.25, s * 0.45, s * 0.28, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    // propeller spins with your cadence
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 3;
    const r = s * 0.8 * Math.abs(Math.cos(st.prop));
    ctx.beginPath();
    ctx.moveTo(s * 1.65, -r);
    ctx.lineTo(s * 1.65, r);
    ctx.stroke();
    ctx.restore();
  }

  function update_hud() {
    $('pp-score').textContent = st.score;
    const g = gates[st.next];
    $('pp-title').textContent = `Gate ${Math.min(st.next + 1, gates.length)}/${gates.length}${st.combo > 1 ? ` · combo ×${st.combo}` : ''}`;
    $('pp-sub').textContent = `zone ${lo}–${hi} bpm · best combo ${st.best_combo}`;
    if (!g) {
      $('pp-hr').textContent = 'All gates done';
      $('pp-dist').textContent = '';
      return;
    }
    const hr = st.alt === null ? null : Math.round(st.alt);
    const arrow = hr === null ? '' : hr < g.hr - perfect_bpm ? ' ▲ climb' : hr > g.hr + perfect_bpm ? ' ▼ descend' : ' ✓ hold';
    const trend = Math.abs(st.slope) < 0.05 ? '→' : st.slope > 0 ? '↗' : '↘';
    $('pp-hr').textContent = `HR ${hr ?? '--'} ${trend} gate ${g.hr}${arrow}`;
    const eta = st.v > 0.5 ? ` · ${Math.round((g.x - st.x) / st.v)} s` : '';
    $('pp-dist').textContent = `${Math.round(g.x - st.x)} m${eta}`;
  }

  function result() {
    const count = (k) => gates.filter((g) => g.result === k).length;
    const dots = gates.map((g) => `<span class="gate-dot ${g.result}" title="${g.hr} bpm"></span>`).join('');
    return {
      title: `${st.score} points`,
      sub: `${count('perfect')} perfect · ${count('good')} good · ${count('miss')} missed · best combo ${st.best_combo}`,
      body: `<div class="gate-dots">${dots}</div><p class="small">Gates: ${gates.map((g) => g.hr).join(' → ')} bpm</p>`,
      score: st.score,
      note: `${count('perfect')}P ${count('good')}G ${count('miss')}M`,
    };
  }

  return game;
}
