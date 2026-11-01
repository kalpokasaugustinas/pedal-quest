// race state: riders (player + bots), bot power model, standings
import { step_speed } from './physics.js?v=24';

// bot roster: name, color and strength relative to the chosen base watts
const roster = [
  { name: 'Red Rocket', color: '#e53935', factor: 0.80 },
  { name: 'Blue Bolt', color: '#1e88e5', factor: 0.90 },
  { name: 'Green Machine', color: '#43a047', factor: 1.00 },
  { name: 'Purple Pace', color: '#8e24aa', factor: 1.10 },
  { name: 'Orange Flash', color: '#fb8c00', factor: 1.20 },
];

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
    next_surge: rand(15, 45),    // time of first attack
    surge_until: 0,
    nitro: new_nitro(rand(0, 0.6)),   // random head start so bots don't all fire together
  }));
  return { distance_m, time: 0, player, riders: [player, ...bots] };
}

// bot power at the current moment: average +- slow wave, random surges, final sprint.
// base scaled by 0.95 so surges and sprint bring the race average back to ~avg_watts
function bot_watts(b, race) {
  const t = race.time;
  if (t < b.start_delay) return 0;
  let w = b.avg_watts * 0.95 * (1 + 0.1 * Math.sin((t / b.period) * 2 * Math.PI + b.phase));
  if (t > b.next_surge) {
    b.surge_until = t + rand(5, 10);
    b.next_surge = t + rand(30, 70);
  }
  if (t < b.surge_until) w *= 1.25;
  if (b.x > race.distance_m * 0.9) w *= 1.3;
  return w;
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
  for (const r of race.riders) {
    const done = r.finish_time !== null;
    if (!done && race.time > 0) update_nitro(r, dt, player_hr);
    // finished riders coast (0 watts)
    const base = done ? 0 : (r.is_player ? player_watts : bot_watts(r, race));
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
