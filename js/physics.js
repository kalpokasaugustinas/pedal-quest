// simple road cycling physics. same model for player, bots, ghosts and storms, so every game is fair

export const rider_mass = 85;   // kg, rider + bike
const crr = 0.004;              // rolling resistance coefficient (good road tyres)
const cda = 0.32;               // drag area m2 (hoods position)
const rho = 1.225;              // air density kg/m3
const g = 9.81;

// resistive force (newtons) at speed v (m/s) on a road with grade in percent: rolling + gravity + air drag
export function resist_force(v, grade = 0) {
  const theta = Math.atan(grade / 100);
  return crr * rider_mass * g * Math.cos(theta) + rider_mass * g * Math.sin(theta) + 0.5 * rho * cda * v * v;
}

// advance speed by dt seconds for a given power (watts). gives natural acceleration, coasting and climbing
export function step_speed(v, watts, dt, grade = 0) {
  const drive = watts / Math.max(v, 1);   // force = power / speed; floor avoids infinite force at standstill
  const a = (drive - resist_force(v, grade)) / rider_mass;
  return Math.max(0, v + a * dt);
}

// steady speed (m/s) that a given power holds on a given grade (bisection)
export function steady_speed(watts, grade = 0) {
  let lo = 0, hi = 30;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (resist_force(mid, grade) * mid > watts) hi = mid; else lo = mid;
  }
  return lo;
}
