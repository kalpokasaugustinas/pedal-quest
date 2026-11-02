// pulse pilot: your heart rate is your altitude. fly a winged bicycle through gates set at target bpm.
// hr reacts slowly to effort, so you have to plan ahead: start pushing (or easing off) well before each gate
import * as THREE from 'three';
import { create_kit, vis_scale, scenery_option } from '../kit3d.js?v=44';
import { step_speed } from '../physics.js?v=44';
import { clamp, rand } from '../util.js?v=44';

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
    'You pedal a flying bike: it flies at the height of your heart rate, the wings flap with your pedal strokes. Gates are set at target bpm.',
    'Pedal harder to climb (HR up), ease off to descend. Your heart reacts with a 10–30 s delay, so plan ahead!',
    'Your watts set your speed, so pushing hard also brings the next gate closer.',
    'Within ±2 bpm = PERFECT (100), within ±5 = GOOD (50). Hits in a row build a combo bonus.',
    'The dotted line shows where your current HR trend will put you at the next gate: green = on target.',
    'Gate heights are based on your max HR setting.',
  ],
  options: [
    { key: 'gates', label: 'Gates', choices: [[8, '8'], [12, '12'], [20, '20']], def: 8 },
    { key: 'zone', label: 'Heart rate zone', choices: [['easy', 'Easy (55–75%)'], ['mixed', 'Mixed (60–85%)'], ['hard', 'Hard (70–92%)']], def: 'mixed' },
    scenery_option('meadow'),
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
      watts_now = game.done ? 0 : input.watts;
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
    render(dt) {
      draw_scene(dt);
      update_hud();
    },
    resize: () => kit.resize(),
    dispose: () => kit.dispose(),
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

  // ---- 3d: a flying bike over the low-poly valley, gates as frames at bpm heights ----
  const vis = vis_scale;
  const kit = create_kit(env.canvas, { theme: env.opts.scenery, posts: false });
  const alt_lo = 6, alt_hi = 46;   // meters above the road for view_lo .. view_hi bpm
  const y_of = (bpm) => alt_lo + ((clamp(bpm, view_lo, view_hi) - view_lo) / (view_hi - view_lo)) * (alt_hi - alt_lo);
  const mat = (color, extra) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...extra });

  // flying bike: you pedal a winged bicycle; the wings flap once per pedal revolution
  const flyer = kit.add_rider(env.look);
  const wing_mat = mat('#ffb300'), rib_mat = mat('#8d6e63');
  const wings = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.22, 1.32, 0.1);
    // three overlapping feather panels, shorter towards the tip, plus a wooden spar
    [[3.4, 1.1, 0], [2.6, 0.8, 0.35], [1.7, 0.55, 0.7]].forEach(([len, depth, back]) => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, depth), wing_mat);
      f.position.set(side * len / 2, 0, back);
      f.castShadow = true;
      pivot.add(f);
    });
    const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.5, 5), rib_mat);
    spar.rotation.z = Math.PI / 2;
    spar.position.set(side * 1.75, 0.05, -0.45);
    pivot.add(spar);
    flyer.bike.add(pivot);
    return { pivot, side };
  });
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.7), wing_mat);
  tail.position.set(0, 0.75, 1.15);
  const tail_fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.6), wing_mat);
  tail_fin.position.set(0, 1.0, 1.2);
  flyer.bike.add(tail, tail_fin);
  let flap_crank = 0, watts_now = 0;

  // bpm number on a small board
  function bpm_texture(text) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(20,24,30,0.85)';
    x.fillRect(0, 0, 256, 96);
    x.fillStyle = '#fff';
    x.font = '900 58px system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, 128, 52);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // gates: a frame across the valley; the opening is target +-5 bpm, the inner band is perfect (+-2)
  const gate_w = 14;
  const gate_models = gates.map((g) => {
    const grp = new THREE.Group();
    const m = mat('#ff7043');
    const y1 = y_of(g.hr - good_bpm), y2 = y_of(g.hr + good_bpm);
    const post = (x, ya, yb) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, yb - ya, 0.6), m);
      p.position.set(x, (ya + yb) / 2, 0);
      p.castShadow = true;
      grp.add(p);
    };
    for (const x of [-gate_w / 2, gate_w / 2]) { post(x, 0, y1); post(x, y2, alt_hi + 8); }
    for (const y of [y1, y2]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(gate_w + 0.6, 0.5, 0.5), m);
      bar.position.y = y;
      bar.castShadow = true;
      grp.add(bar);
    }
    const band = new THREE.Mesh(new THREE.PlaneGeometry(gate_w, y_of(g.hr + perfect_bpm) - y_of(g.hr - perfect_bpm)),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    band.position.y = y_of(g.hr);
    grp.add(band);
    // big bpm board above the opening, readable from far away
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.4), new THREE.MeshBasicMaterial({ map: bpm_texture(`${g.hr} bpm`), fog: false }));
    sign.position.set(0, y2 + 2.6, 0);
    grp.add(sign);
    const z = -g.x * vis;
    grp.position.set(kit.road_x(z), kit.road_y(z), z);
    grp.rotation.y = kit.heading(z);
    kit.scene.add(grp);
    return { grp, mat: m };
  });

  // dashed trail of your flight + projection line to the next gate
  const line_geo = (n) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    return g;
  };
  const trail = new THREE.Line(line_geo(400), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 2, gapSize: 2, transparent: true, opacity: 0.8 }));
  trail.frustumCulled = false;
  const proj = new THREE.Line(line_geo(2), new THREE.LineDashedMaterial({ color: '#7ee08a', dashSize: 1.5, gapSize: 1.5 }));
  proj.frustumCulled = false;
  kit.scene.add(trail, proj);

  function draw_scene(dt) {
    const z = -st.x * vis;
    const alt = st.alt === null ? null : y_of(st.alt);
    const y = (alt ?? alt_lo) + kit.road_y(z);
    // the flying bike: pedalling drives the wings, the nose follows the hr trend (climbing / diving)
    flap_crank = st.prop / 3;
    kit.place_rider(flyer, { z, y, watts: watts_now, v: st.v, crank: flap_crank, dist: st.x * vis, ref: env.profile.ftp }, dt);
    flyer.group.rotation.x = clamp(st.slope * 0.25, -0.35, 0.35);
    flyer.group.visible = alt !== null;
    const flap = Math.sin(flap_crank);
    for (const w of wings) w.pivot.rotation.z = w.side * (0.12 + 0.5 * flap);
    gate_models.forEach((gm, i) => {
      const r = gates[i].result;
      gm.mat.color.set(r === 'perfect' ? '#7ee08a' : r === 'good' ? '#ffd54f' : r === 'miss' ? '#ef5350' : '#ff7043');
    });
    // trail
    const tp = trail.geometry.attributes.position;
    let n = 0;
    for (const [x, a] of st.trail) {
      if (a === null) continue;
      const tz = -x * vis;
      tp.setXYZ(n++, kit.road_x(tz), y_of(a) + kit.road_y(tz), tz);
    }
    trail.geometry.setDrawRange(0, n);
    tp.needsUpdate = true;
    trail.computeLineDistances();
    // projection: where your current hr trend puts you at the next gate (max 30 s ahead)
    const ng = gates[st.next];
    proj.visible = false;
    if (ng && st.alt !== null && st.v > 0.5) {
      const eta = Math.min(30, (ng.x - st.x) / st.v);
      const target = clamp(st.alt + st.slope * eta, view_lo, view_hi);
      const gz = -ng.x * vis;
      const pp = proj.geometry.attributes.position;
      pp.setXYZ(0, flyer.group.position.x, flyer.group.position.y + 1.2, flyer.group.position.z);
      pp.setXYZ(1, kit.road_x(gz), y_of(target) + kit.road_y(gz), gz);
      pp.needsUpdate = true;
      proj.computeLineDistances();
      proj.material.color.set(Math.abs(target - ng.hr) <= good_bpm ? '#7ee08a' : '#ff8a80');
      proj.visible = true;
    }
    const speed = st.v * vis;
    kit.chase({ z, y, back: 11, height: 2.5, look_ahead: 30, look_y: -1, speed, smooth: 3 }, dt);
    kit.frame(dt, { focus_z: z, speed });
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
      flags: { perfect: count('perfect'), miss: count('miss') },
      note: `${count('perfect')}P ${count('good')}G ${count('miss')}M`,
    };
  }

  return game;
}
