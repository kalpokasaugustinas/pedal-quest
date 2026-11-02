// escape: an endless chase. a storm front rides the same physics as you and gets stronger every minute.
// how long can you stay ahead? every km you reach a shelter checkpoint that pushes the storm back
import * as THREE from 'three';
import { create_kit, vis_scale, scenery_option } from '../kit3d.js?v=41';
import { step_speed } from '../physics.js?v=41';
import { clamp, fmt_clock } from '../util.js?v=41';

const start_gap = 60;          // meters head start
const checkpoint_m = 1000;     // a shelter every km
const checkpoint_push = 25;    // storm pushed back 25 m
const ramp_per_min = 0.05;     // storm power grows by 5% of ftp per minute
const max_gap = 150;           // the storm never falls further behind than this (no banking a huge early lead)

export default {
  id: 'escape',
  name: 'Escape',
  icon: '🌩️',
  tagline: 'Outride the storm. It never gets tired.',
  uses: ['power', 'cadence'],
  how: [
    `A storm starts ${start_gap} m behind you. It rides with real power, starting below your FTP and growing ${Math.round(ramp_per_min * 100)}% of FTP every minute.`,
    'The HUD shows the storm’s current watts. To stay ahead, you have to match them.',
    `Every km you pass a shelter: the storm is pushed back ${checkpoint_push} m.`,
    `The storm never drops more than ${max_gap} m behind, so you can’t bank a huge early lead.`,
    'When the storm catches you, the game is over. Score = time survived.',
  ],
  options: [
    { key: 'level', label: 'Storm start power', choices: [[0.55, 'Easy · 55% FTP'], [0.65, 'Normal · 65%'], [0.75, 'Hard · 75%']], def: 0.65 },
    scenery_option('valley'),
  ],
  setup_html: (o, profile) => {
    const at = (min) => Math.round(profile.ftp * (o.level + ramp_per_min * min));
    return `<p class="small">With FTP ${profile.ftp} W the storm rides ${at(0)} W at the start, ${at(5)} W at 5 min, ${at(10)} W at 10 min, ${at(15)} W at 15 min.</p>`;
  },
  board: (o) => ({ key: `escape_${o.level}`, label: `Longest escapes · start ${Math.round(o.level * 100)}% FTP`, lower: false, fmt: fmt_clock }),
  create,
};

function create(env) {
  const $ = (id) => document.getElementById(id);
  const ftp = env.profile.ftp;
  const st = {
    x: 0, v: 0, crank: 0, time: 0, energy: 0,
    storm_x: -start_gap, storm_v: 0, next_cp: checkpoint_m, checkpoints: 0,
    flash: 0, bolt: null, rain_t: 0,
  };
  const storm_watts = () => ftp * (env.opts.level + ramp_per_min * (st.time / 60));

  env.hud.innerHTML = `
    <div class="gh-row">
      <div class="gh-big" id="es-time">0:00</div>
      <div><div id="es-gap" class="gh-title"></div><div id="es-sub" class="gh-sub"></div></div>
    </div>`;
  env.bottom.innerHTML = `
    <div class="target">
      <div class="target-row"><span id="es-storm"></span><span id="es-cp"></span></div>
      <div class="meter"><div id="es-fill" class="meter-fill"></div></div>
    </div>`;

  const game = {
    done: false,
    speed: () => st.v,
    update(dt, input) {
      st.v = step_speed(st.v, game.done ? 0 : input.watts, dt);
      watts_now = game.done ? 0 : input.watts;
      st.x += st.v * dt;
      st.crank += (input.cadence / 60) * 2 * Math.PI * dt;
      st.rain_t += dt;
      st.flash = Math.max(0, st.flash - dt * 3);
      if (game.done) return;
      st.time += dt;
      st.energy += input.watts * dt;
      // storm waits 2 s, then rides
      if (st.time > 2) {
        st.storm_v = step_speed(st.storm_v, storm_watts(), dt);
        st.storm_x += st.storm_v * dt;
        // storm winds drag it along when it falls too far behind
        if (st.x - st.storm_x > max_gap) {
          st.storm_x = st.x - max_gap;
          st.storm_v = Math.max(st.storm_v, st.v);
        }
      }
      if (st.x >= st.next_cp) {
        st.storm_x -= checkpoint_push;
        st.next_cp += checkpoint_m;
        st.checkpoints += 1;
        env.big_text(`SHELTER! −${checkpoint_push} m`, 1400, 'good');
        env.sfx('good');
      }
      // lightning gets more frequent as the storm closes in
      const gap = st.x - st.storm_x;
      if (Math.random() < dt * clamp((60 - gap) / 30, 0.05, 1.5)) {
        st.flash = 1;
        st.bolt = Math.random();
      }
      // warning beep every 2 s while the storm is close
      if (gap < 25 && st.time - (st.last_warn ?? -9) > 2) {
        st.last_warn = st.time;
        env.sfx('warn');
      }
      if (gap <= 0) {
        game.done = true;
        game.done_text = 'CAUGHT!';
        game.done_class = 'bad';
      }
    },
    render(dt, input) {
      draw_scene(dt);
      update_hud(input);
    },
    resize: () => kit.resize(),
    dispose: () => kit.dispose(),
    result,
  };

  // ---- 3d: the camera rides ahead looking back at you; the storm wall rolls in behind ----
  const vis = vis_scale;
  const kit = create_kit(env.canvas, { theme: env.opts.scenery });
  const me = kit.add_rider(env.look);
  const base_light = { hemi: kit.hemi.intensity, sun: kit.sun.intensity, fog: kit.scene.fog.color.clone(), near: kit.scene.fog.near, far: kit.scene.fog.far };
  const storm_fog = new THREE.Color('#3a4152');

  // storm wall: big dark faceted cloud blobs across the valley, slowly churning
  const storm = new THREE.Group();
  const cloud_mat = new THREE.MeshStandardMaterial({ color: '#2a2f3d', flatShading: true, roughness: 1 });
  const blobs = [];
  for (let i = 0; i < 40; i++) {
    const r = 10 + Math.random() * 14;
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), cloud_mat);
    b.position.set((Math.random() - 0.5) * 170, 6 + Math.random() * 55, (Math.random() - 0.5) * 30);
    b.scale.y = 0.7;
    b.userData.spin = (Math.random() - 0.5) * 0.4;
    storm.add(b);
    blobs.push(b);
  }
  // rain: falling streaks in and just ahead of the wall
  const rain_n = 400;
  const rain_pos = new Float32Array(rain_n * 6);
  const rain_geo = new THREE.BufferGeometry();
  rain_geo.setAttribute('position', new THREE.BufferAttribute(rain_pos, 3));
  const rain_pts = Array.from({ length: rain_n }, () => ({ x: (Math.random() - 0.5) * 120, y: Math.random() * 40, z: -Math.random() * 40 + 10 }));
  const rain = new THREE.LineSegments(rain_geo, new THREE.LineBasicMaterial({ color: '#a8b8d8', transparent: true, opacity: 0.5 }));
  rain.frustumCulled = false;
  storm.add(rain);
  // lightning: a jagged line + a flash light
  const bolt_geo = new THREE.BufferGeometry();
  bolt_geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
  const bolt = new THREE.Line(bolt_geo, new THREE.LineBasicMaterial({ color: '#fffbe0', transparent: true }));
  bolt.frustumCulled = false;
  const flash_light = new THREE.PointLight('#dfe8ff', 0, 400, 1.2);
  flash_light.position.set(0, 30, 0);
  storm.add(bolt, flash_light);
  kit.scene.add(storm);

  // shelter hut beside the road at the next checkpoint
  const hut = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), new THREE.MeshStandardMaterial({ color: '#8d6e63', flatShading: true }));
  wall.position.y = 1.5;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 2.2, 4), new THREE.MeshStandardMaterial({ color: '#c62828', flatShading: true }));
  roof.position.y = 4.1;
  roof.rotation.y = Math.PI / 4;
  roof.scale.z = 0.8;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2), new THREE.MeshBasicMaterial({ color: '#ffe082' }));
  door.position.set(0, 1, 2.01);
  hut.add(wall, roof, door);
  hut.traverse((o) => { o.castShadow = true; });
  kit.scene.add(hut);
  let hut_cp = null, hut_board = null;

  let watts_now = 0, last_bolt = -1;
  function draw_scene(dt) {
    const z = -st.x * vis;
    const gap = st.x - st.storm_x;
    const danger = clamp(1 - gap / 90, 0, 1);   // 0 = safe, 1 = caught
    kit.place_rider(me, { z, x: 0, watts: watts_now, v: st.v, crank: st.crank, dist: st.x * vis, ref: ftp }, dt);

    // storm wall at the front's position (real gap, so it reads like in the 2d version but bigger)
    const sz = -st.storm_x * vis + 12;
    storm.position.set(kit.road_x(sz), kit.road_y(sz), sz);
    for (const b of blobs) { b.rotation.y += b.userData.spin * dt; b.rotation.x += b.userData.spin * 0.5 * dt; }
    for (let i = 0; i < rain_n; i++) {
      const p = rain_pts[i];
      p.y -= 40 * dt;
      if (p.y < 0) { p.y = 40; p.x = (Math.random() - 0.5) * 120; p.z = -Math.random() * 40 + 10; }
      const o = i * 6;
      rain_pos[o] = p.x; rain_pos[o + 1] = p.y; rain_pos[o + 2] = p.z;
      rain_pos[o + 3] = p.x - 0.3; rain_pos[o + 4] = p.y - 1.6; rain_pos[o + 5] = p.z;
    }
    rain_geo.attributes.position.needsUpdate = true;
    // lightning bolt from the cloud base to the ground when the game flashes
    if (st.flash > 0 && st.bolt !== last_bolt) {
      last_bolt = st.bolt;
      const bp = bolt_geo.attributes.position;
      let bx = (st.bolt - 0.5) * 70, by = 32;
      for (let i = 0; i < 12; i++) {
        bp.setXYZ(i, bx, by, -8 + Math.random() * 4);
        bx += (Math.random() - 0.5) * 6;
        by -= 32 / 11;
      }
      bp.needsUpdate = true;
    }
    bolt.visible = st.flash > 0;
    bolt.material.opacity = st.flash;
    flash_light.intensity = st.flash * 4000;

    // the world darkens as the storm closes in
    kit.hemi.intensity = base_light.hemi * (1 - 0.55 * danger) + st.flash * 1.5;
    kit.sun.intensity = base_light.sun * (1 - 0.7 * danger);
    kit.scene.fog.color.copy(base_light.fog).lerp(storm_fog, danger * 0.8);
    kit.scene.fog.near = base_light.near * (1 - 0.5 * danger);
    kit.scene.fog.far = base_light.far * (1 - 0.35 * danger);

    // shelter at the next checkpoint
    if (hut_cp !== st.next_cp) {
      hut_cp = st.next_cp;
      const hz = -hut_cp * vis;
      const hx = kit.road_x(hz) + kit.road_edge + 6;
      hut.position.set(hx, kit.ground(hx, hz), hz);
      if (hut_board) kit.remove(hut_board);
      hut_board = kit.add_board(hz + 6, `SHELTER ${st.checkpoints + 1}`, 1, '#c62828', '#ffffff', 2.6);
    }

    // camera ahead of you, looking back: you riding at it, the storm behind (zooms out as the gap grows)
    const gap_vis = Math.max(10, gap * vis);
    const speed = st.v * vis;
    kit.chase({ z, reverse: true, back: 10 + Math.min(4, gap_vis * 0.02), height: 3.2 + Math.min(3, gap_vis * 0.015), look_ahead: Math.min(55, gap_vis * 0.35), look_y: 2.5, speed }, dt);
    kit.frame(dt, { focus_z: z, speed, look_back: true });
  }

  function update_hud(input) {
    const gap = st.x - st.storm_x;
    $('es-time').textContent = fmt_clock(st.time);
    $('es-gap').textContent = `Storm ${Math.max(0, Math.round(gap))} m behind`;
    $('es-gap').style.color = gap < 25 ? '#ff8a80' : gap < 50 ? '#ffd54f' : '';
    $('es-sub').textContent = `${(st.x / 1000).toFixed(2)} km · ${st.checkpoints} shelters`;
    const sw = Math.round(storm_watts());
    const you = Math.round(input.watts);
    $('es-storm').textContent = `Storm ${sw} W · you ${you} W ${you >= sw ? '▲' : '▼'}`;
    $('es-storm').style.color = you >= sw ? '#7ee08a' : '#ff8a80';
    $('es-cp').textContent = `shelter in ${Math.round(st.next_cp - st.x)} m`;
    $('es-fill').style.width = `${clamp(gap / 120, 0, 1) * 100}%`;
    $('es-fill').classList.toggle('bad', gap < 30);
  }

  function result() {
    return {
      title: `Survived ${fmt_clock(st.time)}`,
      sub: `${(st.x / 1000).toFixed(2)} km · ${st.checkpoints} shelters · avg ${Math.round(st.energy / Math.max(1, st.time))} W · storm reached ${Math.round(storm_watts())} W`,
      body: '',
      score: Math.round(st.time),
      flags: { secs: st.time },
      note: `${(st.x / 1000).toFixed(2)} km`,
    };
  }

  return game;
}
