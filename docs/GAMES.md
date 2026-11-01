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
| ⚡ Sprint Cup | One race: rivals attack from behind one by one, hold them off | power | points |
| 📈 Workout | Structured intervals scaled to FTP, optional ERG, FTP ramp test | power, resistance | % on target / FTP estimate |

Main games: Race, Crossroads, Sprint Cup, Workout (in the top tabs and the daily challenge). Summit, Pulse Pilot, Spin Beat and Escape are archived: hidden from the tabs, still playable from the Stats tab or a `#game-id` link. Their badges only show once earned.

Rider bar (top of setup and stats, folded once the trainer connects): player name (rename only), sync button, trainer + HR strap connect, FTP / max HR / weight / sounds. Set once, every game reads them. Weight is the physics mass (rider + 9 kg bike): it sets acceleration, speed, distance and climbing; bots use the same mass, so it doesn't change who wins.

Player storage (`js/util.js`): every `pq_*` key belongs to the active player; the first player ("me") keeps the plain keys, others would use `<key>@<player id>`. The UI has one player; the multi-player storage is kept for later.

Cloud sync (`js/cloud.js`, optional): Google sign-in through Firebase, same project and method as Muscle Map. All players' keys go as one JSON string into the `pedal_quest` field of `users/<uid>` in Firestore (merge write: Muscle Map keeps its own field). Changes upload 1.5 s after the last write; a change from another device applies live, but never during a game (it waits until the game ends). First sign-in on a device with rides asks which copy wins.

Stats tab (`js/stats.js`, `#stats`): lifetime totals, most played game, daily streak, days ridden, records (max power, best 5 s / 1 / 5 / 20 min, best NP, max HR, longest ride / distance / work, each with the day), and per game: plays, time, distance and the best result of every board.

Ride history and badges: collapsed sections at the bottom of the Stats tab. The history lists recent rides and this week's totals (Monday to Sunday).

Ride export: results have a **Download ride (.tcx)** button (rides over 1 min). The TCX has 1-s trackpoints with power, HR, cadence and distance, so Strava / Garmin Connect / intervals.icu can import it. Games without a speed (Spin Beat, Workout, Pulse) get a virtual distance from the flat-road physics.

Daily challenge (`js/daily.js`): one game + settings + goal per local calendar day, seeded by the date (same for everyone). Completing it on consecutive days builds a streak. The card is on the setup screen.

Badges (`js/achievements.js`): 24 long-term goals across all games, checked after every finished game. Games pass `flags` in `result()` (e.g. `{ win: true }`) for game-specific badges. New badges show on the results screen; the collection is on the setup screen.

Every game's results screen also shows **Your ride**: a power + heart rate chart and stats (avg / normalized / max power, best 1 min, intensity factor, kJ, HR, cadence). Recorded by the shell (`js/ride_log.js`), so games don't need to do anything.

### 🏁 Race
- You race 5 bots: 80% to 120% of the "rival strength" watts.
- Bots: slow power wave, random surges, a final sprint, and nitro at 50% of a perfect player's rate.
- Nitro: a random 8 bpm HR window inside the race zone (78–92% of max HR, so hard riding gets you there; spiking overshoots). 30 s inside fills the bar; outside it drains at half that speed. A full bar gives +80 W for 3 s.
- Look: low-poly, flat-shaded 3D with a strong side key light, low ambient and ACES tone mapping (deep colours, contrasty facets). Faceted terrain chunks recycled around the camera, instanced layered pines / round trees / rocks / grass tufts / roadside posts, big two-peak mountains with snow caps, lit clouds, campfires with tents (2 pooled warm point lights + additive ground glow), soft shadows, fog. Scenery option: Sunny meadow, Misty valley, Starry night.
- Mood: calm, soft colours (every palette colour desaturated a bit), softer PCF shadows, a CSS grade on the canvas (saturate / contrast) plus a warm soft-light tint and a vignette layer.
- Riders: low-poly cyclist (tapered torso with stripe, aero helmet with visor, shoes) on a road bike with deep rims in the rider colour. Body language from effort (`animate_rider` in `js/world.js`; reference = FTP for you, average watts for bots): coasting = sits up and rests; steady = small shoulder rock; hard / surging / nitro = out of the saddle, bike rocks side to side with each pedal stroke, head down, heavy breathing. Arms and legs follow via simple IK.
- Visual speed: the scenery moves 2.5× faster than the physics (`vis_scale` in `js/world.js`); speed, watts and times are unchanged. Riders keep their real gaps to the player so the pack looks natural. Wind streaks scale with speed; riders between the camera and you fade out.
- Drafting: a rider up to 5 m ahead cuts your air drag, linearly up to 30% at 1 m. Everyone drafts (not in the first 3 s). In 3D the drafting rider slides in behind the wheel.

### 3D look (all games)
Effects: ~1.2 km of terrain ahead, shadows over ~140 m around the action (no pop-in), fast wind streaks that swirl in small spirals, and tyre dust (gravel / dirt) or smoke (asphalt) when a rider pushes 2× FTP, a big cloud at 3× FTP (bots: 2× / 3× their average).

Roads wind (`curve_x` in the kit: long sweeping bends, s-curves and the odd tight turn, varying along the route); Spin Beat stays straight so its lanes stay readable. Escape's camera sits ~10 m ahead of you looking back, locked (no lag), so you never ride out of the picture.

Every game is drawn with `js/kit3d.js`, one low-poly world: `create_kit(canvas, { theme, road_w, lanes, road_x(z), road_y(z), surface(z), camps, posts, paint_road })`. Games place riders (`place_rider`), steer the camera (`chase`) and call `frame()` each render. Every game has a **Scenery** option (meadow / valley / night).
- Crossroads: a single bike track (2.6 m) that forks in a clearing into 3 signposted trails; your pick bends the road into that trail (and its surface: asphalt, gravel, dirt).
- Summit: the road really climbs (distance ×1.6, height ×2.2 on screen); grade boards, KOM arch, translucent ghost; profile chart as an overlay.
- Pulse Pilot: you pedal a winged bicycle (wings flap once per pedal stroke) over the valley through gate frames at bpm heights; big bpm boards above each gate; dashed flight trail + projection line.
- Spin Beat: a wide road with rpm lanes painted on it; glowing note tiles; the rider steers across with your cadence.
- Escape: the camera rides ahead looking back; a dark storm wall with rain and lightning; the world darkens as it closes in; shelter huts.
- Sprint Cup: one winding road; the camera pulls back during attacks and a rear-view mirror inset shows the attacker coming; duel bars as an overlay.
- Workout: you ride through the scenery (speed from the physics); the interval chart is a translucent panel on top.

### 🔀 Crossroads
- Each stage has 3 paths: easy (55–72% FTP), medium (75–92%) and hard (95–120%).
- Points follow effort, but each path's exchange rate is randomised ±35%, so you have to compare.
- Scoring: path points × share of the stage with your 3 s average ≥ 95% of the target × streak multiplier.
- A clean stage (≥ 90% on target) adds +0.1 to the multiplier, up to ×1.5. A missed stage resets it.
- Mystery path (25% of stages): watts hidden until you commit, pays 1.5×.
- Pick nothing in 15 s (or reach the fork without choosing) and you get the easiest path.

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
- One continuous race. After 15 s, rivals attack one by one (3 / 5 / 8 attacks), with 25–40 s of random calm between attacks and a warning 3 s before.
- An attacker starts 20 m behind you, 3 m/s faster (steady riding always gets passed: you have to answer; ~1.5–1.75× FTP for 22 s holds a Club attack, ~2× for Racer / Pro), and surges to peak in 3 s, then fades towards 75%. Peak = FTP × level (Club 1.4, Racer 1.7, Pro 2.0) × rider strength (0.9 → 1.15, +8% each time the roster comes round).
- Still ahead after 22 s = held off: 100 points + 10 per meter of lead. Passed by 5 m = lost (0 points). The race goes on either way.
- Earlier attackers settle at 75% FTP and drift away. Rear-view mirror + duel bars during attacks.
- Attackers option: Rivals + past me (default: ghost on every 2nd attack), Past me (ghost on every attack), Rivals only. Each mix has its own board.
- Ghost = your strongest finished run with the same number of attacks (highest average watts over the attack windows). Your watts are recorded at 1 Hz for 22 s from the start of each attack; ghost attack k replays attack k. It starts 20 m behind at only +2 m/s, so the same effort as last time ends about level (physics sim: +1 m/s ≈ 10 m over 22 s). Stored in `pq_sprint_ghost_<attacks>` (best + last).

### 📈 Workout
- Plans: Quick Spin (15 min), Sweet Spot (30), VO2 30/30 (22), Pyramid (23), Over-Unders (31). Power = share of FTP × intensity (90 / 100 / 105%).
- On target = 3 s average within ±5%; close = ±10% (counts half). Score = % of the session on target.
- ERG mode: FTMS op 0x05 (set target power), sent on change, at most every 2 s, in 5 W steps. Quitting/finishing sends grade 0 to leave ERG.
- FTP Ramp Test: 100 W, +20 W per minute. Ends after 5 s below 85% of the step (or under 50 rpm in ERG), not before 2 min. FTP = 75% of best 1-min power, rounded to 5 W. A results button saves it to the profile.

## Architecture

```
index.html        shell markup: top nav, setup, play screen, results
style.css
js/main.js        shell: routing (#game-id), setup/options, countdown, loop, results, leaderboards
js/sensors.js     shared sensor state + connect + rider profile (FTP, max HR)
js/ble.js         Web Bluetooth: FTMS indoor bike data, heart rate, FTMS control point (grade, erg power)
js/physics.js     cycling physics (rolling, gravity, drag); same for everyone
js/util.js        formatting, seeded random, safe localStorage (per player), sync data helpers
js/cloud.js       optional google sign-in + firestore sync of all players
js/stats.js       stats tab
js/draw2d.js      2D canvas helpers (overlay layer for charts / bars, labels)
js/kit3d.js       shared low-poly 3d kit: terrain/road chunks (road can curve + climb), props, mountains,
                  lights + colour grade, campfires, wind, riders with body language, chase camera, arches, signs, trails
js/world.js       Race world on the kit (course + pack)
js/race_model.js  Race model: bots, nitro, drafting, standings
js/ride_log.js    per-second ride samples -> results chart + stats (all games)
js/games/*.js     one module per game
tools/stamp_version.py   build number + cache-busting ?v=N (run by the git hook)
tools/pre-commit         git hook: cp tools/pre-commit .git/hooks/pre-commit
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
//   result() -> { title, sub, body, score, note, flags?, actions? },   // flags feed the badges
//     actions: [{ label, done_label, run(profile) }] -> buttons on results that change the profile
// }
```

### Testing
- `?warp=20` runs game time 20× faster (sub-stepped physics), so a full game can be tested in seconds.
- Demo mode turns on automatically without a trainer: sliders for watts, cadence and HR.
  - On a PC: ↑/↓ change watts, [ / ] change cadence, - / + change HR.
- Headless checks: Playwright with the installed Chrome. Scripts aren't in the repo; see the project notes.

### Storage keys (localStorage)
- Per player (plain key for the first player, `<key>@<id>` for others). Device-only: `pq_active_player`. Shared: `pq_players`.
- `pq_profile`: FTP, max HR, weight
- `pq_opts_<game>`: last options per game
- `pq_board_<key>`: top 10 results per board
- `pq_ghost_summit_<climb>`: best-run trace for the ghost
- `pq_stats`: lifetime totals
- `pq_history`: last 200 finished rides (summary: date, game, duration, avg W, NP, kJ, avg HR, km, max W, max HR)
- `pq_game_stats`: per game plays, time, km, kJ, last played (backfilled once from the history)
- `pq_records`: all-time records with value, day and game
- `pq_board_labels`: board key → readable name for the stats tab
- `pq_sprint_ghost_<attacks>`: Sprint Cup ghost (best + last run's attack efforts)
- `pq_daily`: daily challenge streak (last day done, streak, best, total)
- `pq_badges`: unlocked badges with dates, games played, climbs finished
