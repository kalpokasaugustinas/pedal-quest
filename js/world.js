// race world: the shared low-poly kit + the race course (start line, finish arch, km boards) and the pack.
// the scenery is drawn vis_scale times faster than the physics (the world flies by), while riders keep their
// real gaps to the player so the pack looks natural
import { create_kit, vis_scale } from './kit3d.js?v=46';

export { vis_scale };   // visual speed multiplier (kit3d.js; speed numbers and physics are unchanged)
const lane_count = 6;
const lane_w = 1.1;
const lane_x = (lane) => (lane - (lane_count - 1) / 2) * lane_w;

// build a fresh 3d world for this race; returns { render(dt), resize(), dispose() }
// look: the player's cyclist look (progress.js); bots ride in their team colour
export function create_world(canvas, race, theme_id = 'meadow', ftp = 200, look = null) {
  const kit = create_kit(canvas, { theme: theme_id, road_w: lane_count * lane_w + 1, lanes: lane_count });
  kit.add_arch(-race.distance_m * vis_scale, 'FINISH');
  for (let m = 500; m < race.distance_m; m += 500) kit.add_board(-m * vis_scale, `${m / 1000} km`);

  const riders = race.riders.map((r) => ({ r, model: kit.add_rider(r.is_player && look ? look : r.color), lx: lane_x(r.lane) }));
  const p = race.player;
  // rider z: the player sits at its scaled position, others keep their real gap to the player
  const rider_z = (r) => -(p.x * vis_scale + (r.x - p.x));
  const lx_of = (r) => riders.find((x) => x.r === r)?.lx ?? lane_x(r.lane);

  function render(dt) {
    const boost = p.nitro.boost_left > 0;
    const pz = rider_z(p);
    for (const it of riders) {
      const r = it.r;
      // drafting riders slide in behind the wheel they follow (only with room for a bike between them)
      const tx = r.wheel && r.wheel.x - r.x > 1.9 ? lx_of(r.wheel) : lane_x(r.lane);
      it.lx += (tx - it.lx) * Math.min(1, dt * 1.5);
      const z = rider_z(r);
      kit.place_rider(it.model, {
        z, x: it.lx, watts: r.watts, v: r.v, crank: r.crank, dist: r.x * vis_scale,
        ref: r.is_player ? ftp : r.avg_watts, boost: r.nitro.boost_left > 0,
        // riders between the camera and you fade out (not the ones riding alongside you)
        fade: r.is_player ? 1 : kit.fade_for(z, pz),
      }, dt);
    }
    const speed = p.v * vis_scale;
    kit.chase({ z: pz, x: riders[0].lx * 0.5, speed, boost }, dt);
    kit.frame(dt, { focus_z: pz, speed, boost });
  }

  return { render, resize: kit.resize, dispose: kit.dispose };
}
