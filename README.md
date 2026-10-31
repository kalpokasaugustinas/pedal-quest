# Pedal Quest

A browser game controlled by your indoor bike trainer and heart rate strap. Your watts move the character.

**Play:** https://kalpokasaugustinas.github.io/pedal-quest/

## Status
- Step 1: connection test page that shows live power, cadence, speed and heart rate.

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
