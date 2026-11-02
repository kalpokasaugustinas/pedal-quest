// stats tab: the active player's totals, most played game, best result per game, all-time power / hr records
import { load, fmt_clock, player_board_keys } from './util.js?v=43';

const hm = (secs) => `${Math.floor(secs / 3600)} h ${Math.floor((secs % 3600) / 60)} min`;
const tile = (k, v, sub = '') => `<div class="st-tile"><small>${k}</small><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;

// games: every game module; main: ids of the games in the picker; opts_of(g): the game's current options
export function stats_html({ games, main, opts_of, player, daily }) {
  const life = load('pq_stats', { rides: 0, secs: 0, kj: 0, km: 0 });
  const totals = load('pq_game_stats', {});
  const rec = load('pq_records', {});
  const labels = load('pq_board_labels', {});
  const by_id = Object.fromEntries(games.map((g) => [g.id, g]));

  // most played: by number of games, ties broken by time
  const ranked = Object.entries(totals).filter(([id]) => by_id[id]).sort((a, b) => b[1].plays - a[1].plays || b[1].secs - a[1].secs);
  const fav = ranked[0];
  const history = load('pq_history', []);
  const days = new Set(history.map((r) => r.date.slice(0, 10))).size;

  const top = `<div class="st-grid">
    ${tile('Games played', life.rides)}
    ${tile('Riding time', hm(life.secs))}
    ${tile('Distance', `${life.km.toFixed(1)} km`)}
    ${tile('Energy', `${Math.round(life.kj)} kJ`, `≈ ${Math.round(life.kj)} kcal burnt`)}
    ${tile('Most played', fav ? `${by_id[fav[0]].icon} ${by_id[fav[0]].name}` : '--', fav ? `${fav[1].plays}× · ${hm(fav[1].secs)}` : '')}
    ${tile('Daily streak', `🔥 ${daily.streak}`, `best ${daily.best} · ${daily.total} done`)}
    ${tile('Days ridden', days || '--', 'in the last 200 rides')}
  </div>`;

  // records: value + day it was set
  const r = (k, unit, fmt = (v) => Math.round(v)) => (rec[k] ? `${fmt(rec[k].v)}${unit}` : '--');
  const d = (k) => (rec[k] ? `${rec[k].day}${by_id[rec[k].game] ? ` · ${by_id[rec[k].game].icon}` : ''}` : '');
  const records = `<div class="st-grid">
    ${tile('Max power', r('max_w', ' W'), d('max_w'))}
    ${tile('Best 5 s', r('best_5s', ' W'), d('best_5s'))}
    ${tile('Best 1 min', r('best_1m', ' W'), d('best_1m'))}
    ${tile('Best 5 min', r('best_5m', ' W'), d('best_5m'))}
    ${tile('Best 20 min', r('best_20m', ' W'), d('best_20m'))}
    ${tile('Best NP (10+ min)', r('np', ' W'), d('np'))}
    ${tile('Max heart rate', r('max_hr', ' bpm'), d('max_hr'))}
    ${tile('Longest ride', rec.secs ? fmt_clock(rec.secs.v) : '--', d('secs'))}
    ${tile('Longest distance', r('km', ' km', (v) => v.toFixed(1)), d('km'))}
    ${tile('Most work', r('kj', ' kJ'), d('kj'))}
  </div>`;

  // per game: plays, time, distance, best result per board (one board per game setting)
  const game_rows = games.filter((g) => main.includes(g.id) || totals[g.id]).map((g) => {
    const t = totals[g.id];
    const fmt = g.board(opts_of(g)).fmt;
    const prefix = `pq_board_${g.board(opts_of(g)).key.split('_')[0]}`;   // board keys start with a per-game word
    const bests = player_board_keys(prefix).map((key) => {
      const best = load(key, [])[0];
      if (!best) return '';
      const name = labels[key.slice('pq_board_'.length)] || key.slice(prefix.length).replace(/^_/, '').replaceAll('_', ' ') || 'best';
      // entries since build 22 carry their own formatted text (the ramp test and workouts differ in units)
      return `<li><span>${name.replace(/^[^·]*· /, '')}</span><b>${best.text || fmt(best.score)}</b><small>${best.date}</small></li>`;
    }).filter(Boolean).join('');
    return `<div class="st-game">
      <div class="st-game-head"><b>${g.icon} ${g.name}</b><span class="small">${t ? `${t.plays}× · ${hm(t.secs)}${t.km >= 0.05 ? ` · ${t.km.toFixed(1)} km` : ''}` : 'not played yet'}</span></div>
      ${bests ? `<ul class="st-bests">${bests}</ul>` : ''}
    </div>`;
  }).join('');

  const archived = games.filter((g) => !main.includes(g.id));
  return `
    <h1>📊 ${player}</h1>
    <p class="tag">All your riding in Pedal Quest. Games shorter than 1 min don't count.</p>
    <div class="panel"><div class="label">Totals</div>${top}</div>
    <div class="panel"><div class="label">Records</div>${records}</div>
    <div class="panel"><div class="label">Per game · best results</div>${game_rows}</div>
    ${archived.length ? `<div class="panel"><div class="label">Archived games (still playable)</div>
      <div class="chips">${archived.map((g) => `<a class="chip" href="#${g.id}">${g.icon} ${g.name}</a>`).join('')}</div></div>` : ''}`;
}
