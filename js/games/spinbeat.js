// spin beat: a rhythm game for your legs. target cadence blocks scroll down a highway,
// keep your cadence inside them to score; hitting in a row builds a combo multiplier
import * as THREE from 'three';
import { create_kit, scenery_option } from '../kit3d.js?v=43';
import { clamp, seeded } from '../util.js?v=43';

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
    scenery_option('night'),
  ],
  board: (o) => ({ key: `spin_${o.track}`, label: `Top scores · ${tracks[o.track].name}`, lower: false, fmt: (s) => `${s} pts` }),
  create,
};

function create(env) {
  const $ = (id) => document.getElementById(id);
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
      draw_scene(input, dt);
      update_hud(input);
    },
    resize: () => kit.resize(),
    dispose() { audio?.close().catch(() => {}); kit.dispose(); },
    result,
  };

  // ---- 3d: a wide cadence highway. lanes = rpm, glowing note tiles come at you, the rider steers with cadence ----
  const flow = 14;                 // visual m/s the track scrolls (time-based, independent of your speed)
  const road_w = 16;
  const rx = (rpm) => -road_w / 2 + 1 + ((clamp(rpm, rpm_min, rpm_max) - rpm_min) / (rpm_max - rpm_min)) * (road_w - 2);
  const kit = create_kit(env.canvas, {
    theme: env.opts.scenery, road_w, lanes: 1, camps: false, curves: false,
    // rpm guide lines + numbers painted on the asphalt
    paint_road(g, w, h) {
      g.textAlign = 'center';
      for (let r = 60; r <= 130; r += 10) {
        const x = ((rx(r) + road_w / 2) / road_w) * w;
        g.fillStyle = 'rgba(255,255,255,0.16)';
        g.fillRect(x - 1, 0, 2, h);
        if (r % 20) continue;   // numbers every 20 rpm, squashed: the texture is stretched 2x along the road
        g.save();
        g.translate(x, h * 0.1);
        g.scale(1, 0.5);
        g.font = '700 12px system-ui, sans-serif';
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.fillText(String(r), 0, 0);
        g.restore();
      }
    },
  });
  const me = kit.add_rider(env.look);
  const tile_mats = [];
  // note tiles: outer = good window (translucent), inner = perfect window (bright)
  for (const n of notes) {
    const hue = (280 - ((n.rpm - 60) / 70) * 200) / 360;   // colour by cadence: slow = purple, fast = orange
    const len = n.dur * flow - 0.6;
    const z = -(n.t * flow) - 0.3 - len / 2;
    const make = (half_rpm, height, opacity, emissive) => {
      const m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.85, 0.5), emissive: new THREE.Color().setHSL(hue, 0.95, 0.4), emissiveIntensity: emissive, transparent: true, opacity, roughness: 0.6 });
      const w = rx(n.rpm + half_rpm) - rx(n.rpm - half_rpm);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, len), m);
      mesh.position.set(kit.road_x(z) + rx(n.rpm), kit.road_y(z) + height / 2 + 0.02, z);
      kit.scene.add(mesh);
      return m;
    };
    const outer = make(good_rpm, 0.08, 0.45, 0.15);
    const inner = make(perfect_rpm, 0.16, 0.95, 0.3);
    tile_mats.push({ n, outer, inner });
  }
  let rider_x = rx(85), crank = 0, watts_now = 0;

  function draw_scene(input, dt) {
    const z = -st.time * flow;
    crank += (input.cadence / 60) * 2 * Math.PI * dt;
    watts_now = input.watts;
    rider_x += (rx(input.cadence) - rider_x) * Math.min(1, dt * 6);
    kit.place_rider(me, { z, x: rider_x, watts: watts_now, v: flow / 2.5, crank, dist: -z, ref: env.profile.ftp }, dt);
    // the tile you're on pulses with the metronome beat
    const pulse = Math.max(0, 1 - st.beat * 4);
    for (const t of tile_mats) {
      const active = st.time >= t.n.t && st.time < t.n.t + t.n.dur;
      t.inner.emissiveIntensity = active ? 0.45 + 0.8 * pulse : 0.3;
      t.outer.opacity = active ? 0.6 : 0.45;
    }
    kit.chase({ z, x: 0, back: 9, height: 5.5, look_ahead: 26, look_y: 0, speed: flow }, dt);
    kit.frame(dt, { focus_z: z, speed: flow });
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
