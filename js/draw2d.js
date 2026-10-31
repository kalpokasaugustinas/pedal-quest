// shared 2d canvas helpers for the side-view minigames: sharp canvas setup, sky, hills, clouds, rider

// size the canvas for the screen's pixel density; call view.resize() on screen rotation
export function setup_2d(canvas) {
  const ctx = canvas.getContext('2d');
  const view = {
    ctx, w: 0, h: 0,
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      view.w = canvas.clientWidth;
      view.h = canvas.clientHeight;
      canvas.width = Math.round(view.w * dpr);
      canvas.height = Math.round(view.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
  };
  view.resize();
  return view;
}

export function sky(ctx, w, h, top, bottom) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

// rolling hills from a sum of sines; offset (px) shifts them with the camera
export function hills(ctx, w, base_y, offset, amp, color, seed = 0) {
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
export function clouds(ctx, w, sky_h, offset, color = 'rgba(255,255,255,0.85)') {
  ctx.fillStyle = color;
  const span = w + 200;
  for (let i = 0; i < 4; i++) {
    const x = ((((i * 260 - offset) % span) + span) % span) - 100;
    const y = sky_h * (0.2 + 0.12 * (i % 3));
    for (const [dx, dy, r] of [[0, 0, 22], [24, -8, 18], [46, 0, 20], [22, 6, 20]]) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function round_rect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// darker version of a hex color
export function shade(hex, f = 0.75) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(v * f);
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

// mix two hex colors (t = 0 -> a, 1 -> b)
export function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (shift) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

// side-view cyclist at ground point (x, y). s = pixels per meter, tilt = slope angle (radians, uphill positive)
export function draw_rider(ctx, x, y, s, { color = '#ffd400', crank = 0, wheel = 0, tilt = 0, alpha = 1 } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-tilt);
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const p = ([mx, my]) => [mx * s, my * s];
  const line = (a, b, c, width) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = width * s;
    ctx.beginPath();
    ctx.moveTo(...p(a));
    ctx.lineTo(...p(b));
    ctx.stroke();
  };

  // geometry in meters, y up = negative
  const wr = 0.34;
  const rear = [-0.5, -wr], front = [0.52, -wr];
  const bb = [-0.05, -0.3], seat = [-0.22, -0.92], bar = [0.42, -0.98];
  const hip = [-0.22, -1.0], shoulder = [0.22, -1.4], head = [0.36, -1.56];

  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 0.02 * s, 0.95 * s, 0.08 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // wheels with turning spokes
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
      const a = wheel + (k * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(a) * wr * s, cy - Math.sin(a) * wr * s);
      ctx.lineTo(cx + Math.cos(a) * wr * s, cy + Math.sin(a) * wr * s);
      ctx.stroke();
    }
  }

  draw_leg(line, hip, bb, crank + Math.PI, '#111');
  const frame = '#d9d9d9';
  line(rear, bb, frame, 0.045);
  line(bb, seat, frame, 0.05);
  line(seat, rear, frame, 0.04);
  line(seat, bar, frame, 0.05);
  line(bb, bar, frame, 0.055);
  line(bar, front, frame, 0.045);
  line(hip, shoulder, color, 0.2);
  line(shoulder, bar, shade(color), 0.08);
  draw_leg(line, hip, bb, crank, '#262626');

  const [hx, hy] = p(head);
  ctx.fillStyle = '#f1c27d';
  ctx.beginPath();
  ctx.arc(hx, hy, 0.12 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(hx - 0.01 * s, hy - 0.02 * s, 0.135 * s, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// thigh + shin from hip to pedal; knee from two-segment inverse kinematics
function draw_leg(line, hip, bb, angle, color) {
  const crank_len = 0.17, seg = 0.46;
  const foot = [bb[0] + crank_len * Math.cos(angle), bb[1] + crank_len * Math.sin(angle)];
  const dx = foot[0] - hip[0], dy = foot[1] - hip[1];
  const d = Math.hypot(dx, dy);
  const half = Math.min(d, 2 * seg - 0.001) / 2;
  const bend = Math.sqrt(seg * seg - half * half);
  const ux = dx / d, uy = dy / d;
  const knee = [hip[0] + ux * half + uy * bend, hip[1] + uy * half - ux * bend];   // knee points forward
  line(bb, foot, '#888', 0.03);
  line(hip, knee, color, 0.12);
  line(knee, foot, color, 0.1);
}

// big outlined label (readable on any background)
export function label(ctx, text, x, y, size, color = '#fff', align = 'center') {
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, size / 7);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.textBaseline = 'alphabetic';
}
