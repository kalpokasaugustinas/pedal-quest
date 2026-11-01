# Pedal Quest

A browser game controlled by your indoor bike trainer and heart rate strap. Your watts move the character.

**Play:** https://kalpokasaugustinas.github.io/pedal-quest/

## Games
Pick a game from the tabs at the top. Bluetooth stays connected while you switch. All games use the same low-poly 3D world. Scenery defaults to 🎲 Surprise me: every ride rolls a theme, a season, the weather, sometimes a sunset ride, rivers with bridges, lakes and villages.

- 🏁 **Race**: 3D race against 5 bots with drafting. Bots race with tactics (attack when you fade, chase breakaways, sit in for the sprint) but stick to their average watts. Nitro charges while you keep your heart rate at or above a target set from your own race effort (no upper limit: riding harder never hurts).
- 🔀 **Crossroads**: the road forks into 3 real paths each stage. Each shows the watts to hold and the points it pays. Do the math.
- ⚡ **Sprint Cup**: one race where rivals and ghosts of your own past runs attack you from behind, one after another. Hold them off.
- 📈 **Workout**: structured interval sessions scaled to your FTP, with optional ERG mode and an FTP ramp test. The plan is painted on the road, and other riders out on the road give you someone to catch on hard intervals.

Archived for now (still playable from the 📊 Stats tab):
- ⛰️ **Summit**: climb time-trial. Trainer resistance follows the gradient, and you race a ghost of your best run.
- ❤️ **Pulse Pilot**: your heart rate is your altitude. Pedal a winged bike through gates set at target bpm.
- 🎵 **Spin Beat**: rhythm game for your legs. Match scrolling cadence blocks to a metronome.
- 🌩️ **Escape**: an endless chase. A storm with growing power hunts you down.

Every game has local top-10 leaderboards and a ride chart (power + heart rate) on the results screen. 24 badges to unlock, and a daily challenge with a streak. Download any ride as a .tcx file for Strava. Set your FTP, max HR and weight once, and the games scale to you.
Set your rider details and connect the trainer + HR strap once in the rider bar at the top; every game uses them. Optional Google sign-in syncs your data across devices. The 📊 Stats tab shows totals, the most played game, best results per game and all-time power / heart rate records.
Ride to earn PP (pedal points), level up and unlock your cyclist's look in the 🎨 Garage: jersey colours and patterns, frame, rims, helmet, shoes, nitro flame and trail. Sound: wind, rain, rivers, birds, a cheering finish crowd and music that follows your cadence.
No trainer? Demo mode gives you sliders for watts, cadence and heart rate.

Details, rules and the architecture for developers: [docs/GAMES.md](docs/GAMES.md).
[Connection test page](https://kalpokasaugustinas.github.io/pedal-quest/test.html) shows the raw sensor data.

## Requirements
- A smart trainer with Bluetooth FTMS (e.g. Wahoo KICKR Core, Tacx, Elite, Saris). Summit's resistance control needs FTMS control support.
- Optional: a Bluetooth heart rate strap
- Browser with Web Bluetooth: Chrome or Edge on Android, Windows, macOS or ChromeOS. On iPhone, use the Bluefy app.
- Close other trainer apps (Zwift, Wahoo) first. Trainers only allow one Bluetooth connection at a time.

## Run locally
Web Bluetooth only works on `https` or `localhost`:

```
python -m http.server 8000
```

Then open http://localhost:8000.
