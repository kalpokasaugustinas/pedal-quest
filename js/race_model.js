// race state: riders (player + bots), bot power model, standings
import { step_speed } from './physics.js?v=33';

// bot roster: name, color, strength relative to the chosen base watts and riding style
const roster = [
  { name: 'Red Rocket', color: '#e53935', factor: 0.80, style: 'attacker' },
  { name: 'Blue Bolt', color: '#1e88e5', factor: 0.90, style: 'sitter' },
  { name: 'Green Machine', color: '#43a047', factor: 1.00, style: 'diesel' },
  { name: 'Purple Pace', color: '#8e24aa', factor: 1.10, style: 'chaser' },
  { name: 'Orange Flash', color: '#fb8c00', factor: 1.20, style: 'sprinter' },
];

// riding styles. bots never cheat: every watt above their average is paid back later (energy budget below).
//  attack: chance per second to attack when you fade next to them. chase: how keen they are to close a gap.
//  sit: how much they ease off while drafting (banks energy for later). sprint: share of the race where the kick starts
export const styles = {
  attacker: { label: 'Attacker', attack: 0.5, chase: 0.3, sit: 0.2, sprint: 0.1 },
  sitter: { label: 'Wheel sucker', attack: 0.1, chase: 0.2, sit: 1.0, sprint: 0.08 },
  diesel: { label: 'Diesel', attack: 0.05, chase: 0.5, sit: 0, sprint: 0.15 },
  chaser: { label: 'Chaser', attack: 0.2, chase: 1.0, sit: 0.3, sprint: 0.1 },
  sprinter: { label: 'Sprinter', attack: 0.15, chase: 0.4, sit: 0.7, sprint: 0.06 },
};

// energy budget: bank = joules a bot is under its average (avg_watts x time - energy spent). cruising slowly pays back
// any overdraft (and spends a surplus), tactics need credit, and the final sprint spends exactly what is left
const budget = { repay_s: 90, max_debt_s: 25, cruise: 0.97 };

const bot_lanes = [0, 1, 3, 4, 5];   // player rides in lane 2
const rand = (min, max) => min + Math.random() * (max - min);

// nitro: player charges it by keeping hr at or above a target line set from their own current race hr
// (full after 30 s above it, below it the charge just waits). bots charge on a timer at 50% of a perfect player race.
// a full bar fires automatically: +80 w for 3 s
// drafting: a rider up to 5 m ahead cuts your air drag, up to 30% when you're right on the wheel
export const draft_cfg = { max_gap: 5, min_gap: 1, max_cut: 0.3 };

// share of air drag a rider saves from the closest rider just ahead (0 = none).
// also remembers whose wheel it is (r.wheel), so the 3d view can slide the rider in behind them
function draft_cut(r, riders) {
  let best = 0;
  r.wheel = null;
  for (const o of riders) {
    if (o === r || o.finish_time !== null) continue;
    const gap = o.x - r.x;
    if (gap <= 0.2 || gap > draft_cfg.max_gap) continue;
    const k = Math.min(1, (draft_cfg.max_gap - gap) / (draft_cfg.max_gap - draft_cfg.min_gap));
    if (draft_cfg.max_cut * k > best) { best = draft_cfg.max_cut * k; r.wheel = o; }
  }
  return best;
}

export const nitro_cfg = { charge_s: 30, boost_s: 3, boost_watts: 80, bot_share: 0.5 };
const bot_charge_s = (nitro_cfg.charge_s + nitro_cfg.boost_s) / nitro_cfg.bot_share - nitro_cfg.boost_s;   // 63 s

// the target never asks you to ease off: there is no upper limit, and the line sits 1-3 bpm under your smoothed
// hr of the last ~15 s, so steady race effort is already above it and pushing harder only helps. the skill is not
// fading. a floor (65% of max hr) means soft pedalling charges nothing. below the line for 25 s: it is reset
// to your current hr (no punishment, just a new target)
export const nitro_hr = { floor: 0.65, tau_s: 15, warmup_s: 20, retry_s: 25 };
function new_hr_target(n) {
  return Math.max(Math.round(n.max_hr * nitro_hr.floor), Math.round(n.ema) - 1 - Math.floor(Math.random() * 3));
}

function new_nitro(charge = 0, max_hr = 185) {
  // target stays null until there are warmup_s of hr readings (hr needs time to rise at the start)
  return { charge, boost_left: 0, count: 0, in_range: false, max_hr, target: null, ema: null, hr_s: 0, miss_s: 0 };
}

// bots with their average watts for a given base strength (shown on the setup screen)
export function bot_lineup(base_watts) {
  return roster.map((b) => ({ ...b, avg_watts: Math.round(base_watts * b.factor) }));
}

// common rider fields: position x (m), speed v (m/s), crank angle, energy (joules) for avg watts
function new_rider(fields) {
  return { x: 0, v: 0, watts: 0, draft: 0, crank: rand(0, 6.28), energy: 0, finish_time: null, nitro: new_nitro(), ...fields };
}

export function create_race({ distance_m, base_watts, max_hr = 185 }) {
  const player = new_rider({ name: 'You', color: '#ffd400', is_player: true, lane: 2, nitro: new_nitro(0, max_hr) });
  const bots = bot_lineup(base_watts).map((b, i) => new_rider({
    ...b,
    is_player: false,
    lane: bot_lanes[i],
    phase: rand(0, 6.28),        // offset of the slow power wave
    period: rand(25, 45),        // seconds per power wave
    start_delay: rand(0.2, 0.8), // reaction time at the start
    st: styles[b.style],
    tactic: null,                // { kind: 'attack' | 'chase' | 'follow', mult, until }
    next_tactic: rand(20, 40),   // no tactics in the first seconds
    gap_hist: [],                // [time, gap to the player] for the last ~10 s
    nitro: new_nitro(rand(0, 0.6)),   // random head start so bots don't all fire together
  }));
  // p10 / p60: the player's smoothed power over ~10 s and ~60 s (bots notice when you fade or attack)
  return { distance_m, time: 0, player, riders: [player, ...bots], p10: 0, p60: 0, events: [] };
}

// start a tactic (and tell the game, so it can show it when it happens near you)
function start_tactic(b, race, kind, mult, secs) {
  b.tactic = { kind, mult, until: race.time + secs };
  b.next_tactic = race.time + secs + rand(15, 30);
  race.events.push({ kind, rider: b });
}

// pick a tactic from what the player is doing right now (only while the player is still racing)
function think(b, race, dt) {
  const t = race.time, p = race.player, avg = b.avg_watts, st = b.st;
  const gap = p.x - b.x;   // > 0: you are ahead
  b.gap_hist.push([t, gap]);
  while (b.gap_hist.length && t - b.gap_hist[0][0] > 10) b.gap_hist.shift();
  if (b.tactic || t < b.next_tactic || p.finish_time !== null || b.x > race.distance_m * (1 - st.sprint)) return;
  const credit = b.bank > -avg * budget.max_debt_s * 0.5;   // enough budget left for an effort
  const chance = (rate) => Math.random() < rate * dt;
  const fading = race.p60 > 0 && race.p10 < race.p60 * 0.85;
  const surging = race.p60 > 0 && race.p10 > race.p60 * 1.3;
  const opening = gap - b.gap_hist[0][1];   // how much the gap to you grew in the last 10 s
  if (credit && Math.abs(gap) < 8 && fading && chance(st.attack)) start_tactic(b, race, 'attack', 1.35, rand(7, 10));
  else if (credit && gap > 0 && gap < 15 && surging && chance(st.chase * 0.6)) start_tactic(b, race, 'follow', 1.25, rand(5, 8));
  else if (credit && gap > 8 && gap < 90 && opening > 3 && chance(st.chase * 0.3)) start_tactic(b, race, 'chase', 1.15, rand(12, 20));
  else if (credit && Math.abs(gap) < 25 && chance(st.attack * 0.02)) start_tactic(b, race, 'attack', 1.3, rand(6, 9));   // a test of your legs
}

// bot power right now: style + tactics, all paid from the energy budget, so the race average stays on avg_watts
function bot_watts(b, race, dt) {
  const t = race.time, avg = b.avg_watts;
  if (t < b.start_delay) return 0;
  b.bank = avg * (t - b.start_delay) - b.energy;
  think(b, race, dt);
  if (b.tactic && t > b.tactic.until) b.tactic = null;
  // final sprint: from the style's kick point, spend exactly the banked energy over the time left
  const left_m = race.distance_m - b.x;
  if (left_m < race.distance_m * b.st.sprint) {
    b.tactic = null;
    const t_left = Math.max(3, left_m / Math.max(b.v, 3));
    return Math.min(avg * 1.6, Math.max(avg * 0.85, avg + b.bank / t_left));
  }
  if (b.tactic && b.bank > -avg * budget.max_debt_s) return avg * b.tactic.mult;
  b.tactic = null;
  // cruising: slow wave, ease off on a wheel (sitters), pay back debt / spend part of a surplus
  let w = avg * budget.cruise * (1 + 0.07 * Math.sin((t / b.period) * 2 * Math.PI + b.phase));
  if (b.draft > 0.1) w *= 1 - 0.12 * b.st.sit;
  // pay back an overdraft from tactics; a surplus (cruising under average, sitting on a wheel) is kept for the sprint
  const planned = avg * (1 - budget.cruise) * (t - b.start_delay);
  w += Math.max(-avg * 0.25, Math.min(0, (b.bank - planned) / budget.repay_s));
  return Math.max(avg * 0.6, w);
}

// charge / fire nitro for one rider. hr is only used for the player (null = no hr, no charging)
function update_nitro(r, dt, hr) {
  const n = r.nitro;
  if (n.boost_left > 0) {
    n.boost_left = Math.max(0, n.boost_left - dt);   // no charging while boosting
    return;
  }
  if (r.is_player) {
    if (hr === null || hr === undefined) return;
    // smoothed hr: what the rider can hold right now
    n.ema = n.ema === null ? hr : n.ema + (hr - n.ema) * Math.min(1, dt / nitro_hr.tau_s);
    n.hr_s += dt;
    if (!n.target) {
      if (n.hr_s < nitro_hr.warmup_s) return;
      n.target = new_hr_target(n);
    }
    n.in_range = hr >= n.target;
    n.miss_s = n.in_range ? 0 : n.miss_s + dt;
    if (n.miss_s > nitro_hr.retry_s) { n.target = new_hr_target(n); n.miss_s = 0; }
    if (n.in_range) n.charge += dt / nitro_cfg.charge_s;   // below the line the charge just waits
  } else {
    n.charge += dt / bot_charge_s;
  }
  if (n.charge >= 1) {
    n.charge = 0;
    n.boost_left = nitro_cfg.boost_s;
    n.count += 1;
    if (r.is_player) n.target = new_hr_target(n);
  }
}

// advance the race by dt seconds. player_hr drives the player's nitro (null = no hr source)
export function update_race(race, dt, player_watts, player_cadence, player_hr = null) {
  race.time += dt;
  if (race.player.finish_time === null) {
    race.p10 += (player_watts - race.p10) * Math.min(1, dt / 10);
    race.p60 += (player_watts - race.p60) * Math.min(1, dt / 60);
  }
  for (const r of race.riders) {
    const done = r.finish_time !== null;
    if (!done && race.time > 0) update_nitro(r, dt, player_hr);
    // finished riders coast (0 watts)
    const base = done ? 0 : (r.is_player ? player_watts : bot_watts(r, race, dt));
    const watts = base + (!done && r.nitro.boost_left > 0 ? nitro_cfg.boost_watts : 0);
    const prev_x = r.x;
    r.draft = done || race.time < 3 ? (r.wheel = null, 0) : draft_cut(r, race.riders);   // no drafting in the start bunch
    r.v = step_speed(r.v, watts, dt, 0, 1 - r.draft);
    r.x += r.v * dt;
    r.watts = watts;
    // cadence only drives the leg animation; bots spin ~85-90 rpm
    const cadence = done ? 0 : (r.is_player ? player_cadence : (watts > 0 ? 87 + 4 * Math.sin(race.time / 7 + r.phase) : 0));
    r.crank += (cadence / 60) * 2 * Math.PI * dt;
    if (!done) {
      r.energy += base * dt;   // own effort only, nitro excluded from avg watts
      if (r.x >= race.distance_m) {
        // interpolate the exact crossing moment inside this step
        const frac = (race.distance_m - prev_x) / Math.max(r.x - prev_x, 1e-6);
        r.finish_time = race.time - dt + frac * dt;
      }
    }
  }
}

// finished riders by time, then the rest by distance covered
export function standings(race) {
  return [...race.riders].sort((a, b) => {
    if (a.finish_time !== null && b.finish_time !== null) return a.finish_time - b.finish_time;
    if (a.finish_time !== null) return -1;
    if (b.finish_time !== null) return 1;
    return b.x - a.x;
  });
}

// after the player finishes: fast-forward the bots so every rider gets a finish time
export function finish_remaining(race) {
  const limit = race.time + 4 * 3600;
  while (race.riders.some((r) => r.finish_time === null) && race.time < limit) {
    update_race(race, 0.1, 0, 0);
  }
}

// average watts over the rider's race
export function avg_watts(r) {
  return r.finish_time ? Math.round(r.energy / r.finish_time) : 0;
}
