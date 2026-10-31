# Pedal Quest

A browser game controlled by your indoor bike trainer and heart rate strap. Your watts move the character.

**Play:** https://kalpokasaugustinas.github.io/pedal-quest/

## How it works
- Race 5 computer riders over 1, 2, 5 or 10 km. Each bot has its own average power.
- Set the rival strength on the setup screen.
- 3D third-person view (Three.js).
- Your trainer's watts drive your rider through a simple physics model of a cyclist on flat road. The bots use the same model.
- **Nitro:** keep your heart rate inside the target window (e.g. 122–127 bpm). 30 s in the window fills the bar. Outside the window it drains at half that speed. A full bar fires automatically: +80 W for 3 s, then a new window is picked. Bots get nitro too, at half the rate of a perfect player.
- No trainer? Demo mode gives you watts and HR sliders (arrow keys change watts on PC).
- Your best time per distance is saved in the browser.
- [Connection test page](https://kalpokasaugustinas.github.io/pedal-quest/test.html) shows the raw sensor data.

## Requirements
- A smart trainer with Bluetooth FTMS (e.g. Wahoo KICKR Core, Tacx, Elite, Saris)
- Optional: a Bluetooth heart rate strap
- Browser with Web Bluetooth: Chrome or Edge on Android, Windows, macOS or ChromeOS. On iPhone, use the Bluefy app.
- Close other trainer apps (Zwift, Wahoo) first. Trainers only allow one Bluetooth connection at a time.

## Run locally
Web Bluetooth only works on `https` or `localhost`:

```
python -m http.server 8000
```

Then open http://localhost:8000.
