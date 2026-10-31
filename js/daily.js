// daily challenge: one game + settings + goal per calendar day (same for everyone on that day), with a streak
import { load, store, seeded } from './util.js?v=13';

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const round10 = (w) => Math.max(50, Math.min(500, Math.round(w / 10) * 10));

// each entry builds the day's options and goal from a seeded random + the rider's ftp
const pool = [
  (rnd, ftp) => {
    const km = pick(rnd, [2, 5]);
    const f = pick(rnd, [0.7, 0.8, 0.9]);
    return { game: 'race', opts: { km, base_watts: round10(ftp * f) }, text: `${km} km vs ${round10(ftp * f)} W bots`, goal: 'Win the race', check: (fl) => fl.win };
  },
  () => ({ game: 'crossroads', opts: { stages: 5, stage_min: 2 }, text: '5 stages × 2 min', goal: 'Every stage clean', check: (fl) => fl.clean_all }),
  (rnd) => {
    const climb = pick(rnd, ['pine', 'eagle', 'rollers']);
    return { game: 'summit', opts: { climb }, text: 'Climb of the day', goal: 'Reach the top', check: () => true };
  },
  (rnd) => {
    const zone = pick(rnd, ['easy', 'mixed']);
    return { game: 'pulse', opts: { gates: 8, zone }, text: `8 gates · ${zone} zone`, goal: 'Miss at most 3 gates', check: (fl) => fl.miss <= 3 };
  },
  (rnd) => {
    const track = pick(rnd, ['groove', 'tempo', 'ladder']);
    return { game: 'spinbeat', opts: { track }, text: 'Track of the day', goal: '70% in the zone', check: (fl) => fl.acc >= 70 };
  },
  () => ({ game: 'escape', opts: { level: 0.65 }, text: 'Normal storm', goal: 'Survive 8 minutes', check: (fl) => fl.secs >= 480 }),
  (rnd) => {
    const dist = pick(rnd, [200, 250]);
    return { game: 'sprint', opts: { level: 1.4, dist }, text: `Club rivals · ${dist} m`, goal: 'Reach the final', check: (fl) => fl.won >= 2 };
  },
  (rnd) => {
    const plan = pick(rnd, ['quick', 'pyramid', 'vo2']);
    return { game: 'workout', opts: { plan, intensity: 1 }, text: 'Session of the day', goal: '75% on target', check: (fl) => fl.pct >= 75 };
  },
];

// local date as yyyy-mm-dd (the day rolls over at local midnight)
function day_key(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function today(ftp) {
  const key = day_key();
  const rnd = seeded(+key.replaceAll('-', ''));
  const ch = pool[Math.floor(rnd() * pool.length)](rnd, ftp);
  return { ...ch, day: key };
}

export function state() {
  const s = load('pq_daily', {});
  const yesterday = day_key(new Date(Date.now() - 86400000));
  // a streak survives only if the last completed day is today or yesterday
  const alive = s.last === day_key() || s.last === yesterday;
  return { last: s.last || null, streak: alive ? s.streak || 0 : 0, best: s.best || 0, total: s.total || 0, done_today: s.last === day_key() };
}

// call when a daily attempt finishes; returns true if the goal was met (first time today)
export function complete(ch, flags) {
  let ok = false;
  try { ok = !!ch.check(flags || {}); } catch { ok = false; }
  const s = state();
  if (!ok || s.done_today) return { ok, new_day: false, ...s };
  const streak = s.streak + 1;
  const next = { last: day_key(), streak, best: Math.max(s.best, streak), total: s.total + 1 };
  store('pq_daily', next);
  return { ok, new_day: true, ...next, done_today: true };
}
