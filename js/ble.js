// bluetooth helpers: connect to an ftms smart trainer and a heart rate strap via web bluetooth

// standard bluetooth gatt uuids (16-bit)
const devices = {
  trainer: { service: 0x1826, characteristic: 0x2ad2, parse: parse_indoor_bike_data }, // ftms indoor bike data
  hr: { service: 0x180d, characteristic: 0x2a37, parse: parse_hr },                   // heart rate measurement
};

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
}

// ask the user to pick a device of this kind ('trainer' or 'hr'), then stream its data.
// on_status(state, device) gets 'connected' | 'reconnecting' | 'disconnected'.
// on a dropped connection it retries a few times (e.g. trainer briefly out of range)
export async function connect_device(kind, on_data, on_status) {
  const cfg = devices[kind];
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [cfg.service] }] });
  device.addEventListener('gattserverdisconnected', async () => {
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
