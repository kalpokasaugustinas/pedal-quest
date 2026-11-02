// menu background: a living 2d cycling scene behind the menus. the sky runs through a day
// (golden hour → dusk → night with stars, moon and fireflies → dawn → day) every few minutes,
// clouds drift, hills with pines scroll at different speeds, you ride on the road in your garage
// look with a few riders swapping places beside you, and bird flocks cross the sky.
// cheap on phones: ~30 fps, drawn with plain 2d paths, stopped while a game runs or the tab is hidden.

const tau = Math.PI * 2;
const cycle_s = 240;                 // one full day in seconds
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

// sky keyframes over the day (p = 0..1): sky top + horizon, landscape light (shade colour + amount),
// sun height (-1 below .. 1 high) + x (share of screen width), night amount (stars, moon, fireflies, lights)
const keys = [
  { p: 0.00, top: '#2a3566', hor: '#f2a65e', shade: '#ff9a4a', amt: 0.12, sun: 0.22, sx: 0.74, night: 0 },
  { p: 0.17, top: '#1c1d42', hor: '#c75f78', shade: '#5a3a7a', amt: 0.35, sun: -0.06, sx: 0.84, night: 0.25 },
  { p: 0.30, top: '#060a18', hor: '#1b2548', shade: '#0a1030', amt: 0.62, sun: -0.6, sx: 0.95, night: 1 },
  { p: 0.55, top: '#060a18', hor: '#1d2a50', shade: '#0a1030', amt: 0.62, sun: -0.6, sx: 0.05, night: 1 },
  { p: 0.67, top: '#24305e', hor: '#e8958a', shade: '#8a5a8a', amt: 0.3, sun: 0.0, sx: 0.14, night: 0.2 },
  { p: 0.80, top: '#245585', hor: '#9cc4dc', shade: '#ffffff', amt: 0.04, sun: 0.75, sx: 0.42, night: 0 },
  { p: 0.93, top: '#2a5a88', hor: '#b9cbd6', shade: '#fff2d0', amt: 0.06, sun: 0.6, sx: 0.6, night: 0 },
  { p: 1.00, top: '#2a3566', hor: '#f2a65e', shade: '#ff9a4a', amt: 0.12, sun: 0.22, sx: 0.74, night: 0 },
].map((k) => ({ ...k, top: hex(k.top), hor: hex(k.hor), shade: hex(k.shade) }));

// sky state at day phase p (blend of the two nearest keyframes)
function sky_at(p) {
  let i = 0;
  while (keys[i + 1].p < p) i++;
  const a = keys[i], b = keys[i + 1], t = smooth((p - a.p) / (b.p - a.p));
  const o = {};
  for (const k of Object.keys(a)) o[k] = Array.isArray(a[k]) ? mix(a[k], b[k], t) : lerp(a[k], b[k], t);
  return o;
}

// small seeded random so the hills look the same every visit
function seeded(s) {
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// a landscape layer that tiles every `period` px: a skyline from integer sine waves + trees on top
function make_layer(seed, period, base, height, rough, trees, tree_h, color) {
  const rnd = seeded(seed);
  const waves = [1, 2, 3, 5, 8].map((f) => ({ f, a: rnd() / f ** rough, ph: rnd() * tau }));
  const norm = waves.reduce((s, w) => s + w.a, 0);
  const y_at = (x) => waves.reduce((s, w) => s + w.a * Math.sin((x / period) * tau * w.f + w.ph), 0) / norm;
  const list = Array.from({ length: trees }, () => ({ x: rnd() * period, s: 0.6 + rnd() * 0.7, round: rnd() < 0.25 }));
  return { period, base, height, y_at, list, tree_h, color: hex(color) };
}

const layers = [
  // far mountains, hills with pines, near treeline (base / height are shares of the screen height)
  { speed: 3, haze: 0.38, ...make_layer(11, 1900, 0.6, 0.12, 0.6, 0, 0, '#4a4f86') },
  { speed: 12, haze: 0.2, ...make_layer(23, 1500, 0.7, 0.07, 1.1, 46, 0.035, '#36506a') },
  { speed: 34, haze: 0.1, ...make_layer(37, 1300, 0.8, 0.035, 1.3, 38, 0.06, '#1e3a30') },
];

// one cyclist, side view facing right. look = garage look (jersey, helmet, frame, rim colours)
function draw_rider(g, x, y, r, crank, wheel, c, night, blink) {
  const P = (px, py) => [x + px * r, y + py * r];
  const line = (a, b, w, col) => { g.strokeStyle = col; g.lineWidth = w * r; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); };
  g.lineCap = 'round'; g.lineJoin = 'round';
  // shadow on the road
  g.fillStyle = 'rgba(0,0,0,.28)';
  g.beginPath(); g.ellipse(x + 1.45 * r, y + 1.02 * r, 2.4 * r, 0.22 * r, 0, 0, tau); g.fill();
  const rear = P(0, 0), front = P(2.9, 0), bb = P(1.15, 0.2), seat = P(0.85, -1.75), head_top = P(2.5, -1.5), bar = P(2.7, -1.6);
  const hip = P(0.85, -1.95), shoulder = P(2.0, -2.8);
  // leg from hip to pedal: two segments, knee pushed forward
  const leg = (a, col_thigh, col_shin) => {
    const pd = [bb[0] + Math.cos(a) * 0.55 * r, bb[1] + Math.sin(a) * 0.55 * r];
    const dx = pd[0] - hip[0], dy = pd[1] - hip[1], d = Math.min(Math.hypot(dx, dy), 2.85 * r);
    const seg = 1.45 * r, h = Math.sqrt(Math.max(0, seg * seg - (d / 2) ** 2));
    const mx = hip[0] + dx / 2, my = hip[1] + dy / 2, nx = -dy / Math.hypot(dx, dy), ny = dx / Math.hypot(dx, dy);
    const knee = [mx - nx * h, my - ny * h];   // forward side of the hip → pedal line
    line(hip, knee, 0.42, col_thigh);
    line(knee, pd, 0.3, col_shin);
    line([pd[0] - 0.22 * r, pd[1]], [pd[0] + 0.3 * r, pd[1]], 0.18, '#15171c');   // shoe
    return pd;
  };
  // far leg first (darker), behind the frame
  leg(crank + Math.PI, '#0d0f14', '#3b2a22');
  // wheels: tyre, rim, spokes turning with the road
  for (const w of [rear, front]) {
    g.strokeStyle = '#0c0d10'; g.lineWidth = 0.14 * r;
    g.beginPath(); g.arc(w[0], w[1], r, 0, tau); g.stroke();
    g.strokeStyle = c.rim; g.lineWidth = 0.06 * r;
    g.beginPath(); g.arc(w[0], w[1], 0.86 * r, 0, tau); g.stroke();
    g.strokeStyle = 'rgba(220,225,235,.5)'; g.lineWidth = 0.035 * r;
    for (let k = 0; k < 4; k++) {
      const a = wheel + (k * Math.PI) / 4;
      g.beginPath();
      g.moveTo(w[0] + Math.cos(a) * 0.86 * r, w[1] + Math.sin(a) * 0.86 * r);
      g.lineTo(w[0] - Math.cos(a) * 0.86 * r, w[1] - Math.sin(a) * 0.86 * r);
      g.stroke();
    }
  }
  // frame
  const fw = 0.13;
  line(rear, bb, fw, c.frame); line(rear, seat, fw, c.frame); line(seat, bb, fw, c.frame);
  line(seat, head_top, fw, c.frame); line(bb, P(2.45, -1.1), fw, c.frame); line(head_top, front, fw, c.frame);
  line(P(0.6, -1.95), P(1.05, -1.95), 0.12, '#15171c');   // saddle
  line(head_top, bar, 0.1, '#15171c');
  // crank arm
  line(bb, [bb[0] + Math.cos(crank) * 0.55 * r, bb[1] + Math.sin(crank) * 0.55 * r], 0.1, '#9aa0a8');
  // near leg, torso, arms, head
  leg(crank, '#16181e', '#5a4033');
  line(hip, shoulder, 0.62, c.jersey);
  const elbow = P(2.25, -2.1);
  line(shoulder, elbow, 0.24, c.jersey); line(elbow, bar, 0.2, '#5a4033');
  const hd = P(2.5, -3.2);
  g.fillStyle = '#5a4033'; g.beginPath(); g.arc(hd[0], hd[1], 0.36 * r, 0, tau); g.fill();
  g.fillStyle = c.helmet; g.beginPath(); g.ellipse(hd[0] - 0.08 * r, hd[1] - 0.12 * r, 0.48 * r, 0.3 * r, -0.25, Math.PI, tau); g.fill();
  // lights at night: headlight beam and a blinking rear light
  if (night > 0.05) {
    const beam = g.createRadialGradient(front[0] + r, front[1] - 0.6 * r, 0, front[0] + r, front[1] - 0.6 * r, 3.5 * r);
    beam.addColorStop(0, `rgba(255,245,200,${0.45 * night})`); beam.addColorStop(1, 'rgba(255,245,200,0)');
    g.fillStyle = beam; g.beginPath(); g.arc(front[0] + r, front[1] - 0.6 * r, 3.5 * r, 0, tau); g.fill();
    if (blink) { g.fillStyle = `rgba(255,40,40,${night})`; g.beginPath(); g.arc(seat[0] - 0.25 * r, seat[1] + 0.25 * r, 0.14 * r, 0, tau); g.fill(); }
  }
}

// soft cloud sprite (white puffs on a transparent canvas), drawn once per cloud
function cloud_sprite(rnd) {
  const w = 260, h = 110, cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  for (let k = 0; k < 7; k++) {
    const x = 40 + rnd() * (w - 80), y = 50 + rnd() * 30, rr = 22 + rnd() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, tau); g.fill();
  }
  return cv;
}

// colour from a look item: '#rrggbb' as is, 'rainbow' cycles, 'auto' falls back
const look_col = (v, fallback, t) => (v === 'rainbow' ? `hsl(${(t * 60) % 360},85%,55%)` : v && v.startsWith('#') ? v : fallback);

export function start_menu_bg(canvas, get_look) {
  const g = canvas.getContext('2d');
  const rnd = seeded(97);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, raf = 0, last = 0, running = false;
  // start at golden hour (test hook: ?bgt=0.4 starts at that share of the day, e.g. night)
  let t = cycle_s * (+new URLSearchParams(location.search).get('bgt') || 0.02);
  let look = get_look();
  const stars = Array.from({ length: 90 }, () => ({ x: rnd(), y: rnd() * 0.55, s: 0.6 + rnd() * 1.4, ph: rnd() * tau }));
  const clouds = Array.from({ length: 7 }, () => ({ img: cloud_sprite(rnd), x: rnd(), y: 0.06 + rnd() * 0.32, s: 0.5 + rnd() * 0.9, v: 4 + rnd() * 8 }));
  const flies = Array.from({ length: 24 }, () => ({ x: rnd(), y: 0.74 + rnd() * 0.1, ph: rnd() * tau, v: 0.3 + rnd() * 0.6 }));
  // riders beside you: they drift ahead and fall back (an easy group ride)
  const others = [
    { jersey: '#e53935', helmet: '#f5f5f5', frame: '#202020', rim: '#c9ccd2', lane: 0, ph: 1.7, f: 0.043 },
    { jersey: '#1e88e5', helmet: '#1b1b1f', frame: '#e0e0e0', rim: '#1b1b1f', lane: 1, ph: 4.1, f: 0.031 },
    { jersey: '#43a047', helmet: '#ffd400', frame: '#2b2b30', rim: '#ffd400', lane: 1, ph: 0.4, f: 0.052 },
  ];
  let flock = null, next_flock = 6;
  let confetti = [];

  function resize() {
    const pr = Math.min(devicePixelRatio || 1, 1.5);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * pr); canvas.height = Math.round(H * pr);
    g.setTransform(pr, 0, 0, pr, 0, 0);
  }

  function frame(dt) {
    t += dt;
    const p = (t / cycle_s) % 1, sky = sky_at(p), night = sky.night;
    const road_y = H * 0.86;
    // sky
    const sg = g.createLinearGradient(0, 0, 0, H * 0.8);
    sg.addColorStop(0, rgb(sky.top)); sg.addColorStop(1, rgb(sky.hor));
    g.fillStyle = sg; g.fillRect(0, 0, W, H);
    // stars (twinkle) and moon
    if (night > 0.02) {
      for (const s of stars) {
        g.fillStyle = `rgba(255,255,255,${night * (0.45 + 0.4 * Math.sin(t * 1.7 + s.ph))})`;
        g.fillRect(s.x * W, s.y * H, s.s, s.s);
      }
      const mx = W * 0.3, my = H * (0.42 - 0.22 * night);
      const glow = g.createRadialGradient(mx, my, 0, mx, my, 70);
      glow.addColorStop(0, `rgba(220,230,255,${0.3 * night})`); glow.addColorStop(1, 'rgba(220,230,255,0)');
      g.fillStyle = glow; g.fillRect(mx - 70, my - 70, 140, 140);
      g.fillStyle = `rgba(240,242,255,${night})`; g.beginPath(); g.arc(mx, my, 13, 0, tau); g.fill();
      g.fillStyle = rgb(sky.top, night); g.beginPath(); g.arc(mx + 5, my - 3, 11, 0, tau); g.fill();   // crescent
    }
    // sun: glow + disc, sets behind the mountains
    const horizon = H * layers[0].base;
    const sun_y = horizon - sky.sun * H * 0.45, sun_x = sky.sx * W;
    if (sky.sun > -0.25) {
      const sr = Math.max(14, Math.min(W, H) * 0.045);
      const glow = g.createRadialGradient(sun_x, sun_y, 0, sun_x, sun_y, sr * 7);
      glow.addColorStop(0, 'rgba(255,220,150,.55)'); glow.addColorStop(1, 'rgba(255,190,120,0)');
      g.fillStyle = glow; g.fillRect(sun_x - sr * 7, sun_y - sr * 7, sr * 14, sr * 14);
      g.fillStyle = sky.sun > 0.4 ? '#fff6dc' : '#ffd08a'; g.beginPath(); g.arc(sun_x, sun_y, sr, 0, tau); g.fill();
    }
    // clouds: drift at their own speed, fainter at night
    for (const c of clouds) {
      c.x += (c.v * dt) / W;
      if (c.x > 1.15) c.x = -0.35;
      g.globalAlpha = 0.55 - 0.42 * night;
      g.drawImage(c.img, c.x * W, c.y * H, 260 * c.s, 110 * c.s);
    }
    g.globalAlpha = 1;
    // bird flocks: a loose v crossing the sky now and then (by day)
    next_flock -= dt;
    if (!flock && next_flock < 0 && night < 0.5) {
      flock = { x: -60, y: H * (0.12 + Math.random() * 0.2), v: 40 + Math.random() * 25, n: 5 + ((Math.random() * 4) | 0) };
    }
    if (flock) {
      flock.x += flock.v * dt;
      g.strokeStyle = 'rgba(20,22,35,.75)'; g.lineWidth = 1.6;
      for (let k = 0; k < flock.n; k++) {
        const row = Math.ceil(k / 2), side = k % 2 ? -1 : 1;
        const bx = flock.x - row * 16, by = flock.y + side * row * 10 + Math.sin(t * 2 + k) * 2;
        const flap = Math.sin(t * 9 + k * 1.3) * 4;
        g.beginPath(); g.moveTo(bx - 7, by - flap); g.lineTo(bx, by); g.lineTo(bx + 7, by - flap); g.stroke();
      }
      if (flock.x > W + 120) { flock = null; next_flock = 14 + Math.random() * 18; }
    }
    // landscape layers, far to near: hazed toward the horizon colour and lit by the time of day
    for (const L of layers) {
      const col = rgb(mix(mix(L.color, sky.hor, L.haze), sky.shade, sky.amt));
      const off = (t * L.speed) % L.period;
      const base = H * L.base, hh = H * L.height;
      g.fillStyle = col;
      g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W + 20; x += 20) g.lineTo(x, base - (L.y_at(x + off) * 0.5 + 0.5) * hh);
      g.lineTo(W, H); g.closePath(); g.fill();
      // pines (and a few round trees) standing on the skyline
      for (const tr of L.list) {
        for (let rep = -L.period; rep < W + L.period; rep += L.period) {
          const x = tr.x - off + rep;
          if (x < -40 || x > W + 40) continue;
          const y = base - (L.y_at(tr.x) * 0.5 + 0.5) * hh + 2, th = H * L.tree_h * tr.s;
          g.beginPath();
          if (tr.round) { g.arc(x, y - th * 0.55, th * 0.42, 0, tau); g.rect(x - th * 0.05, y - th * 0.3, th * 0.1, th * 0.3); }
          else { g.moveTo(x, y - th); g.lineTo(x + th * 0.28, y); g.lineTo(x - th * 0.28, y); }
          g.fill();
        }
      }
    }
    // fireflies over the near meadow at night
    if (night > 0.3) {
      for (const f of flies) {
        const fx = ((f.x * W + Math.sin(t * f.v + f.ph) * 30) % W + W) % W, fy = H * f.y + Math.cos(t * f.v * 1.3 + f.ph) * 12;
        const a = (night - 0.3) * (0.5 + 0.5 * Math.sin(t * 3 + f.ph));
        g.fillStyle = `rgba(210,255,120,${a})`; g.beginPath(); g.arc(fx, fy, 1.8, 0, tau); g.fill();
      }
    }
    // verge, road and the dashed centre line moving under the riders
    const lit = (h) => rgb(mix(hex(h), sky.shade, sky.amt));
    g.fillStyle = lit('#2c4a2a'); g.fillRect(0, road_y - H * 0.03, W, H * 0.03);
    g.fillStyle = lit('#30343c'); g.fillRect(0, road_y, W, H * 0.1);
    g.fillStyle = lit('#24402a'); g.fillRect(0, road_y + H * 0.1, W, H);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, road_y + 2, W, 2); g.fillRect(0, road_y + H * 0.1 - 4, W, 2);
    const dash = 60, doff = (t * 140) % dash;
    g.fillStyle = 'rgba(255,214,0,.55)';
    for (let x = -doff; x < W; x += dash) g.fillRect(x, road_y + H * 0.05 - 1.5, 30, 3);
    // riders: back lane first, then you (front lane, near the left third), then the front-lane rival
    const r = Math.max(9, Math.min(24, Math.min(W, H) * 0.035));
    const crank = t * tau * 1.45, wheel = t * 140 / r * 0.3;
    const blink = (t * 2) % 1 < 0.5;
    const lane_y = [road_y + H * 0.08 - r, road_y + H * 0.035 - r * 0.85];
    const rider_x = (o) => W * (0.32 + 0.22 * Math.sin(t * o.f + o.ph));
    for (const o of others.filter((o) => o.lane === 1)) {
      draw_rider(g, rider_x(o), lane_y[1], r * 0.85, crank + o.ph, wheel, o, night, blink);
    }
    const me = {
      jersey: look_col(look.jersey, '#ffd400', t), helmet: look_col(look.helmet, '#f5f5f5', t),
      frame: look_col(look.frame, look_col(look.jersey, '#202020', t), t), rim: look_col(look.rim, '#c9ccd2', t),
    };
    const front_rival = others[0], fx = rider_x(front_rival) + W * 0.12;
    const my_x = W * 0.28;
    // the front-lane rival passes behind or ahead of you depending on where it is
    if (fx < my_x) draw_rider(g, fx, lane_y[0], r, crank + front_rival.ph, wheel, front_rival, night, blink);
    draw_rider(g, my_x, lane_y[0], r, crank, wheel, me, night, blink);
    if (fx >= my_x) draw_rider(g, fx, lane_y[0], r, crank + front_rival.ph, wheel, front_rival, night, blink);
    // confetti after a good result
    if (confetti.length) {
      for (const c of confetti) {
        c.vy += 120 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.a += c.va * dt;
        g.save(); g.translate(c.x, c.y); g.rotate(c.a); g.fillStyle = c.col; g.fillRect(-4, -2.5, 8, 5); g.restore();
      }
      confetti = confetti.filter((c) => c.y < H + 20);
    }
  }

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (ts - last < 32) return;   // ~30 fps is plenty for a backdrop
    const dt = Math.min(0.1, (ts - last) / 1000 || 0.03);
    last = ts;
    frame(dt);
  }

  function set_running(on) {
    on = on && !document.hidden;
    if (on === running) return;
    running = on;
    canvas.style.display = on ? 'block' : 'none';
    cancelAnimationFrame(raf);
    if (on && !still) { last = performance.now(); raf = requestAnimationFrame(loop); }
    if (on && still) frame(0);
  }

  resize();
  addEventListener('resize', () => { resize(); if (still) frame(0); });
  let want = true;
  document.addEventListener('visibilitychange', () => set_running(want));
  set_running(true);
  return {
    // show while browsing menus, stop while a game runs
    show(on) { want = on; set_running(on); },
    set_look(lk) { look = lk; },
    // burst of confetti from the top (podium, personal best)
    celebrate() {
      const cols = ['#ffd400', '#ff5252', '#3fa9f5', '#7ee08a', '#ff9f1a', '#e040fb'];
      for (let k = 0; k < 140; k++) {
        confetti.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.4, vx: (Math.random() - 0.5) * 80, vy: 40 + Math.random() * 80,
          a: Math.random() * tau, va: (Math.random() - 0.5) * 10, col: cols[k % cols.length] });
      }
    },
  };
}
