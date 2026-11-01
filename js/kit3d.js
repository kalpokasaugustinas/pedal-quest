// 3d scene kit shared by every game: a low-poly, flat-shaded world (think faceted landscape art) around a road
// that can curve (road_x) and climb (road_y). big faceted mountains with strong side light, layered pines with
// warm trunks, calm colours, lit clouds, campfires, wind streaks, and riders with body language.
// three scenery themes (meadow, valley, night).
import * as THREE from 'three';
import { seeded } from './util.js?v=20';

export const chunk_len = 120;              // terrain chunk length (visual meters)
const chunk_count = 11;                    // chunks alive at once: 1 behind the camera, 10 ahead (~1.2 km)

// ---- themes: colour palettes, light and props. strong key light + low ambient = contrasty facets ----
export const themes = {
  meadow: {
    name: 'Sunny meadow',
    sky: ['#3f9be0', '#bfe3f5'], fog: '#bfe0ee', fog_range: [90, 900],
    hemi: ['#d8e8f4', '#4a6a3a', 1.0], key: ['#ffe9cc', 2.7], key_dir: [-60, 55, 25],
    grass: ['#5fa62c', '#529a27', '#6db535', '#468c22', '#78bb3c'], high: ['#7f9a38', '#94844a'],
    mountain: ['#b08a68', '#9a7556', '#c9a582', '#86664c'], snow: '#f4f1ea', snow_line: 0.82,
    round: ['#55a52e', '#62b236', '#4a9628', '#70bb3e'], pine: ['#2f8530', '#287a2b', '#379238'],
    trunk: '#a8622f', rock: ['#a4a4a8', '#8e8f96'], mix: { round: 0.55, pine: 0.3, rock: 0.15 },
    asphalt: '#6c6f78', cloud: '#ffffff', cloud_glow: 0.25, stars: false, camps: 0.25,
  },
  valley: {
    name: 'Misty valley',
    sky: ['#a9c79f', '#eef0d4'], fog: '#d8e2c2', fog_range: [60, 720],
    hemi: ['#f0f2e0', '#40644a', 1.05], key: ['#fff0d6', 2.4], key_dir: [55, 45, 20],
    grass: ['#4c9a3c', '#418d35', '#58a646', '#3a8030', '#62ad4c'], high: ['#2f7f6a', '#286f5c'],
    mountain: ['#3f8f7a', '#2f7563', '#5aa38a', '#286a58'], snow: null, snow_line: 1,
    round: ['#5aa35a', '#4f9650'], pine: ['#2e7a58', '#28704f', '#358763'],
    trunk: '#8a5230', rock: ['#7d8a80', '#6d786f'], mix: { round: 0.12, pine: 0.7, rock: 0.18 },
    asphalt: '#6e6860', cloud: '#f6f7ea', cloud_glow: 0.3, stars: false, camps: 0.2,
  },
  night: {
    name: 'Starry night',
    sky: ['#081638', '#1e3a78'], fog: '#17305f', fog_range: [70, 800],
    hemi: ['#5470b4', '#1a3428', 0.75], key: ['#d6e0ff', 2.7], key_dir: [-55, 60, 20],
    grass: ['#2f9a3a', '#37a542', '#288c34', '#40b04a', '#24802f'], high: ['#22702f', '#34548a'],
    mountain: ['#3a5590', '#4a68a8', '#2c4478', '#5a7ac0'], snow: '#dfe9fb', snow_line: 0.78,
    round: ['#3f9f45', '#34903b'], pine: ['#2f9a3c', '#27883a', '#3aab45', '#2a7f35'],
    trunk: '#b8622a', rock: ['#5e6f96', '#4f5f86', '#6b7da6'], mix: { round: 0.05, pine: 0.8, rock: 0.15 },
    asphalt: '#3a3f56', cloud: '#c8d4f2', cloud_glow: 0.35, stars: true, camps: 0.55,
  },
};

let renderer = null;   // one renderer per canvas; each race builds a new scene

// ---- helpers ----

function canvas_texture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// deterministic hash of two integers -> [0, 1). same input = same output, so chunk seams line up
function hash2(ix, iz) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// smooth value noise in [0, 1]
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// random colour from a palette with a small brightness jitter (keeps facets distinct)
const tmp_color = new THREE.Color();
const mood = { sat: -0.16, light: 0.025 };   // calm, soft colours: applied to every palette colour
function palette_color(list, r, out = tmp_color) {
  out.set(list[Math.floor(r * list.length) % list.length]);
  out.offsetHSL(0, mood.sat, mood.light);
  out.offsetHSL(0, ((r * 13) % 1 - 0.5) * 0.06, ((r * 7) % 1 - 0.5) * 0.11);
  return out;
}

function flat_mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95, metalness: 0, ...extra });
}

// jitter vertices of a geometry for a hand-made faceted look (seeded). shared positions move together
function jitter(geom, amount, rnd, keep_base = false) {
  const p = geom.attributes.position;
  geom.computeBoundingBox();
  const min_y = geom.boundingBox.min.y;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) {
      const base = keep_base && Math.abs(p.getY(i) - min_y) < 1e-3;
      seen.set(key, [(rnd() - 0.5) * amount, base ? 0 : (rnd() - 0.5) * amount, (rnd() - 0.5) * amount]);
    }
    const [dx, dy, dz] = seen.get(key);
    p.setXYZ(i, p.getX(i) + dx, p.getY(i) + dy, p.getZ(i) + dz);
  }
  geom.computeVertexNormals();
  return geom;
}

// merge simple geometries into one (non-indexed), so a multi-part prop is one instanced mesh
function merge(geoms) {
  const parts = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  const pos = [];
  for (const g of parts) pos.push(...g.attributes.position.array);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
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

function dispose_scene(scene) {
  scene.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) {
      m.map?.dispose();
      m.dispose();
    }
  });
  scene.background?.dispose?.();
}


// ---- instanced props: trees, rocks, roadside posts ----

function make_props(scene, theme) {
  const per_chunk = 170;
  const n = per_chunk * chunk_count;
  const rnd = seeded(7);
  const mk = (geom, color, count = n, shadow = true) => {
    const m = new THREE.InstancedMesh(geom, flat_mat(color), count);
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.frustumCulled = false;   // instances move around; bounds would be stale
    scene.add(m);
    return m;
  };
  // round tree: two faceted blobs on a trunk
  const crown = merge([
    jitter(new THREE.IcosahedronGeometry(1.8, 1), 0.55, rnd).translate(0, 3.8, 0),
    jitter(new THREE.IcosahedronGeometry(1.25, 1), 0.4, rnd).translate(0.8, 5.0, 0.3),
    jitter(new THREE.IcosahedronGeometry(1.0, 1), 0.35, rnd).translate(-0.9, 4.5, -0.4),
  ]);
  const trunk = new THREE.CylinderGeometry(0.2, 0.32, 2.6, 5).translate(0, 1.3, 0);
  // pine: three stacked, slightly drooping cones (the classic low-poly pine)
  const pine = merge([
    jitter(new THREE.ConeGeometry(1.8, 2.6, 10, 2), 0.35, rnd, true).translate(0, 2.3, 0),
    jitter(new THREE.ConeGeometry(1.45, 2.3, 9, 2), 0.3, rnd, true).translate(0, 3.5, 0),
    jitter(new THREE.ConeGeometry(1.15, 2.1, 8, 2), 0.25, rnd, true).translate(0, 4.5, 0),
    jitter(new THREE.ConeGeometry(0.8, 2.0, 7, 2), 0.2, rnd, true).translate(0, 5.5, 0),
  ]);
  const pine_trunk = new THREE.CylinderGeometry(0.22, 0.3, 1.6, 5).translate(0, 0.8, 0);
  const rock = jitter(new THREE.DodecahedronGeometry(1, 1), 0.45, rnd).scale(1.2, 0.75, 1).translate(0, 0.35, 0);
  // roadside post with a reflector band
  const post = new THREE.BoxGeometry(0.12, 1.0, 0.12).translate(0, 0.5, 0);
  const posts_per_chunk = Math.ceil(chunk_len / 25) * 2 + 2;
  const tuft = merge([0, 2.1, 4.2].map((a) => new THREE.ConeGeometry(0.09, 0.45, 3).translate(Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12)));
  const tufts_per_chunk = 420;
  const bush = merge([
    jitter(new THREE.IcosahedronGeometry(0.7, 1), 0.25, rnd).scale(1, 0.75, 1).translate(0, 0.45, 0),
    jitter(new THREE.IcosahedronGeometry(0.5, 1), 0.2, rnd).scale(1, 0.75, 1).translate(0.55, 0.35, 0.2),
  ]);
  const bushes_per_chunk = 60;
  const props = {
    bushes_per_chunk, bush: mk(bush, '#ffffff', bushes_per_chunk * chunk_count),
    tufts_per_chunk, tuft: mk(tuft, '#ffffff', tufts_per_chunk * chunk_count, false),
    per_chunk, posts_per_chunk,
    crown: mk(crown, '#ffffff'), trunk: mk(trunk, theme.trunk),
    pine: mk(pine, '#ffffff'), pine_trunk: mk(pine_trunk, theme.trunk),
    rock: mk(rock, '#ffffff'),
    post: mk(post, '#f4f4f4', posts_per_chunk * chunk_count, false),
  };
  return props;
}

const m4 = new THREE.Matrix4();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
const quat = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const scl = new THREE.Vector3();
const vpos = new THREE.Vector3();

// ---- campfires with tents: warm glow on the ground, flickering flames, 2 real point lights ----

const glow_tex = () => canvas_texture(128, 128, (g, w) => {
  const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grad.addColorStop(0, 'rgba(255,190,90,0.95)');
  grad.addColorStop(0.35, 'rgba(255,140,40,0.45)');
  grad.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, w);
});

function make_camps(scene, theme) {
  const tex = glow_tex();
  const glow_mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const flame_mat = new THREE.MeshBasicMaterial({ color: '#ffb02e', fog: false });
  const core_mat = new THREE.MeshBasicMaterial({ color: '#fff3a0', fog: false });
  const log_mat = flat_mat('#6b3a1e');
  const tent_mats = ['#e8792e', '#3f6fd0', '#d84a3a'].map((c) => flat_mat(c));
  const stone_mat = flat_mat(theme.rock[0]);
  const rnd = seeded(99);
  const camps = Array.from({ length: chunk_count }, () => {
    const g = new THREE.Group();
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), glow_mat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.15;
    g.add(glow);
    for (const a of [0.5, -0.5, 1.6]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 5), log_mat);
      log.rotation.set(Math.PI / 2 - 0.25, a, 0);
      log.position.y = 0.15;
      log.castShadow = true;
      g.add(log);
    }
    for (let s = 0; s < 7; s++) {
      const st = new THREE.Mesh(jitter(new THREE.DodecahedronGeometry(0.18, 0), 0.08, rnd), stone_mat);
      st.position.set(Math.cos((s / 7) * 6.28) * 0.75, 0.08, Math.sin((s / 7) * 6.28) * 0.75);
      g.add(st);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.38, 1.1, 5), flame_mat);
    flame.position.y = 0.6;
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 5), core_mat);
    core.position.y = 0.45;
    g.add(flame, core);
    // a-frame tent: 4-sided pyramid stretched into a ridge tent
    const tent = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.7, 4), tent_mats[Math.floor(rnd() * 3)]);
    tent.scale.set(1, 1, 1.5);
    tent.rotation.y = Math.PI / 4;
    tent.position.set(3.2, 0.85, -1.5);
    tent.castShadow = true;
    tent.receiveShadow = true;
    g.add(tent);
    g.visible = false;
    scene.add(g);
    return { group: g, flame, core, light_pos: new THREE.Vector3() };
  });
  // two warm point lights are moved to the nearest visible fires each frame (fixed count = no shader rebuilds)
  const lights = [0, 1].map(() => {
    const l = new THREE.PointLight('#ff9a3c', 0, 26, 1.6);
    scene.add(l);
    return l;
  });
  return { camps, lights };
}

// ---- backdrop: big faceted mountains, lit clouds, stars ----

function make_backdrop(scene, theme) {
  const group = new THREE.Group();
  const rnd = seeded(42);
  const fog = new THREE.Color(theme.fog);
  // mountains are lit by the key light (strong facets) but skip scene fog; a light haze is baked in by distance
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, fog: false });
  const ring = [
    ...Array.from({ length: 14 }, (_, i) => ({ a: (i / 14) * Math.PI * 2, r: 430 + rnd() * 120, h: 260 + rnd() * 220, w: 150 + rnd() * 80 })),
    ...Array.from({ length: 16 }, (_, i) => ({ a: (i / 16 + 0.03) * Math.PI * 2, r: 720 + rnd() * 200, h: 300 + rnd() * 260, w: 220 + rnd() * 120 })),
  ];
  for (const m of ring) {
    const ahead = Math.abs(Math.atan2(Math.sin(m.a + Math.PI / 2), Math.cos(m.a + Math.PI / 2)));   // angle from straight ahead
    if (m.r < 600 && ahead < 0.45) m.r += 380;
    // a mountain = a main peak + a shoulder peak, both jittered for crisp facets
    const main = jitter(new THREE.ConeGeometry(m.w, m.h, 11, 7), m.w * 0.17, rnd, true);
    const sh_h = m.h * (0.55 + rnd() * 0.2);
    const shoulder = jitter(new THREE.ConeGeometry(m.w * 0.7, sh_h, 9, 5), m.w * 0.15, rnd, true)
      .translate(m.w * 0.55, (sh_h - m.h) / 2, m.w * 0.15);
    const g = merge([main, shoulder]);
    const p = g.attributes.position;
    const col = [];
    for (let t = 0; t < p.count; t += 3) {
      const cy = (p.getY(t) + p.getY(t + 1) + p.getY(t + 2)) / 3 / m.h + 0.5;   // 0 bottom .. 1 top
      palette_color(theme.mountain, rnd());
      if (theme.snow && cy > theme.snow_line - rnd() * 0.06) tmp_color.set(theme.snow);
      tmp_color.lerp(fog, Math.min(0.5, (m.r - 400) / 1600));   // farther = hazier
      for (let j = 0; j < 3; j++) col.push(tmp_color.r, tmp_color.g, tmp_color.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(Math.cos(m.a) * m.r, m.h / 2 - 30, Math.sin(m.a) * m.r);
    mesh.rotation.y = rnd() * 6.28;
    group.add(mesh);
  }
  scene.add(group);

  // big faceted clouds: clusters of squashed icosahedrons, lit plus a soft glow
  const clouds = new THREE.Group();
  const cloud_mat = new THREE.MeshStandardMaterial({ color: theme.cloud, flatShading: true, roughness: 1, fog: false, emissive: theme.cloud, emissiveIntensity: theme.cloud_glow });
  for (let i = 0; i < 10; i++) {
    const parts = [];
    const n = 4 + Math.floor(rnd() * 3);
    for (let j = 0; j < n; j++) {
      const r = 22 + rnd() * 20 - Math.abs(j - n / 2) * 4;
      parts.push(jitter(new THREE.IcosahedronGeometry(r, 0), r * 0.35, rnd).scale(1.2, 0.45, 0.8).translate(j * 26 - n * 13, rnd() * 6, rnd() * 12));
    }
    const c = new THREE.Mesh(merge(parts), cloud_mat);
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.6;   // mostly ahead of the riders
    const r = 420 + rnd() * 380;
    c.position.set(Math.cos(a) * r, 190 + rnd() * 140, Math.sin(a) * r);
    c.rotation.y = rnd() * 0.6 - 0.3;
    clouds.add(c);
  }
  scene.add(clouds);

  let stars = null;
  if (theme.stars) {
    const pts = [];
    for (let i = 0; i < 600; i++) {
      const a = rnd() * Math.PI * 2, e = 0.15 + rnd() * 1.3;
      pts.push(Math.cos(a) * Math.cos(e) * 1800, Math.sin(e) * 1800, Math.sin(a) * Math.cos(e) * 1800);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false }));
    scene.add(stars);
    const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(38, 1), new THREE.MeshBasicMaterial({ color: '#f6f2dc', fog: false }));
    moon.position.set(-700, 700, -1300);
    stars.add(moon);
  }
  return { group, clouds, stars };
}


// ---- riders: chunky low-poly cyclist on a road bike ----

// unit prism stretched between two points (tubes, limbs). 5 sides = visible facets
const unit_cyl = new THREE.CylinderGeometry(1, 1, 1, 7);
const y_axis = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
function make_bar(material, radius, radius_z = radius) {
  const m = new THREE.Mesh(unit_cyl, material);
  m.userData.radius = radius;
  m.userData.radius_z = radius_z;
  m.castShadow = true;
  return m;
}
function place_bar(mesh, a, b) {
  tmp.subVectors(b, a);
  const len = tmp.length();
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.scale.set(mesh.userData.radius, len, mesh.userData.radius_z);
  mesh.quaternion.setFromUnitVectors(y_axis, tmp.normalize());
}

// side-view coordinates (forward f, up u, sideways s) -> rider-local 3d point
const v = (f, u, s = 0) => new THREE.Vector3(s, u, -f);
const wheel_r = 0.35;
const geo = { bb: [-0.03, 0.3], hip: [-0.24, 1.0], shoulder: [0.24, 1.36], hand: [0.47, 1.0] };

function make_wheel(mats) {
  const w = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(wheel_r - 0.025, 0.035, 4, 12), mats.tire);
  tire.rotation.y = Math.PI / 2;
  tire.castShadow = true;
  // deep carbon-style rim in the rider's colour
  const rim = new THREE.Mesh(new THREE.TorusGeometry(wheel_r - 0.085, 0.045, 3, 12), mats.accent);
  rim.rotation.y = Math.PI / 2;
  rim.scale.set(1, 1, 0.5);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 6), mats.metal);
  hub.rotation.z = Math.PI / 2;
  w.add(tire, rim, hub);
  for (const rot of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.01, wheel_r * 2 - 0.16, 0.025), mats.metal);
    spoke.rotation.x = rot;
    w.add(spoke);
  }
  return w;
}

function make_rider(color) {
  const g = new THREE.Group();
  const c = new THREE.Color(color);
  // own materials per rider, so a rider can fade out near the camera
  const mats = {
    jersey: flat_mat(color),
    accent: flat_mat(c.clone().offsetHSL(0, 0, -0.18)),
    frame: flat_mat('#f2f2f2'),
    tire: flat_mat('#17171a'),
    skin: flat_mat('#e9b27f'),
    shorts: flat_mat('#1f2027'),
    metal: flat_mat('#9aa0a8'),
    white: flat_mat('#ffffff'),
    shoe: flat_mat('#f5f5f5'),
  };
  const add_bar = (mat, r, a, b, rz) => {
    const m = make_bar(mat, r, rz);
    if (a) place_bar(m, a, b);
    g.add(m);
    return m;
  };

  const wheels = [-0.52, 0.52].map((f) => {
    const w = make_wheel(mats);
    w.position.copy(v(f, wheel_r));
    g.add(w);
    return w;
  });

  // frame: chunky tubes, top tube sloping, fork + stem in the accent colour
  const p = { rear: v(-0.52, 0.35), bb: v(...geo.bb), seat: v(-0.2, 0.86), head: v(0.38, 0.86), head_low: v(0.42, 0.68), front: v(0.52, 0.35) };
  const f = mats.frame;
  add_bar(f, 0.024, p.rear, p.bb);
  add_bar(f, 0.03, p.bb, p.seat);
  add_bar(f, 0.02, p.seat, p.rear);
  add_bar(f, 0.03, p.seat, p.head);
  add_bar(f, 0.038, p.bb, p.head_low);
  add_bar(mats.accent, 0.035, p.head_low, v(0.4, 0.94));          // head tube
  add_bar(mats.accent, 0.022, p.head_low, p.front);                // fork
  add_bar(mats.accent, 0.022, v(0.4, 0.94), v(0.47, 0.98));        // stem
  add_bar(mats.tire, 0.018, v(0.47, 0.98, -0.21), v(0.47, 0.98, 0.21));   // handlebar
  for (const s of [-1, 1]) add_bar(mats.tire, 0.018, v(0.47, 0.98, s * 0.21), v(0.55, 0.88, s * 0.21));   // drops
  add_bar(mats.metal, 0.016, p.seat, v(-0.24, 0.98));              // seat post
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.28), mats.tire);
  saddle.position.copy(v(-0.22, 1.0));
  g.add(saddle);

  // upper body: its own group pivoting at the hips, so it can lean, rise out of the saddle and rock.
  // parts are built in rider coordinates, then re-based on the hip pivot
  const body = new THREE.Group();
  const add_body = (mesh) => { mesh.castShadow = true; body.add(mesh); return mesh; };
  const torso = add_body(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.58, 8), mats.jersey));
  torso.position.copy(v(0.02, 1.2));
  torso.rotation.x = -1.05;   // lean forward
  torso.scale.set(1.15, 1, 0.8);
  const stripe = add_body(new THREE.Mesh(new THREE.CylinderGeometry(0.162, 0.175, 0.07, 8), mats.white));
  stripe.position.copy(v(0.06, 1.23));
  stripe.rotation.x = -1.05;
  stripe.scale.set(1.16, 1, 0.81);
  const hips = add_body(new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), mats.shorts));
  hips.position.copy(v(...geo.hip));
  hips.scale.set(1.15, 0.8, 1);
  // head: skin, faceted aero helmet in the rider colour with a white vent and a dark visor
  const head = add_body(new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 1), mats.skin));
  head.position.copy(v(0.36, 1.5));
  const helmet = add_body(new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 1), mats.jersey));
  helmet.position.copy(v(0.33, 1.56));
  helmet.scale.set(0.95, 0.7, 1.35);
  const vent = add_body(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.3), mats.white));
  vent.position.copy(v(0.32, 1.66));
  const visor = add_body(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.06), mats.tire));
  visor.position.copy(v(0.46, 1.5));
  const hip0 = v(...geo.hip);
  for (const ch of body.children) ch.position.sub(hip0);
  body.position.copy(hip0);
  g.add(body);

  // arms: shoulder follows the body, hand stays on the hoods, elbow from a simple two-bone ik
  const arms = [-1, 1].map((s) => {
    const glove = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), mats.tire);
    glove.position.copy(v(geo.hand[0] + 0.03, geo.hand[1] - 0.01, s * 0.2));
    g.add(glove);
    return {
      side: s,
      shoulder_local: v(geo.shoulder[0], geo.shoulder[1], s * 0.19).sub(hip0),
      hand: glove.position.clone(),
      upper: add_bar(mats.jersey, 0.055),
      fore: add_bar(mats.skin, 0.042),
    };
  });

  // nitro flame behind the rear wheel, visible only while boosting
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 1.0, 6),
    new THREE.MeshBasicMaterial({ color: '#ff8a00', transparent: true, opacity: 0.9, depthWrite: false }),
  );
  flame.rotation.x = Math.PI / 2;
  flame.position.copy(v(-1.05, 0.34));
  flame.visible = false;
  g.add(flame);

  // legs: thigh + calf posed from the crank angle every frame, shoe on the pedal
  const legs = [-1, 1].map((s) => {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.24), mats.shoe);
    shoe.castShadow = true;
    g.add(shoe);
    return {
      side: s * 0.12,
      thigh: add_bar(mats.shorts, 0.075, null, null, 0.07),
      shin: add_bar(mats.skin, 0.05),
      crank: add_bar(mats.metal, 0.016),
      shoe,
    };
  });
  // the bike group sits inside a root group: the root is placed on the road, the bike rolls inside it
  const root = new THREE.Group();
  root.add(g);
  return {
    group: root, bike: g, body, arms, wheels, legs, flame, mats: Object.values(mats), faded: false,
    // smoothed animation state
    anim: { effort: 0.6, stand: 0, coast: 0, strain: 0, prev_v: 0, accel: 0, t: Math.random() * 10 },
  };
}

// thigh + shin from hip to pedal; knee from two-segment inverse kinematics (side view, up positive)
function pose_leg(leg, angle, hx = geo.hip[0], hy = geo.hip[1]) {
  const crank_len = 0.17, seg = 0.46;
  const [bx, by] = geo.bb;
  const fx = bx + crank_len * Math.cos(angle);
  const fy = by - crank_len * Math.sin(angle);
  const dx = fx - hx, dy = fy - hy;
  const d = Math.hypot(dx, dy);
  const half = Math.min(d, 2 * seg - 0.001) / 2;
  const bend = Math.sqrt(seg * seg - half * half);
  const ux = dx / d, uy = dy / d;
  const kx = hx + ux * half - uy * bend, ky = hy + uy * half + ux * bend;
  const s = leg.side;
  place_bar(leg.thigh, v(hx, hy, s), v(kx, ky, s));
  place_bar(leg.shin, v(kx, ky, s), v(fx, fy + 0.03, s));
  place_bar(leg.crank, v(bx, by, s), v(fx, fy, s));
  leg.shoe.position.copy(v(fx + 0.03, fy + 0.02, s * 1.15));
}

// arm: shoulder (moves with the body) to the fixed hand; elbow bends out and down
const arm_tmp = { sh: new THREE.Vector3(), d: new THREE.Vector3(), n: new THREE.Vector3(), el: new THREE.Vector3() };
function pose_arm(arm, body) {
  const seg = 0.3;
  const { sh, d, n, el } = arm_tmp;
  sh.copy(arm.shoulder_local).applyQuaternion(body.quaternion).add(body.position);
  d.subVectors(arm.hand, sh);
  const len = d.length();
  const half = Math.min(len, 2 * seg - 0.001) / 2;
  const bend = Math.sqrt(seg * seg - half * half);
  d.normalize();
  // bend direction: down and slightly outwards, made perpendicular to the arm
  n.set(arm.side * 0.3, -1, 0.25);
  n.addScaledVector(d, -n.dot(d)).normalize();
  el.copy(sh).addScaledVector(d, half).addScaledVector(n, bend);
  place_bar(arm.upper, sh, el);
  place_bar(arm.fore, el, arm.hand);
}

// body language from effort: ref_watts = what this rider can hold comfortably (ftp / bot average).
//  coasting -> sits up, slow breathing; steady -> small shoulder rock with each stroke;
//  hard / surging / nitro -> out of the saddle, bike rocks side to side, head down, heavy breathing
function animate_rider(model, r, dt, ref_watts, boost) {
  const a = model.anim;
  const k = (rate) => Math.min(1, dt * rate);   // smoothing factor
  a.t += dt;
  if (dt > 0) a.accel += ((r.v - a.prev_v) / dt - a.accel) * k(3);
  a.prev_v = r.v;
  const effort = r.watts / Math.max(ref_watts || 150, 50);
  a.effort += (effort - a.effort) * k(2.5);
  const coasting = r.watts < 15;
  const standing = boost || a.effort > 1.3 || (a.accel > 0.5 && a.effort > 0.95);
  a.coast += ((coasting ? 1 : 0) - a.coast) * k(2);
  a.stand += ((standing && !coasting ? 1 : 0) - a.stand) * k(3);
  a.strain += (Math.min(1, Math.max(0, (a.effort - 0.75) / 0.7)) * (1 - a.coast) - a.strain) * k(2);

  const crank = r.crank;
  const stroke = Math.sin(crank);   // one side-to-side cycle per pedal revolution
  // the bike rolls with the pedal stroke: tiny when seated, big when standing
  const roll = stroke * (0.015 + 0.03 * a.strain + 0.13 * a.stand);
  model.bike.rotation.z = roll;
  // upper body: sit up when coasting, head down when straining, rise + move forward when standing
  const b = model.body;
  const hx = geo.hip[0] + 0.14 * a.stand, hy = geo.hip[1] + 0.16 * a.stand;
  b.rotation.x = 0.22 * a.coast - 0.1 * a.strain - 0.12 * a.stand;
  b.rotation.z = -roll * 0.75 + stroke * 0.04 * a.strain;   // shoulders counter the bike, rocking with effort
  b.rotation.y = stroke * 0.05 * a.stand;
  const breathe = Math.sin(a.t * (1.6 + 6 * a.strain)) * (0.006 + 0.012 * a.strain);
  b.position.set(stroke * 0.03 * a.stand, hy + breathe, -hx);
  // legs follow the hips (standing lifts them), arms follow the shoulders
  model.legs.forEach((leg, i) => pose_leg(leg, crank + i * Math.PI, hx, hy));
  for (const arm of model.arms) pose_arm(arm, b);
}

// ---- wind streaks: short lines rushing past the camera, stronger with speed and nitro ----

function make_wind(scene) {
  const n = 190;
  const pos = new Float32Array(n * 6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, fog: false });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  scene.add(lines);
  let clock = 0;

  // random spot in a box around the road ahead of the camera (not right in front of the rider),
  // with its own spiral: radius, turn rate, phase and speed factor
  function spawn(p, anywhere = false) {
    do {
      p.x = (Math.random() - 0.5) * 20;
      p.y = 0.3 + Math.random() * 3.8;
    } while (Math.abs(p.x) < 1.4 && p.y < 2.5);
    p.z = anywhere ? -Math.random() * 80 : -60 - Math.random() * 25;
    p.r = 0.2 + Math.random() * 1.2;                    // swirl radius
    p.w = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 5);   // turn rate (rad/s), either direction
    p.ph = Math.random() * 6.28;
    p.k = 1.7 + Math.random() * 0.9;                    // faster than the ground: air rush
    return p;
  }
  const pts = Array.from({ length: n }, () => spawn({}, true));

  return {
    update(dt, cam_z, cam_x, vis_speed, boost) {
      clock += dt;
      const len = Math.min(7, 0.4 + vis_speed * 0.12) * (boost ? 1.6 : 1);
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const v = vis_speed * p.k * (boost ? 1.4 : 1);
        p.z += v * dt;
        if (p.z > 3) spawn(p);
        // head now, tail where the particle was a moment ago: the streak curves along the spiral
        const tail_t = clock - len / Math.max(v, 1);
        const a1 = p.w * clock + p.ph, a0 = p.w * tail_t + p.ph;
        const o = i * 6;
        pos[o] = cam_x + p.x + Math.cos(a1) * p.r; pos[o + 1] = p.y + Math.sin(a1) * p.r * 0.7; pos[o + 2] = cam_z + p.z;
        pos[o + 3] = cam_x + p.x + Math.cos(a0) * p.r; pos[o + 4] = p.y + Math.sin(a0) * p.r * 0.7; pos[o + 5] = cam_z + p.z - len;
      }
      g.attributes.position.needsUpdate = true;
      mat.opacity = Math.min(0.55, Math.max(0, (vis_speed - 5) / 40)) + (boost ? 0.3 : 0);
    },
  };
}

// ---- the kit: one low-poly world around a (possibly curving, climbing) road ----
//
// coordinates: forward = -z. the road centre line is road_x(z), its height road_y(z) (both in visual meters).
// games give positions as visual z and a sideways offset from the road centre.
//
// opts: { theme, road_w, lanes, road_x(z), road_y(z), surface(z) -> 'asphalt'|'gravel'|'dirt', camps, posts }
export function create_kit(canvas, opts = {}) {
  const theme = themes[opts.theme] || themes.meadow;
  const road_w = opts.road_w ?? 7.6;
  const lanes = opts.lanes ?? 6;
  const road_edge = road_w / 2;
  const road_x = opts.road_x || (() => 0);
  const road_y = opts.road_y || (() => 0);
  const surface = opts.surface || (() => 'asphalt');
  const flat_zones = [];   // { x, z, r }: clearings where the hills flatten out (e.g. a crossroads)

  if (!renderer || renderer.domElement !== canvas) {
    renderer?.dispose();
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // pcf + radius = soft, blurred shadow edges
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // deeper, filmic colours with soft highlights
  renderer.toneMappingExposure = 1.0;
  // calm colour grade: css filter on the canvas + warm soft-light tint + vignette layers on top of it
  canvas.classList.add('soft-grade');
  const mood_layers = [];
  for (const cls of ['mood-tint', 'mood-vignette']) {
    const d = document.createElement('div');
    d.className = cls;
    canvas.parentElement?.appendChild(d);
    mood_layers.push(d);
  }

  const scene = new THREE.Scene();
  scene.background = canvas_texture(4, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    // sky colours pulled towards the fog colour: a softer, hazier sky
    grad.addColorStop(0, '#' + new THREE.Color(theme.sky[0]).lerp(new THREE.Color(theme.fog), 0.2).getHexString());
    grad.addColorStop(0.7, '#' + new THREE.Color(theme.sky[1]).lerp(new THREE.Color(theme.fog), 0.3).getHexString());
    grad.addColorStop(1, theme.fog);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(theme.fog, ...theme.fog_range);
  const hemi = new THREE.HemisphereLight(theme.hemi[0], theme.hemi[1], theme.hemi[2]);
  scene.add(hemi);
  // key light from the side: lit facets vs shaded facets is the whole low-poly look
  const sun = new THREE.DirectionalLight(theme.key[0], theme.key[1]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 4;
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 500 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const sun_off = new THREE.Vector3(...theme.key_dir);

  // far ground under everything (beyond the terrain grid), same colour as the fog
  const base = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshBasicMaterial({ color: theme.fog }));
  base.rotation.x = -Math.PI / 2;
  scene.add(base);

  // ---- ground shape ----

  // hills relative to the road: flat along the road, rolling hills growing towards the sides (a valley).
  // flat zones (clearings) pull the hills down to road level
  function ground(x, z) {
    const rx = x - road_x(z);
    const ry = road_y(z);
    const d = Math.abs(rx) - (road_edge + 1.5);
    if (d <= 0) return ry - 0.05;
    let ramp = smoothstep(0, 40, d);
    for (const f of flat_zones) {
      const dist = Math.hypot(x - f.x, z - f.z);
      ramp *= smoothstep(f.r * 0.6, f.r, dist);
    }
    const n = vnoise(x / 50, z / 50) * 0.7 + vnoise(x / 16 + 31, z / 16) * 0.3;
    return ry - 0.05 + n * (5 + d * 0.3) * ramp;
  }
  const in_clearing = (x, z) => flat_zones.some((f) => Math.hypot(x - f.x, z - f.z) < f.r * 0.85);

  // x columns of the terrain grid, relative to the road centre: fine near the road, coarse far away
  const xs = (() => {
    const right = [road_edge - 0.05, road_edge + 1.5, road_edge + 3, road_edge + 5, road_edge + 7, road_edge + 9, road_edge + 12, road_edge + 15, road_edge + 19,
      road_edge + 24, road_edge + 30, 38, 46, 56, 68, 82, 98, 118, 142, 175, 220, 280, 360, 460, 600].filter((x, i, a) => i === 0 || x > a[i - 1]);
    return [...right.map((x) => -x).reverse(), ...right];
  })();
  const z_step = 5;
  const mid = xs.length / 2;

  function build_terrain(geom, z0) {
    const rows = Math.round(chunk_len / z_step);
    const row0 = Math.round(-z0 / z_step);
    const pos = [], col = [];
    const vtx = (ci, ri) => {
      const gx = xs[ci], gr = row0 + ri;
      // jitter interior columns sideways and every row along z (hash of global indices: seams match)
      const edge_col = ci === mid - 1 || ci === mid;
      const jx = edge_col ? 0 : (hash2(ci, gr) - 0.5) * Math.min(16, Math.abs(gx) * 0.14);
      const jz = edge_col ? 0 : (hash2(ci + 101, gr) - 0.5) * z_step * 0.7;
      const z = -gr * z_step + jz;
      const x = road_x(z) + gx + jx;
      return [x, ground(x, z), z];
    };
    for (let ri = 0; ri < rows; ri++) {
      for (let ci = 0; ci < xs.length - 1; ci++) {
        if (ci === mid - 1) continue;   // the road strip has no terrain
        const a = vtx(ci, ri), b = vtx(ci + 1, ri), c = vtx(ci, ri + 1), d = vtx(ci + 1, ri + 1);
        for (const tri of [[a, b, c], [b, d, c]]) {   // counter-clockwise seen from above
          const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3 - road_y(tri[0][2]);
          const r = hash2(Math.round(tri[0][0] * 10 + tri[1][2]), Math.round(tri[2][2] * 10 + cy * 7));
          const list = cy > 22 + r * 14 ? theme.high : theme.grass;
          palette_color(list, r);
          for (const p of tri) {
            pos.push(...p);
            col.push(tmp_color.r, tmp_color.g, tmp_color.b);
          }
        }
      }
    }
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
  }

  // ---- road: a ribbon per chunk following road_x / road_y, textured per surface ----

  const surfaces = {
    asphalt: { base: theme.asphalt, lines: true },
    gravel: { base: '#9a8f7e', lines: false, speckle: ['rgba(255,255,255,0.12)', 'rgba(60,50,40,0.18)'] },
    dirt: { base: '#8a6a48', lines: false, speckle: ['rgba(255,230,190,0.1)', 'rgba(50,30,15,0.2)'] },
  };
  const road_mats = {};
  for (const [k, s] of Object.entries(surfaces)) {
    const tex = canvas_texture(256, 256, (g, w, h) => {
      g.fillStyle = s.base;
      g.fillRect(0, 0, w, h);
      const sp = s.speckle || ['rgba(255,255,255,0.035)', 'rgba(0,0,0,0.07)'];
      for (let i = 0; i < 2200; i++) {
        g.fillStyle = sp[i % 2];
        g.fillRect(Math.random() * w, Math.random() * h, 2 + (s.lines ? 0 : Math.random() * 2), 2);
      }
      if (s.lines) {
        const ppm = w / road_w, line_w = 0.12 * ppm, lane_w = (road_w - 1) / lanes;
        for (let i = 0; i <= lanes; i++) {
          const x = (0.5 + i * lane_w) * ppm - line_w / 2;
          const edge = i === 0 || i === lanes;
          g.fillStyle = edge ? '#f2f2f2' : 'rgba(255,255,255,0.6)';
          g.fillRect(x, 0, line_w, edge ? h : h / 2);
        }
      } else {
        // wheel tracks: two slightly darker bands
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(w * 0.28, 0, w * 0.1, h);
        g.fillRect(w * 0.62, 0, w * 0.1, h);
      }
      opts.paint_road?.(g, w, h, k);
    });
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    road_mats[k] = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
  }

  // ribbon along a centre-line function: points every `step` m from z0 down to z1 (z1 < z0)
  function ribbon(z0, z1, cx, cy, width, step = 2.5) {
    const pos = [], uv = [], idx = [];
    const n = Math.max(1, Math.ceil((z0 - z1) / step));
    for (let i = 0; i <= n; i++) {
      const z = z0 - ((z0 - z1) * i) / n;
      const x = cx(z), y = cy(z);
      pos.push(x - width / 2, y, z, x + width / 2, y, z);
      uv.push(0, -z / 8, 1, -z / 8);
      if (i < n) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);   // counter-clockwise seen from above
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // ---- chunks: terrain + road + props + campfire, recycled around the camera ----

  const backdrop = make_backdrop(scene, theme);
  const props = make_props(scene, theme);
  const camps = opts.camps === false ? null : make_camps(scene, theme);
  const terrain_mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  const chunks = Array.from({ length: chunk_count }, (_, slot) => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), terrain_mat);
    mesh.receiveShadow = true;
    const road = new THREE.Mesh(new THREE.BufferGeometry(), road_mats.asphalt);
    road.receiveShadow = true;
    scene.add(mesh, road);
    return { slot, mesh, road, index: null };
  });
  let road_end = -Infinity;   // games can stop the road (e.g. at a fork): no road beyond this z

  const set_inst = (mesh, i, x, y, z, s, sy, rot, color) => {
    quat.setFromAxisAngle(up, rot);
    mesh.setMatrixAt(i, m4.compose(vpos.set(x, y, z), quat, scl.set(s, s * sy, s)));
    if (color) mesh.setColorAt(i, color);
  };

  function fill_props(slot, chunk_i, z0) {
    const rnd = seeded(chunk_i * 7919 + 13);
    const base_i = slot * props.per_chunk;
    // random spot beside the road: side offset from the road centre
    const spot = (min, spread) => {
      const z = z0 - rnd() * chunk_len;
      const side = rnd() < 0.5 ? -1 : 1;
      return { z, rx: side * (road_edge + min + spread) };
    };
    for (let k = 0; k < props.per_chunk; k++) {
      const i = base_i + k;
      for (const m of [props.crown, props.trunk, props.pine, props.pine_trunk, props.rock]) m.setMatrixAt(i, hidden);
      // most trees line the road (a forest corridor), the rest scatter over the hills
      const near = rnd() < 0.6;
      const { z, rx } = spot(4, near ? rnd() * 40 : 40 + rnd() ** 1.3 * 260);
      const x = road_x(z) + rx;
      const s = (1.0 + rnd() * 0.9) * (1 + Math.abs(rx) / 220);
      const sy = 0.9 + rnd() * 0.6;   // some pines are much taller
      const rot = rnd() * 6.28;
      const kind = rnd();
      const cr = rnd();
      if (in_clearing(x, z)) continue;   // keep clearings (forks) open
      const y = ground(x, z) - 0.15;
      if (kind < theme.mix.round) {
        set_inst(props.crown, i, x, y, z, s, sy, rot, palette_color(theme.round, cr));
        set_inst(props.trunk, i, x, y, z, s, sy, rot);
      } else if (kind < theme.mix.round + theme.mix.pine) {
        set_inst(props.pine, i, x, y, z, s * 1.15, sy * 1.25, rot, palette_color(theme.pine, cr));
        set_inst(props.pine_trunk, i, x, y, z, s * 1.15, 1, rot);
      } else {
        set_inst(props.rock, i, x, y, z, s * (0.5 + cr * 0.9), 1, rot, palette_color(theme.rock, cr));
      }
    }
    // bushes in the verge and under the trees
    const bb = slot * props.bushes_per_chunk;
    for (let k = 0; k < props.bushes_per_chunk; k++) {
      const { z, rx } = spot(2, rnd() ** 1.3 * 45);
      const x = road_x(z) + rx;
      const s = 0.7 + rnd() * 1.1, rot = rnd() * 6.28, cr = rnd();
      if (in_clearing(x, z)) { props.bush.setMatrixAt(bb + k, hidden); continue; }
      set_inst(props.bush, bb + k, x, ground(x, z) - 0.1, z, s, 1, rot, palette_color(theme.round, cr).offsetHSL(0, 0, -0.04));
    }
    // grass tufts close to the road: small detail that reads as texture at speed
    const tb = slot * props.tufts_per_chunk;
    for (let k = 0; k < props.tufts_per_chunk; k++) {
      const { z, rx } = spot(0.4, rnd() ** 1.5 * 30);
      const x = road_x(z) + rx;
      set_inst(props.tuft, tb + k, x, ground(x, z) - 0.05, z, 0.8 + rnd() * 1.4, 0.7 + rnd(), rnd() * 6.28,
        palette_color(theme.grass, rnd()).offsetHSL(0, 0.05, -0.08));
    }
    // white roadside posts every 25 m: strong speed cue (only where there is a road)
    const pb = slot * props.posts_per_chunk;
    let k = 0;
    const first = Math.ceil(-z0 / 25) * 25;
    for (let d = first; d < -z0 + chunk_len && k < props.posts_per_chunk - 1; d += 25) {
      if (opts.posts === false || -d < road_end) continue;
      for (const side of [-1, 1]) props.post.setMatrixAt(pb + k++, m4.makeTranslation(road_x(-d) + side * (road_edge + 0.7), road_y(-d), -d));
    }
    while (k < props.posts_per_chunk) props.post.setMatrixAt(pb + k++, hidden);
    for (const m of Object.values(props)) {
      if (m.isInstancedMesh) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }

  function place_camp(slot, chunk_i, z0) {
    if (!camps) return;
    const c = camps.camps[slot];
    const rnd = seeded(chunk_i * 104729 + 5);
    c.group.visible = rnd() < theme.camps;
    if (!c.group.visible) return;
    const side = rnd() < 0.5 ? -1 : 1;
    const rx = side * (road_edge + 7 + rnd() * 5);
    const z = z0 - 15 - rnd() * (chunk_len - 30);
    const x = road_x(z) + rx;
    if (in_clearing(x, z)) { c.group.visible = false; return; }
    c.group.position.set(x, ground(x, z), z);
    c.group.rotation.y = side < 0 ? 0 : Math.PI;   // tent on the far side of the fire
  }

  function build_chunk(c, i) {
    c.index = i;
    const z0 = -i * chunk_len;
    c.mesh.geometry.dispose();   // fresh geometry: frees the old gpu buffers
    c.mesh.geometry = new THREE.BufferGeometry();
    build_terrain(c.mesh.geometry, z0);
    c.road.geometry.dispose();
    const z1 = Math.max(z0 - chunk_len, road_end);
    c.road.visible = z1 < z0;
    c.road.geometry = c.road.visible ? ribbon(z0, z1, road_x, (z) => road_y(z) + 0.01, road_w) : new THREE.BufferGeometry();
    c.road.material = road_mats[surface(z0 - chunk_len / 2)] || road_mats.asphalt;
    fill_props(c.slot, i, z0);
    place_camp(c.slot, i, z0);
  }

  // keep the chunk window around the camera: chunk i covers visual z in [-(i+1)L, -iL]
  function update_chunks(cam_z, behind = 1) {
    const first = Math.floor(-cam_z / chunk_len) - behind;
    const wanted = new Set(Array.from({ length: chunk_count }, (_, k) => first + k));
    const free = chunks.filter((c) => !wanted.has(c.index));
    for (const i of wanted) {
      if (chunks.some((c) => c.index === i)) continue;
      build_chunk(free.pop(), i);
    }
  }

  // campfires: flicker, and give the two warm lights to the nearest fires in front of the camera
  function update_camps(cam_z) {
    if (!camps) return;
    const lit = camps.camps
      .filter((c) => c.group.visible && c.group.position.z < cam_z + 10 && c.group.position.z > cam_z - 140)
      .sort((a, b) => b.group.position.z - a.group.position.z);
    camps.lights.forEach((l, i) => {
      const c = lit[i];
      l.intensity = c ? 55 * (0.85 + Math.random() * 0.3) : 0;
      if (c) l.position.set(c.group.position.x, c.group.position.y + 1.4, c.group.position.z);
    });
    for (const c of camps.camps) {
      if (!c.group.visible) continue;
      const f = 0.85 + Math.random() * 0.35;
      c.flame.scale.set(f, 0.8 + Math.random() * 0.5, f);
      c.core.scale.set(1, 0.8 + Math.random() * 0.4, 1);
    }
  }

  const wind = make_wind(scene);

  const dust_n = 500;
  const dust = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1, transparent: true, opacity: 0.6, depthWrite: false }), dust_n);
  dust.frustumCulled = false;
  scene.add(dust);
  for (let i = 0; i < dust_n; i++) dust.setMatrixAt(i, hidden);
  const puffs = Array.from({ length: dust_n }, () => ({ life: 0, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, spin: 0 }));
  let next_puff = 0;
  const dust_color = new THREE.Color();

  // one puff at a wheel; level 1 = 2x ftp (dust), level 2 = 3x ftp (big cloud)
  function spawn_puff(x, y, z, level, color) {
    const idx = next_puff;
    const p = puffs[idx];
    next_puff = (next_puff + 1) % dust_n;
    p.x = x + (Math.random() - 0.5) * 0.3;
    p.y = y + 0.08;
    p.z = z;
    p.vx = (Math.random() - 0.5) * (level > 1 ? 2.4 : 1.4);
    p.vy = 0.4 + Math.random() * (level > 1 ? 1.6 : 0.9);
    p.vz = 1 + Math.random() * 2;   // kicked backwards
    p.size = (level > 1 ? 0.3 : 0.16) * (0.7 + Math.random() * 0.6);
    p.life = (level > 1 ? 1.1 : 0.7) + Math.random() * 0.6;
    p.age = 0;
    p.spin = Math.random() * 6.28;
    dust.setColorAt(idx, dust_color.set(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.08));
  }

  function update_dust(dt) {
    for (let i = 0; i < dust_n; i++) {
      const p = puffs[i];
      if (p.age >= p.life) continue;
      p.age += dt;
      if (p.age >= p.life) { dust.setMatrixAt(i, hidden); continue; }
      const drag = Math.pow(0.25, dt);
      p.vx *= drag; p.vz *= drag; p.vy *= Math.pow(0.6, dt);
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = p.age / p.life;
      const sc = p.size * (1 + 2.6 * t) * (1 - t * t * t);   // billows out, then dissolves
      quat.setFromAxisAngle(up, p.spin + t * 2);
      dust.setMatrixAt(i, m4.compose(vpos.set(p.x, p.y, p.z), quat, scl.set(sc, sc * 0.8, sc)));
    }
    dust.instanceMatrix.needsUpdate = true;
    if (dust.instanceColor) dust.instanceColor.needsUpdate = true;
  }

  // ---- camera ----

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3200);
  let base_fov = 60;
  let portrait = false;
  let t_total = 0;
  const cam_pos = new THREE.Vector3(0, 3, 6), cam_look = new THREE.Vector3(0, 1, -10);
  let cam_ready = false;

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    portrait = h > w;
    const min_h_fov = (62 * Math.PI) / 180;
    base_fov = Math.max(55, (2 * Math.atan(Math.tan(min_h_fov / 2) / camera.aspect) * 180) / Math.PI);
    camera.fov = base_fov;
    camera.updateProjectionMatrix();
  }
  resize();

  // road direction at z: yaw angle (0 = straight ahead) and climb angle
  const heading = (z) => -Math.atan((road_x(z - 1) - road_x(z + 1)) / 2);
  const pitch = (z) => Math.atan((road_y(z - 1) - road_y(z + 1)) / 2);

  // chase camera behind a target that follows the road; c = { z, x (offset from road centre), back, height,
  // look_ahead, look_y, smooth, fov_add, speed (visual m/s), boost, reverse (look back at the rider) }
  const tmpv = new THREE.Vector3();
  function chase(c, dt) {
    const back = c.back ?? (portrait ? 4.2 : 5.2), height = c.height ?? (portrait ? 2.1 : 2.4);
    const ahead = c.look_ahead ?? (portrait ? 12 : 9);
    const yaw = heading(c.z);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // forward unit vector on the ground
    const tx = road_x(c.z) + (c.x ?? 0), ty = c.y ?? road_y(c.z);
    const dir = c.reverse ? -1 : 1;
    tmpv.set(tx - fx * back * dir, ty + height, c.z - fz * back * dir);
    const k = cam_ready && c.smooth ? Math.min(1, dt * c.smooth) : 1;
    cam_pos.lerp(tmpv, k);
    tmpv.set(tx + fx * ahead * dir, ty + (c.look_y ?? (portrait ? 0.7 : -0.4)), c.z + fz * ahead * dir);
    cam_look.lerp(tmpv, k);
    cam_ready = true;
    const speed = c.speed ?? 0;
    const shake = Math.min(1, speed / 30) * (c.boost ? 0.04 : 0.012);
    camera.position.set(cam_pos.x + Math.sin(t_total * 31) * shake, cam_pos.y + Math.sin(t_total * 23) * shake, cam_pos.z);
    camera.lookAt(cam_look);
    const target_fov = base_fov + (c.boost ? 14 : 0) + Math.min(6, speed / 8) + (c.fov_add ?? 0);
    camera.fov += (target_fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }

  // ---- riders ----

  const riders = [];
  function add_rider(color) {
    const model = make_rider(color);
    model.group.rotation.order = 'YXZ';
    scene.add(model.group);
    riders.push(model);
    return model;
  }

  // place + animate a rider. s = { z, x (offset from road centre), watts, v, crank, ref, boost, fade, dist (for wheels) }
  function place_rider(model, s, dt) {
    const x = road_x(s.z) + (s.x ?? 0);
    model.group.position.set(x, s.y ?? road_y(s.z), s.z);
    model.group.rotation.y = heading(s.z) + (s.yaw ?? 0);
    model.group.rotation.x = pitch(s.z);
    for (const w of model.wheels) w.rotation.x = (s.dist ?? -s.z) / wheel_r;
    animate_rider(model, s, dt, s.ref, !!s.boost);
    // tyre dust (gravel / dirt) or smoke (asphalt) when pushing 2x ftp; a big cloud at 3x
    const effort = (s.watts ?? 0) / Math.max(s.ref || 150, 50);
    if (effort >= 2 && dt > 0) {
      const level = effort >= 3 ? 2 : 1;
      model.dust_acc = (model.dust_acc ?? 0) + (level > 1 ? 80 : 30) * Math.min(dt, 0.1);
      const yaw = model.group.rotation.y;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const color = surface(s.z) === 'asphalt' ? '#d8d8d8' : '#c9b38c';
      while (model.dust_acc >= 1) {
        model.dust_acc -= 1;
        const wheel = Math.random() < 0.7 ? -0.52 : 0.52;   // mostly the rear wheel
        spawn_puff(x + fx * wheel, model.group.position.y, s.z + fz * wheel, level, color);
      }
    }
    model.flame.visible = !!s.boost;
    if (model.flame.visible) model.flame.scale.set(1, 0.8 + Math.random() * 0.6, 1);
    // riders between the camera and the target fade out, so they never block the view
    const fade = s.fade ?? 1;
    const faded = fade < 0.999;
    if (faded || model.faded) {
      for (const m of model.mats) { m.transparent = faded; m.opacity = faded ? fade : 1; m.depthWrite = !faded; }
      model.faded = faded;
    }
  }

  // fade factor for a rider at z when the camera follows a target at target_z (1 = fully visible)
  function fade_for(z, target_z, back) {
    const cz = target_z + (back ?? (portrait ? 4.2 : 5.2));
    const near = Math.max(0, Math.min(1, (cz - z - 1.0) / 2.2));
    return 0.05 + 0.95 * near * near;
  }

  // ---- course furniture ----

  const furniture = [];
  const keep = (o) => { scene.add(o); furniture.push(o); return o; };

  // finish (or summit) arch with a checkered line across the road at z
  function add_arch(z, text = 'FINISH', color = '#d84343') {
    const g = new THREE.Group();
    const checker = canvas_texture(64, 64, (c) => {
      c.fillStyle = '#fff'; c.fillRect(0, 0, 64, 64);
      c.fillStyle = '#111'; c.fillRect(0, 0, 32, 32); c.fillRect(32, 32, 32, 32);
    });
    checker.wrapS = checker.wrapT = THREE.RepeatWrapping;
    checker.repeat.set(road_w / 0.5, 2);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(road_w, 1), new THREE.MeshBasicMaterial({ map: checker }));
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.03;
    g.add(line);
    const pole_mat = flat_mat('#e8e8e8');
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 5.2, 6), pole_mat);
      pole.position.set(side * (road_edge + 0.5), 2.6, 0);
      pole.castShadow = true;
      g.add(pole);
    }
    const m = flat_mat(color);
    const banner = new THREE.Mesh(new THREE.BoxGeometry(road_w + 1.6, 1.2, 0.2),
      [m, m, m, m, new THREE.MeshBasicMaterial({ map: text_texture(text, color, '#ffffff', 1024, 160) }), m]);
    banner.position.set(0, 4.8, 0);
    banner.castShadow = true;
    g.add(banner);
    g.position.set(road_x(z), road_y(z), z);
    g.rotation.y = heading(z);
    return keep(g);
  }

  // roadside board on a post (distance markers, shelters...)
  function add_board(z, text, side = 1, bg = '#ffffff', fg = '#1b1b1b', w = 1.8) {
    const g = new THREE.Group();
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.7), new THREE.MeshBasicMaterial({ map: text_texture(text, bg, fg, 256 * (w / 1.8), 96) }));
    board.position.y = 1.8;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.45, 5), flat_mat('#e8e8e8'));
    post.position.y = 0.72;
    g.add(board, post);
    const x = road_x(z) + side * (road_edge + 1.8);
    g.position.set(x, ground(x, z), z);
    g.rotation.y = heading(z);
    return keep(g);
  }

  // signpost with an arrow board (canvas drawn by the game), pointing along `yaw`
  function add_sign(x, z, draw, yaw = 0, w = 2.6, h = 1.5) {
    const g = new THREE.Group();
    const tex = canvas_texture(512, Math.round(512 * (h / w)), draw);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    board.position.y = 1.6 + h / 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.6 + h / 2, 5), flat_mat('#7a5232'));
    post.position.y = (1.6 + h / 2) / 2;
    post.castShadow = true;
    g.add(board, post);
    g.position.set(x, ground(x, z), z);
    g.rotation.y = yaw;
    return keep(g);
  }

  // a trail (side road) along points [{x, z}], draped on the ground. used for crossroads branches
  function add_trail(pts, width, surf = 'gravel') {
    const pos = [], uv = [], idx = [];
    let along = 0;
    pts.forEach((p, i) => {
      const q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
      const dx = q.x - o.x, dz = q.z - o.z, len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len;   // sideways normal
      if (i > 0) along += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      for (const s of [-1, 1]) {
        const x = p.x + (nx * width * s) / 2, z = p.z + (nz * width * s) / 2;
        pos.push(x, ground(x, z) + 0.04, z);
      }
      uv.push(0, along / 8, 1, along / 8);
      if (i < pts.length - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, road_mats[surf] || road_mats.gravel);
    mesh.material.side = THREE.DoubleSide;
    mesh.receiveShadow = true;
    return keep(mesh);
  }

  function remove(o) {
    scene.remove(o);
    o.traverse((c) => { c.geometry?.dispose(); });
    const i = furniture.indexOf(o);
    if (i >= 0) furniture.splice(i, 1);
  }

  // rebuild chunks that overlap [z_far, z_near] (after road_x / flat zones / road_end change)
  function invalidate(z_near = Infinity, z_far = -Infinity) {
    for (const c of chunks) {
      if (c.index === null) continue;
      const c0 = -c.index * chunk_len, c1 = c0 - chunk_len;
      if (c1 <= z_near && c0 >= z_far) build_chunk(c, c.index);
    }
  }

  // ---- frame ----

  // f = { focus_z (where the action is), speed (visual m/s for wind), boost, look_back (camera looks backwards) }
  function frame(dt, f) {
    t_total += dt;
    const cz = camera.position.z, cx = camera.position.x;
    update_chunks(f.look_back ? cz : Math.min(cz, f.focus_z + 10), f.look_back ? 5 : 1);
    update_camps(cz);
    wind.update(dt, cz, cx, f.speed ?? 0, !!f.boost);
    update_dust(dt);
    backdrop.group.position.set(cx, road_y(cz), cz);
    backdrop.clouds.position.set(cx + Math.sin(t_total * 0.01) * 60, road_y(cz), cz);
    if (backdrop.stars) backdrop.stars.position.set(cx, 0, cz);
    base.position.set(cx, road_y(cz) - 1.5, cz);
    const fz = f.focus_z;
    sun.target.position.set(road_x(fz - 45), road_y(fz - 45), fz - 45);
    sun.position.copy(sun.target.position).add(sun_off);
    renderer.render(scene, camera);
  }

  function dispose() {
    dispose_scene(scene);
    for (const d of mood_layers) d.remove();
    canvas.classList.remove('soft-grade');
  }

  return {
    THREE, scene, camera, theme, hemi, sun, ground, road_x, road_y, heading, road_w, road_edge,
    get portrait() { return portrait; },
    set_road_end(z) { road_end = z; },
    add_flat_zone(x, z, r) { flat_zones.push({ x, z, r }); },
    clear_flat_zones() { flat_zones.length = 0; },
    add_rider, place_rider, fade_for, chase, add_arch, add_board, add_sign, add_trail, remove, invalidate,
    frame, resize, dispose,
  };
}

// shared "scenery" option for every 3d game
export const scenery_option = (def = 'meadow') => ({ key: 'scenery', label: 'Scenery', choices: Object.entries(themes).map(([id, t]) => [id, t.name]), def });
