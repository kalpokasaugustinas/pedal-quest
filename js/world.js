// 3d world with three.js: road, trees, hills, finish arch, low-poly riders, third-person chase camera.
// race coordinates: rider x (meters along the course) maps to world z = -x (forward = -z)
import * as THREE from 'three';

const lane_w = 1.1;                       // meters per lane
const lane_count = 6;
const road_w = lane_count * lane_w + 1;   // lanes + 0.5 m shoulder on each side
const lane_x = (lane) => (lane - (lane_count - 1) / 2) * lane_w;
const sky_color = '#a8d8f0';

let renderer = null;   // one renderer for the whole session, scenes are rebuilt per race

// ---- small helpers ----

// canvas -> texture
function canvas_texture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// unit cylinder stretched between two points (frame tubes, limbs)
const unit_cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
const y_axis = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
function make_bar(material, radius) {
  const m = new THREE.Mesh(unit_cyl, material);
  m.userData.radius = radius;
  return m;
}
function place_bar(mesh, a, b) {
  tmp.subVectors(b, a);
  const len = tmp.length();
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.scale.set(mesh.userData.radius, len, mesh.userData.radius);
  mesh.quaternion.setFromUnitVectors(y_axis, tmp.normalize());
}

// free gpu memory of the previous race scene
function dispose_scene(scene) {
  scene.traverse((o) => {
    if (o.geometry && o.geometry !== unit_cyl) o.geometry.dispose();
    for (const m of [].concat(o.material || [])) {
      m.map?.dispose();
      m.dispose();
    }
  });
}

// ---- static scenery ----

// asphalt with solid edge lines and dashed lane lines; one texture tile = 4 m of road
function road_texture() {
  return canvas_texture(512, 256, (g, w, h) => {
    g.fillStyle = '#3b3e44';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.1)';
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    const ppm = w / road_w;
    const line_w = 0.1 * ppm;
    for (let i = 0; i <= lane_count; i++) {
      const x = (0.5 + i * lane_w) * ppm - line_w / 2;
      const edge = i === 0 || i === lane_count;
      g.fillStyle = edge ? '#eeeeee' : 'rgba(255,255,255,0.55)';
      g.fillRect(x, 0, line_w, edge ? h : h / 2);   // dashes: 2 m line, 2 m gap
    }
  });
}

function text_texture(text, bg, fg, w = 512, h = 128) {
  return canvas_texture(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.font = `bold ${h * 0.6}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

function build_scenery(scene, race) {
  const length = race.distance_m + 400;            // road from 100 m behind start to 300 m past finish
  const center_z = 100 - length / 2;
  const max_aniso = renderer.capabilities.getMaxAnisotropy();

  // grass: big plane that follows the camera (plain color, so its movement is invisible)
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshLambertMaterial({ color: '#5f9a4a' }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.02;
  scene.add(grass);

  // road
  const tex = road_texture();
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, length / 4);
  tex.anisotropy = max_aniso;
  const road = new THREE.Mesh(new THREE.PlaneGeometry(road_w, length), new THREE.MeshLambertMaterial({ map: tex }));
  road.rotation.x = -Math.PI / 2;
  road.position.z = center_z;
  scene.add(road);

  // start line
  const start = new THREE.Mesh(new THREE.PlaneGeometry(road_w, 0.4), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  start.rotation.x = -Math.PI / 2;
  start.position.set(0, 0.005, 0);
  scene.add(start);

  // finish: checkered strip + arch with banner
  const checker = canvas_texture(64, 64, (g) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#111'; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
  });
  checker.wrapS = checker.wrapT = THREE.RepeatWrapping;
  checker.repeat.set(road_w / 0.5, 2);
  const finish = new THREE.Mesh(new THREE.PlaneGeometry(road_w, 1), new THREE.MeshBasicMaterial({ map: checker }));
  finish.rotation.x = -Math.PI / 2;
  finish.position.set(0, 0.006, -race.distance_m);
  scene.add(finish);
  const pole_mat = new THREE.MeshLambertMaterial({ color: '#dddddd' });
  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 10), pole_mat);
    pole.position.set(side * (road_w / 2 + 0.4), 2.5, -race.distance_m);
    scene.add(pole);
  }
  const red = new THREE.MeshLambertMaterial({ color: '#d32f2f' });
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(road_w + 1.2, 1.1, 0.15),
    [red, red, red, red, new THREE.MeshBasicMaterial({ map: text_texture('FINISH', '#d32f2f', '#ffffff', 1024, 160) }), red],
  );
  banner.position.set(0, 4.6, -race.distance_m);
  scene.add(banner);

  // distance boards every 500 m on the right side
  for (let m = 500; m < race.distance_m; m += 500) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), new THREE.MeshBasicMaterial({ map: text_texture(`${m / 1000} km`, '#ffffff', '#1b1b1b', 256, 96) }));
    board.position.set(road_w / 2 + 1.6, 1.6, -m);
    scene.add(board);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), pole_mat);
    post.position.set(road_w / 2 + 1.6, 0.65, -m);
    scene.add(post);
  }

  // trees on both sides (instanced: thousands of trees, two draw calls)
  const per_side = Math.ceil(length / 9);
  const count = per_side * 2;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.22, 1.6, 6), new THREE.MeshLambertMaterial({ color: '#6b4a2b' }), count);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.2, 3.2, 7), new THREE.MeshLambertMaterial({ color: '#ffffff' }), count);
  const greens = ['#2f6b3a', '#3a7d44', '#28603a', '#4a8c4f'].map((c) => new THREE.Color(c));
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? 1 : -1;
    const z = 100 - Math.floor(i / 2) * 9 - Math.random() * 8;
    const x = side * (road_w / 2 + 3 + Math.random() ** 2 * 35);
    const s = 0.7 + Math.random() * 0.8;
    m4.makeScale(s, s, s).setPosition(x, 0.8 * s, z);
    trunks.setMatrixAt(i, m4);
    m4.makeScale(s, s, s).setPosition(x, (1.6 + 1.5) * s, z);
    crowns.setMatrixAt(i, m4);
    crowns.setColorAt(i, greens[i % greens.length]);
  }
  scene.add(trunks, crowns);

  // distant hills: ring of flattened spheres that follows the camera (backdrop)
  const hills = new THREE.Group();
  const hill_mat = new THREE.MeshLambertMaterial({ color: '#7aa77e' });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), hill_mat);
    const r = 280 + (i % 3) * 40;
    hill.scale.set(70 + (i % 4) * 25, 25 + (i % 5) * 8, 60);
    hill.position.set(Math.cos(a) * r, -5, Math.sin(a) * r);
    hills.add(hill);
  }
  scene.add(hills);

  return { grass, hills };
}

// ---- riders ----

const shared_mats = {
  frame: new THREE.MeshLambertMaterial({ color: '#dcdcdc' }),
  tire: new THREE.MeshLambertMaterial({ color: '#151515' }),
  skin: new THREE.MeshLambertMaterial({ color: '#f1c27d' }),
  shorts: new THREE.MeshLambertMaterial({ color: '#222222' }),
  crank: new THREE.MeshLambertMaterial({ color: '#888888' }),
  shadow: new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false }),
};

// side-view coordinates (forward f, up u, sideways s) -> rider-local 3d point
const v = (f, u, s = 0) => new THREE.Vector3(s, u, -f);

const wheel_r = 0.34;
const geo = {
  bb: [-0.05, 0.3], hip: [-0.22, 1.0],
};

function make_wheel() {
  const w = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(wheel_r - 0.02, 0.025, 6, 24), shared_mats.tire);
  tire.rotation.y = Math.PI / 2;
  w.add(tire);
  // two spokes so the spin is visible
  for (const rot of [0, Math.PI / 2]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.01, wheel_r * 2 - 0.05, 0.02), shared_mats.crank);
    spoke.rotation.x = rot;
    w.add(spoke);
  }
  return w;
}

function make_rider(color) {
  const g = new THREE.Group();
  const jersey = new THREE.MeshLambertMaterial({ color });
  const add_bar = (mat, radius, a, b) => {
    const m = make_bar(mat, radius);
    if (a) place_bar(m, a, b);
    g.add(m);
    return m;
  };

  // blob shadow
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), shared_mats.shadow);
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(0.5, 1.1, 1);
  shadow.position.y = 0.01;
  g.add(shadow);

  // wheels
  const wheels = [-0.5, 0.52].map((f) => {
    const w = make_wheel();
    w.position.copy(v(f, wheel_r));
    g.add(w);
    return w;
  });

  // frame tubes
  const p = { rear: v(-0.5, 0.34), bb: v(...geo.bb), seat: v(-0.22, 0.92), bar: v(0.42, 0.98), front: v(0.52, 0.34) };
  const f = shared_mats.frame;
  add_bar(f, 0.02, p.rear, p.bb);
  add_bar(f, 0.022, p.bb, p.seat);
  add_bar(f, 0.018, p.seat, p.rear);
  add_bar(f, 0.022, p.seat, p.bar);
  add_bar(f, 0.025, p.bb, p.bar);
  add_bar(f, 0.02, p.bar, p.front);
  add_bar(f, 0.015, v(0.42, 0.98, -0.2), v(0.42, 0.98, 0.2));   // handlebar

  // body: torso, arms, head with helmet
  add_bar(jersey, 0.15, v(-0.22, 1.0), v(0.22, 1.4));
  for (const s of [-1, 1]) add_bar(jersey, 0.045, v(0.2, 1.38, s * 0.17), v(0.42, 0.99, s * 0.2));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), shared_mats.skin);
  head.position.copy(v(0.36, 1.56));
  g.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), jersey);
  helmet.position.copy(v(0.35, 1.58));
  g.add(helmet);

  // nitro flame behind the rear wheel, visible only while boosting
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.13, 0.7, 10),
    new THREE.MeshBasicMaterial({ color: '#ff8a00', transparent: true, opacity: 0.85, depthWrite: false }),
  );
  flame.rotation.x = Math.PI / 2;   // cone tip points backwards (+z)
  flame.position.copy(v(-0.95, 0.32));
  flame.visible = false;
  g.add(flame);

  // legs: posed every frame from the crank angle
  const legs = [-1, 1].map((s) => ({
    side: s * 0.11,
    thigh: add_bar(shared_mats.shorts, 0.065),
    shin: add_bar(shared_mats.shorts, 0.05),
    crank: add_bar(shared_mats.crank, 0.015),
  }));
  return { group: g, wheels, legs, flame };
}

// thigh + shin from hip to pedal; knee from two-segment inverse kinematics (side view, up positive)
function pose_leg(leg, angle) {
  const crank_len = 0.17, seg = 0.46;
  const [bx, by] = geo.bb, [hx, hy] = geo.hip;
  const fx = bx + crank_len * Math.cos(angle);
  const fy = by - crank_len * Math.sin(angle);   // minus: pedals turn forward over the top
  const dx = fx - hx, dy = fy - hy;
  const d = Math.hypot(dx, dy);
  const half = Math.min(d, 2 * seg - 0.001) / 2;
  const bend = Math.sqrt(seg * seg - half * half);
  const ux = dx / d, uy = dy / d;
  // perpendicular (-uy, ux) points the knee forward
  const kx = hx + ux * half - uy * bend, ky = hy + uy * half + ux * bend;
  const s = leg.side;
  place_bar(leg.thigh, v(hx, hy, s), v(kx, ky, s));
  place_bar(leg.shin, v(kx, ky, s), v(fx, fy, s));
  place_bar(leg.crank, v(bx, by, s), v(fx, fy, s));
}

// ---- public api ----

// build a fresh 3d world for this race; returns { render(dt), resize(), dispose() }
export function create_world(canvas, race) {
  // each game start gets a fresh canvas, so the renderer follows it
  if (!renderer || renderer.domElement !== canvas) {
    renderer?.dispose();
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.background = canvas_texture(4, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#4a9be0');
    grad.addColorStop(1, sky_color);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(sky_color, 80, 380);
  scene.add(new THREE.HemisphereLight('#ffffff', '#4f8a3c', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6);
  sun.position.set(-20, 40, 15);
  scene.add(sun);

  const scenery = build_scenery(scene, race);
  const riders = race.riders.map((r) => {
    const model = make_rider(r.color);
    scene.add(model.group);
    return { r, model };
  });

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 700);
  let base_fov = 60;
  let portrait = false;

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    portrait = h > w;
    // keep at least 62 degrees horizontal view, so a narrow portrait screen still shows the road
    const min_h_fov = (62 * Math.PI) / 180;
    base_fov = Math.max(55, (2 * Math.atan(Math.tan(min_h_fov / 2) / camera.aspect) * 180) / Math.PI);
    camera.fov = base_fov;
    camera.updateProjectionMatrix();
  }
  resize();

  function render(dt) {
    const boost = race.player.nitro.boost_left > 0;
    // pose riders
    for (const { r, model } of riders) {
      model.group.position.set(lane_x(r.lane), 0, -r.x);
      for (const w of model.wheels) w.rotation.x = r.x / wheel_r;
      model.legs.forEach((leg, i) => pose_leg(leg, r.crank + i * Math.PI));
      // flickering flame while this rider's nitro burns
      model.flame.visible = r.nitro.boost_left > 0;
      if (model.flame.visible) model.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
    }

    // chase camera behind the player, pulled slightly towards the road centre
    const p = race.player;
    const cx = lane_x(p.lane) * 0.5;
    // landscape looks down more, so the rider sits above the bottom hud
    const back = portrait ? 4.0 : 5.0, height = portrait ? 2.1 : 2.3;
    camera.position.set(cx, height, -p.x + back);
    camera.lookAt(cx, portrait ? 0.6 : -0.6, -p.x - (portrait ? 12 : 9));

    // nitro: widen the field of view for a rush of speed
    const target_fov = base_fov + (boost ? 12 : 0);
    camera.fov += (target_fov - camera.fov) * Math.min(1, dt * 5);
    camera.updateProjectionMatrix();

    scenery.grass.position.z = camera.position.z;
    scenery.hills.position.z = camera.position.z;
    renderer.render(scene, camera);
  }

  function dispose() {
    dispose_scene(scene);
  }

  return { render, resize, dispose };
}
