// 3d world with three.js in a low-poly, flat-shaded style: faceted hills, mountains, trees, rocks,
// soft shadows, fog, wind streaks. three scenery themes (meadow, valley, night).
// race coordinates: rider x (meters along the course). the scenery is drawn vis_scale times faster than the
// physics (the world flies by), while riders keep their real gaps to the player so the pack looks natural
import * as THREE from 'three';
import { seeded } from './util.js?v=15';

export const vis_scale = 2.5;              // visual speed multiplier (speed numbers and physics are unchanged)
const lane_w = 1.1;                        // meters per lane
const lane_count = 6;
const road_w = lane_count * lane_w + 1;    // lanes + 0.5 m shoulder on each side
const road_edge = road_w / 2;
const lane_x = (lane) => (lane - (lane_count - 1) / 2) * lane_w;
const chunk_len = 120;                     // terrain chunk length (visual meters)
const chunk_count = 9;                     // chunks alive at once: 1 behind the camera, 8 ahead

// ---- themes: colour palettes + light + tree mix, inspired by low-poly landscape art ----
export const themes = {
  meadow: {
    name: 'Sunny meadow',
    sky: ['#5aa9e6', '#d8eef6'], fog: '#cfe6ee', fog_range: [60, 650],
    hemi: ['#d6ecff', '#6f8f3a', 1.4], sun: ['#fff1d2', 2.6], sun_dir: [-30, 45, 20],
    grass: ['#8cc63f', '#7db83a', '#9bcc4f', '#a8c94a', '#86bd45'], high: ['#b9a26f', '#a88d62'],
    mountain: ['#a68a6d', '#937759', '#bba083', '#7f6650'], snow: null,
    round: ['#7cc144', '#8bcB4a', '#6fb33d', '#9ad15a'], pine: ['#4f9a3c', '#3f8a35'], trunk: '#7a4a2a', rock: ['#9e9a92', '#8a857c'],
    mix: { round: 0.65, pine: 0.2, rock: 0.15 }, asphalt: '#5b5e66', clouds: '#ffffff', stars: false,
  },
  valley: {
    name: 'Misty valley',
    sky: ['#b9cfae', '#eef0d6'], fog: '#dfe6c9', fog_range: [40, 520],
    hemi: ['#f0f4dc', '#4f7a4a', 1.5], sun: ['#fff6dc', 2.0], sun_dir: [25, 40, 10],
    grass: ['#5f9e4f', '#57944a', '#6aa858', '#76ad5c', '#4f8c45'], high: ['#3f8f7a', '#357d69'],
    mountain: ['#3f8f7a', '#2f7563', '#5aa38a', '#46907c'], snow: null,
    round: ['#5aa35a', '#4f9650'], pine: ['#2e6b55', '#28604c', '#357a5f'], trunk: '#5b3b26', rock: ['#7d8a80', '#6d786f'],
    mix: { round: 0.15, pine: 0.65, rock: 0.2 }, asphalt: '#5a5550', clouds: '#f4f6e8', stars: false,
  },
  night: {
    name: 'Starry night',
    sky: ['#0b1634', '#2a4a7c'], fog: '#1d3159', fog_range: [40, 520],
    hemi: ['#6f8fd0', '#1d3a2a', 1.3], sun: ['#b8cfff', 1.6], sun_dir: [20, 50, -30],
    grass: ['#2f7d3a', '#38894a', '#2a6d35', '#3f9a4c', '#2c7540'], high: ['#3a4c6e', '#435780'],
    mountain: ['#46577a', '#56688e', '#3a4a6a', '#61739a'], snow: '#dfe8f5',
    round: ['#3f8f45', '#2f7d3a'], pine: ['#2e7d32', '#25692b', '#36883a'], trunk: '#5a3420', rock: ['#5b6478', '#4d5568'],
    mix: { round: 0.1, pine: 0.75, rock: 0.15 }, asphalt: '#2f3240', clouds: '#9fb0d6', stars: true,
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

// terrain height: flat along the road, rolling hills that grow towards the sides (a valley)
function height_at(x, z) {
  const d = Math.abs(x) - (road_edge + 1.5);
  if (d <= 0) return -0.05;
  const ramp = smoothstep(0, 45, d);
  const n = vnoise(x / 55, z / 55) * 0.75 + vnoise(x / 18 + 31, z / 18) * 0.25;
  return -0.05 + n * (4 + d * 0.22) * ramp;
}

// random colour from a palette with a small brightness jitter (keeps facets distinct)
const tmp_color = new THREE.Color();
function palette_color(list, r, out = tmp_color) {
  out.set(list[Math.floor(r * list.length) % list.length]);
  out.offsetHSL(0, 0, (r * 7 % 1 - 0.5) * 0.06);
  return out;
}

function flat_mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1, metalness: 0, ...extra });
}

// jitter vertices of a geometry for a hand-made faceted look (seeded)
function jitter(geom, amount, rnd) {
  const p = geom.attributes.position;
  // merge identical positions first, so faces stay connected after jittering
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, [(rnd() - 0.5) * amount, (rnd() - 0.5) * amount, (rnd() - 0.5) * amount]);
    const [dx, dy, dz] = seen.get(key);
    p.setXYZ(i, p.getX(i) + dx, p.getY(i) + dy, p.getZ(i) + dz);
  }
  geom.computeVertexNormals();
  return geom;
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

// ---- terrain chunks (recycled as the camera moves) ----

// x columns of the terrain grid: fine near the road, coarse far away
const xs = (() => {
  const right = [road_edge - 0.05, road_edge + 1.5, road_edge + 5, 12, 18, 26, 36, 50, 66, 86, 110, 140, 180, 230, 300, 400, 550];
  return [...right.map((x) => -x).reverse(), ...right];
})();
const z_step = 12;

function build_chunk_geometry(geom, z0, theme) {
  // z0 = start (visual z, negative = ahead). rows every z_step, global row index keeps seams identical
  const rows = Math.round(chunk_len / z_step);
  const row0 = Math.round(-z0 / z_step);
  const pos = [], col = [];
  const vtx = (ci, ri) => {
    const gx = xs[ci], gr = row0 + ri;
    // jitter interior columns sideways and every row along z (hash of global indices: seams match)
    const edge_col = ci === xs.length / 2 - 1 || ci === xs.length / 2;
    const jx = edge_col ? 0 : (hash2(ci, gr) - 0.5) * Math.min(14, Math.abs(gx) * 0.12);
    const jz = (hash2(ci + 101, gr) - 0.5) * z_step * 0.6;
    const x = gx + jx, z = -gr * z_step + jz;
    return [x, height_at(x, z), z];
  };
  for (let ri = 0; ri < rows; ri++) {
    for (let ci = 0; ci < xs.length - 1; ci++) {
      if (ci === xs.length / 2 - 1) continue;   // the road strip has no terrain
      const a = vtx(ci, ri), b = vtx(ci + 1, ri), c = vtx(ci, ri + 1), d = vtx(ci + 1, ri + 1);
      for (const tri of [[a, b, c], [b, d, c]]) {   // counter-clockwise seen from above
        const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
        const r = hash2(Math.round(tri[0][0] * 10 + tri[1][2]), Math.round(tri[2][2] * 10 + cy * 7));
        // higher ground drifts towards the "high" palette (dry grass, rock, teal slopes)
        const list = cy > 18 + r * 10 ? theme.high : theme.grass;
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

// ---- instanced props: trees, rocks, roadside posts ----

function make_props(scene, theme) {
  const per_chunk = 70;
  const n = per_chunk * chunk_count;
  const rnd = seeded(7);
  const mk = (geom, color, count = n) => {
    const m = new THREE.InstancedMesh(geom, flat_mat(color), count);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;   // instances move around; bounds would be stale
    scene.add(m);
    return m;
  };
  // round tree: faceted crown on a short trunk (image-1 style)
  const crown = jitter(new THREE.IcosahedronGeometry(1.7, 0), 0.6, rnd).translate(0, 3.6, 0);
  const trunk = new THREE.CylinderGeometry(0.22, 0.34, 2.4, 5).translate(0, 1.2, 0);
  // pine: two stacked cones (image-4 style)
  const pine_a = jitter(new THREE.ConeGeometry(1.5, 3.2, 6), 0.25, rnd).translate(0, 2.6, 0);
  const pine_b = jitter(new THREE.ConeGeometry(1.05, 2.4, 6), 0.2, rnd).translate(0, 4.4, 0);
  const rock = jitter(new THREE.DodecahedronGeometry(1, 0), 0.5, rnd).translate(0, 0.4, 0);
  const post = new THREE.BoxGeometry(0.12, 1.0, 0.12).translate(0, 0.5, 0);
  const posts_per_chunk = Math.ceil(chunk_len / 25) * 2 + 2;
  const props = {
    per_chunk, posts_per_chunk,
    crown: mk(crown, '#ffffff'), trunk: mk(trunk, theme.trunk),
    pine_a: mk(pine_a, '#ffffff'), pine_b: mk(pine_b, '#ffffff'), pine_trunk: mk(trunk, theme.trunk),
    rock: mk(rock, '#ffffff'),
    post: mk(post, '#f4f4f4', posts_per_chunk * chunk_count),
  };
  props.post.castShadow = false;
  return props;
}

const m4 = new THREE.Matrix4();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
const quat = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const scl = new THREE.Vector3();
const vpos = new THREE.Vector3();

// place this chunk's trees / rocks / posts (seeded by the chunk index, so a chunk always looks the same)
function fill_props(props, slot, chunk_i, z0, theme) {
  const rnd = seeded(chunk_i * 7919 + 13);
  const base = slot * props.per_chunk;
  const set = (mesh, i, x, y, z, s, rot, color) => {
    quat.setFromAxisAngle(up, rot);
    mesh.setMatrixAt(i, m4.compose(vpos.set(x, y, z), quat, scl.set(s, s * (0.85 + rnd() * 0.3), s)));
    if (color) mesh.setColorAt(i, color);
  };
  for (let k = 0; k < props.per_chunk; k++) {
    const i = base + k;
    // hide every type at this index, then show the chosen one
    for (const m of [props.crown, props.trunk, props.pine_a, props.pine_b, props.pine_trunk, props.rock]) m.setMatrixAt(i, hidden);
    const side = rnd() < 0.5 ? -1 : 1;
    const x = side * (road_edge + 3 + rnd() ** 1.6 * 260);
    const z = z0 - rnd() * chunk_len;
    const y = height_at(x, z) - 0.1;
    const s = (0.8 + rnd() * 0.7) * (1 + Math.abs(x) / 160);   // bigger far away: reads as forest
    const rot = rnd() * 6.28;
    const kind = rnd();
    if (kind < theme.mix.round) {
      set(props.crown, i, x, y, z, s, rot, palette_color(theme.round, rnd()));
      set(props.trunk, i, x, y, z, s, rot);
    } else if (kind < theme.mix.round + theme.mix.pine) {
      const c = palette_color(theme.pine, rnd());
      set(props.pine_a, i, x, y, z, s, rot, c);
      set(props.pine_b, i, x, y, z, s, rot, c);
      set(props.pine_trunk, i, x, y, z, s * 0.8, rot);
    } else {
      set(props.rock, i, x, y, z, s * (0.6 + rnd()), rot, palette_color(theme.rock, rnd()));
    }
  }
  // white roadside posts every 25 m: strong speed cue
  const pb = slot * props.posts_per_chunk;
  let k = 0;
  const first = Math.ceil(-z0 / 25) * 25;
  for (let d = first; d < -z0 + chunk_len && k < props.posts_per_chunk - 1; d += 25) {
    for (const side of [-1, 1]) props.post.setMatrixAt(pb + k++, m4.makeTranslation(side * (road_edge + 0.7), 0, -d));
  }
  while (k < props.posts_per_chunk) props.post.setMatrixAt(pb + k++, hidden);
  for (const m of Object.values(props)) {
    if (m.isInstancedMesh) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

// ---- backdrop: faceted mountain ring, clouds, stars ----

function make_backdrop(scene, theme) {
  const group = new THREE.Group();
  const rnd = seeded(42);
  const fog = new THREE.Color(theme.fog);
  // mountains ignore scene fog (they're beyond it) and get a fixed haze mixed into their colours instead
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, fog: false });
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rnd() * 0.2;
    const r = 760 + rnd() * 260;
    const hgt = 140 + rnd() * 220;
    const g = jitter(new THREE.ConeGeometry(130 + rnd() * 120, hgt, 7, 3), 30, rnd).toNonIndexed();
    const p = g.attributes.position;
    const col = [];
    for (let t = 0; t < p.count; t += 3) {
      const cy = (p.getY(t) + p.getY(t + 1) + p.getY(t + 2)) / 3 / hgt + 0.5;   // 0 bottom .. 1 top
      palette_color(theme.mountain, rnd());
      if (theme.snow && cy > 0.72) tmp_color.set(theme.snow);
      tmp_color.lerp(fog, 0.15 + (r - 760) / 1300);   // farther = hazier
      for (let j = 0; j < 3; j++) col.push(tmp_color.r, tmp_color.g, tmp_color.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.position.set(Math.cos(a) * r, hgt / 2 - 25, Math.sin(a) * r);
    m.rotation.y = rnd() * 6.28;
    group.add(m);
  }
  scene.add(group);

  // low-poly clouds: clusters of flattened icosahedrons
  const clouds = new THREE.Group();
  const cloud_mat = new THREE.MeshStandardMaterial({ color: theme.clouds, flatShading: true, roughness: 1, fog: false, emissive: theme.clouds, emissiveIntensity: 0.35 });
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(14 + rnd() * 10, 0), 6, rnd), cloud_mat);
      puff.position.set(j * 16 - 24, rnd() * 6, rnd() * 10);
      puff.scale.y = 0.55;
      c.add(puff);
    }
    const a = rnd() * Math.PI * 2;
    c.position.set(Math.cos(a) * (300 + rnd() * 300), 110 + rnd() * 70, Math.sin(a) * (300 + rnd() * 300) - 200);
    clouds.add(c);
  }
  scene.add(clouds);

  let stars = null;
  if (theme.stars) {
    const pts = [];
    for (let i = 0; i < 500; i++) {
      const a = rnd() * Math.PI * 2, e = 0.08 + rnd() * 1.3;
      pts.push(Math.cos(a) * Math.cos(e) * 1400, Math.sin(e) * 1400, Math.sin(a) * Math.cos(e) * 1400);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, fog: false }));
    scene.add(stars);
    const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(30, 1), new THREE.MeshBasicMaterial({ color: '#f4f1de', fog: false }));
    moon.position.set(400, 520, -1100);
    stars.add(moon);
  }
  return { group, clouds, stars };
}

// ---- road, start, finish, km boards ----

function road_texture(theme) {
  return canvas_texture(256, 256, (g, w, h) => {
    g.fillStyle = theme.asphalt;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.08)';
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    const ppm = w / road_w;
    const line_w = 0.12 * ppm;
    for (let i = 0; i <= lane_count; i++) {
      const x = (0.5 + i * lane_w) * ppm - line_w / 2;
      const edge = i === 0 || i === lane_count;
      g.fillStyle = edge ? '#f2f2f2' : 'rgba(255,255,255,0.6)';
      g.fillRect(x, 0, line_w, edge ? h : h / 2);   // dashes: half a tile line, half gap
    }
  });
}

function build_course(scene, race, theme) {
  const vis_len = (race.distance_m + 400) * vis_scale;
  const tex = road_texture(theme);
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, vis_len / 8);   // one tile = 8 visual meters
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const road = new THREE.Mesh(new THREE.PlaneGeometry(road_w, vis_len), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  road.rotation.x = -Math.PI / 2;
  road.position.z = 150 - vis_len / 2;
  road.receiveShadow = true;
  scene.add(road);

  const start = new THREE.Mesh(new THREE.PlaneGeometry(road_w, 0.5), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  start.rotation.x = -Math.PI / 2;
  start.position.set(0, 0.01, 0);
  scene.add(start);

  // finish: checkered strip + low-poly arch with banner
  const fz = -race.distance_m * vis_scale;
  const checker = canvas_texture(64, 64, (g) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#111'; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
  });
  checker.wrapS = checker.wrapT = THREE.RepeatWrapping;
  checker.repeat.set(road_w / 0.5, 2);
  const finish = new THREE.Mesh(new THREE.PlaneGeometry(road_w, 1), new THREE.MeshBasicMaterial({ map: checker }));
  finish.rotation.x = -Math.PI / 2;
  finish.position.set(0, 0.012, fz);
  scene.add(finish);
  const pole_mat = flat_mat('#e8e8e8');
  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 5.2, 6), pole_mat);
    pole.position.set(side * (road_edge + 0.5), 2.6, fz);
    pole.castShadow = true;
    scene.add(pole);
  }
  const red = flat_mat('#d84343');
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(road_w + 1.6, 1.2, 0.2),
    [red, red, red, red, new THREE.MeshBasicMaterial({ map: text_texture('FINISH', '#d84343', '#ffffff', 1024, 160) }), red],
  );
  banner.position.set(0, 4.8, fz);
  banner.castShadow = true;
  scene.add(banner);

  // distance boards every 500 m
  for (let m = 500; m < race.distance_m; m += 500) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.7), new THREE.MeshBasicMaterial({ map: text_texture(`${m / 1000} km`, '#ffffff', '#1b1b1b', 256, 96) }));
    board.position.set(road_edge + 1.8, 1.8, -m * vis_scale);
    scene.add(board);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.45, 5), pole_mat);
    post.position.set(road_edge + 1.8, 0.72, -m * vis_scale);
    scene.add(post);
  }
}

// ---- riders (low-poly, flat shaded) ----

const shared_mats = {
  frame: flat_mat('#e6e6e6'),
  tire: flat_mat('#1b1b1b'),
  skin: flat_mat('#f1c27d'),
  shorts: flat_mat('#26262c'),
  crank: flat_mat('#8d8d8d'),
};

// unit cylinder stretched between two points (frame tubes, limbs)
const unit_cyl = new THREE.CylinderGeometry(1, 1, 1, 6);
const y_axis = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
function make_bar(material, radius) {
  const m = new THREE.Mesh(unit_cyl, material);
  m.userData.radius = radius;
  m.castShadow = true;
  return m;
}
function place_bar(mesh, a, b) {
  tmp.subVectors(b, a);
  const len = tmp.length();
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.scale.set(mesh.userData.radius, len, mesh.userData.radius);
  mesh.quaternion.setFromUnitVectors(y_axis, tmp.normalize());
}

// side-view coordinates (forward f, up u, sideways s) -> rider-local 3d point
const v = (f, u, s = 0) => new THREE.Vector3(s, u, -f);
const wheel_r = 0.34;
const geo = { bb: [-0.05, 0.3], hip: [-0.22, 1.0] };

function make_wheel(mats) {
  const w = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(wheel_r - 0.02, 0.03, 5, 14), mats.tire);
  tire.rotation.y = Math.PI / 2;
  tire.castShadow = true;
  w.add(tire);
  for (const rot of [0, Math.PI / 2]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.012, wheel_r * 2 - 0.05, 0.03), mats.crank);
    spoke.rotation.x = rot;
    w.add(spoke);
  }
  return w;
}

function make_rider(color) {
  const g = new THREE.Group();
  const jersey = flat_mat(color);
  // own copies of the shared materials, so this rider can fade out when it's close to the camera
  const mats = { jersey };
  for (const [k, m] of Object.entries(shared_mats)) mats[k] = m.clone();
  const add_bar = (mat, radius, a, b) => {
    const m = make_bar(mat, radius);
    if (a) place_bar(m, a, b);
    g.add(m);
    return m;
  };

  const wheels = [-0.5, 0.52].map((f) => {
    const w = make_wheel(mats);
    w.position.copy(v(f, wheel_r));
    g.add(w);
    return w;
  });

  const p = { rear: v(-0.5, 0.34), bb: v(...geo.bb), seat: v(-0.22, 0.92), bar: v(0.42, 0.98), front: v(0.52, 0.34) };
  const f = mats.frame;
  add_bar(f, 0.022, p.rear, p.bb);
  add_bar(f, 0.024, p.bb, p.seat);
  add_bar(f, 0.02, p.seat, p.rear);
  add_bar(f, 0.024, p.seat, p.bar);
  add_bar(f, 0.027, p.bb, p.bar);
  add_bar(f, 0.022, p.bar, p.front);
  add_bar(f, 0.018, v(0.42, 0.98, -0.2), v(0.42, 0.98, 0.2));

  // torso: a faceted box-ish body, arms, head + helmet (low segment counts = visible facets)
  add_bar(jersey, 0.16, v(-0.22, 1.0), v(0.22, 1.4));
  for (const s of [-1, 1]) add_bar(jersey, 0.05, v(0.2, 1.38, s * 0.17), v(0.42, 0.99, s * 0.2));
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), mats.skin);
  head.position.copy(v(0.36, 1.56));
  head.castShadow = true;
  g.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), jersey);
  helmet.position.copy(v(0.35, 1.58));
  helmet.scale.set(1, 0.9, 1.25);
  helmet.castShadow = true;
  g.add(helmet);

  // nitro flame behind the rear wheel, visible only while boosting
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.15, 0.9, 6),
    new THREE.MeshBasicMaterial({ color: '#ff8a00', transparent: true, opacity: 0.9, depthWrite: false }),
  );
  flame.rotation.x = Math.PI / 2;
  flame.position.copy(v(-1.0, 0.32));
  flame.visible = false;
  g.add(flame);

  const legs = [-1, 1].map((s) => ({
    side: s * 0.11,
    thigh: add_bar(mats.shorts, 0.07),
    shin: add_bar(mats.shorts, 0.052),
    crank: add_bar(mats.crank, 0.016),
  }));
  return { group: g, wheels, legs, flame, mats: Object.values(mats), faded: false };
}

// thigh + shin from hip to pedal; knee from two-segment inverse kinematics (side view, up positive)
function pose_leg(leg, angle) {
  const crank_len = 0.17, seg = 0.46;
  const [bx, by] = geo.bb, [hx, hy] = geo.hip;
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
  place_bar(leg.shin, v(kx, ky, s), v(fx, fy, s));
  place_bar(leg.crank, v(bx, by, s), v(fx, fy, s));
}

// ---- wind streaks: short lines rushing past the camera, stronger with speed and nitro ----

function make_wind(scene) {
  const n = 160;
  const pos = new Float32Array(n * 6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, fog: false });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  scene.add(lines);
  const pts = Array.from({ length: n }, () => spawn({}, true));

  // random spot in a box around the road ahead of the camera (not right in front of the rider)
  function spawn(p, anywhere = false) {
    do {
      p.x = (Math.random() - 0.5) * 18;
      p.y = 0.2 + Math.random() * 3.6;
    } while (Math.abs(p.x) < 1.3 && p.y < 2.4);
    p.z = anywhere ? -Math.random() * 70 : -55 - Math.random() * 20;
    return p;
  }

  return {
    update(dt, cam_z, cam_x, vis_speed, boost) {
      const len = Math.min(5, 0.25 + vis_speed * 0.09) * (boost ? 1.6 : 1);
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        p.z += vis_speed * (boost ? 1.5 : 1.15) * dt;   // a bit faster than the ground: air rush
        if (p.z > 3) spawn(p);
        const o = i * 6;
        pos[o] = cam_x + p.x; pos[o + 1] = p.y; pos[o + 2] = cam_z + p.z;
        pos[o + 3] = cam_x + p.x; pos[o + 4] = p.y; pos[o + 5] = cam_z + p.z - len;
      }
      g.attributes.position.needsUpdate = true;
      mat.opacity = Math.min(0.55, Math.max(0, (vis_speed - 6) / 45)) + (boost ? 0.3 : 0);
    },
  };
}

// ---- public api ----

// build a fresh 3d world for this race; returns { render(dt), resize(), dispose() }
export function create_world(canvas, race, theme_id = 'meadow') {
  const theme = themes[theme_id] || themes.meadow;
  if (!renderer || renderer.domElement !== canvas) {
    renderer?.dispose();
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = canvas_texture(4, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, theme.sky[0]);
    grad.addColorStop(0.75, theme.sky[1]);
    grad.addColorStop(1, theme.fog);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(theme.fog, ...theme.fog_range);
  scene.add(new THREE.HemisphereLight(theme.hemi[0], theme.hemi[1], theme.hemi[2]));
  const sun = new THREE.DirectionalLight(theme.sun[0], theme.sun[1]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 160 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const sun_off = new THREE.Vector3(...theme.sun_dir);

  // far ground under everything (beyond the terrain grid), same colour as the fog
  const base = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: theme.fog }));
  base.rotation.x = -Math.PI / 2;
  base.position.y = -1;
  scene.add(base);

  build_course(scene, race, theme);
  const backdrop = make_backdrop(scene, theme);
  const props = make_props(scene, theme);
  const terrain_mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  const chunks = Array.from({ length: chunk_count }, (_, slot) => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), terrain_mat);
    mesh.receiveShadow = true;
    scene.add(mesh);
    return { slot, mesh, index: null };
  });
  const wind = make_wind(scene);

  const riders = race.riders.map((r) => {
    const model = make_rider(r.color);
    scene.add(model.group);
    return { r, model };
  });

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2600);
  let base_fov = 60;
  let portrait = false;
  let t_total = 0;

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

  // keep the chunk window around the camera: chunk i covers visual z in [-(i+1)L, -iL]
  function update_chunks(cam_z) {
    const first = Math.floor(-cam_z / chunk_len) - 1;
    const wanted = new Set(Array.from({ length: chunk_count }, (_, k) => first + k));
    const free = chunks.filter((c) => !wanted.has(c.index));
    for (const i of wanted) {
      if (chunks.some((c) => c.index === i)) continue;
      const c = free.pop();
      c.index = i;
      const z0 = -i * chunk_len;
      c.mesh.geometry.dispose();   // fresh geometry: frees the old gpu buffers
      c.mesh.geometry = new THREE.BufferGeometry();
      build_chunk_geometry(c.mesh.geometry, z0, theme);
      fill_props(props, c.slot, i, z0, theme);
    }
  }

  // rider z: the player sits at its scaled position, others keep their real gap to the player
  const p = race.player;
  const rider_z = (r) => -(p.x * vis_scale + (r.x - p.x));
  const model_lx = (r) => riders.find((x) => x.r === r)?.model.lx ?? null;

  function render(dt) {
    t_total += dt;
    const boost = p.nitro.boost_left > 0;
    const back = portrait ? 4.2 : 5.2, height = portrait ? 2.1 : 2.4;
    const cam_z = rider_z(p) + back;   // this frame's camera z (the camera object still holds last frame's)
    for (const { r, model } of riders) {
      // drafting riders slide in behind the wheel they follow (only with room for a bike between them)
      const tx = r.wheel && r.wheel.x - r.x > 1.9 ? (model_lx(r.wheel) ?? lane_x(r.wheel.lane)) : lane_x(r.lane);
      model.lx = model.lx ?? lane_x(r.lane);
      model.lx += (tx - model.lx) * Math.min(1, dt * 1.5);
      model.group.position.set(model.lx, 0, rider_z(r));
      for (const w of model.wheels) w.rotation.x = (r.x * vis_scale) / wheel_r;
      model.legs.forEach((leg, i) => pose_leg(leg, r.crank + i * Math.PI));
      // riders between the camera and the player fade out, so they never block the view
      const near = Math.max(0, Math.min(1, (cam_z - model.group.position.z - 1.5) / 3));
      const fade = !r.is_player && near < 1;
      if (fade || model.faded) {
        for (const m of model.mats) { m.transparent = fade; m.opacity = fade ? 0.15 + 0.85 * near : 1; m.depthWrite = !fade; }
        model.faded = fade;
      }
      model.flame.visible = r.nitro.boost_left > 0;
      if (model.flame.visible) model.flame.scale.set(1, 0.8 + Math.random() * 0.6, 1);
    }

    // chase camera, pulled towards the road centre; a tiny speed shake sells the pace
    const pz = rider_z(p);
    const cx = (riders[0].model.lx ?? lane_x(p.lane)) * 0.5;
    const vis_speed = p.v * vis_scale;
    const shake = Math.min(1, vis_speed / 30) * (boost ? 0.04 : 0.015);
    camera.position.set(cx + Math.sin(t_total * 31) * shake, height + Math.sin(t_total * 23) * shake, pz + back);
    camera.lookAt(cx, portrait ? 0.6 : -0.5, pz - (portrait ? 12 : 9));
    const target_fov = base_fov + (boost ? 14 : 0) + Math.min(6, vis_speed / 8);
    camera.fov += (target_fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();

    update_chunks(camera.position.z);
    wind.update(dt, camera.position.z, cx, vis_speed, boost);
    // backdrop and sun follow the camera (infinitely far away)
    backdrop.group.position.z = camera.position.z;
    backdrop.clouds.position.z = camera.position.z * 0.97;   // a little parallax
    if (backdrop.stars) backdrop.stars.position.z = camera.position.z;
    base.position.z = camera.position.z;
    sun.target.position.set(0, 0, pz - 8);
    sun.position.copy(sun.target.position).add(sun_off);
    renderer.render(scene, camera);
  }

  function dispose() {
    dispose_scene(scene);
  }

  return { render, resize, dispose };
}
