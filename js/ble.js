// bluetooth helpers: ftms smart trainer (data + resistance control) and heart rate strap via web bluetooth

// standard bluetooth gatt uuids (16-bit)
const devices = {
  trainer: { service: 0x1826, characteristic: 0x2ad2, parse: parse_indoor_bike_data, control: true }, // ftms indoor bike data
  hr: { service: 0x180d, characteristic: 0x2a37, parse: parse_hr },                                   // heart rate measurement
};
const control_point_uuid = 0x2ad9;   // ftms control point (write + indicate)

export const ble_supported = !!navigator.bluetooth;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// parse ftms indoor bike data (0x2ad2). fields come in a fixed order, flags say which are present
export function parse_indoor_bike_data(dv) {
  const flags = dv.getUint16(0, true);
  let i = 2;
  const out = {};
  // bit 0 = "more data": when 0, instantaneous speed is present (inverted logic)
  if ((flags & 0x0001) === 0) { out.speed = dv.getUint16(i, true) / 100; i += 2; }
  if (flags & 0x0002) { i += 2; }                                          // average speed
  if (flags & 0x0004) { out.cadence = dv.getUint16(i, true) / 2; i += 2; } // instantaneous cadence, 0.5 rpm
  if (flags & 0x0008) { i += 2; }                                          // average cadence
  if (flags & 0x0010) { i += 3; }                                          // total distance (uint24)
  if (flags & 0x0020) { i += 2; }                                          // resistance level
  if (flags & 0x0040) { out.power = dv.getInt16(i, true); i += 2; }        // instantaneous power
  if (flags & 0x0080) { i += 2; }                                          // average power
  if (flags & 0x0100) { i += 5; }                                          // energy: total, per hour, per minute
  if (flags & 0x0200) { out.hr = dv.getUint8(i); i += 1; }                 // heart rate (if trainer relays it)
  return out;
}

// parse heart rate measurement (0x2a37): bit 0 of flags = 16-bit value
export function parse_hr(dv) {
  const flags = dv.getUint8(0);
  return (flags & 0x01) ? dv.getUint16(1, true) : dv.getUint8(1);
}

// open gatt connection and subscribe to notifications.
// uses the on... property (not addEventListener) so a reconnect never adds duplicate handlers
async function subscribe(device, cfg, on_data) {
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(cfg.service);
  const ch = await service.getCharacteristic(cfg.characteristic);
  ch.oncharacteristicvaluechanged = (e) => on_data(cfg.parse(e.target.value));
  await ch.startNotifications();
  if (cfg.control) await setup_control(service);
}

// ask the user to pick a device of this kind ('trainer' or 'hr'), then stream its data.
// on_status(state, device) gets 'connected' | 'reconnecting' | 'disconnected'.
// on a dropped connection it retries a few times (e.g. trainer briefly out of range)
export async function connect_device(kind, on_data, on_status) {
  const cfg = devices[kind];
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [cfg.service] }] });
  device.addEventListener('gattserverdisconnected', async () => {
    if (cfg.control) control.available = false;
    on_status('reconnecting', device);
    for (let attempt = 1; attempt <= 5; attempt++) {
      await wait(1000 * attempt);
      try {
        await subscribe(device, cfg, on_data);
        on_status('connected', device);
        return;
      } catch { /* try again */ }
    }
    on_status('disconnected', device);
  });
  await subscribe(device, cfg, on_data);
  on_status('connected', device);
  return device;
}

// ---- trainer resistance control (ftms control point) ----

let control_point = null;
let write_queue = Promise.resolve();

// gatt allows one operation at a time, so writes are chained
function write_cp(bytes) {
  const run = () => (control_point.writeValueWithResponse
    ? control_point.writeValueWithResponse(bytes)
    : control_point.writeValue(bytes));
  write_queue = write_queue.then(run, run);
  return write_queue;
}

// get the control point and ask the trainer for control. trainers without it simply stay "not available"
async function setup_control(service) {
  control.available = false;
  try {
    control_point = await service.getCharacteristic(control_point_uuid);
    // responses arrive as indications; not needed, but the subscription must exist before writing
    control_point.oncharacteristicvaluechanged = () => {};
    await control_point.startNotifications();
    await write_cp(new Uint8Array([0x00]));   // op 0x00: request control
    control.available = true;
  } catch {
    control_point = null;
  }
}

export const control = {
  available: false,
  // simulate a road gradient in percent: the trainer adds resistance like a real hill
  async set_grade(grade_pct) {
    if (!control.available) return;
    const dv = new DataView(new ArrayBuffer(7));
    dv.setUint8(0, 0x11);                                                            // op: indoor bike simulation
    dv.setInt16(1, 0, true);                                                         // wind speed 0 m/s
    dv.setInt16(3, Math.round(Math.max(-20, Math.min(20, grade_pct)) * 100), true); // grade in 0.01 %
    dv.setUint8(5, 40);                                                              // rolling resistance 0.0040
    dv.setUint8(6, 51);                                                              // wind resistance 0.51 kg/m
    try { await write_cp(new Uint8Array(dv.buffer)); } catch { /* a single failed write is harmless */ }
  },
  // erg mode: the trainer holds this power no matter how fast you pedal. set_grade(0) switches back to normal
  async set_power(watts) {
    if (!control.available) return;
    const dv = new DataView(new ArrayBuffer(3));
    dv.setUint8(0, 0x05);                                                    // op: set target power
    dv.setInt16(1, Math.round(Math.max(0, Math.min(2000, watts))), true);   // watts
    try { await write_cp(new Uint8Array(dv.buffer)); } catch { /* a single failed write is harmless */ }
  },
};
