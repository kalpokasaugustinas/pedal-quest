// progression: pedal points (pp) from riding, levels, and the cyclist look you unlock with them.
// pp = 10 per km + bonuses (finish, podium, personal best, daily challenge, new badges, solid workout).
// stored per player: pq_pp { total, last }, pq_look { slot: item id }
import { load, store } from './util.js?v=43';

// pp needed to go from level n to n+1: 100, 150, 200, ... (level 5 at 700 pp, level 10 at 2700 pp)
const step = (n) => 100 + 50 * (n - 1);

export function level_info(total) {
  let level = 1, floor = 0;
  while (total >= floor + step(level)) { floor += step(level); level += 1; }
  return { level, into: total - floor, need: step(level) };
}

// unlockable items per slot: [id, name, level]. ids are colours (or a style name)
export const catalog = {
  jersey: { label: 'Jersey', items: [
    ['#ffd400', 'Yellow', 1], ['#e53935', 'Red', 1], ['#1e88e5', 'Blue', 1], ['#43a047', 'Green', 2], ['#fb8c00', 'Orange', 3],
    ['#8e24aa', 'Purple', 4], ['#ec407a', 'Pink', 5], ['#212121', 'Black', 6], ['#fafafa', 'White', 7], ['#00897b', 'Teal', 8],
    ['#c6ff00', 'Fluo', 9], ['#d4a017', 'Gold', 12],
  ] },
  pattern: { label: 'Jersey pattern', items: [
    ['plain', 'Chest band', 1], ['hoops', 'Hoops', 2], ['stripes', 'Stripes', 3], ['sash', 'Sash', 4], ['dots', 'Polka dots', 5],
    ['twotone', 'Two-tone', 6], ['chevron', 'Chevron', 8], ['checks', 'Checkers', 10], ['rainbow', 'Champion bands', 14],
  ] },
  pattern_color: { label: 'Pattern colour', items: [
    ['#ffffff', 'White', 1], ['#212121', 'Black', 1], ['#e53935', 'Red', 2], ['#1e88e5', 'Blue', 3], ['#ffd400', 'Yellow', 4],
    ['#43a047', 'Green', 5], ['#ec407a', 'Pink', 7], ['#d4a017', 'Gold', 11],
  ] },
  frame: { label: 'Frame', items: [
    ['#f2f2f2', 'White', 1], ['#222226', 'Black', 1], ['#e53935', 'Red', 2], ['#1e88e5', 'Blue', 3], ['#ffd400', 'Yellow', 4],
    ['#43a047', 'Green', 6], ['#ec407a', 'Pink', 7], ['#b0bec5', 'Raw alloy', 9], ['#d4a017', 'Gold', 13],
  ] },
  rim: { label: 'Rims', items: [
    ['auto', 'Match jersey', 1], ['#1b1b1f', 'Carbon', 1], ['#f2f2f2', 'White', 3], ['#e53935', 'Red', 4], ['#1e88e5', 'Blue', 5],
    ['#c6ff00', 'Fluo', 8], ['#d4a017', 'Gold', 11],
  ] },
  helmet: { label: 'Helmet', items: [
    ['auto', 'Match jersey', 1], ['#fafafa', 'White', 1], ['#212121', 'Black', 2], ['#e53935', 'Red', 5], ['#1e88e5', 'Blue', 5],
    ['#c6ff00', 'Fluo', 7], ['#d4a017', 'Gold', 12],
  ] },
  shoe: { label: 'Shoes', items: [
    ['#f5f5f5', 'White', 1], ['#212121', 'Black', 1], ['#e53935', 'Red', 4], ['#c6ff00', 'Fluo', 6], ['#1e88e5', 'Blue', 7], ['#d4a017', 'Gold', 13],
  ] },
  flame: { label: 'Nitro flame', items: [
    ['#ff8a00', 'Orange', 1], ['#29b6f6', 'Blue', 3], ['#66ff66', 'Green', 5], ['#b388ff', 'Purple', 7], ['#ff4fa3', 'Pink', 9],
    ['#ffffff', 'White hot', 11], ['rainbow', 'Rainbow', 15],
  ] },
  trail: { label: 'Nitro trail', items: [
    ['none', 'None', 1], ['sparks', 'Sparks', 4], ['smoke', 'Smoke', 6], ['stars', 'Stars', 10], ['rainbow', 'Rainbow', 13],
  ] },
};

const default_look = Object.fromEntries(Object.entries(catalog).map(([k, c]) => [k, c.items[0][0]]));

export const pp_state = () => load('pq_pp', null) || backfill();

// first time: grant pp for riding done before levels existed (10 per km + 20 per badge)
function backfill() {
  const km = load('pq_stats', { km: 0 }).km || 0;
  const badges = Object.keys(load('pq_badges', {}).unlocked || {}).length;
  const s = { total: Math.round(km * 10) + badges * 20, last: null };
  store('pq_pp', s);
  return s;
}

// the rider's look: chosen items, falling back to the default when an item is locked or unknown
export function look() {
  const saved = load('pq_look', {});
  const lvl = level_info(pp_state().total).level;
  const out = { ...default_look };
  for (const [k, c] of Object.entries(catalog)) {
    const it = c.items.find((x) => x[0] === saved[k]);
    if (it && it[2] <= lvl) out[k] = it[0];
  }
  return out;
}
export function set_look(slot, id) {
  store('pq_look', { ...load('pq_look', {}), [slot]: id });
}

// items unlocked by reaching exactly this level
export const unlocks_at = (lvl) => Object.values(catalog).flatMap((c) => c.items.filter((x) => x[2] === lvl).map((x) => `${c.label}: ${x[1]}`));

// pp for one finished game. ctx = { secs, km, flags, rank (personal board, -1 = not placed), daily_new, badges }
export function award(ctx) {
  if (ctx.secs < 60) return null;   // same rule as stats: real rides only
  const lines = [['Distance', Math.round(ctx.km * 10)], ['Finished', 10]];
  const pos = ctx.flags?.pos;
  if (pos === 1) lines.push(['Win', 50]);
  else if (pos === 2) lines.push(['2nd place', 30]);
  else if (pos === 3) lines.push(['3rd place', 20]);
  if (ctx.rank === 0) lines.push(['Personal best', 30]);
  else if (ctx.rank > 0 && ctx.rank < 3) lines.push([`Top 3 on your board`, 10]);
  if ((ctx.flags?.pct ?? 0) >= 80) lines.push(['Workout ≥ 80% on target', 20]);
  if (ctx.daily_new) lines.push(['Daily challenge', 40]);
  if (ctx.badges) lines.push([`New badge${ctx.badges > 1 ? 's' : ''}`, 20 * ctx.badges]);
  const gained = lines.reduce((a, x) => a + x[1], 0);
  const s = pp_state();
  const before = level_info(s.total);
  s.total += gained;
  s.last = { gained, date: new Date().toISOString().slice(0, 10) };
  store('pq_pp', s);
  const after = level_info(s.total);
  const unlocked = [];
  for (let l = before.level + 1; l <= after.level; l++) unlocked.push(...unlocks_at(l));
  return { lines, gained, before, after, unlocked };
}

// results panel for an award
export function award_html(a) {
  if (!a) return '';
  const pct = Math.round((a.after.into / a.after.need) * 100);
  const up = a.after.level > a.before.level;
  return `<div class="panel pp ${up ? 'up' : ''}">
    <div class="pp-head"><b>+${a.gained} PP</b><span>Level ${a.after.level}${up ? ' · LEVEL UP! 🎉' : ''}</span></div>
    <div class="pp-bar"><div style="width:${pct}%"></div></div>
    <div class="small">${a.after.into} / ${a.after.need} PP to level ${a.after.level + 1}</div>
    <ul class="pp-lines">${a.lines.map(([t, v]) => `<li>${t}<span>+${v}</span></li>`).join('')}</ul>
    ${a.unlocked.length ? `<div class="pp-unlock">Unlocked: ${a.unlocked.join(' · ')} <a href="#garage">→ Garage</a></div>` : ''}
  </div>`;
}
