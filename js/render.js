// canvas drawing: sky, parallax hills, road with lanes, riders, finish line, off-screen markers.
// world units are meters; the camera follows the player

export function draw_world(ctx, race, w, h) {
  const n = race.riders.length;
  const portrait = h > w;
  // road band sits above the bottom html hud; at least 16 m of road stays visible (matters in portrait)
  const road_bottom = h - (portrait ? 160 : 130);
  const max_lane_h = (road_bottom - (portrait ? h * 0.40 : h * 0.30)) / n;
  const ppm = Math.min((max_lane_h * 1.5) / 1.8, w / 16);   // pixels per meter
  const lane_h = Math.min(max_lane_h, ppm * 1.25);
  const road_top = road_bottom - n * lane_h;
  const player = race.player;
  const cam = player.x - (w * 0.35) / ppm;               // world x at the left screen edge
  const sx = (x) => (x - cam) * ppm;

  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, road_top);
  sky.addColorStop(0, '#5aa9e6');
  sky.addColorStop(1, '#bfe3f7');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, road_top);

  // clouds and hills move slower than the road (parallax)
  draw_clouds(ctx, w, road_top, cam * ppm * 0.05);
  draw_hills(ctx, w, road_top, cam * ppm * 0.15, Math.min(130, road_top * 0.35), '#7fae8a', 0);
  draw_hills(ctx, w, road_top, cam * ppm * 0.35, Math.min(70, road_top * 0.2), '#5e9a5f', 2.1);

  // grass verges and road surface
  ctx.fillStyle = '#4f8a3c';
  ctx.fillRect(0, road_top - 8, w, 8);
  ctx.fillRect(0, road_bottom, w, h - road_bottom);
  ctx.fillStyle = '#3a3d42';
  ctx.fillRect(0, road_top, w, road_bottom - road_top);
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, road_top, w, 3);
  ctx.fillRect(0, road_bottom - 3, w, 3);

  // dashed lane lines every 4 m: they scroll past and give the feeling of speed
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  const view_end = cam + w / ppm;
  for (let i = 1; i < n; i++) {
    const y = road_top + i * lane_h;
    for (let x = Math.floor(cam / 4) * 4; x < view_end; x += 4) ctx.fillRect(sx(x), y - 1, 2 * ppm, 2);
  }

  // distance markers every 100 m on the far verge
  ctx.font = `bold ${Math.max(11, ppm * 0.35)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  for (let m = Math.max(100, Math.floor(cam / 100) * 100); m < view_end + 2 && m < race.distance_m; m += 100) {
    const x = sx(m);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 2, road_top - 0.9 * ppm, 4, 0.9 * ppm);
    ctx.fillStyle = '#1b1b1b';
    ctx.fillText(m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`, x, road_top - 1.0 * ppm);
  }

  // start line and checkered finish line with banner
  ctx.fillStyle = '#fff';
  ctx.fillRect(sx(0) - 2, road_top, 4, road_bottom - road_top);
  draw_finish(ctx, sx(race.distance_m), road_top, road_bottom, ppm);

  // riders, back lanes first so nearer riders overlap them
  const by_lane = [...race.riders].sort((a, b) => a.lane - b.lane);
  for (const r of by_lane) {
    const ground_y = road_top + lane_h * (r.lane + 0.8);
    draw_rider(ctx, sx(r.x), ground_y, ppm, r);
  }

  // riders out of view: colored pill at the screen edge with gap in meters
  ctx.font = `bold ${Math.min(15, Math.max(11, lane_h * 0.4))}px system-ui, sans-serif`;
  for (const r of race.riders) {
    const x = sx(r.x);
    if (x > -ppm && x < w + ppm) continue;
    const gap = Math.round(Math.abs(r.x - player.x));
    const ahead = x >= w;
    const text = ahead ? `${gap} m ▶` : `◀ ${gap} m`;
    const tw = ctx.measureText(text).width + 14;
    const th = Math.min(24, Math.max(18, lane_h * 0.6));
    const px = ahead ? w - tw - 6 : 6;
    const py = road_top + lane_h * (r.lane + 0.5) - th / 2;
    ctx.fillStyle = r.color;
    round_rect(ctx, px, py, tw, th, th / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px + tw / 2, py + th / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }
}

// rolling hills from a sum of sines; offset shifts them with the camera
function draw_hills(ctx, w, base_y, offset, amp, color, seed) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, base_y);
  for (let x = 0; x <= w + 20; x += 20) {
    const t = x + offset;
    const y = base_y - amp * (0.6 + 0.25 * Math.sin(t / 180 + seed) + 0.15 * Math.sin(t / 67 + seed * 3));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, base_y);
  ctx.closePath();
  ctx.fill();
}

// a few soft clouds that wrap around the screen
function draw_clouds(ctx, w, sky_h, offset) {
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const span = w + 200;
  for (let i = 0; i < 4; i++) {
    const x = ((((i * 260 - offset) % span) + span) % span) - 100;
    const y = sky_h * (0.15 + 0.12 * (i % 3));
    for (const [dx, dy, r] of [[0, 0, 22], [24, -8, 18], [46, 0, 20], [22, 6, 20]]) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// checkered strip across the road plus a finish banner on two poles
function draw_finish(ctx, x, top, bottom, ppm) {
  const sq = Math.max(6, ppm * 0.4);
  for (let row = 0; top + row * sq < bottom; row++) {
    for (let col = 0; col < 2; col++) {
      ctx.fillStyle = (row + col) % 2 ? '#111' : '#fff';
      ctx.fillRect(x + col * sq - sq, top + row * sq, sq, Math.min(sq, bottom - top - row * sq));
    }
  }
  const pole_h = 3.2 * ppm;
  ctx.fillStyle = '#ddd';
  ctx.fillRect(x - 3, top - pole_h, 5, pole_h);
  ctx.fillRect(x - 3, bottom - pole_h, 5, pole_h);
  ctx.fillStyle = '#d32f2f';
  ctx.fillRect(x - 1.6 * ppm, top - pole_h - 0.8 * ppm, 3.2 * ppm, 0.8 * ppm);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${ppm * 0.55}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('FINISH', x, top - pole_h - 0.2 * ppm);
}

function round_rect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// side-view cyclist. geometry in meters relative to the ground point (y up = negative)
function draw_rider(ctx, x, y, s, r) {
  const p = ([mx, my]) => [x + mx * s, y + my * s];
  const line = (a, b, color, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * s;
    ctx.beginPath();
    ctx.moveTo(...p(a));
    ctx.lineTo(...p(b));
    ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const wr = 0.34;                       // wheel radius
  const rear = [-0.5, -wr], front = [0.52, -wr];
  const bb = [-0.05, -0.3];              // bottom bracket (crank centre)
  const seat = [-0.22, -0.92], bar = [0.42, -0.98];
  const hip = [-0.22, -1.0], shoulder = [0.22, -1.4], head = [0.36, -1.56];

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(x, y + 0.02 * s, 0.95 * s, 0.08 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // wheels with spokes that turn with distance travelled
  const spin = r.x / wr;
  for (const c of [rear, front]) {
    const [cx, cy] = p(c);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 0.05 * s;
    ctx.beginPath();
    ctx.arc(cx, cy, wr * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#999';
    ctx.lineWidth = Math.max(1, 0.012 * s);
    for (let k = 0; k < 3; k++) {
      const a = spin + (k * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(a) * wr * s, cy - Math.sin(a) * wr * s);
      ctx.lineTo(cx + Math.cos(a) * wr * s, cy + Math.sin(a) * wr * s);
      ctx.stroke();
    }
  }

  // far leg first (darker), then frame, then near leg on top
  draw_leg(line, hip, bb, r.crank + Math.PI, '#111');
  const frame = '#d9d9d9';
  line(rear, bb, frame, 0.045);
  line(bb, seat, frame, 0.05);
  line(seat, rear, frame, 0.04);
  line(seat, bar, frame, 0.05);
  line(bb, bar, frame, 0.055);
  line(bar, front, frame, 0.045);

  // torso and arm in team color
  line(hip, shoulder, r.color, 0.2);
  line(shoulder, bar, shade(r.color), 0.08);
  draw_leg(line, hip, bb, r.crank, '#262626');

  // head with helmet
  const [hx, hy] = p(head);
  ctx.fillStyle = '#f1c27d';
  ctx.beginPath();
  ctx.arc(hx, hy, 0.12 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = r.color;
  ctx.beginPath();
  ctx.arc(hx - 0.01 * s, hy - 0.02 * s, 0.135 * s, Math.PI, Math.PI * 2);
  ctx.fill();

  // marker above the player
  if (r.is_player) {
    const my = hy - 0.3 * s;
    ctx.fillStyle = '#ffd400';
    ctx.beginPath();
    ctx.moveTo(hx - 0.12 * s, my - 0.14 * s);
    ctx.lineTo(hx + 0.12 * s, my - 0.14 * s);
    ctx.lineTo(hx, my);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// leg = thigh + shin from hip to pedal; knee found with two-segment inverse kinematics
function draw_leg(line, hip, bb, angle, color) {
  const crank_len = 0.17, seg = 0.46;
  const foot = [bb[0] + crank_len * Math.cos(angle), bb[1] + crank_len * Math.sin(angle)];
  const dx = foot[0] - hip[0], dy = foot[1] - hip[1];
  const d = Math.hypot(dx, dy);
  const half = Math.min(d, 2 * seg - 0.001) / 2;
  const bend = Math.sqrt(seg * seg - half * half);
  const ux = dx / d, uy = dy / d;
  // perpendicular (uy, -ux) points the knee forward
  const knee = [hip[0] + ux * half + uy * bend, hip[1] + uy * half - ux * bend];
  line(bb, foot, '#888', 0.03);   // crank arm
  line(hip, knee, color, 0.12);
  line(knee, foot, color, 0.1);
}

// darker version of a hex color (sleeves)
function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(v * 0.75);
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}
