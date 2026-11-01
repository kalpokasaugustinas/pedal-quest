// sprint cup: one continuous race. rivals come up from behind one after another and attack you;
// answer each attack and hold them off. every rival you keep behind scores, the ones who pass you don't
import { overlay_2d, label, round_rect } from '../draw2d.js?v=21';
import { create_kit, scenery_option } from '../kit3d.js?v=21';
import { step_speed } from '../physics.js?v=21';
import { clamp, fmt_clock } from '../util.js?v=21';

// the attackers, in order; they come round again (stronger) on longer races
const roster = [
  { rival: 'Rocket Rosa', color: '#e53935', strength: 0.9 },
  { rival: 'Turbo Tom', color: '#1e88e5', strength: 1.0 },
  { rival: 'Green Gus', color: '#43a047', strength: 1.05 },
  { rival: 'Big Ben', color: '#8e24aa', strength: 1.1 },
  { rival: 'Orange Olga', color: '#fb8c00', strength: 1.15 },
];
const first_gap_s = 15;      // calm riding before the first attack
const gap_s = [25, 40];      // random calm time between attacks (so you can't time them)
const start_behind = 20;     // an attacker appears this far behind you (m)
const pass_margin = 5;       // attacker this far ahead of you = you've been passed
const attack_s = 22;         // an attack lasts this long; still in front at the end = held off

// attacker power: a surge to peak in 3 s, then fading towards 75% (they can't hold a sprint forever)
function rival_watts(peak, t) {
  if (t < 3) return peak * (0.7 + 0.1 * t);
  return peak * (0.75 + 0.25 * Math.exp(-(t - 3) / 7));
}

export default {
  id: 'sprint',
  name: 'Sprint Cup',
  icon: '⚡',
  tagline: 'One race, rivals attack from behind. Hold them off.',
  uses: ['power', 'cadence'],
  how: [
    'You ride one long race. Rivals come up from behind, one by one, and attack.',
    `⚠ When an attack starts, a rival is ${start_behind} m behind you and sprinting. Answer it!`,
    `Still ahead after ${attack_s} s = attack held off: 100 points + 10 per meter of lead. Passed by ${pass_margin} m = attack lost.`,
    'Attackers surge in 3 s and then fade, like real sprinters. Go too early and you fade with them.',
    `Between attacks you get ${gap_s[0]}–${gap_s[1]} s of calm (random, so stay alert).`,
    'Later attackers are stronger. Rival level sets their peak power from your FTP.',
  ],
  options: [
    { key: 'level', label: 'Rival level', choices: [[1.4, 'Club'], [1.7, 'Racer'], [2.0, 'Pro']], def: 1.4 },
    { key: 'attacks', label: 'Attacks', choices: [[3, '3'], [5, '5'], [8, '8']], def: 5 },
    scenery_option('meadow'),
  ],
  setup_html: (o, profile) => `<p class="small">Attackers peak at ${Math.round(profile.ftp * o.level * 0.9)}–${Math.round(profile.ftp * o.level * 1.15)} W (from FTP ${profile.ftp} W). Race ≈ ${Math.round((first_gap_s + o.attacks * (attack_s + 32)) / 60)} min.</p>`,
  board: (o) => ({ key: `sprint_${o.level}_${o.attacks}`, label: `Top scores · ${o.attacks} attacks · level ${o.level}`, lower: false, fmt: (s) => `${s} pts` }),
  create,
};

function create(env) {
  const $ = (id) => document.getElementById(id);
  const ftp = env.profile.ftp;
  const total = env.opts.attacks;
  const st = {
    phase: 'calm', t_phase: 0, next_in: first_gap_s, n: 0, score: 0, log: [], warned: false,
    p: { x: 0, v: 0, crank: 0, watts: 0 },
    riders: [],          // attackers on the road (current + earlier ones still in view)
    cur: null,           // the current attacker
    time: 0, energy: 0, peak: 0, attack_peak: 0,
  };
  // the n-th attacker: roster cycles, stronger each time round
  const attacker_for = (n) => {
    const r = roster[n % roster.length];
    return { ...r, peak: ftp * env.opts.level * r.strength * (1 + 0.08 * Math.floor(n / roster.length)) };
  };

  env.hud.innerHTML = `
    <div class="gh-row">
      <div class="gh-big" id="sp-big">0</div>
      <div><div id="sp-title" class="gh-title"></div><div id="sp-sub" class="gh-sub"></div></div>
    </div>`;
  env.bottom.innerHTML = `
    <div class="target">
      <div class="target-row"><span id="sp-a"></span><span id="sp-b"></span></div>
      <div class="meter"><div id="sp-fill" class="meter-fill"></div></div>
    </div>`;

  function start_attack() {
    const a = attacker_for(st.n);
    const rider = { ...a, x: st.p.x - start_behind, v: st.p.v + 3, crank: 0, watts: 0, t: 0, model: kit.add_rider(a.color), lane: (st.n % 2 ? 1 : -1) * 0.9 };
    st.riders.push(rider);
    st.cur = rider;
    st.phase = 'attack';
    st.t_phase = 0;
    st.attack_peak = 0;
    env.big_text(`⚠ ${a.rival} attacks!`, 1600, 'hot');
    env.sfx('warn');
  }

  function end_attack(held) {
    const r = st.cur;
    const lead = st.p.x - r.x;
    const pts = held ? 100 + Math.round(Math.max(0, lead) * 10) : 0;
    st.score += pts;
    st.log.push({ n: st.n + 1, rival: r.rival, color: r.color, held, lead, peak: st.attack_peak, rival_peak: r.peak, pts });
    env.big_text(held ? `HELD OFF +${pts}` : `${r.rival} got away`, 1500, held ? 'good' : 'bad');
    env.sfx(held ? 'perfect' : 'bad');
    st.cur = null;
    st.n += 1;
    if (st.n >= total) {
      game.done = true;
      game.done_text = 'FINISH';
      game.done_class = st.log.every((l) => l.held) ? 'good' : '';
      return;
    }
    st.phase = 'calm';
    st.t_phase = 0;
    st.next_in = gap_s[0] + Math.random() * (gap_s[1] - gap_s[0]);
  }

  const game = {
    done: false,
    speed: () => st.p.v,
    update(dt, input) {
      const p = st.p;
      p.watts = game.done ? 0 : input.watts;
      p.v = step_speed(p.v, p.watts, dt);
      p.x += p.v * dt;
      p.crank += (input.cadence / 60) * 2 * Math.PI * dt;
      // attackers: the current one sprints, finished ones settle into a steady pace (and drift away)
      for (const r of st.riders) {
        if (r === st.cur) { r.t += dt; r.watts = rival_watts(r.peak, r.t); }
        else r.watts = ftp * 0.75;
        r.v = step_speed(r.v, r.watts, dt);
        r.x += r.v * dt;
        r.crank += ((r.watts > 20 ? 95 : 0) / 60) * 2 * Math.PI * dt;
      }
      // forget riders far away
      for (const r of st.riders.filter((x) => x !== st.cur && Math.abs(x.x - p.x) > 160)) {
        kit.scene.remove(r.model.group);
        st.riders.splice(st.riders.indexOf(r), 1);
      }
      if (game.done) return;
      st.time += dt;
      st.t_phase += dt;
      st.energy += input.watts * dt;
      st.peak = Math.max(st.peak, input.watts);
      if (st.phase === 'calm') {
        // a warning just before the attack
        if (st.t_phase >= st.next_in - 3 && !st.warned) { st.warned = true; env.big_text('Attack coming…', 1200); env.sfx('tick'); }
        if (st.t_phase >= st.next_in) { st.warned = false; start_attack(); }
        return;
      }
      st.attack_peak = Math.max(st.attack_peak, input.watts);
      const lead = p.x - st.cur.x;
      if (lead <= -pass_margin) end_attack(false);
      else if (st.t_phase >= attack_s) end_attack(lead > 0);
    },
    render(dt, input) {
      draw_scene(input, dt);
      update_hud(input);
    },
    resize: () => { kit.resize(); view.resize(); },
    dispose: () => kit.dispose(),
    result,
  };

  // ---- 3d: one long winding road; attackers keep their real gap to you, the camera pulls back during attacks ----
  const vis = 2.5;
  const kit = create_kit(env.canvas, { theme: env.opts.scenery });
  const me = kit.add_rider('#ffd400');
  const view = overlay_2d(env.overlay);   // duel bars on top of the 3d view
  let cam_back = 4.2;

  function draw_scene(input, dt) {
    const p = st.p;
    const pz = -p.x * vis;
    kit.place_rider(me, { z: pz, x: 0, watts: p.watts, v: p.v, crank: p.crank, dist: -pz, ref: ftp }, dt);
    for (const r of st.riders) {
      const z = pz - (r.x - p.x);   // real gap to you (like the race pack)
      kit.place_rider(r.model, { z, x: r.lane, watts: r.watts, v: r.v, crank: r.crank, dist: p.x * vis + (r.x - p.x), ref: r.peak / 1.6, fade: kit.fade_for(z, pz, cam_back) }, dt);
    }
    // during an attack the camera pulls back and up far enough to keep the attacker in the picture
    const behind = st.cur ? Math.max(0, p.x - st.cur.x) : 0;
    const want = st.phase === 'attack' ? clamp(behind + 3, 5, 9) : (kit.portrait ? 4.2 : 5.2);
    cam_back += (want - cam_back) * Math.min(1, dt * 1.5);
    const speed = p.v * vis;
    kit.chase({ z: pz, back: cam_back, height: 2 + (cam_back - 4) * 0.33, look_y: 0.2, speed, smooth: 6 }, dt);
    // rear-view mirror during attacks: watch them come
    const mirror = st.phase === 'attack' && st.cur ? { z: pz, top: env.insets().top + 96, look_z: pz - (st.cur.x - p.x) + 6 } : null;
    if (!mirror) kit.hide_mirror();
    kit.frame(dt, { focus_z: pz, speed, mirror });

    view.clear();
    if (st.phase === 'attack' && st.cur) draw_power_duel(view.ctx, view.w, env.insets().top + 24, input);
  }

  // live power duel: your watts vs the attacker's (watch them fade!)
  function draw_power_duel(ctx, w, top, input) {
    const r = st.cur;
    const scale = Math.max(r.peak * 1.3, input.watts, 100);
    const bw = Math.min(w - 40, 520), x = (w - bw) / 2;
    const bar = (y, value, color, name) => {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      round_rect(ctx, x, y, bw, 26, 8);
      ctx.fill();
      ctx.fillStyle = color;
      round_rect(ctx, x, y, Math.max(16, (bw * clamp(value, 0, scale)) / scale), 26, 8);
      ctx.fill();
      label(ctx, `${name} ${Math.round(value)} W`, x + 10, y + 14, 14, '#fff', 'left');
    };
    bar(top, input.watts, '#f9a825', 'You');
    bar(top + 34, r.watts, r.color, r.rival);
  }

  function update_hud(input) {
    $('sp-big').textContent = `${st.score}`;
    const held = st.log.filter((l) => l.held).length;
    if (st.phase === 'attack' && st.cur) {
      const lead = st.p.x - st.cur.x;
      $('sp-title').textContent = `Attack ${st.n + 1}/${total}: ${st.cur.rival}`;
      $('sp-sub').textContent = `hold on ${Math.ceil(attack_s - st.t_phase)} s · held off ${held}`;
      $('sp-a').textContent = lead >= 0 ? `${st.cur.rival} ${lead.toFixed(1)} m behind` : `${st.cur.rival} ${(-lead).toFixed(1)} m ahead!`;
      $('sp-a').style.color = lead >= 0 ? '#7ee08a' : '#ff8a80';
      $('sp-b').textContent = `${Math.round(input.watts)} W`;
      // meter: how far you are from being passed (full = safe)
      $('sp-fill').style.width = `${clamp((lead + pass_margin) / (start_behind + pass_margin), 0, 1) * 100}%`;
      $('sp-fill').classList.toggle('bad', lead < 3);
    } else {
      $('sp-title').textContent = st.n < total ? `Race · next: ${attacker_for(st.n).rival}` : 'Race';
      $('sp-sub').textContent = `${st.n}/${total} attacks · held off ${held} · ${fmt_clock(st.time)}`;
      $('sp-a').textContent = 'Ride steady, save your legs';
      $('sp-a').style.color = '';
      $('sp-b').textContent = `${Math.round(input.watts)} W`;
      $('sp-fill').style.width = '0%';
      $('sp-fill').classList.remove('bad');
    }
  }

  function result() {
    const held = st.log.filter((l) => l.held).length;
    const rows = st.log.map((l) => `
      <tr class="${l.held ? 'me' : ''}">
        <td>${l.n}</td>
        <td><span class="dot" style="background:${l.color}"></span> ${l.rival}</td>
        <td class="num">${Math.round(l.rival_peak)} W</td>
        <td class="num">${Math.round(l.peak)} W</td>
        <td class="num">${l.held ? `+${l.lead.toFixed(1)} m` : 'passed'}</td>
        <td class="num">${l.held ? `+${l.pts}` : '✗'}</td>
      </tr>`).join('');
    return {
      title: held === total ? 'Untouchable! 🏆' : `Held off ${held}/${total} attacks`,
      sub: `${st.score} points · peak ${Math.round(st.peak)} W · avg ${Math.round(st.energy / Math.max(1, st.time))} W`,
      body: `<table><tr class="th"><td>#</td><td>Attacker</td><td class="num">Their peak</td><td class="num">Your peak</td><td class="num">Lead</td><td class="num">Pts</td></tr>${rows}</table>`,
      score: st.score,
      flags: { won: held, all: held === total },
      note: `${held}/${total} held · peak ${Math.round(st.peak)} W`,
    };
  }

  return game;
}
