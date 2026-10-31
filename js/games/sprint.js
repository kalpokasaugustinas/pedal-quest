// sprint cup: knockout drag-race tournament. three standing-start sprints (quarter, semi, final) against
// one rival each, with a recovery ride between rounds. lose a round and you're out
import { setup_2d, sky, hills, draw_rider, label, round_rect } from '../draw2d.js?v=9';
import { step_speed } from '../physics.js?v=9';
import { clamp, fmt_time, fmt_clock } from '../util.js?v=9';

const rounds = [
  { name: 'Quarterfinal', rival: 'Rocket Rosa', color: '#e53935', strength: 0.9 },
  { name: 'Semifinal', rival: 'Turbo Tom', color: '#1e88e5', strength: 1.0 },
  { name: 'Final', rival: 'Big Ben', color: '#8e24aa', strength: 1.1 },
];
const first_wait_s = 10;    // get ready before round 1
const recover_s = 45;       // easy riding between rounds
const staging_s = 3;        // 3-2-1 before each sprint

// rival sprint power: ramps to peak in 2 s, then fades towards 75% of peak (like a real sprint)
function rival_watts(peak, t) {
  if (t < 2) return peak * (0.6 + 0.2 * t);
  return peak * (0.75 + 0.25 * Math.exp(-(t - 2) / 8));
}

export default {
  id: 'sprint',
  name: 'Sprint Cup',
  icon: '⚡',
  tagline: 'Knockout sprint tournament. Three rivals, three all-out efforts.',
  uses: ['power', 'cadence'],
  how: [
    'Three rounds: quarterfinal, semifinal, final. Each is a standing-start sprint against one rival.',
    'Win to go through. Lose and you’re knocked out.',
    `Between rounds you get ${recover_s} s of easy riding to recover.`,
    'Rivals hit their peak after ~2 s and then fade, like real sprinters. Pace it or go all-in from the gun?',
    'Score: 100 per round won + 20 per second of winning margin.',
    'Tip: pick a big gear before the countdown ends.',
  ],
  options: [
    { key: 'level', label: 'Rival level', choices: [[1.4, 'Club'], [1.7, 'Racer'], [2.0, 'Pro']], def: 1.4 },
    { key: 'dist', label: 'Sprint distance', choices: [[200, '200 m'], [250, '250 m'], [400, '400 m']], def: 250 },
  ],
  setup_html: (o, profile) => `<p class="small">Rival peak power: ${rounds.map((r) => `${r.rival} ~${Math.round(profile.ftp * o.level * r.strength)} W`).join(' · ')} (from FTP ${profile.ftp} W).</p>`,
  board: (o) => ({ key: `sprint_${o.level}_${o.dist}`, label: `Top scores · ${o.dist} m · level ${o.level}`, lower: false, fmt: (s) => `${s} pts` }),
  create,
};

function create(env) {
  const $ = (id) => document.getElementById(id);
  const view = setup_2d(env.canvas);
  const ftp = env.profile.ftp;
  const dist = env.opts.dist;
  const st = {
    round: 0, phase: 'wait', t_phase: 0, score: 0, log: [],
    // player and rival sprint state
    p: { x: 0, v: 0, crank: 0, finish: null },
    r: { x: 0, v: 0, crank: 0, finish: null },
    t_sprint: 0, peak: 0, energy: 0, cruise_x: 0, last_count: 0,
  };
  const rival_peak = () => ftp * env.opts.level * rounds[st.round].strength;

  env.hud.innerHTML = `
    <div class="gh-row">
      <div class="gh-big" id="sp-big">R1</div>
      <div><div id="sp-title" class="gh-title"></div><div id="sp-sub" class="gh-sub"></div></div>
    </div>`;
  env.bottom.innerHTML = `
    <div class="target">
      <div class="target-row"><span id="sp-a"></span><span id="sp-b"></span></div>
      <div class="meter"><div id="sp-fill" class="meter-fill"></div></div>
    </div>`;

  function start_staging() {
    st.phase = 'staging';
    st.t_phase = 0;
    st.last_count = 0;
    st.p = { x: 0, v: 0, crank: st.p.crank, finish: null };
    st.r = { x: 0, v: 0, crank: 0, finish: null };
    st.t_sprint = 0;
    st.peak = 0;
    st.energy = 0;
  }

  function end_round() {
    const won = st.p.finish < st.r.finish;
    const margin = st.r.finish - st.p.finish;
    const round = rounds[st.round];
    const pts = won ? 100 + Math.round(margin * 20) : 0;
    st.score += pts;
    st.log.push({ round: round.name, rival: round.rival, you: st.p.finish, them: st.r.finish, peak: st.peak, avg: st.energy / st.p.finish, won, pts });
    if (!won) {
      game.done = true;
      game.done_text = 'KNOCKED OUT';
      game.done_class = 'bad';
      return;
    }
    if (st.round === rounds.length - 1) {
      game.done = true;
      game.done_text = 'CHAMPION! 🏆';
      game.done_class = 'good';
      return;
    }
    env.big_text(`WIN +${pts}`, 1500, 'good');
    env.sfx('perfect');
    st.round += 1;
    st.phase = 'recover';
    st.t_phase = 0;
  }

  const game = {
    done: false,
    speed: () => (st.phase === 'sprint' || st.phase === 'staging' ? st.p.v : st.p.v),
    update(dt, input) {
      st.p.crank += (input.cadence / 60) * 2 * Math.PI * dt;
      if (game.done) {
        st.p.v = step_speed(st.p.v, 0, dt);
        st.p.x += st.p.v * dt;
        return;
      }
      st.t_phase += dt;

      if (st.phase === 'wait' || st.phase === 'recover') {
        // cruising: the rider rolls along, nothing counts
        st.p.v = step_speed(st.p.v, input.watts, dt);
        st.cruise_x += st.p.v * dt;
        if (st.t_phase >= (st.phase === 'wait' ? first_wait_s : recover_s)) start_staging();
        return;
      }

      if (st.phase === 'staging') {
        const n = Math.ceil(staging_s - st.t_phase);
        if (n !== st.last_count && n > 0) {
          st.last_count = n;
          env.big_text(String(n), 900);
          env.sfx('tick');
        }
        if (st.t_phase >= staging_s) {
          st.phase = 'sprint';
          st.t_phase = 0;
          env.big_text('GO!', 700, 'hot');
          env.sfx('go');
        }
        return;
      }

      // sprint: both riders from standstill
      st.t_sprint += dt;
      for (const [rider, watts] of [[st.p, input.watts], [st.r, rival_watts(rival_peak(), st.t_sprint)]]) {
        if (rider.finish !== null) {
          rider.v = step_speed(rider.v, 0, dt);
          rider.x += rider.v * dt;
          continue;
        }
        const prev = rider.x;
        rider.v = step_speed(rider.v, watts, dt);
        rider.x += rider.v * dt;
        if (rider.x >= dist) rider.finish = st.t_sprint - dt + ((dist - prev) / Math.max(1e-6, rider.x - prev)) * dt;
      }
      st.r.crank += (110 / 60) * 2 * Math.PI * dt;
      if (st.p.finish === null) {
        st.peak = Math.max(st.peak, input.watts);
        st.energy += input.watts * dt;
      }
      if (st.p.finish !== null && st.r.finish !== null) end_round();
    },
    render(dt, input) {
      draw_scene(input);
      update_hud(input);
    },
    resize: () => view.resize(),
    dispose() {},
    result,
  };

  function draw_scene(input) {
    const { ctx, w, h } = view;
    const ins = env.insets();
    const sprinting = st.phase === 'sprint' || st.phase === 'staging';
    const cam_x = sprinting ? Math.max(st.p.x, st.r.x) * 0.5 + Math.min(st.p.x, st.r.x) * 0.5 : st.cruise_x;
    const ppm = clamp(w / 35, 8, 30);
    const cx = w * 0.45;
    const sx = (x) => cx + (x - cam_x) * ppm;
    const ground_y = h - ins.bottom - Math.max(40, h * 0.06);
    const lane_h = Math.min(70, h * 0.09);

    sky(ctx, w, ground_y, '#ff9a5c', '#ffe0b2');   // evening track light
    hills(ctx, w, ground_y - lane_h * 2, cam_x * ppm * 0.1, Math.min(120, h * 0.15), '#a1887f', 0);
    // stands with a crowd
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(0, ground_y - lane_h * 2 - 30, w, 30);
    for (let i = 0; i < w; i += 9) {
      const x = i - ((cam_x * ppm * 0.6) % 9);
      ctx.fillStyle = ['#ef5350', '#42a5f5', '#ffee58', '#66bb6a', '#ffffff'][Math.abs(Math.floor((i + cam_x * 5) / 9)) % 5];
      ctx.beginPath();
      ctx.arc(x, ground_y - lane_h * 2 - 22 + Math.sin(i + st.t_phase * 10) * (sprinting ? 2 : 0), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // track: two lanes
    ctx.fillStyle = '#c0574a';
    ctx.fillRect(0, ground_y - lane_h * 2, w, lane_h * 2 + 10);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(0, ground_y - lane_h * 2, w, 3);
    ctx.fillRect(0, ground_y - lane_h, w, 2);
    ctx.fillRect(0, ground_y + 8, w, 3);
    ctx.fillStyle = '#6d4c41';
    ctx.fillRect(0, ground_y + 11, w, h - ground_y);

    if (sprinting) {
      // start and finish lines, 50 m marks
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx(0) - 2, ground_y - lane_h * 2, 4, lane_h * 2 + 10);
      for (let m = 50; m < dist; m += 50) {
        const x = sx(m);
        if (x < -20 || x > w + 20) continue;
        ctx.fillRect(x - 1, ground_y - lane_h * 2, 2, 8);
        label(ctx, `${m}`, x, ground_y - lane_h * 2 - 40, 12, '#fff');
      }
      const fx = sx(dist);
      if (fx > -20 && fx < w + 20) {
        const sq = 8;
        for (let y = ground_y - lane_h * 2, row = 0; y < ground_y + 10; y += sq, row++) {
          for (let col = 0; col < 2; col++) {
            ctx.fillStyle = (row + col) % 2 ? '#111' : '#fff';
            ctx.fillRect(fx - sq + col * sq, y, sq, sq);
          }
        }
      }
    }

    const s = clamp(lane_h * 0.75, 28, 52);
    const rival = rounds[st.round];
    if (sprinting) {
      draw_rider(ctx, sx(st.r.x), ground_y - lane_h - 2, s * 0.9, { color: rival.color, crank: st.r.crank, wheel: st.r.x / 0.34 });
      draw_rider(ctx, sx(st.p.x), ground_y + 6, s, { color: '#ffd400', crank: st.p.crank, wheel: st.p.x / 0.34 });
      // off-screen rival marker
      const rx = sx(st.r.x);
      if (rx > w) label(ctx, `${rival.rival} ${Math.round(st.r.x - st.p.x)} m ▶`, w - 10, ground_y - lane_h * 1.5, 14, rival.color, 'right');
      if (rx < 0) label(ctx, `◀ ${rival.rival} ${Math.round(st.p.x - st.r.x)} m`, 10, ground_y - lane_h * 1.5, 14, rival.color, 'left');
      draw_power_duel(ctx, w, ins.top + 24, input);
    } else {
      draw_rider(ctx, cx, ground_y + 6, s, { color: '#ffd400', crank: st.p.crank, wheel: st.cruise_x / 0.34 });
      draw_round_card(ctx, w, ins.top + 20, Math.max(ins.top + 20, ground_y - lane_h * 2 - 60));
    }
  }

  // live power duel in the sky: your watts vs the rival's (watch them fade!)
  function draw_power_duel(ctx, w, top, input) {
    const rival = rounds[st.round];
    const theirs = st.phase === 'sprint' && st.r.finish === null ? rival_watts(rival_peak(), st.t_sprint) : 0;
    const yours = st.p.finish === null ? input.watts : 0;
    const scale = Math.max(rival_peak() * 1.3, yours, 100);
    const bw = Math.min(w - 40, 520), x = (w - bw) / 2;
    const bar = (y, value, color, name) => {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      round_rect(ctx, x, y, bw, 26, 8);
      ctx.fill();
      ctx.fillStyle = color;
      round_rect(ctx, x, y, Math.max(16, (bw * clamp(value, 0, scale)) / scale), 26, 8);
      ctx.fill();
      label(ctx, `${name} ${Math.round(value)} W`, x + 10, y + 14, 14, '#fff', 'left');
    };
    bar(top, yours, '#f9a825', 'You');
    bar(top + 34, theirs, rival.color, rival.rival);
  }

  // "next round" card shown while waiting / recovering
  function draw_round_card(ctx, w, top, max_bottom) {
    const r = rounds[st.round];
    const left = (st.phase === 'wait' ? first_wait_s : recover_s) - st.t_phase;
    const cw = Math.min(w - 32, 420), ch = Math.min(170, max_bottom - top);
    const x = (w - cw) / 2;
    ctx.fillStyle = 'rgba(10,15,20,0.85)';
    round_rect(ctx, x, top, cw, ch, 14);
    ctx.fill();
    label(ctx, `${r.name}`, w / 2, top + 28, 22, '#ffd54f');
    label(ctx, `vs ${r.rival}`, w / 2, top + 62, 26, r.color === '#1e88e5' ? '#64b5f6' : r.color === '#8e24aa' ? '#ce93d8' : '#ef9a9a');
    label(ctx, `peak ~${Math.round(rival_peak())} W · ${dist} m`, w / 2, top + 96, 15, '#fff');
    label(ctx, st.phase === 'wait' ? `Get ready: ${Math.ceil(left)} s` : `Recover: ${Math.ceil(left)} s`, w / 2, top + 132, 20, '#7ee08a');
  }

  function update_hud(input) {
    const r = rounds[st.round];
    $('sp-big').textContent = `${st.score}`;
    $('sp-title').textContent = `${r.name} vs ${r.rival}`;
    if (st.phase === 'sprint') {
      $('sp-sub').textContent = `${fmt_time(st.p.finish ?? st.t_sprint)} · ${Math.round(Math.max(0, dist - st.p.x))} m to go`;
      const gap = st.p.x - st.r.x;
      $('sp-a').textContent = `Peak ${Math.round(st.peak)} W`;
      $('sp-b').textContent = gap >= 0 ? `+${gap.toFixed(1)} m ahead` : `${gap.toFixed(1)} m behind`;
      $('sp-b').style.color = gap >= 0 ? '#7ee08a' : '#ff8a80';
      $('sp-fill').style.width = `${clamp(st.p.x / dist, 0, 1) * 100}%`;
    } else {
      const left = st.phase === 'staging' ? staging_s - st.t_phase : (st.phase === 'wait' ? first_wait_s : recover_s) - st.t_phase;
      $('sp-sub').textContent = `Round ${st.round + 1}/3 · ${st.phase === 'staging' ? 'get set!' : `starts in ${fmt_clock(left)}`}`;
      $('sp-a').textContent = st.phase === 'recover' ? 'Spin easy, breathe' : 'Shift to a big gear';
      $('sp-b').textContent = `${Math.round(input.watts)} W`;
      $('sp-b').style.color = '';
      $('sp-fill').style.width = '0%';
    }
  }

  function result() {
    const won = st.log.filter((l) => l.won).length;
    const rows = st.log.map((l) => `
      <tr class="${l.won ? 'me' : ''}">
        <td>${l.round}</td>
        <td>${l.rival}</td>
        <td class="num">${l.you.toFixed(2)}s</td>
        <td class="num">${l.them.toFixed(2)}s</td>
        <td class="num">${Math.round(l.peak)} W</td>
        <td class="num">${l.won ? `+${l.pts}` : '✗'}</td>
      </tr>`).join('');
    const titles = ['Out in the quarterfinal', 'Out in the semifinal', 'Runner-up 🥈', 'Champion! 🏆'];
    const best_peak = Math.max(0, ...st.log.map((l) => l.peak));
    return {
      title: titles[won],
      sub: `${st.score} points · ${won}/3 rounds won · peak ${Math.round(best_peak)} W`,
      body: `<table><tr class="th"><td>Round</td><td>Rival</td><td class="num">You</td><td class="num">Rival</td><td class="num">Peak</td><td class="num">Pts</td></tr>${rows}</table>`,
      score: st.score,
      note: `${won}/3 won · peak ${Math.round(best_peak)} W`,
    };
  }

  return game;
}
