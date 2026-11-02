// game-style setup controls: section headers with icons, number tiles, difficulty stars, a power gauge,
// and painted scenery cards (a tiny landscape per theme, drawn once and cached).
// the markup keeps the .seg / .stepper + data-key / data-i / data-d hooks that main.js wires up.
import { themes, surprise_id } from './kit3d.js?v=34';

// icon per option key (falls back to a diamond)
const icons = {
  km: '🏁', base_watts: '⚡', scenery: '🗺️', stages: '🔀', stage_min: '⏱️', level: '🏆', attacks: '⚔️',
  attackers: '👥', plan: '📈', intensity: '🔥', erg: '🎛️', track: '🎵', climb: '⛰️',
};
// options whose choices go from easy to hard: shown with 1-3 stars
const rated = ['level', 'intensity', 'stages', 'attacks'];

// "2 km" → big 2 + small km; plain words stay as they are
function tile_text(text) {
  const m = /^(\d[\d.]*)\s*(%|[a-z]+)?$/i.exec(text);
  return m ? `<b>${m[1]}</b>${m[2] ? `<small>${m[2]}</small>` : ''}` : `<span>${text}</span>`;
}

// how hard a watt value feels against the rider's ftp
function effort(w, ftp) {
  const r = w / ftp;
  const [name, col] = r < 0.55 ? ['Chill', '#7ee08a'] : r < 0.75 ? ['Steady', '#c6e86a'] : r < 0.9 ? ['Tough', '#ffd54f'] : r < 1.05 ? ['Hard', '#ff9f1a'] : ['Brutal', '#ff5252'];
  return { pct: Math.round(r * 100), name, col };
}

// ---- scenery thumbnails: sky, sun or moon, mountains, hills, a road running to the horizon, pines ----
const thumbs = {};
function paint_theme(g, t, w, h) {
  const hz = h * 0.5;
  const sky = g.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, t.sky[0]); sky.addColorStop(1, t.sky[1]);
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  if (t.stars) {
    g.fillStyle = '#fff';
    for (let k = 0; k < 40; k++) g.fillRect((k * 53) % w, (k * 29) % (hz * 0.8), 1.5, 1.5);
    g.fillStyle = '#f2f4ff'; g.beginPath(); g.arc(w * 0.78, h * 0.18, 9, 0, 7); g.fill();
  } else {
    g.fillStyle = 'rgba(255,240,200,.9)'; g.beginPath(); g.arc(w * 0.75, h * 0.2, 11, 0, 7); g.fill();
  }
  // mountains with snow caps
  const peaks = [[0, 0.62], [0.12, 0.3], [0.3, 0.5], [0.46, 0.22], [0.62, 0.45], [0.8, 0.26], [1, 0.5]];
  g.fillStyle = t.mountain[0];
  g.beginPath(); g.moveTo(0, hz);
  for (const [x, y] of peaks) g.lineTo(x * w, y * h + h * 0.08);
  g.lineTo(w, hz); g.fill();
  if (t.snow) {
    g.fillStyle = t.snow;
    for (const [x, y] of peaks) if (y < 0.32) { g.beginPath(); g.moveTo(x * w, y * h + h * 0.08); g.lineTo(x * w - 9, y * h + h * 0.08 + 9); g.lineTo(x * w + 9, y * h + h * 0.08 + 9); g.fill(); }
  }
  // haze over the far hills, then the meadow
  g.fillStyle = t.high[0];
  g.beginPath(); g.moveTo(0, hz);
  for (let x = 0; x <= w; x += 8) g.lineTo(x, hz - 6 - Math.sin(x * 0.05) * 5);
  g.lineTo(w, h); g.lineTo(0, h); g.fill();
  const fog = g.createLinearGradient(0, h * 0.25, 0, hz + 4);
  fog.addColorStop(0, 'rgba(0,0,0,0)'); fog.addColorStop(1, t.fog + '99');
  g.fillStyle = fog; g.fillRect(0, h * 0.25, w, hz - h * 0.25 + 4);
  g.fillStyle = t.grass[0]; g.fillRect(0, hz + 2, w, h);
  // road to the horizon with a dashed centre line
  g.fillStyle = t.asphalt;
  g.beginPath(); g.moveTo(w * 0.47, hz + 2); g.lineTo(w * 0.53, hz + 2); g.lineTo(w * 0.85, h); g.lineTo(w * 0.15, h); g.fill();
  g.fillStyle = 'rgba(255,255,255,.75)';
  for (let k = 0; k < 5; k++) { const y0 = hz + 2 + (h - hz) * (k / 5) ** 1.6, y1 = hz + 2 + (h - hz) * ((k + 0.5) / 5) ** 1.6; g.fillRect(w / 2 - 0.5 - k * 0.4, y0, 1 + k * 0.8, y1 - y0); }
  // pines along both sides, bigger towards the front
  for (let k = 0; k < 7; k++) {
    const f = k / 6, y = hz + 4 + (h - hz) * f * 0.8, s = 6 + f * 26;
    for (const side of [-1, 1]) {
      const x = w / 2 + side * (w * 0.08 + f * w * 0.42);
      g.fillStyle = k % 3 === 1 && t.mix.round > 0.3 ? t.round[0] : t.pine[0];
      if (k % 3 === 1 && t.mix.round > 0.3) { g.beginPath(); g.arc(x, y - s * 0.6, s * 0.45, 0, 7); g.fill(); }
      else { g.beginPath(); g.moveTo(x, y - s * 1.3); g.lineTo(x + s * 0.4, y); g.lineTo(x - s * 0.4, y); g.fill(); }
    }
  }
}
export function scenery_thumb(id) {
  if (thumbs[id]) return thumbs[id];
  const w = 240, h = 150, cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  if (id === surprise_id) {
    // surprise: every theme in a slanted slice
    const ids = Object.keys(themes);
    ids.forEach((tid, i) => {
      g.save();
      g.beginPath();
      const x0 = (i / ids.length) * w, x1 = ((i + 1) / ids.length) * w;
      g.moveTo(x0 + 25, 0); g.lineTo(x1 + 25, 0); g.lineTo(x1 - 25, h); g.lineTo(x0 - 25, h);
      if (i === 0) { g.lineTo(0, h); g.lineTo(0, 0); }
      if (i === ids.length - 1) { g.lineTo(w, h); g.lineTo(w, 0); }
      g.clip();
      paint_theme(g, themes[tid], w, h);
      g.restore();
    });
  } else if (themes[id]) paint_theme(g, themes[id], w, h);
  thumbs[id] = cv.toDataURL('image/jpeg', 0.85);
  return thumbs[id];
}

// one option section. opt = game option, v = current value, profile = rider (ftp for the gauge)
export function option_html(opt, v, profile) {
  // "Intensity (not used in the ramp test)" → title + small note
  const [, title, note] = /^(.*?)(?:\s*\((.*)\))?$/.exec(opt.label);
  const head = `<div class="opt-head"><span class="opt-ic">${icons[opt.key] || '◆'}</span><span>${title}</span>${note ? `<small class="opt-note">${note}</small>` : ''}</div>`;
  if (opt.type === 'stepper') {
    const fill = Math.round(((v - opt.min) / (opt.max - opt.min)) * 100);
    const e = opt.unit === 'W' ? effort(v, profile.ftp) : null;
    return `<section class="opt">${head}
      <div class="stepper gauge" data-key="${opt.key}">
        <button data-d="-1" aria-label="less">−</button>
        <div class="gauge-val"><b>${v}</b><small>${opt.unit}</small></div>
        <button data-d="1" aria-label="more">+</button>
      </div>
      <div class="gauge-bar"><i style="width:${fill}%;${e ? `background:${e.col};box-shadow:0 0 10px ${e.col}` : ''}"></i></div>
      ${e ? `<div class="gauge-note"><span style="color:${e.col}">${e.name}</span> · ${e.pct}% of your FTP</div>` : ''}</section>`;
  }
  if (opt.key === 'scenery') {
    return `<section class="opt">${head}<div class="seg scenery-pick" data-key="${opt.key}">${opt.choices.map(([cv, text], i) => `
      <button data-i="${i}" class="scene-card${cv === v ? ' on' : ''}" style="background-image:url(${scenery_thumb(cv)})">
        ${cv === surprise_id ? '<span class="scene-dice">🎲</span>' : ''}<span class="scene-name">${text.replace('🎲 ', '')}</span></button>`).join('')}</div></section>`;
  }
  const n = opt.choices.length;
  return `<section class="opt">${head}<div class="seg${opt.wide ? ' wide' : ' tiles'}" data-key="${opt.key}">${opt.choices.map(([cv, text], i) => {
    const stars = rated.includes(opt.key) && !opt.wide ? `<span class="stars">${'★'.repeat(Math.min(3, Math.round(((i + 1) / n) * 3)))}</span>` : '';
    return `<button data-i="${i}" class="${cv === v ? 'on' : ''}">${opt.wide ? text : tile_text(text)}${stars}</button>`;
  }).join('')}</div></section>`;
}
