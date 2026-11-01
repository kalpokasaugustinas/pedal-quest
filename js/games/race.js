// race: you vs 5 bots in a 3d world. your watts drive your rider, holding hr in a window charges nitro
import { bot_lineup, create_race, update_race, standings, finish_remaining, avg_watts, nitro_cfg } from '../race_model.js?v=18';
import { create_world, themes } from '../world.js?v=18';
import { fmt_time, ordinal } from '../util.js?v=18';

export default {
  id: 'race',
  name: 'Race',
  icon: '🏁',
  tagline: 'Beat 5 bots to the finish line in 3D.',
  uses: ['power', 'cadence', 'hr'],
  how: [
    'Your watts drive your rider. Bots ride the same physics with their own average power, random attacks and a final sprint.',
    'Nitro: keep your heart rate inside the target window. 30 s in range fills the bar, outside it drains at half speed.',
    'A full bar fires automatically: +80 W for 3 s, then a new window is picked.',
    'Bots get nitro too, at half the rate of a perfect player.',
    'Drafting: ride within 5 m behind anyone and your air drag drops by up to 30%. Bots draft too.',
  ],
  options: [
    { key: 'km', label: 'Race distance', choices: [[1, '1 km'], [2, '2 km'], [5, '5 km'], [10, '10 km']], def: 2 },
    { key: 'base_watts', label: 'Rival strength', type: 'stepper', min: 50, max: 500, step: 10, unit: 'W', def: 150 },
    { key: 'scenery', label: 'Scenery', choices: Object.entries(themes).map(([id, t]) => [id, t.name]), def: 'meadow' },
  ],
  setup_html: (o) => `<ul class="rivals">${bot_lineup(o.base_watts).reverse()
    .map((b) => `<li><span class="dot" style="background:${b.color}"></span>${b.name}<span class="w">~${b.avg_watts} W avg</span></li>`).join('')}</ul>`,
  board: (o) => ({ key: `race_${o.km}km`, label: `Best times · ${o.km} km`, lower: true, fmt: fmt_time }),
  create,
};

function create(env) {
  const $ = (id) => document.getElementById(id);
  const race = create_race({ distance_m: env.opts.km * 1000, base_watts: env.opts.base_watts });
  const world = create_world(env.canvas, race, env.opts.scenery, env.profile.ftp);

  env.hud.innerHTML = `
    <div class="race-top">
      <div id="h-pos" class="pos"></div>
      <div class="hud-mid">
        <div id="progress" class="progress">${race.riders.map((r) => `<span class="dot${r.is_player ? ' me' : ''}" style="background:${r.color}"></span>`).join('')}</div>
        <div class="hud-sub"><span id="h-time"></span> · <span id="h-left"></span> <span id="h-draft" class="draft hidden"></span></div>
      </div>
    </div>`;
  // mood layers above the 3d view: warm soft-light tint + soft vignette (calm, filmic look)
  env.overlay.innerHTML = '<div class="mood-tint"></div><div class="mood-vignette"></div><div id="boost-fx" class="boost-fx hidden"></div><ol id="leaderboard" class="leaderboard"></ol>';
  env.canvas.classList.add('soft-grade');
  env.bottom.innerHTML = `
    <div id="nitro" class="nitro">
      <span class="nitro-label">NITRO</span>
      <div class="nitro-bar"><div id="nitro-fill" class="nitro-fill"></div></div>
      <span id="nitro-range" class="nitro-range"></span>
    </div>`;
  const dots = [...$('progress').children];
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
      if (race.player.nitro.count > last_boosts) {
        last_boosts = race.player.nitro.count;
        env.big_text('NITRO!', 1200, 'hot');
        env.sfx('boost');
      }
      if (race.player.finish_time !== null) {
        game.done = true;
        game.done_text = 'FINISH';
      }
    },
    render(dt) {
      world.render(dt);
      update_hud();
    },
    resize: () => world.resize(),
    dispose: () => world.dispose(),
    result,
  };

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
    // leaderboard: rider names are fixed constants, so innerHTML is safe
    $('leaderboard').innerHTML = order.map((r, i) => {
      const gap = Math.round(r.x - p.x);
      const gap_text = r.is_player ? '' : (gap >= 0 ? `+${gap} m` : `${gap} m`);
      const fire = r.nitro.boost_left > 0 ? ' 🔥' : '';
      return `<li class="${r.is_player ? 'me' : ''}">${i + 1}. <span class="dot" style="background:${r.color}"></span>${r.name}${fire}<span class="gap">${gap_text}</span></li>`;
    }).join('');

    // nitro bar: charge (or remaining boost), target window, colour by state
    const n = p.nitro;
    const boosting = n.boost_left > 0;
    $('nitro').classList.toggle('boost', boosting);
    $('nitro').classList.toggle('in-range', !boosting && n.in_range && last_hr !== null);
    $('nitro').classList.toggle('off', last_hr === null);
    $('nitro-fill').style.width = `${(boosting ? n.boost_left / nitro_cfg.boost_s : n.charge) * 100}%`;
    $('nitro-range').textContent = last_hr === null ? 'needs HR strap' : `HR ${n.range[0]}–${n.range[1]}`;
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
      flags: { win: pos === 1, nitro: p.nitro.count },
      note: `${ordinal(pos)} vs ${env.opts.base_watts} W bots`,
    };
  }

  return game;
}
