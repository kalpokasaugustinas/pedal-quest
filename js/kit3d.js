// 3d scene kit shared by every game: a low-poly, flat-shaded world (think faceted landscape art) around a road
// that can curve (road_x) and climb (road_y). big faceted mountains with strong side light, layered pines with
// warm trunks, calm colours, drifting lit clouds, campfires, boulders, elk and deer, hikers, birds, wind streaks,
// and riders with body language.
// three scenery themes (meadow, valley, night).
import * as THREE from 'three';
import { seeded } from './util.js?v=32';

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
    asphalt: '#6c6f78', cloud: '#ffffff', cloud_glow: 0.25, stars: false, camps: 0.25, animals: 0.5, hikers: 0.4, birds: true,
  },
  valley: {
    name: 'Misty valley',
    sky: ['#a9c79f', '#eef0d4'], fog: '#d8e2c2', fog_range: [60, 720],
    hemi: ['#f0f2e0', '#40644a', 1.05], key: ['#fff0d6', 2.4], key_dir: [55, 45, 20],
    grass: ['#4c9a3c', '#418d35', '#58a646', '#3a8030', '#62ad4c'], high: ['#2f7f6a', '#286f5c'],
    mountain: ['#3f8f7a', '#2f7563', '#5aa38a', '#286a58'], snow: null, snow_line: 1,
    round: ['#5aa35a', '#4f9650'], pine: ['#2e7a58', '#28704f', '#358763'],
    trunk: '#8a5230', rock: ['#7d8a80', '#6d786f'], mix: { round: 0.12, pine: 0.7, rock: 0.18 },
    asphalt: '#6e6860', cloud: '#f6f7ea', cloud_glow: 0.3, stars: false, camps: 0.2, animals: 0.55, hikers: 0.35, birds: true,
  },
  night: {
    name: 'Starry night',
    sky: ['#081638', '#1e3a78'], fog: '#17305f', fog_range: [70, 800],
    hemi: ['#5470b4', '#1a3428', 0.75], key: ['#d6e0ff', 2.7], key_dir: [-55, 60, 20],
    grass: ['#2f9a3a', '#37a542', '#288c34', '#40b04a', '#24802f'], high: ['#22702f', '#34548a'],
    mountain: ['#3a5590', '#4a68a8', '#2c4478', '#5a7ac0'], snow: '#dfe9fb', snow_line: 0.78,
    round: ['#3f9f45', '#34903b'], pine: ['#2f9a3c', '#27883a', '#3aab45', '#2a7f35'],
    trunk: '#b8622a', rock: ['#5e6f96', '#4f5f86', '#6b7da6'], mix: { round: 0.05, pine: 0.8, rock: 0.15 },
    asphalt: '#3a3f56', cloud: '#c8d4f2', cloud_glow: 0.35, stars: true, camps: 0.55, animals: 0.4, hikers: 0.25, birds: false,
  },
};

// ---- surprise me: every ride rolls a theme, a season, the weather, maybe a sunset ride, rivers, lakes, villages ----

const pick = (list) => { let r = Math.random() * list.reduce((a, x) => a + x[1], 0); for (const [v, w] of list) { r -= w; if (r <= 0) return v; } return list[0][0]; };
const shift = (list, h, sat, l) => list.map((c) => '#' + new THREE.Color(c).offsetHSL(h, sat, l).getHexString());

// season on top of a theme: autumn = warm leaves and dry grass, winter = snow on the ground, trees and peaks
function season_theme(base, season) {
  const t = { ...base };
  if (season === 'autumn') {
    t.round = ['#d9772b', '#e3a83a', '#c4502a', '#e8c14a', '#b8862f'];
    t.grass = shift(base.grass, -0.05, -0.12, 0.01);
    t.high = ['#a07a3a', '#8a6a34'];
    t.mix = { ...base.mix, round: Math.max(base.mix.round, 0.4), pine: Math.min(base.mix.pine, 0.45) };
  }
  if (season === 'winter') {
    const night = base.stars;
    t.grass = night ? ['#c9d6ec', '#bccbe4', '#d3def0', '#b4c4e0', '#c4d2ea'] : ['#eef3f7', '#e3ebf2', '#f5f8fb', '#dde6ee', '#e9eff5'];
    t.high = night ? ['#d3def0', '#c4d2ea'] : ['#f4f7fa', '#dfe7ee'];
    t.round = night ? ['#c4d2ea', '#b4c4e0'] : ['#e8eef2', '#d8e2ea'];
    t.pine = ['#2f5e45', '#2a5640', '#356a4e'];
    t.snow = night ? '#dfe9fb' : '#f4f6f8';
    t.snow_line = 0.4;
    if (!night) { t.fog = '#dfe8ee'; t.sky = ['#8fb3d1', '#e6eef4']; }
    t.camps = Math.max(base.camps, 0.4);
  }
  return t;
}

// sunset palette (a day ride that turns into night) and the rain look
const dusk_pal = { sky: ['#3a3f7a', '#f59e5b'], fog: '#e09a70', hemi: ['#ffc49a', '#3a3040', 0.8], key: ['#ffb070', 2.1], key_dir: [-80, 16, 10], cloud: '#ffc4a0' };

export const surprise_id = 'random';
// roll one ride. fixed theme ids give the old fixed look (summer, clear, no landmarks)
export function roll_scenery(id) {
  if (id !== surprise_id && themes[id]) return { id, theme: themes[id], season: 'summer', weather: 'clear', dusk: false, water: false, village: false, label: '' };
  // test helper: ?roll=valley,autumn,rain,dusk,water,village forces a roll
  const force = (new URLSearchParams(location.search).get('roll') || '').split(',').filter(Boolean);
  const has = (k) => force.includes(k);
  const tid = force.find((k) => themes[k]) || pick([['meadow', 4], ['valley', 3.5], ['night', 2.5]]);
  const season = force.find((k) => ['summer', 'autumn', 'winter'].includes(k)) || pick([['summer', 5], ['autumn', 3], ['winter', 2]]);
  const weather = force.find((k) => ['clear', 'rain', 'fog'].includes(k)) || pick([['clear', 5.5], ['rain', 2], ['fog', 2.5]]);
  const dusk = force.length ? has('dusk') : tid !== 'night' && Math.random() < 0.3;
  const water = force.length ? has('water') : Math.random() < 0.7, village = force.length ? has('village') : Math.random() < 0.65;
  const label = [themes[tid].name, { summer: '☀️ Summer', autumn: '🍂 Autumn', winter: '❄️ Winter' }[season],
    weather === 'rain' ? (season === 'winter' ? '🌨️ Snowfall' : '🌧️ Rain') : weather === 'fog' ? '🌫️ Fog' : '',
    dusk ? '🌅 Sunset ride' : '', water ? '🌉 Rivers + lakes' : '', village ? '🏘️ Villages' : ''].filter(Boolean).join(' · ');
  return { id: tid, theme: season_theme(themes[tid], season), season, weather, dusk, water, village, label };
}

// little house: walls, pitched roof, door, two windows (one merged mesh)
const wall_cols = ['#f1e3c8', '#e8c9a0', '#d9e4ea', '#f4d6d0', '#e9e2b8', '#cfdcc0'];
const roof_cols = ['#a8442f', '#5a4a44', '#7a3b2c', '#3e5468'];
function house_geom(rnd, winter) {
  const w = 5 + rnd() * 3, d = 4 + rnd() * 2, h = 3 + rnd() * 1.5;
  const wall = wall_cols[Math.floor(rnd() * wall_cols.length)];
  const roof = winter ? '#f2f5f8' : roof_cols[Math.floor(rnd() * roof_cols.length)];
  return merge_painted([
    paint(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), wall),
    paint(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 2.4, 4).rotateY(Math.PI / 4).scale(w / Math.max(w, d), 1, d / Math.max(w, d)).translate(0, h + 1.2, 0), roof),
    paint(new THREE.BoxGeometry(0.9, 1.8, 0.1).translate(0, 0.9, d / 2 + 0.03), '#6b4a2c'),
    paint(new THREE.BoxGeometry(0.8, 0.8, 0.1).translate(-w * 0.3, h * 0.6, d / 2 + 0.03), '#ffe9a8'),
    paint(new THREE.BoxGeometry(0.8, 0.8, 0.1).translate(w * 0.3, h * 0.6, d / 2 + 0.03), '#ffe9a8'),
  ]);
}

// rain (streaks) or snow (flakes) in a box around the camera. you ride into it: drops come at you as fast as
// you ride, and each streak is drawn along its motion relative to you (falling + rushing at you), so at speed
// rain slants towards the screen like the wind streaks and snow turns into short streaks
function make_precip(scene, snow) {
  const n = snow ? 900 : 700;
  const lines = new Float32Array(n * 6);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lines, 3));
  const line_mat = new THREE.LineBasicMaterial({ color: snow ? '#ffffff' : '#c8d4de', transparent: true, opacity: snow ? 0 : 0.45, depthWrite: false });
  const streaks = new THREE.LineSegments(lg, line_mat);
  streaks.frustumCulled = false;
  scene.add(streaks);
  // snow also gets round flakes (visible when you ride slowly)
  const dots = snow ? new Float32Array(n * 3) : null;
  let flakes = null;
  if (snow) {
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dots, 3));
    flakes = new THREE.Points(dg, new THREE.PointsMaterial({ color: '#ffffff', size: 0.12, transparent: true, opacity: 0.9, depthWrite: false }));
    flakes.frustumCulled = false;
    scene.add(flakes);
  }
  const pts = Array.from({ length: n }, () => ({ x: (Math.random() - 0.5) * 50, y: Math.random() * 22, z: -Math.random() * 80 + 8, ph: Math.random() * 6.28 }));
  const fall = snow ? 1.6 : 16;
  const trail = snow ? 0.07 : 0.045;   // streak length = relative speed x this many seconds
  return {
    update(dt, cx, cy, cz, speed) {
      pts.forEach((p, i) => {
        const vx = snow ? Math.sin(p.ph + p.y * 0.5) * 0.6 : 0;
        p.x += vx * dt;
        p.y -= fall * dt;
        p.z += speed * dt;   // you ride into it at your own speed
        // fell to the ground: back to the top. passed the camera: back far ahead at any height
        if (p.y < 0) { p.y = 16 + Math.random() * 6; p.z = 8 - Math.random() * 80; p.x = (Math.random() - 0.5) * 50; }
        if (p.z > 8) { p.z = -60 - Math.random() * 20; p.y = Math.random() * 22; p.x = (Math.random() - 0.5) * 50; }
        const x = cx + p.x, y = cy - 3 + p.y, z = cz + p.z;
        // tail = where the drop was a moment ago, relative to you: up (it falls) and further ahead (you close in)
        const tail = Math.max(trail, snow ? 0 : 0.7 / fall);
        lines.set([x, y, z, x - vx * tail, y + fall * tail, z - speed * tail], i * 6);
        if (snow) dots.set([x, y, z], i * 3);
      });
      lg.attributes.position.needsUpdate = true;
      if (snow) {
        flakes.geometry.attributes.position.needsUpdate = true;
        line_mat.opacity = Math.min(0.75, speed / 25);   // flakes stretch into streaks as you speed up
      }
    },
  };
}

// what the scenery sounds like right now (main.js feeds it to sfx.js): rain, water (0-1, how close a river or
// lake is), crowd (0-1, how close the finish crowd is), birds (daytime, clear weather)
export const ambience = { rain: false, water: 0, crowd: 0, birds: false };

let renderer = null;   // one renderer per canvas; each race builds a new scene
// render resolution learned on this device (auto resolution below); the next game starts from it
let learned_pr = null, pr_ceiling = null;
const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

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
  const rnd = seeded(7);
  // round tree: two faceted blobs on a trunk
  const crown = merge([
    jitter(new THREE.IcosahedronGeometry(1.8, 1), 0.55, rnd).translate(0, 3.8, 0),
    jitter(new THREE.IcosahedronGeometry(1.25, 0), 0.4, rnd).translate(0.8, 5.0, 0.3),   // small blobs: coarser (cheap on phones)
    jitter(new THREE.IcosahedronGeometry(1.0, 0), 0.35, rnd).translate(-0.9, 4.5, -0.4),
  ]);
  const trunk = new THREE.CylinderGeometry(0.2, 0.32, 2.6, 5).translate(0, 1.3, 0);
  // pine: three stacked, slightly drooping cones (the classic low-poly pine)
  const pine = merge([
    jitter(new THREE.ConeGeometry(1.8, 2.6, 10, 1), 0.35, rnd, true).translate(0, 2.3, 0),
    jitter(new THREE.ConeGeometry(1.45, 2.3, 9, 1), 0.3, rnd, true).translate(0, 3.5, 0),
    jitter(new THREE.ConeGeometry(1.15, 2.1, 8, 1), 0.25, rnd, true).translate(0, 4.5, 0),
    jitter(new THREE.ConeGeometry(0.8, 2.0, 7, 1), 0.2, rnd, true).translate(0, 5.5, 0),
  ]);
  const pine_trunk = new THREE.CylinderGeometry(0.22, 0.3, 1.6, 5).translate(0, 0.8, 0);
  const rock = jitter(new THREE.DodecahedronGeometry(1, 0), 0.45, rnd).scale(1.2, 0.75, 1).translate(0, 0.35, 0);
  // roadside post with a reflector band
  const post = new THREE.BoxGeometry(0.12, 1.0, 0.12).translate(0, 0.5, 0);
  const posts_per_chunk = Math.ceil(chunk_len / 25) * 2 + 2;
  const tuft = merge([0, 2.1, 4.2].map((a) => new THREE.ConeGeometry(0.09, 0.45, 3).translate(Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12)));
  const tufts_per_chunk = 420;
  const bush = merge([
    jitter(new THREE.IcosahedronGeometry(0.7, 0), 0.25, rnd).scale(1, 0.75, 1).translate(0, 0.45, 0),
    jitter(new THREE.IcosahedronGeometry(0.5, 0), 0.2, rnd).scale(1, 0.75, 1).translate(0.55, 0.35, 0.2),
  ]);
  const bushes_per_chunk = 60;
  // boulder pile: two or three big rocks leaning together
  const boulder = merge([
    jitter(new THREE.DodecahedronGeometry(1.3, 0), 0.5, rnd).scale(1.2, 0.8, 1).translate(0, 0.6, 0),
    jitter(new THREE.DodecahedronGeometry(0.9, 0), 0.35, rnd).translate(1.4, 0.45, 0.5),
    jitter(new THREE.DodecahedronGeometry(0.6, 0), 0.25, rnd).translate(-1.1, 0.3, 0.8),
  ]);
  const boulders_per_chunk = 5;
  // one instanced mesh per kind per chunk slot: only the instances a chunk uses are drawn (count), and a chunk
  // out of view, out of the shadow camera or behind the mirror is skipped as a whole (bounding sphere culling).
  // before this, every slot drew all three tree shapes (two shrunk to nothing): ~2.6 m triangles a frame
  // kind: [geometry, colour, per chunk, casts shadow, per-instance colour]
  const kinds = {
    crown: [crown, '#ffffff', per_chunk, true, true], trunk: [trunk, theme.trunk, per_chunk, true, false],
    pine: [pine, '#ffffff', per_chunk, true, true], pine_trunk: [pine_trunk, theme.trunk, per_chunk, true, false],
    rock: [rock, '#ffffff', per_chunk, true, true], bush: [bush, '#ffffff', bushes_per_chunk, true, true],
    tuft: [tuft, '#ffffff', tufts_per_chunk, false, true], post: [post, '#f4f4f4', posts_per_chunk, false, false],
    boulder: [boulder, '#ffffff', boulders_per_chunk, true, true],
  };
  const mats = Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, flat_mat(v[1])]));
  const white = new THREE.Color('#ffffff');
  const slots = Array.from({ length: chunk_count }, () => Object.fromEntries(Object.entries(kinds).map(([k, [g, , n, shadow, colored]]) => {
    const m = new THREE.InstancedMesh(g, mats[k], n);
    m.castShadow = shadow;
    m.receiveShadow = true;
    if (colored) m.setColorAt(0, white);   // colour buffer from the start: same shader for every slot
    m.count = 0;
    scene.add(m);
    return [k, m];
  })));
  return { slots, per_chunk, bushes_per_chunk, tufts_per_chunk, boulders_per_chunk, posts_per_chunk };
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

// ---- wildlife and hikers: elk and deer in the woods (most bolt when you ride by), hikers on the verge who
// wave as you pass, a flock of birds crossing the sky. one small set per terrain chunk, recycled with it ----

// vertex-coloured parts: every moving body part is one merged mesh (few draw calls)
function paint(geom, color) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const c = new THREE.Color(color).offsetHSL(0, mood.sat, mood.light);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function merge_painted(geoms) {
  const pos = [], col = [];
  for (const g of geoms) {
    pos.push(...g.attributes.position.array);
    col.push(...g.attributes.color.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}
const part = (geoms, mat) => {
  const m = new THREE.Mesh(merge_painted(geoms), mat);
  m.castShadow = true;
  return m;
};
// a group at a pivot point, holding one part (legs, arms, neck swing around their pivot)
const pivot = (x, y, z, mesh) => {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(mesh);
  return g;
};

// elk: big, dark neck, pale rump, antlers. deer: smaller, tan. models face -z like the riders
const animal_kinds = {
  elk: { size: 1, body: '#7a5236', neck: '#4a3020', rump: '#d8bd90', leg: '#3b281a', antlers: '#eadbb8', run_v: 7 },
  deer: { size: 0.72, body: '#b07a42', neck: '#a06e3c', rump: '#f2e6cc', leg: '#6b4a2c', antlers: null, run_v: 8.5 },
};
function make_animal(kind, mat, rnd) {
  const k = animal_kinds[kind];
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(k.size);
  root.add(body);
  body.add(part([
    paint(jitter(new THREE.IcosahedronGeometry(0.6, 1), 0.1, rnd).scale(0.72, 0.66, 1.45).translate(0, 1.45, 0), k.body),
    paint(new THREE.IcosahedronGeometry(0.3, 0).scale(1.2, 1, 0.6).translate(0, 1.5, 0.78), k.rump),
    paint(new THREE.ConeGeometry(0.08, 0.25, 4).rotateX(-2.4).translate(0, 1.62, 0.95), k.rump),
  ], mat));
  // neck + head swing around the chest: rotation.x < 0 lowers the head to graze
  const head_parts = [
    paint(new THREE.CylinderGeometry(0.16, 0.25, 0.9, 6).rotateX(-0.55).translate(0, 0.38, -0.2), k.neck),
    paint(jitter(new THREE.BoxGeometry(0.26, 0.28, 0.55), 0.05, rnd).translate(0, 0.8, -0.55), k.neck),
    paint(new THREE.BoxGeometry(0.17, 0.16, 0.18).translate(0, 0.74, -0.86), '#2a1d14'),
    paint(new THREE.ConeGeometry(0.06, 0.22, 4).rotateZ(1.1).translate(0.19, 0.98, -0.42), k.neck),
    paint(new THREE.ConeGeometry(0.06, 0.22, 4).rotateZ(-1.1).translate(-0.19, 0.98, -0.42), k.neck),
  ];
  if (k.antlers) {
    for (const sx of [-1, 1]) {
      // beam rising up, out and back from the top of the head, with three forward tines
      const dir = new THREE.Vector3(sx * 0.56, 0.73, 0.4).normalize(), base = new THREE.Vector3(sx * 0.08, 0.94, -0.5);
      const mid = base.clone().addScaledVector(dir, 0.42);
      head_parts.push(paint(new THREE.CylinderGeometry(0.025, 0.045, 0.84, 4)
        .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(y_axis, dir)).translate(mid.x, mid.y, mid.z), k.antlers));
      for (const t of [0.3, 0.55, 0.8]) {
        const p = base.clone().addScaledVector(dir, 0.84 * t);
        head_parts.push(paint(new THREE.ConeGeometry(0.025, 0.3, 4).rotateX(-0.45).translate(p.x, p.y + 0.13, p.z - 0.07), k.antlers));
      }
    }
  }
  const head = pivot(0, 1.5, -0.75, part(head_parts, mat));
  body.add(head);
  // legs hang from the hips and shoulders: 0 front left, 1 front right, 2 back left, 3 back right
  const legs = [[-0.2, -0.6], [0.2, -0.6], [-0.2, 0.62], [0.2, 0.62]].map(([x, z]) => {
    const l = pivot(x, 1.3, z, part([
      paint(new THREE.CylinderGeometry(0.075, 0.05, 1.22, 5).translate(0, -0.61, 0), k.leg),
      paint(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 5).translate(0, -1.25, 0), '#1e1610'),
    ], mat));
    body.add(l);
    return l;
  });
  root.visible = false;
  return { root, body, head, legs, kind: k, x: 0, z: 0, yaw: 0, state: 'graze', timer: 0, phase: 0, t: 0 };
}

// hiker with a backpack; a headlamp at night. faces -z
const jackets = ['#d84a3a', '#3f6fd0', '#f0a030', '#4a9a5a', '#8a4ac0', '#e86fa0'];
function make_hiker(mat, rnd, night) {
  const jacket = jackets[Math.floor(rnd() * jackets.length)];
  const pants = ['#3a3f4a', '#5a4a3a', '#2f4a5a'][Math.floor(rnd() * 3)];
  const skin = ['#f0c8a0', '#d8a47a', '#a8744e', '#6e4a30'][Math.floor(rnd() * 4)];
  const pack = ['#2f6f4a', '#c8582a', '#3a4a6a', '#6a5a3a'][Math.floor(rnd() * 4)];
  const root = new THREE.Group();
  root.add(part([
    paint(jitter(new THREE.BoxGeometry(0.4, 0.58, 0.25), 0.04, rnd).translate(0, 1.2, 0), jacket),
    paint(new THREE.BoxGeometry(0.34, 0.5, 0.2).translate(0, 1.25, 0.22), pack),
    paint(new THREE.CylinderGeometry(0.08, 0.08, 0.38, 6).rotateZ(Math.PI / 2).translate(0, 1.55, 0.24), '#d8c8a0'),
    paint(new THREE.IcosahedronGeometry(0.13, 1).translate(0, 1.64, 0), skin),
    paint(new THREE.CylinderGeometry(0.12, 0.14, 0.09, 7).translate(0, 1.75, 0), rnd() < 0.5 ? jacket : '#e8e0d0'),
  ], mat));
  const legs = [-0.1, 0.1].map((x) => {
    const l = pivot(x, 0.92, 0, part([
      paint(new THREE.CylinderGeometry(0.08, 0.065, 0.85, 5).translate(0, -0.43, 0), pants),
      paint(new THREE.BoxGeometry(0.12, 0.09, 0.22).translate(0, -0.88, -0.04), '#3a2a1e'),
    ], mat));
    root.add(l);
    return l;
  });
  const arms = [-0.26, 0.26].map((x) => {
    const a = pivot(x, 1.45, 0, part([
      paint(new THREE.CylinderGeometry(0.06, 0.05, 0.56, 5).translate(0, -0.28, 0), jacket),
      paint(new THREE.IcosahedronGeometry(0.05, 0).translate(0, -0.58, 0), skin),
    ], mat));
    root.add(a);
    return a;
  });
  if (night) {
    const lamp = new THREE.Mesh(new THREE.IcosahedronGeometry(0.04, 0), new THREE.MeshBasicMaterial({ color: '#fff6c8', fog: false }));
    lamp.position.set(0, 1.7, -0.13);
    root.add(lamp);
  }
  root.visible = false;
  return { root, legs, arms, x: 0, rx: 0, z: 0, z0: 0, dir: -1, phase: rnd() * 6.28, wave_t: 0, waved: false };
}

// flock of birds: each bird is two flapping wings (one instanced mesh, one draw call), flying in a v across the sky
function make_birds(scene) {
  const n = 9;
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.25, 0, 0, 0.2, 1.1, 0, 0.12], 3));
  wing.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(wing, new THREE.MeshBasicMaterial({ color: '#2a2c36', side: THREE.DoubleSide }), n * 2);
  mesh.frustumCulled = false;
  scene.add(mesh);
  for (let i = 0; i < n * 2; i++) mesh.setMatrixAt(i, hidden);
  const f = { x: 0, y: 0, z: 0, yaw: 0, wait: 6, t: 0 };
  const q = new THREE.Quaternion(), qf = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const fwd = new THREE.Vector3(0, 0, 1);
  return {
    update(dt, cam_x, cam_z) {
      f.t += dt;
      if (f.wait > 0) {
        f.wait -= dt;
        if (f.wait > 0) return;
        // new flock: starts off to one side ahead of the camera and flies across the road
        const side = Math.random() < 0.5 ? -1 : 1;
        f.x = cam_x + side * (140 + Math.random() * 60);
        f.z = cam_z - 90 - Math.random() * 140;
        f.y = 28 + Math.random() * 25;
        f.yaw = side * (Math.PI / 2 + (Math.random() - 0.5) * 0.7);   // heading towards the other side
      }
      const v = 11;
      f.x -= Math.sin(f.yaw) * v * dt;
      f.z -= Math.cos(f.yaw) * v * dt;
      if (Math.hypot(f.x - cam_x, f.z - cam_z) > 320) {
        f.wait = 12 + Math.random() * 25;
        for (let i = 0; i < n * 2; i++) mesh.setMatrixAt(i, hidden);
        mesh.instanceMatrix.needsUpdate = true;
        return;
      }
      const s = Math.sin(f.yaw), c = Math.cos(f.yaw);
      for (let i = 0; i < n; i++) {
        // v formation: leader first, then alternating left / right, each a step further back
        const rank = Math.ceil(i / 2), lr = i % 2 ? -1 : 1;
        const ox = lr * rank * 2.4, oz = rank * 2.2, oy = Math.sin(f.t * 1.3 + i) * 0.5;
        p.set(f.x + ox * c + oz * s, f.y + oy, f.z - ox * s + oz * c);
        const flap = Math.sin(f.t * 9 + i * 0.8) * 0.65;
        for (const w of [1, -1]) {
          qf.setFromAxisAngle(fwd, flap * w);
          q.setFromAxisAngle(up, f.yaw).multiply(qf);
          mesh.setMatrixAt(i * 2 + (w > 0 ? 0 : 1), m4.compose(p, q, sc.set(1.5 * w, 1.5, 1.5)));
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

function make_wildlife(scene, theme) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
  const rnd = seeded(31);
  // per chunk: an elk, two deer (a doe and a fawn) and two hikers; most stay hidden
  const slots = Array.from({ length: chunk_count }, () => {
    const s = {
      elk: make_animal('elk', mat, rnd), deer: [make_animal('deer', mat, rnd), make_animal('deer', mat, rnd)],
      hikers: [make_hiker(mat, rnd, theme.stars), make_hiker(mat, rnd, theme.stars)],
    };
    s.deer[1].body.scale.multiplyScalar(0.75);
    for (const o of [s.elk, ...s.deer, ...s.hikers]) scene.add(o.root);
    return s;
  });
  return { slots, birds: theme.birds ? make_birds(scene) : null };
}

// leg swing, head and body bob for one animal
function animate_animal(a, dt, speed) {
  const gallop = speed > 3;
  a.phase += dt * (gallop ? 11 : speed > 0 ? 5 : 0);
  const amp = gallop ? 0.7 : speed > 0 ? 0.32 : 0;
  const offs = gallop ? [0, 0.5, Math.PI, Math.PI + 0.5] : [0, Math.PI, Math.PI, 0];
  a.legs.forEach((l, i) => { l.rotation.x += (Math.sin(a.phase + offs[i]) * amp - l.rotation.x) * Math.min(1, dt * 12); });
  const head = a.state === 'graze' ? -1.75 + Math.sin(a.t * 5) * 0.06 : a.state === 'flee' ? 0.2 : 0;
  a.head.rotation.x += (head - a.head.rotation.x) * Math.min(1, dt * 2.5);
  a.body.position.y = gallop ? Math.abs(Math.sin(a.phase)) * 0.15 : 0;
  a.body.rotation.x = gallop ? Math.sin(a.phase) * 0.06 : 0;
}


// cloud box around the camera: x from -span to span, z from far ahead to a bit behind. approach = share of your
// forward speed the clouds come towards you (parallax: a feeling of travelling under them)
const cloud_box = { n: 18, span: 1000, z: [-1150, 400], approach: 0.3 };

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

  // big faceted clouds: clusters of squashed icosahedrons, lit plus a soft glow. they drift sideways on the wind
  // and slowly come closer as you ride; each fades in far away and out at the edges of its box, so wrapping never pops
  const clouds = new THREE.Group();
  for (let i = 0; i < cloud_box.n; i++) {
    const cloud_mat = new THREE.MeshStandardMaterial({ color: theme.cloud, flatShading: true, roughness: 1, fog: false, emissive: theme.cloud, emissiveIntensity: theme.cloud_glow, transparent: true });
    const parts = [];
    const n = 4 + Math.floor(rnd() * 3);
    for (let j = 0; j < n; j++) {
      const r = 22 + rnd() * 20 - Math.abs(j - n / 2) * 4;
      parts.push(jitter(new THREE.IcosahedronGeometry(r, 0), r * 0.35, rnd).scale(1.2, 0.45, 0.8).translate(j * 26 - n * 13, rnd() * 6, rnd() * 12));
    }
    const c = new THREE.Mesh(merge(parts), cloud_mat);
    c.position.set((rnd() * 2 - 1) * cloud_box.span, 190 + rnd() * 150, cloud_box.z[0] + rnd() * (cloud_box.z[1] - cloud_box.z[0]));
    c.rotation.y = rnd() * 0.6 - 0.3;
    c.userData.v = 5 + rnd() * 9;   // wind drift (m/s); far clouds look slow, near ones fast
    clouds.add(c);
  }
  scene.add(clouds);
  // moved = metres the camera went forward this frame
  function update_clouds(dt, moved) {
    const [z0, z1] = cloud_box.z;
    for (const c of clouds.children) {
      c.position.x += c.userData.v * dt;
      c.position.z += moved * cloud_box.approach;
      if (c.position.x > cloud_box.span) c.position.x -= 2 * cloud_box.span;
      if (c.position.z > z1) c.position.z -= z1 - z0;
      c.material.opacity = smoothstep(0, 220, cloud_box.span - Math.abs(c.position.x)) * smoothstep(0, 250, c.position.z - z0) * smoothstep(0, 120, z1 - c.position.z);
    }
  }

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
  return { group, clouds, stars, update_clouds };
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
  const rim = new THREE.Mesh(new THREE.TorusGeometry(wheel_r - 0.085, 0.045, 3, 12), mats.rim);
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

// jersey print: pattern in a second colour on the jersey colour (cylinder uv: u around the body, v along it)
function jersey_texture(base, pat, color) {
  return canvas_texture(128, 128, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.fillStyle = color;
    if (pat === 'hoops') for (let y = 8; y < h; y += 32) g.fillRect(0, y, w, 14);
    if (pat === 'stripes') for (let x = 0; x < w; x += 21) g.fillRect(x, 0, 9, h);
    if (pat === 'sash') { g.beginPath(); g.moveTo(0, 20); g.lineTo(0, 56); g.lineTo(w, 108); g.lineTo(w, 72); g.fill(); }
    if (pat === 'dots') for (let y = 8; y < h; y += 22) for (let x = (y / 22) % 2 ? 11 : 0; x < w; x += 22) { g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }
    if (pat === 'twotone') g.fillRect(0, 0, w, h * 0.45);
    if (pat === 'chevron') for (const y0 of [24, 70]) { g.beginPath(); g.moveTo(0, y0); g.lineTo(w / 2, y0 + 26); g.lineTo(w, y0); g.lineTo(w, y0 + 16); g.lineTo(w / 2, y0 + 42); g.lineTo(0, y0 + 16); g.fill(); }
    if (pat === 'checks') for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 16 : 0; x < w; x += 32) g.fillRect(x, y, 16, 16);
    if (pat === 'rainbow') ['#1e88e5', '#e53935', '#212121', '#ffd400', '#43a047'].forEach((c, i) => { g.fillStyle = c; g.fillRect(0, 44 + i * 9, w, 9); });
  });
}
const rainbow = (t) => new THREE.Color().setHSL((t * 0.6) % 1, 0.9, 0.6);

// look: a jersey colour, or { jersey, pattern, pattern_color, frame, rim, helmet, shoe, flame, trail } (progress.js)
function make_rider(look) {
  const L = typeof look === 'string' ? { jersey: look } : look;
  const color = L.jersey;
  const g = new THREE.Group();
  const c = new THREE.Color(color);
  const accent = c.clone().offsetHSL(0, 0, -0.18);
  const printed = L.pattern && L.pattern !== 'plain';
  // own materials per rider, so a rider can fade out near the camera
  const mats = {
    jersey: flat_mat(color),
    print: printed ? flat_mat('#ffffff', { map: jersey_texture(color, L.pattern, L.pattern_color || '#ffffff') }) : null,
    accent: flat_mat(accent),
    rim: flat_mat(L.rim && L.rim !== 'auto' ? L.rim : accent),
    helmet: flat_mat(L.helmet && L.helmet !== 'auto' ? L.helmet : color),
    frame: flat_mat(L.frame || '#f2f2f2'),
    tire: flat_mat('#17171a'),
    skin: flat_mat('#e9b27f'),
    shorts: flat_mat('#1f2027'),
    metal: flat_mat('#9aa0a8'),
    white: flat_mat(L.pattern_color || '#ffffff'),
    shoe: flat_mat(L.shoe || '#f5f5f5'),
  };
  if (!mats.print) delete mats.print;
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
  const torso = add_body(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.58, 8), mats.print || mats.jersey));
  torso.position.copy(v(0.02, 1.2));
  torso.rotation.x = -1.05;   // lean forward
  torso.scale.set(1.15, 1, 0.8);
  const stripe = add_body(new THREE.Mesh(new THREE.CylinderGeometry(0.162, 0.175, 0.07, 8), mats.white));
  stripe.position.copy(v(0.06, 1.23));
  stripe.rotation.x = -1.05;
  stripe.scale.set(1.16, 1, 0.81);
  stripe.visible = !mats.print;   // the chest band is the 'plain' pattern
  const hips = add_body(new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), mats.shorts));
  hips.position.copy(v(...geo.hip));
  hips.scale.set(1.15, 0.8, 1);
  // head: skin, faceted aero helmet in the rider colour with a white vent and a dark visor
  const head = add_body(new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 1), mats.skin));
  head.position.copy(v(0.36, 1.5));
  const helmet = add_body(new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 1), mats.helmet));
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
    new THREE.MeshBasicMaterial({ color: L.flame && L.flame !== 'rainbow' ? L.flame : '#ff8a00', transparent: true, opacity: 0.9, depthWrite: false }),
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
    group: root, bike: g, body, arms, wheels, legs, flame, mats: Object.values(mats), faded: false, look: L,
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
  const n = 70;   // few streaks: a hint of air rushing past, not a blizzard
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
      mat.opacity = Math.min(0.4, Math.max(0, (vis_speed - 5) / 50)) + (boost ? 0.25 : 0);
    },
  };
}

// winding road centre line (visual meters): long sweeping bends, medium s-curves and the odd tight turn.
// each layer fades in and out on its own slow cycle, so turns vary from gentle to sharp
export function curve_x(z) {
  const wave = (len, amp, ph, env_len, env_ph) => amp * Math.sin(z / len + ph) * (0.55 + 0.45 * Math.sin(z / env_len + env_ph));
  return wave(420, 75, 0.3, 1900, 1.1) + wave(160, 38, 1.3, 760, 2.4) + wave(70, 14, 0.7, 380, 0.2);
}

// ---- the kit: one low-poly world around a (possibly curving, climbing) road ----
//
// coordinates: forward = -z. the road centre line is road_x(z), its height road_y(z) (both in visual meters).
// games give positions as visual z and a sideways offset from the road centre.
//
// opts: { theme, road_w, lanes, road_x(z), road_y(z), surface(z) -> 'asphalt'|'gravel'|'dirt', camps, posts, wildlife }
export function create_kit(canvas, opts = {}) {
  const sc = roll_scenery(opts.theme || 'meadow');
  const theme = { ...sc.theme };
  // weather: rain = greyer, nearer fog, dimmer sun; fog = a short white-out fog
  if (sc.weather === 'rain') {
    const grey = sc.season === 'winter' ? '#d4dde4' : '#9aa4ad';
    theme.fog = '#' + new THREE.Color(theme.fog).lerp(new THREE.Color(grey), 0.55).getHexString();
    theme.sky = theme.sky.map((c) => '#' + new THREE.Color(c).lerp(new THREE.Color(grey), 0.6).getHexString());
    theme.fog_range = [theme.fog_range[0] * 0.6, theme.fog_range[1] * 0.6];
    theme.key = [theme.key[0], theme.key[1] * 0.55];
    theme.cloud = '#a9b0b8';
  }
  if (sc.weather === 'fog') {
    theme.fog = '#' + new THREE.Color(theme.fog).lerp(new THREE.Color(theme.stars ? '#2a3a5a' : '#e4e8ea'), 0.6).getHexString();
    theme.sky = theme.sky.map((c) => '#' + new THREE.Color(c).lerp(new THREE.Color(theme.fog), 0.75).getHexString());
    theme.fog_range = [15, 210];
    theme.key = [theme.key[0], theme.key[1] * 0.7];
  }
  if (sc.dusk) theme.camps = Math.max(theme.camps, 0.45);
  const road_w = opts.road_w ?? 7.6;
  const lanes = opts.lanes ?? 6;
  const road_edge = road_w / 2;
  const road_x = opts.road_x || (opts.curves === false ? () => 0 : curve_x);
  const road_y = opts.road_y || (() => 0);
  const surface = opts.surface || (() => 'asphalt');
  const flat_zones = [];   // { x, z, r }: clearings where the hills flatten out (e.g. a crossroads)

  if (!renderer || renderer.domElement !== canvas) {
    // free the old canvas's gl context (each game and the menu backdrop get a fresh canvas)
    renderer?.forceContextLoss();
    renderer?.dispose();
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  }
  // auto resolution: start at 1.5x (or what this device managed last game), step down when frames come late
  const pr_max = Math.min(window.devicePixelRatio || 1, 2), pr_min = Math.min(1, pr_max);
  // opts.pixel_ratio: fixed resolution, no auto tuning (the menu backdrop: its 30 fps cap would look like lag)
  let pr = opts.pixel_ratio ?? learned_pr ?? Math.min(pr_max, 1.5);
  renderer.setPixelRatio(pr);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // pcf + radius = soft, blurred shadow edges
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // deeper, filmic colours with soft highlights
  renderer.toneMappingExposure = 1.0;
  // calm colour grade: one plain overlay (warm tint + vignette). no css filter / blend modes on the canvas:
  // on phones those cost a full-screen pass every frame
  const mood_layers = [];
  const mood_div = document.createElement('div');
  mood_div.className = 'mood-grade';
  canvas.parentElement?.appendChild(mood_div);
  mood_layers.push(mood_div);

  const scene = new THREE.Scene();
  // sky gradient pulled towards the fog colour (softer, hazier); redrawn during a sunset ride
  const sky_cv = document.createElement('canvas');
  sky_cv.width = 4;
  sky_cv.height = 256;
  function paint_sky(top, low, fog) {
    const g = sky_cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#' + new THREE.Color(top).lerp(new THREE.Color(fog), 0.2).getHexString());
    grad.addColorStop(0.7, '#' + new THREE.Color(low).lerp(new THREE.Color(fog), 0.3).getHexString());
    grad.addColorStop(1, '#' + new THREE.Color(fog).getHexString());
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
  }
  paint_sky(theme.sky[0], theme.sky[1], theme.fog);
  scene.background = new THREE.CanvasTexture(sky_cv);
  scene.background.colorSpace = THREE.SRGBColorSpace;
  scene.fog = new THREE.Fog(theme.fog, ...theme.fog_range);
  const hemi = new THREE.HemisphereLight(theme.hemi[0], theme.hemi[1], theme.hemi[2]);
  scene.add(hemi);
  // key light from the side: lit facets vs shaded facets is the whole low-poly look
  const sun = new THREE.DirectionalLight(theme.key[0], theme.key[1]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048);   // phones: lighter shadow map
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
    const h = ry - 0.05 + n * (5 + d * 0.3) * ramp;
    // rivers and lakes: the ground sinks to a bed under the water level
    const w = wet(x, z);
    return w > 0 ? h + (water_bed(x, z) - h) * w : h;
  }

  // rivers cross the road every ~1.8 km (a bridge carries the road), lakes lie beside it now and then.
  // both from hashes of their index, so every chunk agrees where the water is
  const river_gap = 1800, lake_gap = 700;
  function river(k) {
    if (!sc.water || k < 1 || hash2(k, 11) > 0.75) return null;
    const z = -(k * river_gap + (hash2(k, 7) - 0.5) * 600);
    return { z, w: 14 + hash2(k, 9) * 22, level: road_y(z) - 1.3 };
  }
  function lake(j) {
    if (!sc.water || j < 1 || hash2(j, 21) > 0.4) return null;
    const z = -(j * lake_gap + lake_gap / 2), side = hash2(j, 22) < 0.5 ? -1 : 1;
    const r = 28 + hash2(j, 23) * 40;
    return { x: road_x(z) + side * (road_edge + r + 12 + hash2(j, 24) * 30), z, r, level: road_y(z) - 0.8 };
  }
  // how wet a spot is: 0 = dry land, 1 = river or lake bed (smooth banks in between)
  function wet(x, z) {
    if (!sc.water) return 0;
    let w = 0;
    const r = river(Math.round(-z / river_gap));
    if (r) w = 1 - smoothstep(r.w * 0.3, r.w * 0.62, Math.abs(z - r.z));
    const j = Math.floor(-z / lake_gap);
    for (const l of [lake(j - 1), lake(j), lake(j + 1)]) if (l) w = Math.max(w, 1 - smoothstep(l.r * 0.75, l.r * 1.15, Math.hypot(x - l.x, z - l.z)));
    return w;
  }
  function water_bed(x, z) {
    const r = river(Math.round(-z / river_gap));
    if (r && Math.abs(z - r.z) < r.w) return r.level - 2;
    const j = Math.floor(-z / lake_gap);
    for (const l of [lake(j - 1), lake(j), lake(j + 1)]) if (l && Math.hypot(x - l.x, z - l.z) < l.r * 1.3) return l.level - 2.5;
    return road_y(z) - 3;
  }
  const in_clearing = (x, z) => flat_zones.some((f) => Math.hypot(x - f.x, z - f.z) < f.r * 0.85) || wet(x, z) > 0.15 || in_village(x, z);
  // no trees where a village stands (same hash as update_villages)
  function in_village(x, z) {
    if (!sc.village) return false;
    const k = Math.round(-z / 2500);
    if (k < 1 || hash2(k, 31) > 0.7) return false;
    const vz = -(k * 2500 + (hash2(k, 32) - 0.5) * 800);
    return Math.abs(z - vz) < 55 && Math.abs(x - road_x(z)) < road_edge + 28;
  }

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
    // every grid point once (each is shared by up to 4 cells): ground() is the expensive part of a chunk
    const grid = Array.from({ length: rows + 1 }, (_, ri) => xs.map((_, ci) => vtx(ci, ri)));
    for (let ri = 0; ri < rows; ri++) {
      for (let ci = 0; ci < xs.length - 1; ci++) {
        if (ci === mid - 1) continue;   // the road strip has no terrain
        const a = grid[ri][ci], b = grid[ri][ci + 1], c = grid[ri + 1][ci], d = grid[ri + 1][ci + 1];
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
      // sideways unit vector: perpendicular to the direction of travel (x changes by sl per meter forward)
      const sl = cx(z - 0.5) - cx(z + 0.5);
      const k = width / 2 / Math.sqrt(1 + sl * sl);
      pos.push(x - k, y, z - sl * k, x + k, y, z + sl * k);
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
  const wild = opts.wildlife === false ? null : make_wildlife(scene, theme);
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
    const P = props.slots[slot];
    const used = Object.fromEntries(Object.keys(P).map((k) => [k, 0]));
    const put = (k, ...a) => set_inst(P[k], used[k]++, ...a);
    // random spot beside the road: side offset from the road centre
    const spot = (min, spread) => {
      const z = z0 - rnd() * chunk_len;
      const side = rnd() < 0.5 ? -1 : 1;
      return { z, rx: side * (road_edge + min + spread) };
    };
    for (let k = 0; k < props.per_chunk; k++) {
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
        put('crown', x, y, z, s, sy, rot, palette_color(theme.round, cr));
        put('trunk', x, y, z, s, sy, rot);
      } else if (kind < theme.mix.round + theme.mix.pine) {
        put('pine', x, y, z, s * 1.15, sy * 1.25, rot, palette_color(theme.pine, cr));
        put('pine_trunk', x, y, z, s * 1.15, 1, rot);
      } else {
        put('rock', x, y, z, s * (0.5 + cr * 0.9), 1, rot, palette_color(theme.rock, cr));
      }
    }
    // bushes in the verge and under the trees
    for (let k = 0; k < props.bushes_per_chunk; k++) {
      const { z, rx } = spot(2, rnd() ** 1.3 * 45);
      const x = road_x(z) + rx;
      const s = 0.7 + rnd() * 1.1, rot = rnd() * 6.28, cr = rnd();
      if (in_clearing(x, z)) continue;
      put('bush', x, ground(x, z) - 0.1, z, s, 1, rot, palette_color(theme.round, cr).offsetHSL(0, 0, -0.04));
    }
    // boulder piles in the woods, a few close to the road
    for (let k = 0; k < props.boulders_per_chunk; k++) {
      const { z, rx } = spot(6, rnd() ** 1.4 * 55);
      const x = road_x(z) + rx;
      const s = 0.8 + rnd() * 1.4, rot = rnd() * 6.28, cr = rnd();
      if (in_clearing(x, z)) continue;
      put('boulder', x, ground(x, z) - 0.3 * s, z, s, 0.8 + cr * 0.4, rot, palette_color(theme.rock, cr));
    }
    // grass tufts close to the road: small detail that reads as texture at speed
    for (let k = 0; k < props.tufts_per_chunk; k++) {
      const { z, rx } = spot(0.4, rnd() ** 1.5 * 30);
      const x = road_x(z) + rx;
      put('tuft', x, ground(x, z) - 0.05, z, 0.8 + rnd() * 1.4, 0.7 + rnd(), rnd() * 6.28,
        palette_color(theme.grass, rnd()).offsetHSL(0, 0.05, -0.08));
    }
    // white roadside posts every 25 m: strong speed cue (only where there is a road)
    const first = Math.ceil(-z0 / 25) * 25;
    for (let d = first; d < -z0 + chunk_len && used.post < props.posts_per_chunk - 1; d += 25) {
      if (opts.posts === false || -d < road_end) continue;
      for (const side of [-1, 1]) P.post.setMatrixAt(used.post++, m4.makeTranslation(road_x(-d) + side * (road_edge + 0.7), road_y(-d), -d));
    }
    for (const [k, m] of Object.entries(P)) {
      m.count = used[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();   // per-chunk culling (main view, shadows, mirror)
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

  // wildlife for one chunk: maybe an elk or a pair of deer in the woods, maybe one or two hikers on the verge
  function place_wild(slot, chunk_i, z0) {
    if (!wild) return;
    const w = wild.slots[slot];
    const rnd = seeded(chunk_i * 15485863 + 3);
    for (const o of [w.elk, ...w.deer, ...w.hikers]) o.root.visible = false;
    if (rnd() < theme.animals) {
      const herd = rnd() < 0.4 ? [w.elk] : [w.deer[0], w.deer[1]];
      const side = rnd() < 0.5 ? -1 : 1;
      const rx = side * (road_edge + 9 + rnd() * 26), z = z0 - 10 - rnd() * (chunk_len - 20);
      const skittish = rnd() < 0.75;   // most bolt when you ride by, some don't care
      herd.forEach((a, k) => {
        a.z = z + k * 2.5;
        a.x = road_x(a.z) + rx + k * side * 1.5;
        if (in_clearing(a.x, a.z)) return;
        Object.assign(a, { yaw: rnd() * 6.28, state: 'graze', timer: 2 + rnd() * 5, skittish, fled: false, side });
        a.root.visible = true;
      });
    }
    if (rnd() < theme.hikers) {
      const count = rnd() < 0.5 ? 2 : 1;
      const side = rnd() < 0.5 ? -1 : 1, dir = rnd() < 0.6 ? -1 : 1;
      const z = z0 - 10 - rnd() * (chunk_len - 20);
      for (let k = 0; k < count; k++) {
        const h = w.hikers[k];
        Object.assign(h, { z: z + k * 1.7 * -dir, z0: z, dir, rx: side * (road_edge + 2.3 + k * 0.5 + rnd() * 0.4), wave_t: 0, waved: false });
        if (h.z < road_end || in_clearing(road_x(h.z) + h.rx, h.z)) continue;
        h.root.visible = true;
      }
    }
  }

  // animals graze, look up, wander and (if skittish) bolt away from the road when you come close.
  // hikers walk up and down their stretch of verge and wave once as you pass
  function update_wild(dt, cam_z) {
    if (!wild) return;
    for (const w of wild.slots) {
      for (const a of [w.elk, ...w.deer]) {
        if (!a.root.visible) continue;
        a.t += dt;
        a.timer -= dt;
        const rx = a.x - road_x(a.z);
        const ahead = cam_z - a.z;   // > 0: the animal is in front of the camera
        if (a.skittish && !a.fled && ahead > -5 && ahead < 30 && Math.abs(rx) < 32) {
          // bolt: away from the road and a bit forward
          a.state = 'flee';
          a.fled = true;
          a.timer = 2.5 + Math.random() * 1.5;
          a.yaw = heading(a.z) - Math.sign(rx) * (0.9 + Math.random() * 0.3);
        } else if (a.timer <= 0) {
          if (a.state === 'graze') { a.state = Math.random() < 0.5 ? 'look' : 'walk'; a.timer = 2 + Math.random() * 3; a.yaw += (Math.random() - 0.5) * 1.5; }
          else { a.state = 'graze'; a.timer = 3 + Math.random() * 5; }
        }
        const speed = a.state === 'flee' ? a.kind.run_v : a.state === 'walk' ? 0.9 : 0;
        if (speed) {
          a.x -= Math.sin(a.yaw) * speed * dt;
          a.z -= Math.cos(a.yaw) * speed * dt;
          // wandering animals turn back before they reach the road
          if (a.state === 'walk' && Math.abs(a.x - road_x(a.z)) < road_edge + 6) a.yaw += Math.PI;
        }
        animate_animal(a, dt, speed);
        a.root.position.set(a.x, ground(a.x, a.z) - 0.05, a.z);
        a.root.rotation.y = a.yaw;
      }
      for (const h of w.hikers) {
        if (!h.root.visible) continue;
        h.z += h.dir * 1.25 * dt;
        if (Math.abs(h.z - h.z0) > 35) h.dir = Math.sign(h.z0 - h.z);   // turn around at the end of the stretch
        h.phase += dt * 5.2;
        const x = road_x(h.z) + h.rx;
        h.root.position.set(x, ground(x, h.z) + Math.abs(Math.sin(h.phase)) * 0.03, h.z);
        h.root.rotation.y = heading(h.z) + (h.dir > 0 ? Math.PI : 0);
        h.legs.forEach((l, i) => { l.rotation.x = Math.sin(h.phase + i * Math.PI) * 0.45; });
        h.arms.forEach((a, i) => { a.rotation.x = -Math.sin(h.phase + i * Math.PI) * 0.35; a.rotation.z = 0; });
        if (!h.waved && Math.abs(cam_z - h.z) < 14) { h.waved = true; h.wave_t = 2.6; }
        if (h.wave_t > 0) {
          h.wave_t -= dt;
          // the arm on the road side goes up and waves (local x flips when walking towards the camera)
          const s = -Math.sign(h.rx) * (h.dir > 0 ? -1 : 1);
          const arm = h.arms[s < 0 ? 0 : 1];
          arm.rotation.x = 0;
          arm.rotation.z = s * (2.5 + Math.sin(h.wave_t * 14) * 0.35);
        }
      }
    }
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
    place_wild(c.slot, i, z0);
  }

  // keep the chunk window around the camera: chunk i covers visual z in [-(i+1)L, -iL].
  // a chunk takes ~15 ms to build, so after the first frame at most one is built per frame (nearest first):
  // two in one frame would be a visible hitch
  function update_chunks(cam_z, behind = 1, max_builds = 1) {
    const first = Math.floor(-cam_z / chunk_len) - behind;
    const wanted = new Set(Array.from({ length: chunk_count }, (_, k) => first + k));
    const free = chunks.filter((c) => !wanted.has(c.index));
    let built = 0;
    for (const i of wanted) {
      if (chunks.some((c) => c.index === i)) continue;
      if (built++ >= max_builds) break;
      build_chunk(free.pop(), i);
    }
  }

  // shader warm-up: the gpu compiles a program the first time a kind of object is drawn, a freeze of up to
  // a few hundred ms on a phone. pooled objects (animals, hikers, campfires, nitro flames) start hidden and
  // rivers / houses / road marks appear later, so the first one of each used to stutter early in the ride.
  // one throwaway render into a 1x1 target with everything visible and unculled compiles them all (shadows too)
  let warmed = false;
  function warm_up() {
    const changed = [];
    const probe = new THREE.Group();
    const box = new THREE.BoxGeometry(0.01, 0.01, 0.01);
    for (const m of [water_mat, rail_mat, house_mat, mark_mat('#ffffff', 0.9), flat_mat('#ffffff')]) probe.add(new THREE.Mesh(box, m));
    probe.position.copy(camera.position);
    scene.add(probe);
    scene.traverse((o) => {
      if (!o.visible || o.frustumCulled) changed.push([o, o.visible, o.frustumCulled]);
      o.visible = true;
      o.frustumCulled = false;
    });
    const rt = new THREE.WebGLRenderTarget(1, 1);
    try {
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
    } catch { /* warm-up is only an optimisation */ }
    renderer.setRenderTarget(null);
    rt.dispose();
    for (const [o, vis, cull] of changed) { o.visible = vis; o.frustumCulled = cull; }
    scene.remove(probe);
    box.dispose();
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

  // late frames (> 1.5x the screen refresh) in the last ~2 s lower the resolution a step; a long smooth stretch
  // raises it again, but never back to a level that already stuttered. pauses (> 250 ms) are ignored
  let last_frame = 0, quality_t = performance.now();
  const kit_t0 = performance.now();
  const frame_ms = [];
  function adapt_resolution() {
    if (opts.pixel_ratio) return;
    const now = performance.now();
    if (last_frame) { frame_ms.push(now - last_frame); if (frame_ms.length > 120) frame_ms.shift(); }
    last_frame = now;
    const early = now - kit_t0 < 15000;   // settle fast during loading and the first seconds
    if (frame_ms.length < (early ? 45 : 90) || now - quality_t < (early ? 1000 : 2000)) return;
    const sorted = [...frame_ms].sort((a, b) => a - b);
    const refresh = sorted[Math.floor(sorted.length * 0.1)];
    const late = frame_ms.filter((t) => t > refresh * 1.5 && t < 250).length / frame_ms.length;
    let next = pr;
    if (late > 0.08 && pr > pr_min) { pr_ceiling = pr - 0.25; next = pr - 0.25; }
    else if (late < 0.01 && now - quality_t > 10000 && pr + 0.25 <= Math.min(pr_max, pr_ceiling ?? pr_max)) next = pr + 0.25;
    if (next === pr) return;
    pr = learned_pr = Math.max(pr_min, next);
    renderer.setPixelRatio(pr);
    resize();
    quality_t = now;
    frame_ms.length = 0;
  }

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

  function remove_rider(model) {
    scene.remove(model.group);
    model.mats.forEach((m) => { m.map?.dispose(); m.dispose(); });
    const i = riders.indexOf(model);
    if (i >= 0) riders.splice(i, 1);
  }

  // painted road marks (workout zones): coloured lines along both road edges + a faint tint across the road.
  // list = [{ z0, z1 (z1 < z0), color }]; call again to replace them
  const marks = new THREE.Group();
  scene.add(marks);
  const mark_mats = new Map();
  const mark_mat = (color, opacity) => {
    const key = color + opacity;
    if (!mark_mats.has(key)) mark_mats.set(key, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    return mark_mats.get(key);
  };
  function set_marks(list) {
    for (const m of marks.children) m.geometry.dispose();
    marks.clear();
    for (const k of list) {
      if (k.z0 - k.z1 < 0.5) continue;
      for (const side of [-1, 1]) {
        const off = side * (road_edge - 0.3);
        marks.add(new THREE.Mesh(ribbon(k.z0, k.z1, (z) => road_x(z) + off, (z) => road_y(z) + 0.02, 0.4, 2), mark_mat(k.color, 0.9)));
      }
      marks.add(new THREE.Mesh(ribbon(k.z0, k.z1, road_x, (z) => road_y(z) + 0.015, road_w - 1, 2), mark_mat(k.color, 0.16)));
    }
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
    if (model.flame.visible) {
      model.flame.scale.set(1, 0.8 + Math.random() * 0.6, 1);
      if (model.look.flame === 'rainbow') model.flame.material.color.copy(rainbow(t_total));
      // nitro trail: puffs left behind the rear wheel in the chosen style
      const trail = model.look.trail;
      if (trail && trail !== 'none' && dt > 0) {
        model.trail_acc = (model.trail_acc ?? 0) + 40 * Math.min(dt, 0.1);
        const yaw = model.group.rotation.y;
        while (model.trail_acc >= 1) {
          model.trail_acc -= 1;
          const col = trail === 'rainbow' ? '#' + rainbow(t_total + Math.random() * 0.2).getHexString()
            : { sparks: Math.random() < 0.5 ? '#ffd54f' : '#ff8a00', smoke: '#9e9e9e', stars: Math.random() < 0.5 ? '#fff59d' : '#ffffff' }[trail];
          spawn_puff(x + Math.sin(yaw) * 0.9, model.group.position.y + 0.25 + Math.random() * 0.5, s.z + Math.cos(yaw) * 0.9, trail === 'smoke' ? 2 : 1, col);
        }
      }
    }
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
    if (z > cz - 0.3) return 1;   // behind the camera: not in the main view (but visible in a mirror)
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
    if (sc.village && text === 'FINISH') add_crowd(z);
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

  // ---- weather, sunset, water and villages ----

  const precip = sc.weather === 'rain' ? make_precip(scene, sc.season === 'winter') : null;
  if (sc.weather !== 'clear') {
    // mountains disappear into the weather (they normally skip scene fog)
    for (const m of backdrop.group.children) { m.material.fog = true; m.material.needsUpdate = true; }
  }
  if (sc.weather === 'fog') backdrop.clouds.visible = false;

  // sunset ride: over dusk_s the light goes from day to a golden sunset to night (stars come out)
  const dusk_s = 480;
  const day = { sky: theme.sky, fog: theme.fog, hemi: theme.hemi, key: theme.key, key_dir: theme.key_dir, cloud: theme.cloud };
  const night_t = themes.night;
  let dusk_stars = null, dusk_clock = 0;
  if (sc.dusk) {
    const pts = [];
    for (let i = 0; i < 500; i++) {
      const a = Math.random() * Math.PI * 2, e = 0.2 + Math.random() * 1.2;
      pts.push(Math.cos(a) * Math.cos(e) * 1800, Math.sin(e) * 1800, Math.sin(a) * Math.cos(e) * 1800);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    dusk_stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0 }));
    scene.add(dusk_stars);
  }
  const ca = new THREE.Color(), cb = new THREE.Color();
  const mix = (a, b, t) => '#' + ca.set(a).lerp(cb.set(b), t).getHexString();
  function update_dusk(dt, cx, cz) {
    dusk_clock += dt;
    if (dusk_clock < 1) return;   // repaint once a second
    const p = Math.min(1, t_total / dusk_s);
    dusk_clock = 0;
    const [a, b, t] = p < 0.5 ? [day, dusk_pal, p * 2] : [dusk_pal, { ...night_t, cloud: night_t.cloud }, (p - 0.5) * 2];
    const fog = mix(a.fog, b.fog, t);
    paint_sky(mix(a.sky[0], b.sky[0], t), mix(a.sky[1], b.sky[1], t), fog);
    scene.background.needsUpdate = true;
    scene.fog.color.set(fog);
    base.material.color.set(fog);
    hemi.color.set(mix(a.hemi[0], b.hemi[0], t));
    hemi.groundColor.set(mix(a.hemi[1], b.hemi[1], t));
    hemi.intensity = a.hemi[2] + (b.hemi[2] - a.hemi[2]) * t;
    sun.color.set(mix(a.key[0], b.key[0], t));
    sun.intensity = a.key[1] + (b.key[1] - a.key[1]) * t;
    sun_off.set(...a.key_dir.map((v, i) => v + (b.key_dir[i] - v) * t));
    for (const c of backdrop.clouds.children) { c.material.color.set(mix(a.cloud, b.cloud, t)); c.material.emissive.set(c.material.color); }
    dusk_stars.material.opacity = smoothstep(0.6, 0.95, p);
    dusk_stars.position.set(cx, 0, cz);
  }

  // water meshes for rivers / lakes near the camera (bridge rails over rivers), made when needed
  const water_mat = new THREE.MeshStandardMaterial({
    color: sc.season === 'winter' ? '#cfe3ee' : theme.stars ? '#1d3a6a' : '#3f86b8',
    roughness: sc.season === 'winter' ? 0.6 : 0.15, metalness: 0.1, transparent: true, opacity: sc.season === 'winter' ? 0.95 : 0.85, flatShading: true,
  });
  const rail_mat = flat_mat('#8a6a48');
  const waters = new Map();
  function update_water(cz) {
    ambience.water = 0;
    if (!sc.water) return;
    const want = new Set();
    const k0 = Math.round(-cz / river_gap), j0 = Math.floor(-cz / lake_gap);
    for (let k = k0 - 1; k <= k0 + 1; k++) {
      const r = river(k);
      if (!r || r.z > cz + 200 || r.z < cz - 1400) continue;
      want.add('r' + k);
      if (waters.has('r' + k)) continue;
      const g = new THREE.Group();
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1400, r.w * 0.9, 40, 2).rotateX(-Math.PI / 2), water_mat);
      sheet.position.set(road_x(r.z), r.level, r.z);
      g.add(sheet);
      // bridge: rails and posts along both road edges over the water
      const span = r.w * 0.75 + 4, yaw = heading(r.z), bx = road_x(r.z), by = road_y(r.z);
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, span), rail_mat);
        rail.position.set(bx + side * (road_edge + 0.1), by + 1.0, r.z);
        rail.rotation.y = yaw;
        g.add(rail);
        for (let q = -span / 2; q <= span / 2; q += 2.5) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.14), rail_mat);
          post.position.set(bx + side * (road_edge + 0.1), by + 0.5, r.z + q);
          g.add(post);
        }
      }
      const deck = new THREE.Mesh(new THREE.BoxGeometry(road_w + 0.6, 0.5, span), flat_mat('#7d7468'));
      deck.position.set(bx, by - 0.27, r.z);
      deck.rotation.y = yaw;
      g.add(deck);
      scene.add(g);
      waters.set('r' + k, g);
    }
    for (let j = j0 - 2; j <= j0 + 12; j++) {
      const l = lake(j);
      if (!l || l.z > cz + 200 || l.z < cz - 1400) continue;
      want.add('l' + j);
      if (waters.has('l' + j)) continue;
      const m = new THREE.Mesh(new THREE.CircleGeometry(l.r * 1.02, 24).rotateX(-Math.PI / 2), water_mat);
      m.position.set(l.x, l.level, l.z);
      scene.add(m);
      waters.set('l' + j, m);
    }
    for (const [, o] of waters) {
      const p = o.children?.[0]?.position ?? o.position;   // river sheet or lake
      const d = o.children?.length ? Math.abs(p.z - cz) : Math.hypot(p.x - camera.position.x, p.z - cz) - o.geometry.parameters.radius;
      ambience.water = Math.max(ambience.water, 1 - smoothstep(15, 140, d));
    }
    for (const [k, o] of waters) {
      if (want.has(k)) continue;
      scene.remove(o);
      o.traverse((c) => c.geometry?.dispose());
      waters.delete(k);
    }
  }

  // villages: a few houses by the road every ~2.5 km; a bigger one with a cheering crowd at a finish arch
  const house_mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
  const village_gap = 2500;
  const villages = new Map();
  function add_houses(g, z_mid, len, count, rnd) {
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? -1 : 1;
      const z = z_mid + (rnd() - 0.5) * len;
      const x = road_x(z) + side * (road_edge + 9 + rnd() * 14);
      if (wet(x, z) > 0.05) continue;
      const h = new THREE.Mesh(house_geom(rnd, sc.season === 'winter'), house_mat);
      h.castShadow = h.receiveShadow = true;
      h.position.set(x, ground(x, z) - 0.2, z);
      h.rotation.y = heading(z) + (side > 0 ? -Math.PI / 2 : Math.PI / 2) + (rnd() - 0.5) * 0.3;   // front door to the road
      g.add(h);
    }
  }
  function update_villages(cz) {
    if (!sc.village) return;
    const k0 = Math.round(-cz / village_gap);
    for (let k = k0; k <= k0 + 1; k++) {
      if (k < 1 || villages.has(k) || hash2(k, 31) > 0.7) continue;
      const z = -(k * village_gap + (hash2(k, 32) - 0.5) * 800);
      if (z < cz - 1300 || z > cz + 100) continue;
      const g = new THREE.Group();
      add_houses(g, z, 90, 5 + Math.floor(hash2(k, 33) * 5), seeded(k * 77 + 1));
      scene.add(g);
      villages.set(k, g);
    }
    for (const [k, g] of villages) {
      if (Math.abs(k - k0) <= 1) continue;
      scene.remove(g);
      g.traverse((c) => c.geometry?.dispose());
      villages.delete(k);
    }
  }

  // finish crowd: spectators behind barriers on both sides; they jump and wave when you come close
  const crowd = [];
  function add_crowd(z) {
    const rnd = seeded(Math.round(-z) + 5);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    const g = new THREE.Group();
    for (const side of [-1, 1]) {
      const fence = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 70), flat_mat('#e8e8e8'));
      fence.position.set(road_x(z + 25) + side * (road_edge + 0.6), road_y(z + 25) + 0.45, z + 25);
      fence.rotation.y = heading(z + 25);
      g.add(fence);
      for (let q = -10; q < 60; q += 1.7) {
        if (rnd() < 0.25) continue;
        const zz = z + q, x = road_x(zz) + side * (road_edge + 1.4 + rnd() * 1.2);
        const h = make_hiker(mat, rnd, false);
        h.root.visible = true;
        h.root.position.set(x, ground(x, zz), zz);
        h.root.rotation.y = heading(zz) + side * Math.PI / 2;   // face the road
        h.base_y = h.root.position.y;
        g.add(h.root);
        crowd.push(h);
      }
    }
    // a flat, tree-free square around the finish for the houses
    flat_zones.push({ x: road_x(z - 30), z: z - 30, r: 75 });
    invalidate(z + 60, z - 120);
    add_houses(g, z - 40, 120, 8, rnd);
    return keep(g);
  }
  function update_crowd(dt, cz) {
    ambience.crowd = 1 - smoothstep(20, 160, Math.min(...crowd.map((h) => Math.abs(h.root.position.z - cz))));
    for (const h of crowd) {
      const near = Math.abs(h.root.position.z - cz) < 70;
      h.phase += dt * (near ? 9 + (h.phase % 1) * 3 : 2);
      h.root.position.y = h.base_y + (near ? Math.max(0, Math.sin(h.phase)) * 0.25 : 0);
      h.arms.forEach((a, i) => { a.rotation.z = (i ? 1 : -1) * (near ? 2.6 + Math.sin(h.phase * 1.3 + i) * 0.4 : 0.15); a.rotation.x = 0; });
    }
  }

  // what this ride rolled, shown for a few seconds at the start
  if (sc.label && canvas.parentElement) {
    const toast = document.createElement('div');
    toast.className = 'scene-toast';
    toast.textContent = '🎲 ' + sc.label;
    canvas.parentElement.appendChild(toast);
    mood_layers.push(toast);
    setTimeout(() => toast.classList.add('gone'), 6000);
  }

  // f = { focus_z (where the action is), speed (visual m/s for wind), boost, look_back (camera looks backwards) }
  let last_cz = 0;
  function frame(dt, f) {
    t_total += dt;
    const cz = camera.position.z, cx = camera.position.x;
    update_chunks(f.look_back ? cz : Math.min(cz, f.focus_z + 10), f.look_back ? 5 : 1, warmed ? 1 : Infinity);
    if (!warmed) { warmed = true; warm_up(); }
    update_camps(cz);
    update_wild(dt, cz);
    precip?.update(dt, cx, camera.position.y, cz, f.speed ?? 0);
    if (sc.dusk) update_dusk(dt, cx, cz);
    update_water(cz);
    update_villages(cz);
    if (crowd.length) update_crowd(dt, cz); else ambience.crowd = 0;
    ambience.rain = !!precip && sc.season !== 'winter';
    ambience.birds = theme.birds && sc.weather === 'clear' && (!sc.dusk || t_total < dusk_s * 0.5);
    wild?.birds?.update(dt, cx, cz);
    wind.update(dt, cz, cx, f.speed ?? 0, !!f.boost);
    update_dust(dt);
    backdrop.group.position.set(cx, road_y(cz), cz);
    backdrop.update_clouds(dt, Math.min(5, Math.max(0, last_cz - cz)));
    last_cz = cz;
    backdrop.clouds.position.set(cx, road_y(cz), cz);
    if (backdrop.stars) backdrop.stars.position.set(cx, 0, cz);
    base.position.set(cx, road_y(cz) - 1.5, cz);
    const fz = f.focus_z;
    sun.target.position.set(road_x(fz - 45), road_y(fz - 45), fz - 45);
    sun.position.copy(sun.target.position).add(sun_off);
    renderer.render(scene, camera);
    if (f.mirror) render_mirror(f.mirror);
    adapt_resolution();
  }

  // rear-view mirror: a small inset at the top showing the road behind the rider at m.z
  // m = { z, top (px from the top of the canvas), look_z (optional: aim at a rider behind) }
  const mirror_cam = new THREE.PerspectiveCamera(30, 2.4, 0.5, 600);   // zoomed in: riders behind read clearly
  let mirror_frame = null;
  function render_mirror(m) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const mw = Math.round(Math.min(w * 0.62, 340)), mh = Math.round(mw / 2.4);
    const mx = Math.round((w - mw) / 2), my = Math.round(m.top ?? 70);
    const yaw = heading(m.z);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const x = road_x(m.z), y = road_y(m.z);
    mirror_cam.position.set(x + fx * 0.6, y + 2.2, m.z + fz * 0.6);
    const lz = m.look_z ?? m.z - fz * 40;
    mirror_cam.lookAt(road_x(lz), road_y(lz) + 0.8, lz);
    mirror_cam.aspect = mw / mh;
    mirror_cam.updateProjectionMatrix();
    renderer.setScissorTest(true);
    renderer.setScissor(mx, h - my - mh, mw, mh);
    renderer.setViewport(mx, h - my - mh, mw, mh);
    renderer.shadowMap.autoUpdate = false;   // reuse this frame's shadow map: the mirror would redraw it
    renderer.render(scene, mirror_cam);
    renderer.shadowMap.autoUpdate = true;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    // frame around the mirror (html, so it stays crisp)
    if (!mirror_frame) {
      mirror_frame = document.createElement('div');
      mirror_frame.className = 'mirror-frame';
      canvas.parentElement?.appendChild(mirror_frame);
      mood_layers.push(mirror_frame);
    }
    Object.assign(mirror_frame.style, { left: `${mx}px`, top: `${my}px`, width: `${mw}px`, height: `${mh}px`, display: 'block' });
  }
  function hide_mirror() { if (mirror_frame) mirror_frame.style.display = 'none'; }

  function dispose() {
    Object.assign(ambience, { rain: false, water: 0, crowd: 0, birds: false });
    dispose_scene(scene);
    for (const d of mood_layers) d.remove();
  }

  return {
    THREE, scene, camera, theme, scenery: sc, hemi, sun, ground, road_x, road_y, heading, road_w, road_edge,
    get portrait() { return portrait; },
    set_road_end(z) { road_end = z; },
    add_flat_zone(x, z, r) { flat_zones.push({ x, z, r }); },
    clear_flat_zones() { flat_zones.length = 0; },
    add_rider, remove_rider, set_marks, place_rider, fade_for, chase, add_arch, add_board, add_sign, add_trail, remove, invalidate,
    frame, resize, dispose, hide_mirror, wild,
  };
}

// garage preview: the rider on a slowly turning disc, pedalling. returns { set(look), dispose() }
export function rider_preview(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#e8f0ff', '#40503a', 1.2));
  const sun = new THREE.DirectionalLight('#fff2dd', 2.4);
  sun.position.set(-3, 5, 4);
  scene.add(sun);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.12, 24), flat_mat('#2c3a48'));
  disc.position.y = -0.06;
  scene.add(disc);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  cam.position.set(0, 1.5, 4.4);
  cam.lookAt(0, 0.75, 0);
  let model = null, raf = 0, last = performance.now(), crank = 0, alive = true;
  function set(look) {
    if (model) { scene.remove(model.group); model.mats.forEach((m) => { m.map?.dispose(); m.dispose(); }); }
    model = make_rider(look);
    model.flame.visible = true;   // show off the nitro flame
    scene.add(model.group);
  }
  function tick(ts) {
    if (!alive) return;
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * r.getPixelRatio())) { r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    crank += dt * 9;
    if (model) {
      model.group.rotation.y += dt * 0.5;
      for (const wh of model.wheels) wh.rotation.x -= dt * 7;
      animate_rider(model, { watts: 180, v: 8, crank }, dt, 200, false);
      if (model.look.flame === 'rainbow') model.flame.material.color.copy(rainbow(ts / 1000));
      model.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
    }
    r.render(scene, cam);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  return { set, dispose() { alive = false; cancelAnimationFrame(raf); dispose_scene(scene); r.dispose(); } };
}

// shared "scenery" option for every 3d game
export const scenery_option = () => ({ key: 'scenery', label: 'Scenery', choices: [[surprise_id, '🎲 Surprise me'], ...Object.entries(themes).map(([id, t]) => [id, t.name])], def: surprise_id });
