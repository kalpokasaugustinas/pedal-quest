// escape: an endless chase. a storm front rides the same physics as you and gets stronger every minute.
// how long can you stay ahead? every km you reach a shelter checkpoint that pushes the storm back
import { setup_2d, sky, hills, draw_rider, label, mix } from '../draw2d.js?v=12';
import { step_speed } from '../physics.js?v=12';
import { clamp, fmt_clock } from '../util.js?v=12';

const start_gap = 60;          // meters head start
const checkpoint_m = 1000;     // a shelter every km
const checkpoint_push = 25;    // storm pushed back 25 m
const ramp_per_min = 0.05;     // storm power grows by 5% of ftp per minute
const max_gap = 150;           // the storm never falls further behind than this (no banking a huge early lead)

export default {
  id: 'escape',
  name: 'Escape',
  icon: '🌩️',
  tagline: 'Outride the storm. It never gets tired.',
  uses: ['power', 'cadence'],
  how: [
    `A storm starts ${start_gap} m behind you. It rides with real power, starting below your FTP and growing ${Math.round(ramp_per_min * 100)}% of FTP every minute.`,
    'The HUD shows the storm’s current watts. To stay ahead, you have to match them.',
    `Every km you pass a shelter: the storm is pushed back ${checkpoint_push} m.`,
    `The storm never drops more than ${max_gap} m behind, so you can’t bank a huge early lead.`,
    'When the storm catches you, the game is over. Score = time survived.',
  ],
  options: [
    { key: 'level', label: 'Storm start power', choices: [[0.55, 'Easy · 55% FTP'], [0.65, 'Normal · 65%'], [0.75, 'Hard · 75%']], def: 0.65 },
  ],
  setup_html: (o, profile) => {
    const at = (min) => Math.round(profile.ftp * (o.level + ramp_per_min * min));
    return `<p class="small">With FTP ${profile.ftp} W the storm rides ${at(0)} W at the start, ${at(5)} W at 5 min, ${at(10)} W at 10 min, ${at(15)} W at 15 min.</p>`;
  },
  board: (o) => ({ key: `escape_${o.level}`, label: `Longest escapes · start ${Math.round(o.level * 100)}% FTP`, lower: false, fmt: fmt_clock }),
  create,
};

function create(env) {
  const $ = (id) => document.getElementById(id);
  const view = setup_2d(env.canvas);
  const ftp = env.profile.ftp;
  const st = {
    x: 0, v: 0, crank: 0, time: 0, energy: 0,
    storm_x: -start_gap, storm_v: 0, next_cp: checkpoint_m, checkpoints: 0,
    flash: 0, bolt: null, rain_t: 0,
  };
  const storm_watts = () => ftp * (env.opts.level + ramp_per_min * (st.time / 60));

  env.hud.innerHTML = `
    <div class="gh-row">
      <div class="gh-big" id="es-time">0:00</div>
      <div><div id="es-gap" class="gh-title"></div><div id="es-sub" class="gh-sub"></div></div>
    </div>`;
  env.bottom.innerHTML = `
    <div class="target">
      <div class="target-row"><span id="es-storm"></span><span id="es-cp"></span></div>
      <div class="meter"><div id="es-fill" class="meter-fill"></div></div>
    </div>`;

  const game = {
    done: false,
    speed: () => st.v,
    update(dt, input) {
      st.v = step_speed(st.v, game.done ? 0 : input.watts, dt);
      st.x += st.v * dt;
      st.crank += (input.cadence / 60) * 2 * Math.PI * dt;
      st.rain_t += dt;
      st.flash = Math.max(0, st.flash - dt * 3);
      if (game.done) return;
      st.time += dt;
      st.energy += input.watts * dt;
      // storm waits 2 s, then rides
      if (st.time > 2) {
        st.storm_v = step_speed(st.storm_v, storm_watts(), dt);
        st.storm_x += st.storm_v * dt;
        // storm winds drag it along when it falls too far behind
        if (st.x - st.storm_x > max_gap) {
          st.storm_x = st.x - max_gap;
          st.storm_v = Math.max(st.storm_v, st.v);
        }
      }
      if (st.x >= st.next_cp) {
        st.storm_x -= checkpoint_push;
        st.next_cp += checkpoint_m;
        st.checkpoints += 1;
        env.big_text(`SHELTER! −${checkpoint_push} m`, 1400, 'good');
        env.sfx('good');
      }
      // lightning gets more frequent as the storm closes in
      const gap = st.x - st.storm_x;
      if (Math.random() < dt * clamp((60 - gap) / 30, 0.05, 1.5)) {
        st.flash = 1;
        st.bolt = Math.random();
      }
      // warning beep every 2 s while the storm is close
      if (gap < 25 && st.time - (st.last_warn ?? -9) > 2) {
        st.last_warn = st.time;
        env.sfx('warn');
      }
      if (gap <= 0) {
        game.done = true;
        game.done_text = 'CAUGHT!';
        game.done_class = 'bad';
      }
    },
    render(dt, input) {
      draw_scene();
      update_hud(input);
    },
    resize: () => view.resize(),
    dispose() {},
    result,
  };

  function draw_scene() {
    const { ctx, w, h } = view;
    const ins = env.insets();
    const gap = st.x - st.storm_x;
    const danger = clamp(1 - gap / 90, 0, 1);   // 0 = safe, 1 = caught
    const px = w * 0.62;
    // zoom out so the storm front is always on screen
    const ppm = clamp(Math.min(w / 90, (px - 30) / Math.max(20, gap + 10)), 1.5, 14);
    const sx = (x) => px + (x - st.x) * ppm;
    const ground_y = h - ins.bottom - Math.max(50, h * 0.08);

    // sky darkens as the storm gets closer
    sky(ctx, w, ground_y, mix('#6fb8ec', '#2b3242', danger), mix('#d4eefa', '#596273', danger));
    hills(ctx, w, ground_y, st.x * ppm * 0.15, Math.min(150, ground_y * 0.35), mix('#8fbf86', '#3c4a40', danger), 0);
    hills(ctx, w, ground_y, st.x * ppm * 0.35, Math.min(80, ground_y * 0.2), mix('#6aa25a', '#334034', danger), 2);
    ctx.fillStyle = mix('#5f9a4a', '#2f3d2c', danger);
    ctx.fillRect(0, ground_y, w, h - ground_y);
    ctx.fillStyle = '#3a3d42';
    ctx.fillRect(0, ground_y, w, 34);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    const off = (st.x * ppm) % 50;
    for (let x = -off; x < w; x += 50) ctx.fillRect(x, ground_y + 15, 24, 4);

    // shelter checkpoint ahead
    const cpx = sx(st.next_cp);
    if (cpx < w + 80) draw_shelter(ctx, cpx, ground_y);

    // km markers
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const marker_step = ppm < 4 ? 200 : 100;
    for (let m = Math.ceil((st.x - px / ppm) / marker_step) * marker_step; sx(m) < w; m += marker_step) {
      if (m <= 0) continue;
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx(m) - 1, ground_y - 22, 3, 22);
      ctx.fillText(`${m} m`, sx(m), ground_y - 26);
    }

    const s = clamp(h * 0.06, 32, 54);
    draw_rider(ctx, px, ground_y + 24, s, { color: '#ffd400', crank: st.crank, wheel: st.x / 0.34 });

    // storm front: jagged dark cloud wall from the left edge, rain inside it
    const front = sx(st.storm_x);
    if (front > -60) {
      const t = st.rain_t;
      ctx.fillStyle = 'rgba(25,28,40,0.92)';
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      for (let y = 0; y <= h; y += 16) {
        const wobble = 22 * Math.sin(y / 37 + t * 2) + 12 * Math.sin(y / 13 - t * 3);
        ctx.lineTo(front + wobble, y);
      }
      ctx.lineTo(-10, h);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(160,180,220,0.35)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 60; i++) {
        const rx = ((i * 53.3 + t * 40) % Math.max(20, front + 30)) - 10;
        const ry = (i * 97.1 + t * 600) % h;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 4, ry + 14);
        ctx.stroke();
      }
    }

    // lightning flash + bolt
    if (st.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${0.35 * st.flash})`;
      ctx.fillRect(0, 0, w, h);
      if (front > 0 && st.bolt !== null) {
        ctx.strokeStyle = `rgba(255,255,220,${st.flash})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        let bx = front * st.bolt, by = 0;
        ctx.moveTo(bx, by);
        while (by < ground_y) {
          bx += (Math.random() - 0.5) * 40;
          by += 30;
          ctx.lineTo(bx, by);
        }
        ctx.stroke();
      }
    }

    if (gap < 25 && !game.done) label(ctx, '⚠ STORM!', w / 2, ins.top + 60, 34, '#ff5252');
  }

  function draw_shelter(ctx, x, ground_y) {
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(x - 30, ground_y - 46, 60, 46);
    ctx.fillStyle = '#c62828';
    ctx.beginPath();
    ctx.moveTo(x - 40, ground_y - 46);
    ctx.lineTo(x, ground_y - 76);
    ctx.lineTo(x + 40, ground_y - 46);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffe082';
    ctx.fillRect(x - 10, ground_y - 30, 20, 30);
    label(ctx, 'SHELTER', x, ground_y - 90, 14, '#fff');
  }

  function update_hud(input) {
    const gap = st.x - st.storm_x;
    $('es-time').textContent = fmt_clock(st.time);
    $('es-gap').textContent = `Storm ${Math.max(0, Math.round(gap))} m behind`;
    $('es-gap').style.color = gap < 25 ? '#ff8a80' : gap < 50 ? '#ffd54f' : '';
    $('es-sub').textContent = `${(st.x / 1000).toFixed(2)} km · ${st.checkpoints} shelters`;
    const sw = Math.round(storm_watts());
    const you = Math.round(input.watts);
    $('es-storm').textContent = `Storm ${sw} W · you ${you} W ${you >= sw ? '▲' : '▼'}`;
    $('es-storm').style.color = you >= sw ? '#7ee08a' : '#ff8a80';
    $('es-cp').textContent = `shelter in ${Math.round(st.next_cp - st.x)} m`;
    $('es-fill').style.width = `${clamp(gap / 120, 0, 1) * 100}%`;
    $('es-fill').classList.toggle('bad', gap < 30);
  }

  function result() {
    return {
      title: `Survived ${fmt_clock(st.time)}`,
      sub: `${(st.x / 1000).toFixed(2)} km · ${st.checkpoints} shelters · avg ${Math.round(st.energy / Math.max(1, st.time))} W · storm reached ${Math.round(storm_watts())} W`,
      body: '',
      score: Math.round(st.time),
      flags: { secs: st.time },
      note: `${(st.x / 1000).toFixed(2)} km`,
    };
  }

  return game;
}
