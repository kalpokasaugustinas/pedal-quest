// ride log: one sample per second of game time (watts, hr, cadence) for the results chart + ride stats
// shared by every game through the shell, so the games don't need to record anything themselves
import { load, store } from './util.js?v=26';

let samples = [];     // [{ w, hr, rpm }] one per second
let acc = null;       // running sums for the current second
let started = null;   // wall-clock start time (for the export file)

// start a new log at the beginning of a game
export function reset() {
  samples = [];
  started = new Date();
  acc = { t: 0, w: 0, hr: 0, hr_n: 0, rpm: 0, m: 0 };
}

// add dt seconds of input (speed in m/s, null = game has no speed); closes a sample every full second
export function record(dt, input, speed = null) {
  if (!acc) reset();
  // split dt at the second boundary, so samples are exactly 1 s apart (no time lost to overshoot)
  while (dt > 1e-9) {
    const part = Math.min(dt, 1 - acc.t);
    dt -= part;
    acc.t += part;
    acc.m += (speed ?? 0) * part;
    acc.w += input.watts * part;
    acc.rpm += input.cadence * part;
    if (input.hr !== null && input.hr !== undefined) { acc.hr += input.hr * part; acc.hr_n += part; }
    if (acc.t >= 1 - 1e-6) {   // epsilon: ten 0.1 s steps add up to 0.99999...
      samples.push({ w: acc.w / acc.t, rpm: acc.rpm / acc.t, hr: acc.hr_n > 0 ? acc.hr / acc.hr_n : null, m: acc.m });
      acc = { t: 0, w: 0, hr: 0, hr_n: 0, rpm: 0, m: 0 };
    }
  }
}

// normalized power: 30 s rolling average, ^4, mean, 4th root (standard training metric)
function normalized_power(ws) {
  if (ws.length < 30) return null;
  let sum = 0, roll = 0, n = 0;
  for (let i = 0; i < ws.length; i++) {
    roll += ws[i];
    if (i >= 30) roll -= ws[i - 30];
    if (i >= 29) { sum += (roll / 30) ** 4; n++; }
  }
  return Math.pow(sum / n, 0.25);
}

// best average power over any window of `secs` seconds (null if the ride is shorter)
function best_avg(ws, secs) {
  if (ws.length < secs) return null;
  let roll = 0, best = 0;
  for (let i = 0; i < ws.length; i++) {
    roll += ws[i];
    if (i >= secs) roll -= ws[i - secs];
    if (i >= secs - 1) best = Math.max(best, roll / secs);
  }
  return best;
}

export function summary(ftp) {
  const ws = samples.map((s) => s.w);
  const hrs = samples.map((s) => s.hr).filter((h) => h !== null);
  const pedal = samples.filter((s) => s.rpm > 20);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const np = normalized_power(ws);
  return {
    secs: samples.length,
    avg_w: avg(ws),
    max_w: ws.length ? Math.max(...ws) : null,
    np,
    if_: np && ftp ? np / ftp : null,
    best_5s: best_avg(ws, 5),
    best_1m: best_avg(ws, 60),
    best_5m: best_avg(ws, 300),
    best_20m: best_avg(ws, 1200),
    avg_hr: avg(hrs),
    max_hr: hrs.length ? Math.max(...hrs) : null,
    avg_rpm: avg(pedal.map((s) => s.rpm)),
    kj: ws.reduce((x, y) => x + y, 0) / 1000,
    km: samples.reduce((x, y) => x + y.m, 0) / 1000,
  };
}

// svg chart: power as a filled area (left axis), hr as a red line (right axis), ftp as a dashed line
export function chart_svg(ftp) {
  if (samples.length < 10) return '';
  const w = 400, h = 160, pad_l = 30, pad_r = 26, pad_t = 8, pad_b = 18;
  const iw = w - pad_l - pad_r, ih = h - pad_t - pad_b;

  // smooth power over 5 s so the chart is readable
  const ws = samples.map((_, i) => {
    const a = samples.slice(Math.max(0, i - 2), i + 3);
    return a.reduce((s, x) => s + x.w, 0) / a.length;
  });
  const w_max = Math.max(ftp * 1.3, ...ws) * 1.05;
  const hrs = samples.map((s) => s.hr);
  const hr_vals = hrs.filter((x) => x !== null);
  const hr_lo = hr_vals.length ? Math.min(...hr_vals) - 5 : 60;
  const hr_hi = hr_vals.length ? Math.max(...hr_vals) + 5 : 200;

  const n = samples.length;
  const x = (i) => pad_l + (i / (n - 1)) * iw;
  const yw = (v) => pad_t + ih - (v / w_max) * ih;
  const yh = (v) => pad_t + ih - ((v - hr_lo) / (hr_hi - hr_lo)) * ih;

  // keep the path size small on long rides: at most ~300 points
  const stride = Math.max(1, Math.ceil(n / 300));
  const idx = [];
  for (let i = 0; i < n; i += stride) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);

  const area = `M${x(0)},${yw(0)} ` + idx.map((i) => `L${x(i).toFixed(1)},${yw(ws[i]).toFixed(1)}`).join(' ') + ` L${x(n - 1)},${yw(0)} Z`;
  let hr_path = '';
  let pen = false;
  for (const i of idx) {
    if (hrs[i] === null) { pen = false; continue; }
    hr_path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${yh(hrs[i]).toFixed(1)} `;
    pen = true;
  }

  // time ticks every 1 / 5 / 10 min depending on length
  const step = n > 1800 ? 600 : n > 600 ? 300 : n > 180 ? 60 : 30;
  let ticks = '';
  for (let t = step; t < n; t += step) {
    const label = t % 60 === 0 ? `${t / 60}m` : `${t}s`;
    ticks += `<line x1="${x(t)}" y1="${pad_t}" x2="${x(t)}" y2="${pad_t + ih}" class="rc-grid"/><text x="${x(t)}" y="${h - 4}" class="rc-t" text-anchor="middle">${label}</text>`;
  }

  const ftp_y = yw(ftp);
  return `<svg class="ride-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="power and heart rate over the ride">
    ${ticks}
    <path d="${area}" class="rc-power"/>
    <line x1="${pad_l}" y1="${ftp_y}" x2="${pad_l + iw}" y2="${ftp_y}" class="rc-ftp"/>
    <text x="${pad_l - 4}" y="${ftp_y + 4}" class="rc-t" text-anchor="end">FTP</text>
    <text x="${pad_l - 4}" y="${pad_t + 10}" class="rc-t rc-w" text-anchor="end">${Math.round(w_max)}</text>
    <text x="${pad_l - 4}" y="${pad_t + ih}" class="rc-t rc-w" text-anchor="end">0 W</text>
    ${hr_path ? `<path d="${hr_path}" class="rc-hr"/>
    <text x="${pad_l + iw + 4}" y="${pad_t + 10}" class="rc-t rc-h">${Math.round(hr_hi)}</text>
    <text x="${pad_l + iw + 4}" y="${pad_t + ih}" class="rc-t rc-h">${Math.round(hr_lo)}</text>` : ''}
  </svg>`;
}

// stats grid + chart for the results screen
export function ride_html(ftp) {
  const s = summary(ftp);
  if (s.secs < 10) return '';
  const r = (v, unit) => (v === null ? '--' : `${Math.round(v)}${unit}`);
  const cells = [
    ['Avg power', r(s.avg_w, ' W')],
    ['Norm. power', r(s.np, ' W')],
    ['Max power', r(s.max_w, ' W')],
    ['Best 1 min', r(s.best_1m, ' W')],
    ['Intensity', s.if_ === null ? '--' : s.if_.toFixed(2)],
    ['Energy', r(s.kj, ' kJ')],
    ['Avg HR', r(s.avg_hr, '')],
    ['Max HR', r(s.max_hr, '')],
    ['Avg cadence', r(s.avg_rpm, ' rpm')],
  ];
  return `<div class="panel ride">
    <div class="label">Your ride <span class="rc-legend"><i class="lg-w"></i>power <i class="lg-h"></i>heart rate</span></div>
    ${chart_svg(ftp)}
    <div class="ride-stats">${cells.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('')}</div>
  </div>`;
}

// tcx file of the ride (garmin training center format): strava, garmin connect, intervals.icu etc. import it.
// games without a speed (rhythm/workout) get a virtual speed from the shared physics, so distance isn't 0
export function tcx(sport_name, speed_of_watts) {
  if (samples.length < 10 || !started) return null;
  let dist = 0;
  const pts = samples.map((s, i) => {
    dist += s.m > 0 ? s.m : speed_of_watts(s.w);
    const t = new Date(started.getTime() + (i + 1) * 1000).toISOString();
    return `<Trackpoint><Time>${t}</Time><DistanceMeters>${dist.toFixed(1)}</DistanceMeters>`
      + (s.hr !== null ? `<HeartRateBpm><Value>${Math.round(s.hr)}</Value></HeartRateBpm>` : '')
      + `<Cadence>${Math.round(s.rpm)}</Cadence>`
      + `<Extensions><ns3:TPX><ns3:Watts>${Math.round(s.w)}</ns3:Watts></ns3:TPX></Extensions></Trackpoint>`;
  });
  const sum = summary(0);
  const id = started.toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Biking"><Id>${id}</Id>
<Lap StartTime="${id}"><TotalTimeSeconds>${samples.length}</TotalTimeSeconds><DistanceMeters>${dist.toFixed(1)}</DistanceMeters><Calories>${Math.round(sum.kj)}</Calories>`
    + (sum.avg_hr !== null ? `<AverageHeartRateBpm><Value>${Math.round(sum.avg_hr)}</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>${Math.round(sum.max_hr)}</Value></MaximumHeartRateBpm>` : '')
    + `<Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod>
<Track>${pts.join('\n')}</Track>
<Notes>Pedal Quest: ${sport_name}</Notes></Lap>
<Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Name>Pedal Quest</Name></Creator>
</Activity></Activities></TrainingCenterDatabase>
`;
}

// ---- ride history: last 200 finished rides (summary only), newest first ----
export function save_history(game, title) {
  const s = summary(0);
  if (s.secs < 60) return;
  let list = load('pq_history', []);
  list.unshift({
    date: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),   // local time
    game, title,
    secs: s.secs, avg_w: Math.round(s.avg_w), np: s.np ? Math.round(s.np) : null,
    kj: Math.round(s.kj), avg_hr: s.avg_hr ? Math.round(s.avg_hr) : null,
    km: +s.km.toFixed(2), max_w: s.max_w ? Math.round(s.max_w) : null, max_hr: s.max_hr ? Math.round(s.max_hr) : null,
  });
  store('pq_history', list.slice(0, 200));
}

// ---- per-game totals and all-time records (kept forever, unlike the history list) ----
// call when a game ends (finished or quit) with the game's own distance (km)
export function save_totals(game, km) {
  const s = summary(0);
  if (s.secs < 60) return;
  const totals = load('pq_game_stats', {});
  const t = totals[game] || { plays: 0, secs: 0, km: 0, kj: 0 };
  t.plays += 1;
  t.secs += s.secs;
  t.km += km;
  t.kj += s.kj;
  t.last = new Date().toISOString().slice(0, 10);
  totals[game] = t;
  store('pq_game_stats', totals);
  // records: keep the higher value and the day it was set
  const rec = load('pq_records', {});
  const day = t.last;
  const better = (k, v) => { if (v !== null && v !== undefined && v > (rec[k]?.v ?? 0)) rec[k] = { v: Math.round(v * 100) / 100, day, game }; };
  better('max_w', s.max_w);
  better('best_5s', s.best_5s);
  better('best_1m', s.best_1m);
  better('best_5m', s.best_5m);
  better('best_20m', s.best_20m);
  better('np', s.secs >= 600 ? s.np : null);
  better('max_hr', s.max_hr);
  better('secs', s.secs);
  better('km', km);
  better('kj', s.kj);
  store('pq_records', rec);
}

// one-time: per-game counts from the history saved before totals existed (no distances in old entries)
export function backfill_totals() {
  if (load('pq_game_stats', null)) return;
  const totals = {};
  for (const r of load('pq_history', [])) {
    const t = totals[r.game] || (totals[r.game] = { plays: 0, secs: 0, km: 0, kj: 0, last: r.date.slice(0, 10) });
    t.plays += 1;
    t.secs += r.secs;
    t.kj += r.kj;
    t.km += r.km || 0;
  }
  if (Object.keys(totals).length) store('pq_game_stats', totals);
}

// monday 00:00 local of the current week
function week_start() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// setup panel: this week's totals + recent rides. icons maps game id -> emoji
export function history_html(icons) {
  const list = load('pq_history', []);
  const ws = week_start();
  const week = list.filter((r) => new Date(r.date) >= ws);
  const mins = Math.round(week.reduce((a, r) => a + r.secs, 0) / 60);
  const kj = week.reduce((a, r) => a + r.kj, 0);
  const rows = list.slice(0, 15).map((r) => `<li><span class="h-date">${r.date.slice(5, 10)}</span><span>${icons[r.game] || ''} ${r.title}</span>`
    + `<span class="h-num">${Math.round(r.secs / 60)} min · ${r.avg_w} W${r.avg_hr ? ` · ${r.avg_hr} bpm` : ''}</span></li>`).join('');
  return `<summary>Ride history · this week ${week.length} ride${week.length === 1 ? '' : 's'}, ${Math.floor(mins / 60)} h ${mins % 60} min, ${kj} kJ</summary>
    ${list.length ? `<ol class="history">${rows}</ol>` : '<p class="small">Finished rides longer than 1 min show up here.</p>'}`;
}
