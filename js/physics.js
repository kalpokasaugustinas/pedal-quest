// simple road cycling physics on flat ground. same model for player and bots, so races are fair

export const rider_mass = 85;   // kg, rider + bike
const crr = 0.004;              // rolling resistance coefficient (good road tyres)
const cda = 0.32;               // drag area m2 (hoods position)
const rho = 1.225;              // air density kg/m3
const g = 9.81;

// resistive force (newtons) at speed v (m/s): rolling + aerodynamic drag
export function resist_force(v) {
  return crr * rider_mass * g + 0.5 * rho * cda * v * v;
}

// advance speed by dt seconds for a given power (watts). gives natural acceleration and coasting
export function step_speed(v, watts, dt) {
  const drive = watts / Math.max(v, 2);   // force = power / speed; floor avoids infinite force at standstill
  const a = (drive - resist_force(v)) / rider_mass;
  return Math.max(0, v + a * dt);
}
