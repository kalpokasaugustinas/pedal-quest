// badges: long-term goals across all games. checked after every finished game, saved in localStorage
import { load, store } from './util.js?v=22';

// each check gets: { game, opts, flags, ride (ride_log summary), life (lifetime totals), state, ftp }
const list = [
  { id: 'first', icon: '🚲', name: 'First Pedal', desc: 'Finish any game', check: () => true },
  { id: 'explorer', icon: '🧭', name: 'Explorer', desc: 'Finish every game at least once', check: (c) => c.main.every((id) => c.state.played.includes(id)) },
  { id: 'race_win', icon: '🏆', name: 'Top Step', desc: 'Win a race', check: (c) => c.game === 'race' && c.flags.win },
  { id: 'giant', icon: '💥', name: 'Giant Killer', desc: 'Win a race with rival strength at or above your FTP', check: (c) => c.game === 'race' && c.flags.win && c.opts.base_watts >= c.ftp },
  { id: 'nitro', icon: '🚀', name: 'Nitro Junkie', desc: 'Fire nitro 3 times in one race', check: (c) => c.game === 'race' && c.flags.nitro >= 3 },
  { id: 'clean', icon: '✅', name: 'Clean Sheet', desc: 'Crossroads: every stage clean', check: (c) => c.game === 'crossroads' && c.flags.clean_all },
  { id: 'calc', icon: '🧠', name: 'Calculator', desc: 'Crossroads: best-value path on every stage', check: (c) => c.game === 'crossroads' && c.flags.smart_all },
  { id: 'summit', icon: '⛰️', name: 'Summiteer', desc: 'Finish a climb', check: (c) => c.game === 'summit' },
  { id: 'peaks', icon: '🏔️', name: 'All Peaks', desc: 'Finish all 4 climbs', check: (c) => c.state.climbs.length >= 4 },
  { id: 'pulse5', icon: '❤️', name: 'Heart Whisperer', desc: 'Pulse Pilot: 5 perfect gates in one flight', check: (c) => c.game === 'pulse' && c.flags.perfect >= 5 },
  { id: 'pulse0', icon: '🎯', name: 'No Misses', desc: 'Pulse Pilot: fly a whole course without a miss', check: (c) => c.game === 'pulse' && c.flags.miss === 0 },
  { id: 'spin4', icon: '🎵', name: 'Max Multiplier', desc: 'Spin Beat: reach ×4', check: (c) => c.game === 'spinbeat' && c.flags.mult >= 4 },
  { id: 'spin90', icon: '🎼', name: 'Metronome Legs', desc: 'Spin Beat: 90% in the zone', check: (c) => c.game === 'spinbeat' && c.flags.acc >= 90 },
  { id: 'storm10', icon: '🌩️', name: 'Storm Chaser', desc: 'Escape: survive 10 minutes', check: (c) => c.game === 'escape' && c.flags.secs >= 600 },
  { id: 'storm20', icon: '⛈️', name: 'Eye of the Storm', desc: 'Escape: survive 20 minutes', check: (c) => c.game === 'escape' && c.flags.secs >= 1200 },
  { id: 'sprint', icon: '⚡', name: 'Untouchable', desc: 'Sprint Cup: hold off every attack (5+ attacks)', check: (c) => c.game === 'sprint' && c.flags.all && c.opts.attacks >= 5 },
  { id: 'workout', icon: '📈', name: 'Disciplined', desc: 'Workout: 80% on target without ERG', check: (c) => c.game === 'workout' && c.flags.pct >= 80 && !c.flags.erg },
  { id: 'ramp', icon: '✨', name: 'Know Your Numbers', desc: 'Complete an FTP ramp test', check: (c) => c.game === 'workout' && c.flags.ramp },
  { id: 'threshold', icon: '💪', name: 'Threshold', desc: 'Normalized power at or above FTP for 10+ min', check: (c) => c.ride.secs >= 600 && c.ride.np >= c.ftp },
  { id: 'streak3', icon: '📅', name: 'Habit', desc: 'Daily challenge 3 days in a row', check: () => load('pq_daily', {}).best >= 3 },
  { id: 'streak7', icon: '🗓️', name: 'Full Week', desc: 'Daily challenge 7 days in a row', check: () => load('pq_daily', {}).best >= 7 },
  { id: 'hour', icon: '🕐', name: 'Hour of Power', desc: '1 hour of riding in total', check: (c) => c.life.secs >= 3600 },
  { id: 'century', icon: '🛣️', name: 'Century', desc: '100 km in total', check: (c) => c.life.km >= 100 },
  { id: 'mega', icon: '🔋', name: 'Megajoule', desc: '1000 kJ of work in total', check: (c) => c.life.kj >= 1000 },
];

// badges of the archived games (summit, pulse, spin beat, escape)
const archived_badges = ['summit', 'peaks', 'pulse5', 'pulse0', 'spin4', 'spin90', 'storm10', 'storm20'];

function get_state() {
  const s = load('pq_badges', {});
  return { unlocked: s.unlocked || {}, played: s.played || [], climbs: s.climbs || [] };
}

// call after a finished game; returns the badges unlocked by this game
export function check_badges({ game, opts, flags, ride, ftp, main }) {
  const state = get_state();
  if (!state.played.includes(game)) state.played.push(game);
  if (game === 'summit' && flags?.climb && !state.climbs.includes(flags.climb)) state.climbs.push(flags.climb);
  const life = load('pq_stats', { rides: 0, secs: 0, kj: 0, km: 0 });
  const ctx = { game, opts, flags: flags || {}, ride, life, state, ftp, main };
  const fresh = [];
  for (const b of list) {
    if (state.unlocked[b.id]) continue;
    let ok = false;
    try { ok = !!b.check(ctx); } catch { ok = false; }   // a missing flag never breaks the results screen
    if (ok) {
      state.unlocked[b.id] = new Date().toISOString().slice(0, 10);
      fresh.push(b);
    }
  }
  store('pq_badges', state);
  return fresh;
}

// results: newly unlocked badges
export function fresh_html(fresh) {
  if (!fresh.length) return '';
  return `<div class="panel badges-new"><div class="label">New badge${fresh.length > 1 ? 's' : ''} unlocked!</div>
    ${fresh.map((b) => `<div class="badge-row"><span class="badge-icon">${b.icon}</span><div><b>${b.name}</b><small>${b.desc}</small></div></div>`).join('')}</div>`;
}

// setup: the full collection, locked ones greyed out
export function collection_html() {
  const st = get_state();
  const shown = list.filter((b) => !archived_badges.includes(b.id) || st.unlocked[b.id]);
  const got = shown.filter((b) => st.unlocked[b.id]).length;
  return `<summary>Badges · ${got}/${shown.length}</summary>
    <div class="badge-grid">${shown.map((b) => {
      const on = st.unlocked[b.id];
      return `<div class="badge${on ? ' on' : ''}"><span class="badge-icon">${b.icon}</span><b>${b.name}</b><small>${on ? `✓ ${on}` : b.desc}</small></div>`;
    }).join('')}</div>`;
}
