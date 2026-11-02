// race: you vs 5 bots in a 3d world. your watts drive your rider, holding hr in a window charges nitro
import { create_race, update_race, standings, finish_remaining, avg_watts, nitro_cfg } from '../race_model.js?v=43';
import { create_world } from '../world.js?v=43';
import { scenery_option } from '../kit3d.js?v=43';
import { fmt_time, ordinal } from '../util.js?v=43';
import { create_commentator, place_word, one } from '../commentary.js?v=43';

export default {
  id: 'race',
  name: 'Race',
  icon: '🏁',
  tagline: 'Beat 5 bots to the finish line in 3D.',
  uses: ['power', 'cadence', 'hr'],
  how: [
    'Your watts drive your rider. Bots ride the same physics with their own average power, random attacks and a final sprint.',
    'Nitro: keep your heart rate at or above the target (e.g. HR ≥ 152). It is set just under your own heart rate of the last 15 s and has no upper limit, so steady race effort charges it and riding harder never hurts. Just keep it up.',
    '30 s above the line fills the bar; below it the charge just waits. The target starts 20 s into the race, is at least 65% of your max HR (soft pedalling charges nothing) and resets to your current heart rate after 25 s below it.',
    'A full bar fires automatically: +80 W for 3 s, then a new target is set from your heart rate.',
    'Bots get nitro too, at half the rate of a rider who never fades.',
    'Bots race smart but fair: each has a style (Attacker, Wheel sucker, Diesel, Chaser, Sprinter). They attack when you fade, follow your surges, chase when you break away and save energy on a wheel for the sprint. Every extra watt is paid back later, so their race average stays on target.',
    'Drafting: ride within 5 m behind anyone and your air drag drops by up to 30%. Bots draft too.',
  ],
  options: [
    { key: 'km', label: 'Race distance', choices: [[1, '1 km'], [2, '2 km'], [5, '5 km'], [10, '10 km']], def: 2 },
    // rival strength as a share of your ftp: hard = your ftp, easy = half of it
    { key: 'rivals', label: 'Rival strength', ftp_share: true, choices: [[0.5, 'Easy'], [0.75, 'Normal'], [1, 'Hard'], [1.25, 'Extreme']], def: 0.75 },
    scenery_option('meadow'),
  ],
  board: (o) => ({ key: `race_${o.km}km`, label: `Best times · ${o.km} km`, lower: true, fmt: fmt_time }),
  create,
};

function create(env) {
  const $ = (id) => document.getElementById(id);
  const base_watts = Math.round(env.profile.ftp * env.opts.rivals);
  const level_name = { 0.5: 'Easy', 0.75: 'Normal', 1: 'Hard', 1.25: 'Extreme' }[env.opts.rivals];
  const race = create_race({ distance_m: env.opts.km * 1000, base_watts, max_hr: env.profile.max_hr });
  race.player.color = env.look.jersey;   // your dot in the leaderboard = your jersey
  const world = create_world(env.canvas, race, env.opts.scenery, env.profile.ftp, env.look);

  env.hud.innerHTML = `
    <div class="race-top">
      <div id="h-pos" class="pos"></div>
      <div class="hud-mid">
        <div id="progress" class="progress">${race.riders.map((r) => `<span class="dot${r.is_player ? ' me' : ''}" style="background:${r.color}"></span>`).join('')}</div>
        <div class="hud-sub"><span id="h-time"></span> · <span id="h-left"></span> <span id="h-draft" class="draft hidden"></span></div>
      </div>
    </div>`;
  env.overlay.innerHTML = '<div id="boost-fx" class="boost-fx hidden"></div><ol id="leaderboard" class="leaderboard"></ol>';
  env.bottom.innerHTML = `
    <div id="nitro" class="nitro">
      <span class="nitro-label">NITRO</span>
      <div class="nitro-bar"><div id="nitro-fill" class="nitro-fill"></div></div>
      <span id="nitro-range" class="nitro-range"></span>
    </div>`;
  const dots = [...$('progress').children];

  // commentator: narrates overtakes, attacks, nitro, the gaps and your numbers (captions + voice)
  const cm = env.profile.commentator === false ? null : create_commentator($('screen-play'), { voice: env.profile.sound !== false, voice_name: env.profile.voice || '' });
  const talk = { started: false, order: null, order_t: 0, marks: new Set(), quiet_t: 14, draft_t: 0, boosting: new Set(), top_v: 0, cad: 0, hr: null };
  const cap = (t) => t[0].toUpperCase() + t.slice(1);
  const style_line = { attacker: 'itching to attack', sitter: 'sitting on wheels, waiting', diesel: 'riding a steady tempo', chaser: 'ready to chase anything', sprinter: 'saving it all for the sprint' };
  // "12 metres behind Olivia" / "8 metres clear"
  const gap_text = (order, me) => (me === 1
    ? (order[1] ? `, ${Math.round(race.player.x - order[1].x)} metres clear` : '')
    : `, ${Math.round(order[me - 2].x - race.player.x)} metres behind ${order[me - 2].name}`);
  function narrate(dt, input) {
    const p = race.player, km = race.distance_m / 1000;
    talk.top_v = Math.max(talk.top_v, p.v);
    talk.cad += ((input.cadence || 0) - talk.cad) * Math.min(1, dt * 0.5);
    talk.hr = input.hr ?? null;
    if (!talk.started) {
      talk.started = true;
      cm.say(one(`And they're off! Six riders, ${km} kilometres to the line.`, `We're racing! ${km} k, six riders. Let's go!`), 3);
      return;
    }
    // positions twice a second: the lead, your overtakes, bots swapping places near you or at the front
    talk.order_t -= dt;
    if (talk.order_t <= 0) {
      talk.order_t = 0.5;
      const order = standings(race), prev = talk.order;
      talk.order = order;
      if (prev && race.time > 4) {
        const pos = (r, list) => list.indexOf(r) + 1;
        const me_now = pos(p, order), me_was = pos(p, prev);
        if (order[0] !== prev[0]) cm.say(order[0].is_player ? one('You hit the front! You lead the race!', 'And you take the lead!') : `${order[0].name} takes the lead!`, 2, 'lead', 6);
        else if (me_now < me_was) { const by = prev[me_now - 1]; cm.say(one(`You pass ${by.name}, up to ${place_word(me_now)}!`, `Great move, you go by ${by.name}. ${cap(place_word(me_now))} now.`), 2, 'pass', 4); }
        else if (me_now > me_was) { const by = order[me_was - 1]; cm.say(one(`${by.name} gets past you. You drop to ${place_word(me_now)}.`, `${by.name} comes by! You're ${place_word(me_now)}.`), 2, 'passed', 4); }
        else {
          for (let i = 0; i < order.length - 1; i++) {
            const a = order[i], b = order[i + 1];
            if (a.is_player || b.is_player || pos(a, prev) <= pos(b, prev)) continue;
            if (i < 2 || Math.abs(a.x - p.x) < 25) { cm.say(`${a.name} moves past ${b.name} into ${place_word(i + 1)}.`, 1, 'botpass', 8); break; }
          }
        }
      }
    }
    // nitro: yours and theirs
    for (const r of race.riders) {
      const on = r.nitro.boost_left > 0;
      if (on && !talk.boosting.has(r)) cm.say(r.is_player ? one('Nitro! You are flying!', 'There goes the nitro, full gas!') : `${r.name} fires the nitro!`, 2, r.is_player ? null : 'botnitro', 10);
      if (on) talk.boosting.add(r); else talk.boosting.delete(r);
    }
    // distance marks
    const order = talk.order || standings(race), me = order.indexOf(p) + 1, left = race.distance_m - p.x;
    const mark = (id, cond, text) => { if (cond && !talk.marks.has(id)) { talk.marks.add(id); cm.say(text, 3); } };
    mark('half', race.distance_m >= 2000 && p.x >= race.distance_m / 2, `Halfway! You're ${place_word(me)}${gap_text(order, me)}.`);
    mark('1k', race.distance_m >= 3000 && left <= 1000, `Final kilometre! ${me === 1 ? 'You lead, now hold it!' : `You're ${place_word(me)}${gap_text(order, me)}.`}`);
    mark('200', left <= 200, me === 1 ? 'Two hundred metres to go and you lead! Empty the tank!' : `Two hundred to go! ${cap(place_word(me))} place. Sprint now!`);
    // drafting
    talk.draft_t = p.draft > 0.12 ? talk.draft_t + dt : 0;
    if (talk.draft_t > 3 && p.wheel) cm.say(`You're tucked in on ${p.wheel.name}'s wheel, saving energy.`, 1, 'draft', 45);
    // quiet moments: your numbers, the gap at the front or what a rival is up to
    talk.quiet_t -= dt;
    if (talk.quiet_t <= 0 && cm.free()) {
      talk.quiet_t = 13 + Math.random() * 9;
      // live average (avg_watts() only counts finished riders)
      const avg = Math.round(p.energy / Math.max(1, race.time)), pct = Math.round((avg / env.profile.ftp) * 100), r = Math.random();
      if (r < 0.4 && race.time > 20 && avg > 20) {
        cm.say(one(
          `You're averaging ${avg} watts, that's ${pct} percent of your FTP.`,
          `Cadence ${Math.round(talk.cad)}${talk.hr ? `, heart rate ${talk.hr}` : ''}. Average power ${avg} watts.`,
          `Top speed so far: ${Math.round(talk.top_v * 3.6)} kilometres an hour.`,
        ));
      } else if (r < 0.75) {
        const lead = order[0];
        cm.say(lead.is_player ? `You lead by ${Math.round(p.x - order[1].x)} metres over ${order[1].name}.` : `${lead.name} leads${me > 1 ? `, you're ${place_word(me)}, ${Math.round(lead.x - p.x)} metres back` : ''}.`);
      } else {
        const bots = order.filter((x) => !x.is_player && Math.abs(x.x - p.x) < 40);
        const b = bots[Math.floor(Math.random() * bots.length)];
        if (b) cm.say(`${b.name} is ${style_line[b.style] || 'looking strong'}.`);
      }
    }
  }
  let last_boosts = 0;
  let last_hr = null;

  const game = {
    done: false,
    speed: () => race.player.v,
    update(dt, input) {
      if (game.done) {
        update_race(race, dt, 0, 0);   // coast past the line, bots keep racing
        return;
      }
      last_hr = input.hr;
      update_race(race, dt, input.watts, input.cadence, input.hr);
      if (cm) narrate(dt, input);
      // tactics near you get a callout (the leaderboard shows the rest)
      for (const e of race.events.splice(0)) {
        if (Math.abs(e.rider.x - race.player.x) > 30) continue;
        if (cm && e.kind === 'attack') cm.say(one(`${e.rider.name} attacks!`, `${e.rider.name} jumps! Can you go with it?`), 2, 'attack', 6);
        const text = { attack: `⚔️ ${e.rider.name} attacks!`, chase: `🎯 ${e.rider.name} chases`, follow: `🧲 ${e.rider.name} follows` }[e.kind];
        env.big_text(text, 1400, 'callout');
        if (e.kind === 'attack') env.sfx('warn');
      }
      if (race.player.nitro.count > last_boosts) {
        last_boosts = race.player.nitro.count;
        env.big_text('NITRO!', 1200, 'hot');
        env.sfx('boost');
      }
      if (race.player.finish_time !== null) {
        game.done = true;
        game.done_text = 'FINISH';
        const pos = standings(race).indexOf(race.player) + 1;
        cm?.say(pos === 1 ? one('You win it! What a ride!', 'Victory! Nobody could touch you today!') : `You cross the line in ${place_word(pos)}.`, 3);
      }
    },
    render(dt) {
      world.render(dt);
      update_hud();
    },
    resize: () => world.resize(),
    dispose: () => { world.dispose(); cm?.stop(); },
    result,
  };

  let lb_t = 0;
  function render_leaderboard(order, p) {
    $('leaderboard').innerHTML = order.map((r, i) => {
      const gap = Math.round(r.x - p.x);
      const gap_text = r.is_player ? '' : (gap >= 0 ? `+${gap} m` : `${gap} m`);
      const fire = (r.nitro.boost_left > 0 ? ' 🔥' : '') + (r.tactic ? { attack: ' ⚔️', chase: ' 🎯', follow: ' 🧲' }[r.tactic.kind] : '');
      return `<li class="${r.is_player ? 'me' : ''}">${i + 1}. <span class="dot" style="background:${r.color}"></span>${r.name}${fire}<span class="gap">${gap_text}</span></li>`;
    }).join('');
  }

  function update_hud() {
    const order = standings(race);
    const p = race.player;
    $('h-pos').textContent = `${order.indexOf(p) + 1}/${race.riders.length}`;
    $('h-time').textContent = fmt_time(p.finish_time ?? race.time);
    $('h-left').textContent = `${(Math.max(0, race.distance_m - p.x) / 1000).toFixed(2)} km left`;
    $('h-draft').classList.toggle('hidden', p.draft < 0.02);
    $('h-draft').textContent = `💨 draft −${Math.round(p.draft * 100)}%`;
    race.riders.forEach((r, i) => {
      dots[i].style.left = `${Math.min(100, (r.x / race.distance_m) * 100)}%`;
    });
    // leaderboard: rider names are fixed constants, so innerHTML is safe. rebuilt 5x per second, not every
    // frame (a dom rebuild each frame costs a layout + paint on phones)
    const now = performance.now();
    if (now - lb_t > 200) { lb_t = now; render_leaderboard(order, p); }

    // nitro bar: charge (or remaining boost), target window, colour by state
    const n = p.nitro;
    const boosting = n.boost_left > 0;
    $('nitro').classList.toggle('boost', boosting);
    $('nitro').classList.toggle('in-range', !boosting && n.in_range && last_hr !== null);
    $('nitro').classList.toggle('off', last_hr === null);
    $('nitro-fill').style.width = `${(boosting ? n.boost_left / nitro_cfg.boost_s : n.charge) * 100}%`;
    $('nitro-range').textContent = last_hr === null ? 'needs HR strap' : (n.target ? `HR ≥ ${n.target}` : 'HR warming up');
    $('boost-fx').classList.toggle('hidden', !boosting);
  }

  function result() {
    finish_remaining(race);
    const order = standings(race);
    const p = race.player;
    const pos = order.indexOf(p) + 1;
    const winner_time = order[0].finish_time;
    const rows = order.map((r, i) => `
      <tr class="${r.is_player ? 'me' : ''}">
        <td>${i + 1}</td>
        <td><span class="dot" style="background:${r.color}"></span> ${r.name}</td>
        <td class="num">${fmt_time(r.finish_time)}</td>
        <td class="num">${i === 0 ? '' : `+${(r.finish_time - winner_time).toFixed(1)}s`}</td>
        <td class="num">${avg_watts(r)} W</td>
      </tr>`).join('');
    return {
      title: pos === 1 ? 'You won! 🏆' : `You finished ${ordinal(pos)}`,
      sub: `${env.opts.km} km in ${fmt_time(p.finish_time)} · avg ${avg_watts(p)} W · nitro ×${p.nitro.count}`,
      body: `<table>${rows}</table>`,
      score: p.finish_time,
      flags: { win: pos === 1, pos, nitro: p.nitro.count },
      note: `${ordinal(pos)} vs ${level_name} bots (${base_watts} W)`,
    };
  }

  return game;
}
