// shared sensor state for every game: trainer + hr strap connections and the rider profile (ftp, max hr).
// lives for the whole page session, so switching games keeps bluetooth connected
import { ble_supported, connect_device, control } from './ble.js?v=12';
import { load, store } from './util.js?v=12';

export { ble_supported, control };

export const sensors = {
  watts: 0, cadence: 0, hr: null,
  trainer: false, hr_strap: false, last_trainer_ms: 0,
  status: { trainer: 'not connected', hr: 'optional' },
};

// listeners get { kind: 'trainer' | 'hr', state }
const listeners = [];
export function on_change(fn) { listeners.push(fn); }
const notify = (kind, state) => listeners.forEach((fn) => fn({ kind, state }));

function on_trainer_data(d) {
  if (d.power !== undefined) sensors.watts = Math.max(0, d.power);
  if (d.cadence !== undefined) sensors.cadence = d.cadence;
  if (d.hr && !sensors.hr_strap) sensors.hr = d.hr;   // some trainers relay hr
  sensors.last_trainer_ms = performance.now();
}

function on_hr_data(bpm) {
  sensors.hr = bpm;
}

const status_text = {
  reconnecting: 'reconnecting…',
  disconnected: 'disconnected',
};

function on_status(kind, state, device) {
  const ok = state === 'connected';
  if (kind === 'trainer') sensors.trainer = ok;
  if (kind === 'hr') {
    sensors.hr_strap = ok;
    if (state === 'disconnected') sensors.hr = null;
  }
  const extra = kind === 'trainer' && ok ? (control.available ? ' · resistance control ✓' : ' · no resistance control') : '';
  sensors.status[kind] = ok ? `connected: ${device.name}${extra}` : status_text[state];
  notify(kind, state);
}

// connect button handler; a cancelled device picker is not an error
export async function connect(kind) {
  sensors.status[kind] = 'pick your device…';
  notify(kind, 'picking');
  try {
    await connect_device(
      kind,
      kind === 'trainer' ? on_trainer_data : on_hr_data,
      (state, device) => on_status(kind, state, device),
    );
  } catch (err) {
    sensors.status[kind] = err.name === 'NotFoundError' ? 'cancelled' : `failed: ${err.message}`;
    notify(kind, 'failed');
  }
}

// rider profile used by games to size targets (ftp = power you can hold ~1 hour)
export const profile = { ftp: 200, max_hr: 185, weight: 75, sound: true, ...load('pq_profile', {}) };
export function save_profile() {
  store('pq_profile', profile);
}
