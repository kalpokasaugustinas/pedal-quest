// race state: riders (player + bots), bot power model, standings
import { step_speed } from './physics.js';

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

// bots with their average watts for a given base strength (shown on the setup screen)
export function bot_lineup(base_watts) {
  return roster.map((b) => ({ ...b, avg_watts: Math.round(base_watts * b.factor) }));
}

// common rider fields: position x (m), speed v (m/s), crank angle, energy (joules) for avg watts
function new_rider(fields) {
  return { x: 0, v: 0, watts: 0, crank: rand(0, 6.28), energy: 0, finish_time: null, ...fields };
}

export function create_race({ distance_m, base_watts }) {
  const player = new_rider({ name: 'You', color: '#ffd400', is_player: true, lane: 2 });
  const bots = bot_lineup(base_watts).map((b, i) => new_rider({
    ...b,
    is_player: false,
    lane: bot_lanes[i],
    phase: rand(0, 6.28),        // offset of the slow power wave
    period: rand(25, 45),        // seconds per power wave
    start_delay: rand(0.2, 0.8), // reaction time at the start
    next_surge: rand(15, 45),    // time of first attack
    surge_until: 0,
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

// advance the race by dt seconds
export function update_race(race, dt, player_watts, player_cadence) {
  race.time += dt;
  for (const r of race.riders) {
    const done = r.finish_time !== null;
    // finished riders coast (0 watts)
    const watts = done ? 0 : (r.is_player ? player_watts : bot_watts(r, race));
    const prev_x = r.x;
    r.v = step_speed(r.v, watts, dt);
    r.x += r.v * dt;
    r.watts = watts;
    // cadence only drives the leg animation; bots spin ~85-90 rpm
    const cadence = done ? 0 : (r.is_player ? player_cadence : (watts > 0 ? 87 + 4 * Math.sin(race.time / 7 + r.phase) : 0));
    r.crank += (cadence / 60) * 2 * Math.PI * dt;
    if (!done) {
      r.energy += watts * dt;
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
