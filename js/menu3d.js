// menu backdrop in the real game world: a small group rides a surprise-me course while the camera cuts
// between cinematic shots (chase, side tracking, low front, roadside pan, drone, crane) with a fade through
// black. every few shots the scenery re-rolls (season, weather, villages...) behind the black.
// light on phones: fixed low resolution, ~30 fps, stopped while a game runs or the tab is hidden.
// falls back to the 2d scene (menu_bg.js) when webgl is not available.
import { create_kit, surprise_id } from './kit3d.js?v=45';
import { start_menu_bg } from './menu_bg.js?v=45';

const shot_s = 4.5;          // seconds per shot
const fade_s = 0.4;          // fade out / in through black
const shots_per_world = 5;   // re-roll the scenery after this many shots
const group_v = 20;          // visual speed of the group (m/s), like the games' 5x visual speed
const phone = matchMedia('(pointer: coarse)').matches;

// the group: you plus four riders around you (gap = metres behind you, x = side offset)
const pack = [
  { color: null, gap: 0, x: -0.6 },
  { color: '#e53935', gap: -2.2, x: 0.7 },
  { color: '#1e88e5', gap: 2.4, x: 0.9 },
  { color: '#43a047', gap: 4.6, x: -0.4 },
  { color: '#8e24aa', gap: -5.2, x: -0.2 },
];

// camera shots. each gets (kit, s = shot state, t = seconds into the shot, pz = your z) and places the camera
const tmp = { x: 0, y: 0, z: 0 };
// point beside the road at z: side offset, height above the road (never below the hillside + 0.8 m)
const at = (kit, z, side, h) => {
  tmp.x = kit.road_x(z) + side; tmp.z = z;
  tmp.y = Math.max(kit.road_y(z) + h, kit.ground(tmp.x, z) + Math.min(h, 0.8));
  return tmp;
};
const shots = {
  // classic chase behind you, like in a race
  chase: { wind: true, run(kit, s, t, pz, dt) { kit.chase({ z: pz, x: -0.3, speed: group_v, smooth: t < 0.2 ? 0 : 3 }, dt); } },
  // tracking beside the group, the riders slowly overtake the camera
  side: {
    fov: 42, run(kit, s, t, pz) {
      const p = at(kit, pz + 4 - t * 2, s.side * 8, 1.3); kit.camera.position.set(p.x, p.y, p.z);
      const l = at(kit, pz - 1, 0, 1.0); kit.camera.lookAt(l.x, l.y, l.z);
    },
  },
  // low in front of the group, looking back at the riders coming at you
  front: {
    fov: 50, run(kit, s, t, pz) {
      const p = at(kit, pz - 11 + t * 0.8, s.side * 1.6, 0.6); kit.camera.position.set(p.x, p.y, p.z);
      const l = at(kit, pz + 1.5, 0, 1.1); kit.camera.lookAt(l.x, l.y, l.z);
    },
  },
  // fixed roadside camera ahead: the group rides towards it and past it, the camera pans along
  roadside: {
    fov: 34, run(kit, s, t, pz) {
      s.z ??= pz - 55;
      const p = at(kit, s.z, s.side * 6.5, 1.6); kit.camera.position.set(p.x, p.y, p.z);
      const l = at(kit, pz, 0, 1.0); kit.camera.lookAt(l.x, l.y, l.z);
    },
  },
  // drone high behind, the landscape opens up ahead
  drone: {
    fov: 55, run(kit, s, t, pz) {
      const p = at(kit, pz + 14 - t * 1.2, s.side * (5 + t * 1.5), 12 + t * 1.6); kit.camera.position.set(p.x, p.y, p.z);
      const l = at(kit, pz - 12, 0, 0); kit.camera.lookAt(l.x, l.y, l.z);
    },
  },
  // crane: starts at wheel height beside you and rises over the group
  crane: {
    fov: 48, run(kit, s, t, pz) {
      const k = Math.min(1, t / shot_s), e = k * k * (3 - 2 * k);
      const p = at(kit, pz + 4 + e * 5, s.side * (2.5 + e * 3), 0.5 + e * 8); kit.camera.position.set(p.x, p.y, p.z);
      const l = at(kit, pz - 3 - e * 6, 0, 0.9 - e * 0.6); kit.camera.lookAt(l.x, l.y, l.z);
    },
  },
};
const order = Object.keys(shots);

export function start_menu3d(container, get_look) {
  const fade = document.createElement('div');
  fade.className = 'bg-fade';
  container.appendChild(fade);
  let canvas = null, kit = null, models = [], raf = 0, last = 0, running = false, want = true, failed = null;
  let d = 0, crank = 0, shot = null, shot_t = 0, shot_n = 0, look = get_look();

  // fresh canvas + world (the renderer moves to a new canvas each time: games use their own)
  function build() {
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'menu-bg-canvas';
      container.insertBefore(canvas, fade);
    }
    kit = create_kit(canvas, { theme: surprise_id, road_w: 7.6, lanes: 6, pixel_ratio: phone ? 0.75 : 1 });
    models = pack.map((r) => kit.add_rider(r.color ?? look));
    d = 0;
  }
  function teardown() {
    kit?.dispose();
    kit = null; models = [];
    canvas?.remove();
    canvas = null;
  }

  // next shot: a different one from the last, on a random side; re-roll the world now and then
  function next_shot() {
    shot_n++;
    if (shot_n % shots_per_world === 0) { kit.dispose(); build(); }
    const pool = order.filter((k) => k !== shot?.name);
    const name = pool[Math.floor(Math.random() * pool.length)];
    shot = { name, side: Math.random() < 0.5 ? -1 : 1 };
    shot_t = 0;
    kit.camera.fov = shots[name].fov ?? kit.camera.fov;
    kit.camera.updateProjectionMatrix();
  }

  function frame(dt) {
    d += group_v * dt;
    crank += dt * 9.4;   // ~90 rpm
    shot_t += dt;
    if (shot_t > shot_s) next_shot();
    const pz = -d;
    const sh = shots[shot.name];
    sh.run(kit, shot, shot_t, pz, dt);
    // riders: each drifts a little forward and back and side to side
    pack.forEach((r, i) => {
      const z = pz + r.gap + Math.sin(d * 0.0065 + i * 1.7) * 1.2;
      kit.place_rider(models[i], {
        z, x: r.x + Math.sin(d * 0.0045 + i) * 0.4, watts: 190 + i * 15, v: group_v, crank: crank + i * 1.3, dist: -z, ref: 200,
        fade: sh.wind ? kit.fade_for(z, pz) : 1,
      }, dt);
    });
    kit.frame(dt, { focus_z: pz, speed: sh.wind ? group_v : 0 });
    // fade through black around each cut
    const a = Math.max(0, 1 - shot_t / fade_s, 1 - (shot_s - shot_t) / fade_s);
    fade.style.opacity = a.toFixed(2);
  }

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (ts - last < 32) return;   // ~30 fps is plenty for a backdrop
    const dt = Math.min(0.1, (ts - last) / 1000);
    last = ts;
    try { frame(dt); } catch (e) { fall_back(e); }
  }

  function set_running(on) {
    on = on && !document.hidden;
    if (on === running) return;
    running = on;
    container.style.display = on ? 'block' : 'none';
    cancelAnimationFrame(raf);
    if (on) {
      if (!kit) { build(); shot = null; shot_n = 0; next_shot(); }
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
  }

  // no webgl (or it broke): the 2d scene instead
  function fall_back(e) {
    console.warn('menu backdrop: 3d failed, using 2d', e);
    cancelAnimationFrame(raf);
    running = false;
    try { teardown(); } catch { /* already gone */ }
    fade.remove();
    const cv = document.createElement('canvas');
    cv.className = 'menu-bg-canvas';
    container.appendChild(cv);
    container.style.display = 'block';
    failed = start_menu_bg(cv, get_look);
    failed.show(want);
  }
  const start = (on) => { try { set_running(on); } catch (e) { fall_back(e); } };

  // first build a moment after load, so the menu shows up before the world is built
  let ready = false;
  container.style.display = 'none';
  setTimeout(() => { ready = true; if (!failed) start(want); }, 300);
  addEventListener('resize', () => kit?.resize());
  document.addEventListener('visibilitychange', () => { if (ready && !failed) start(want); });

  return {
    // on in the menus; off in a game: the world is freed so the game gets the gpu to itself
    show(on) {
      if (failed) { failed.show(on); container.style.display = on ? 'block' : 'none'; return; }
      want = on;
      if (!ready) return;
      if (!on) { set_running(false); teardown(); } else start(true);
    },
    // new garage look: swap your rider
    set_look(lk) {
      look = lk;
      failed?.set_look(lk);
      if (!kit) return;
      kit.remove_rider(models[0]);
      models[0] = kit.add_rider(look);
    },
    // confetti burst over everything (podium, record, level up)
    celebrate() {
      const box = document.createElement('div');
      box.className = 'confetti';
      const cols = ['#ffd400', '#ff5252', '#3fa9f5', '#7ee08a', '#ff9f1a', '#e040fb'];
      box.innerHTML = Array.from({ length: 120 }, (_, k) => `<i style="left:${Math.random() * 100}%;background:${cols[k % cols.length]};`
        + `animation-delay:${(Math.random() * 0.8).toFixed(2)}s;animation-duration:${(2.2 + Math.random() * 1.6).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg"></i>`).join('');
      document.body.appendChild(box);
      setTimeout(() => box.remove(), 5000);
    },
  };
}
