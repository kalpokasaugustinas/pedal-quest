// spin beat: a rhythm game for your legs. target cadence blocks scroll down a highway,
// keep your cadence inside them to score; hitting in a row builds a combo multiplier
import { setup_2d, round_rect, label } from '../draw2d.js?v=18';
import { clamp, seeded } from '../util.js?v=18';

// tracks are generated from a fixed seed, so the same track is the same every time (fair leaderboards)
const tracks = {
  groove: { name: 'Warm-up Groove', min: 3, seed: 11, rpms: [75, 80, 85, 90, 95], dur: [10, 18], bursts: 0 },
  tempo: { name: 'Tempo Tracks', min: 5, seed: 23, rpms: [70, 80, 90, 100, 110], dur: [8, 15], bursts: 0.15 },
  storm: { name: 'Spin Storm', min: 8, seed: 37, rpms: [70, 85, 95, 105, 115], dur: [5, 12], bursts: 0.25 },
  ladder: { name: 'Cadence Ladder', min: 6, seed: 0, ladder: true },
};

const perfect_rpm = 3;
const good_rpm = 7;
const rpm_min = 50, rpm_max = 135;   // visible cadence range

function make_notes(track) {
  const notes = [];
  const total = track.min * 60;
  if (track.ladder) {
    // ladder: 70 -> 120 in 10 rpm steps and back down, 30 s each
    const steps = [70, 80, 90, 100, 110, 120, 110, 100, 90, 80, 70];
    let t = 0;
    for (const rpm of steps) { notes.push({ t, dur: Math.min(30, total - t), rpm }); t += 30; if (t >= total) break; }
    return notes;
  }
  const rnd = seeded(track.seed);
  let t = 0;
  let prev = 85;
  notes.push({ t: 0, dur: 12, rpm: 85 });   // warm-up block
  t = 12;
  while (t < total) {
    let rpm, dur;
    if (rnd() < track.bursts) {
      rpm = 120;                       // short high-cadence burst
      dur = 5;
    } else {
      do { rpm = track.rpms[Math.floor(rnd() * track.rpms.length)]; } while (rpm === prev);
      dur = Math.round(track.dur[0] + rnd() * (track.dur[1] - track.dur[0]));
    }
    dur = Math.min(dur, total - t);
    notes.push({ t, dur, rpm });
    prev = rpm;
    t += dur;
  }
  return notes;
}

export default {
  id: 'spinbeat',
  name: 'Spin Beat',
  icon: '🎵',
  tagline: 'Rhythm game for your legs. Match the cadence blocks.',
  uses: ['cadence'],
  how: [
    'Cadence blocks scroll down the highway. Keep your cadence (the dot) inside the block on the line.',
    'Within ±3 rpm = PERFECT (10 pts/s), within ±7 = GOOD (5 pts/s).',
    'Every 10 s without a miss adds +0.5 to the multiplier (up to ×4). Missing for more than 1 s resets it.',
    'The metronome clicks once per pedal stroke at the target cadence. Pedal to the beat!',
    'Resistance doesn’t matter. Pick an easy gear and focus on rhythm.',
  ],
  options: [
    { key: 'track', label: 'Track', wide: true, choices: Object.entries(tracks).map(([id, t]) => [id, `${t.name}<small>${t.min} min${t.ladder ? ' · 70→120→70' : ` · ${Math.min(...t.rpms)}–${t.bursts ? 120 : Math.max(...t.rpms)} rpm`}</small>`]), def: 'groove' },
    { key: 'metronome', label: 'Metronome', choices: [[1, 'On'], [0, 'Off']], def: 1 },
  ],
  board: (o) => ({ key: `spin_${o.track}`, label: `Top scores · ${tracks[o.track].name}`, lower: false, fmt: (s) => `${s} pts` }),
  create,
};

function create(env) {
  const $ = (id) => document.getElementById(id);
  const view = setup_2d(env.canvas);
  const track = tracks[env.opts.track];
  const notes = make_notes(track);
  const total = notes.reduce((s, n) => s + n.dur, 0);
  const st = { time: 0, score: 0, streak_s: 0, miss_s: 0, mult: 1, best_mult: 1, perfect_s: 0, good_s: 0, trail: [], beat: 0, flash: 0, last_hit: '' };

  // metronome: short click via web audio (created inside the start tap, so browsers allow sound)
  let audio = null;
  if (env.opts.metronome) {
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; }
  }
  function click(accent) {
    if (!audio) return;
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = accent ? 1400 : 900;
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  env.hud.innerHTML = `
    <div class="gh-row">
      <div class="gh-big" id="sb-score">0</div>
      <div><div id="sb-title" class="gh-title"></div><div id="sb-sub" class="gh-sub"></div></div>
    </div>`;
  env.bottom.innerHTML = `
    <div class="target">
      <div class="target-row"><span id="sb-target"></span><span id="sb-hit"></span></div>
    </div>`;

  const note_at = (t) => notes.find((n) => t >= n.t && t < n.t + n.dur) || null;

  const game = {
    done: false,
    speed: () => null,
    update(dt, input) {
      if (game.done) return;
      st.time += dt;
      const n = note_at(st.time);
      if (!n) {
        game.done = true;
        game.done_text = 'ENCORE!';
        return;
      }
      // metronome: one click per revolution at the target cadence
      st.beat += (n.rpm / 60) * dt;
      if (st.beat >= 1) {
        st.beat -= 1;
        click(false);
      }

      const diff = Math.abs(input.cadence - n.rpm);
      let hit = 'miss';
      if (diff <= perfect_rpm) hit = 'perfect';
      else if (diff <= good_rpm) hit = 'good';
      if (hit === 'miss') {
        st.miss_s += dt;
        if (st.miss_s > 1) { st.streak_s = 0; st.mult = 1; }
      } else {
        st.miss_s = 0;
        st.streak_s += dt;
        st.mult = Math.min(4, 1 + Math.floor(st.streak_s / 10) * 0.5);
        st.best_mult = Math.max(st.best_mult, st.mult);
        st.score += (hit === 'perfect' ? 10 : 5) * st.mult * dt;
        if (hit === 'perfect') st.perfect_s += dt; else st.good_s += dt;
      }
      st.last_hit = hit;
      st.trail.push([st.time, input.cadence]);
      while (st.trail.length && st.time - st.trail[0][0] > 4) st.trail.shift();
    },
    render(dt, input) {
      draw_scene(input);
      update_hud(input);
    },
    resize: () => view.resize(),
    dispose() { audio?.close().catch(() => {}); },
    result,
  };

  function draw_scene(input) {
    const { ctx, w, h } = view;
    const ins = env.insets();
    const pad = 28;
    const x_of = (rpm) => pad + ((rpm - rpm_min) / (rpm_max - rpm_min)) * (w - pad * 2);
    const now_y = h - ins.bottom - 40;
    const pps = (now_y - ins.top) / 10;   // pixels per second: ~10 s of track visible
    const y_of = (t) => now_y - (t - st.time) * pps;

    // background: dark stage with a subtle pulse on each beat
    ctx.fillStyle = '#0d1220';
    ctx.fillRect(0, 0, w, h);
    const pulse = Math.max(0, 1 - st.beat * 4);
    ctx.fillStyle = `rgba(120,80,255,${0.08 * pulse})`;
    ctx.fillRect(0, 0, w, h);

    // cadence grid
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let r = 60; r <= 130; r += 10) {
      const x = x_of(r);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, ins.top);
      ctx.lineTo(x, now_y + 10);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText(String(r), x, now_y + 26);
    }

    // note blocks: outer = good window, inner = perfect window (clipped just below the now line)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, now_y + 12);
    ctx.clip();
    for (const n of notes) {
      const y1 = y_of(n.t + n.dur), y2 = y_of(n.t);
      if (y2 < ins.top - 20 || y1 > now_y + 40) continue;
      const hue = 280 - ((n.rpm - 60) / 70) * 200;   // colour by cadence: slow = purple, fast = orange
      const active = st.time >= n.t && st.time < n.t + n.dur;
      ctx.fillStyle = `hsla(${hue}, 85%, 60%, ${active ? 0.35 : 0.22})`;
      round_rect(ctx, x_of(n.rpm - good_rpm), y1 + 2, x_of(n.rpm + good_rpm) - x_of(n.rpm - good_rpm), y2 - y1 - 4, 8);
      ctx.fill();
      ctx.fillStyle = `hsla(${hue}, 90%, 62%, ${active ? 0.95 : 0.7})`;
      round_rect(ctx, x_of(n.rpm - perfect_rpm), y1 + 2, x_of(n.rpm + perfect_rpm) - x_of(n.rpm - perfect_rpm), y2 - y1 - 4, 6);
      ctx.fill();
      if (y2 - y1 > 24) label(ctx, `${n.rpm}`, x_of(n.rpm), Math.max(y1 + 16, Math.min(y2 - 14, ins.top + 20)), 14, '#fff');
    }
    ctx.restore();

    // now line
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad - 10, now_y);
    ctx.lineTo(w - pad + 10, now_y);
    ctx.stroke();

    // your cadence trail (past 4 s, drawn below the now line) and cursor
    ctx.strokeStyle = 'rgba(255,212,0,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    st.trail.forEach(([t, rpm], i) => {
      const p = [x_of(clamp(rpm, rpm_min, rpm_max)), now_y + (st.time - t) * pps * 0.25];
      if (i === 0) ctx.moveTo(...p); else ctx.lineTo(...p);
    });
    ctx.stroke();
    const cx = x_of(clamp(input.cadence, rpm_min, rpm_max));
    const col = st.last_hit === 'perfect' ? '#7ee08a' : st.last_hit === 'good' ? '#ffd54f' : '#ff5252';
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(cx, now_y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (st.mult > 1) label(ctx, `×${st.mult.toFixed(1)}`, w - pad, ins.top + 30, 30, '#ffd54f', 'right');
  }

  function update_hud(input) {
    $('sb-score').textContent = Math.round(st.score);
    $('sb-title').textContent = track.name;
    const left = Math.max(0, total - st.time);
    $('sb-sub').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} left · multiplier ×${st.mult.toFixed(1)}`;
    const n = note_at(st.time);
    const next = n ? notes[notes.indexOf(n) + 1] : null;
    $('sb-target').textContent = n ? `Target ${n.rpm} rpm${next ? ` · next ${next.rpm} in ${Math.ceil(n.t + n.dur - st.time)} s` : ''}` : '';
    $('sb-hit').textContent = { perfect: 'PERFECT', good: 'GOOD', miss: Math.round(input.cadence) < (n?.rpm ?? 0) ? 'faster ▲' : 'slower ▼' }[st.last_hit] || '';
  }

  function result() {
    const acc = Math.round(((st.perfect_s + st.good_s) / Math.max(1, total)) * 100);
    return {
      title: `${Math.round(st.score)} points`,
      sub: `${acc}% in the zone · ${Math.round((st.perfect_s / Math.max(1, total)) * 100)}% perfect · best multiplier ×${st.best_mult.toFixed(1)}`,
      body: '',
      score: Math.round(st.score),
      flags: { acc, mult: st.best_mult },
      note: `${acc}% accuracy`,
    };
  }

  return game;
}
