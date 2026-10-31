# Pedal Quest: games and architecture

## The games

| Game | Hook | Sensors | Score |
|---|---|---|---|
| 🏁 Race | 3D race against 5 bots, HR-window nitro | power, cadence, HR | best time per distance |
| 🔀 Crossroads | Pick 1 of 3 paths each stage: watts vs points, do the math | power | points (higher = better) |
| ⛰️ Summit | Climb time-trial, trainer resistance follows the gradient, ghost of your best run | power, resistance | time per climb |
| ❤️ Pulse Pilot | Your heart rate is your altitude, fly through bpm gates | HR (power = speed) | points |
| 🎵 Spin Beat | Rhythm game: keep cadence inside scrolling blocks, metronome | cadence | points |
| 🌩️ Escape | Endless chase: a storm with growing power hunts you | power | time survived |
| ⚡ Sprint Cup | Knockout tournament of 3 standing-start sprints vs fading rivals | power | points |

### 🏁 Race
- You race 5 bots: 80% to 120% of the "rival strength" watts.
- Bots: slow power wave, random surges, a final sprint, and nitro at 50% of a perfect player's rate.
- Nitro: a random 5 bpm HR window. 30 s inside fills the bar; outside it drains at half that speed. A full bar gives +80 W for 3 s.

### 🔀 Crossroads
- Each stage has 3 paths: easy (55–72% FTP), medium (75–92%) and hard (95–120%).
- Points follow effort, but each path's exchange rate is randomised ±35%, so you have to compare.
- Scoring: path points × share of the stage with your 3 s average ≥ 95% of the target × streak multiplier.
- A clean stage (≥ 90% on target) adds +0.1 to the multiplier, up to ×1.5. A missed stage resets it.
- Mystery path (25% of stages): watts hidden until you commit, pays 1.5×.
- Pick nothing in 15 s and you get the easiest path.

### ⛰️ Summit
- 4 climbs are defined as `[length, grade]` segments.
- Physics includes gravity, so you see your real speed on the slope.
- FTMS simulation mode (control point 0x2AD9, op 0x11) sends the grade to the trainer, scaled 0 / 50 / 100%. It sends at most 1 write per second, and only when the grade changes.
  - Resistance is set back to 0% when you finish or quit.
- Ghost: your best run's time at every 10 m is saved per climb in localStorage.

### ❤️ Pulse Pilot
- The zone is a share of max HR: easy 55–75%, mixed 60–85%, hard 70–92%.
- Gates are 320 m apart. Each target is 6–18 bpm away from the previous one.
- ±2 bpm = perfect (100 points), ±5 = good (50). Combos add +10% per hit in a row.
- HR lags effort by 10–30 s, so planning ahead is the skill.
- A dotted projection line shows where your current HR trend (smoothed bpm/s) puts you at the next gate, up to 30 s ahead: green = on target.

### 🎵 Spin Beat
- Tracks come from a fixed seed, so a track is identical every time and leaderboards stay fair.
- Perfect (±3 rpm) = 10 points/s, good (±7) = 5 points/s.
- Multiplier: +0.5 per 10 s streak, up to ×4. A miss longer than 1 s resets it.
- Metronome: a Web Audio click once per pedal stroke at the target cadence.

### 🌩️ Escape
- Storm power = FTP × (start level + 5% per minute). It uses the same physics as you.
- Starts 60 m behind you and never drops more than 150 m behind.
- Every km, a shelter pushes the storm back 25 m.

### ⚡ Sprint Cup
- Quarterfinal, semifinal and final, each 200 / 250 / 400 m from a standstill against one rival.
- Rival peak power = FTP × level (Club 1.4, Racer 1.7, Pro 2.0) × round strength (0.9 / 1.0 / 1.1).
- Rivals ramp to their peak in 2 s, then fade towards 75%.
- 10 s to get ready before round 1, 45 s of recovery between rounds. Lose a round and you're out.
- Score: 100 per round won + 20 per second of winning margin. Live power-duel bars show your watts vs the rival's.

## Architecture

```
index.html        shell markup: top nav, setup, play screen, results
style.css
js/main.js        shell: routing (#game-id), setup/options, countdown, loop, results, leaderboards
js/sensors.js     shared sensor state + connect + rider profile (FTP, max HR)
js/ble.js         Web Bluetooth: FTMS indoor bike data, heart rate, FTMS control point (grade)
js/physics.js     cycling physics (rolling, gravity, drag); same for everyone
js/util.js        formatting, seeded random, safe localStorage
js/draw2d.js      2D canvas helpers (sky, hills, rider sprite, labels)
js/world.js       Three.js world for Race
js/race_model.js  Race model: bots, nitro, standings
js/games/*.js     one module per game
tools/stamp_version.py   run before each commit: build number + cache-busting ?v=N
test.html         raw sensor test page
```

The games are tabs in one page, not separate HTML pages. A Web Bluetooth connection drops when the browser loads a new page, so separate pages would force a reconnect for every game.

### Game module interface

```js
export default {
  id, name, icon, tagline,
  uses: ['power', 'cadence', 'hr', 'resistance'],   // chips on the setup screen
  how: ['rule', ...],                                // "How to play" list
  options: [                                         // rendered by the shell, saved per game
    { key, label, choices: [[value, 'label html'], ...], def, wide? },
    { key, label, type: 'stepper', min, max, step, unit, def },
  ],
  setup_html(opts, profile) -> html,                 // optional extra info on setup
  board(opts) -> { key, label, lower, fmt },         // leaderboard id + sort + formatting
  create(env) -> instance,
};

// env: { canvas, hud, overlay, bottom, opts, profile, trainer, big_text(text, ms, cls), insets() }
// instance: {
//   update(dt, { watts, cadence, hr }),   // fixed sub-steps <= 0.1 s
//   render(dt, input), resize(), dispose(),
//   speed() -> m/s | null,                // shared km/h display
//   done, done_text, done_class,          // set done = true to end; the shell shows done_text
//   result() -> { title, sub, body, score, note },
// }
```

### Testing
- `?warp=20` runs game time 20× faster (sub-stepped physics), so a full game can be tested in seconds.
- Demo mode turns on automatically without a trainer: sliders for watts, cadence and HR.
  - On a PC: ↑/↓ change watts, [ / ] change cadence, - / + change HR.
- Headless checks: Playwright with the installed Chrome. Scripts aren't in the repo; see the project notes.

### Storage keys (localStorage)
- `pq_profile`: FTP, max HR, weight
- `pq_opts_<game>`: last options per game
- `pq_board_<key>`: top 10 results per board
- `pq_ghost_summit_<climb>`: best-run trace for the ghost
- `pq_stats`: lifetime totals
