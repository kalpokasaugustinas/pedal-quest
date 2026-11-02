// race commentator: short lines shown as a caption above the bottom hud and (optionally) spoken with the
// device's built-in text-to-speech voice. lines are rate-limited; a more important line can cut in.
// priority: 1 colour (stats, gaps), 2 action (overtakes, attacks, nitro), 3 must say (start, finish, last metres)

// english voices on this device (the phone's own text-to-speech), for the voice picker
export function english_voices() {
  return ('speechSynthesis' in window ? window.speechSynthesis.getVoices() : []).filter((v) => /^en/i.test(v.lang));
}
// a likely male voice by name (devices don't report gender; names like daniel / george / guy / ryan give it away)
const male_hint = /male|daniel|george|guy|ryan|thomas|oliver|arthur|james|david|mark|rishi|aaron|fred|gbd|gbb|rjs|iol/i;

// speak one line with a voice name ('' = best male-sounding english voice). excited lines are faster and brighter
export function speak(text, voice_name = '', excited = false) {
  if (!('speechSynthesis' in window)) return;
  const vs = english_voices();
  const v = vs.find((x) => x.name === voice_name)
    || vs.find((x) => /en-GB/i.test(x.lang) && male_hint.test(x.name)) || vs.find((x) => male_hint.test(x.name))
    || vs.find((x) => /en-GB/i.test(x.lang)) || vs[0];
  // a commentator, not a robot: a touch lower, quicker and livelier when something happens
  const u = new SpeechSynthesisUtterance(text.replace(/[^\p{L}\p{N}\s.,!?'%-]/gu, ''));
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-GB';
  u.rate = excited ? 1.14 : 1.03;
  u.pitch = excited ? 1.02 : 0.92;
  window.speechSynthesis.speak(u);
}

export function create_commentator(parent, { voice = true, voice_name = '' } = {}) {
  const el = document.createElement('div');
  el.className = 'commentary hidden';
  parent.appendChild(el);
  const synth = voice && 'speechSynthesis' in window ? window.speechSynthesis : null;

  let busy_until = 0, hide_t = 0, last_prio = 0;
  const said = new Map();   // key -> time last said (don't repeat the same kind of line too often)

  // say a line now if the commentator is free (or the line matters more). key + cooldown (s) stop repeats
  function say(text, prio = 1, key = null, cooldown = 0) {
    const now = performance.now() / 1000;
    if (key && said.has(key) && now - said.get(key) < cooldown) return false;
    if (now < busy_until && prio <= last_prio) return false;
    if (key) said.set(key, now);
    last_prio = prio;
    const secs = 1.6 + text.length * 0.055;   // about how long it takes to say
    busy_until = now + secs + (prio >= 3 ? 0.3 : 1.2);
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(hide_t);
    hide_t = setTimeout(() => el.classList.add('hidden'), (secs + 1.2) * 1000);
    if (synth) {
      try {
        if (prio >= 2) synth.cancel();   // action interrupts colour
        speak(text, voice_name, prio >= 2);
      } catch { /* no speech on this device */ }
    }
    return true;
  }
  return {
    say,
    free: () => performance.now() / 1000 >= busy_until,
    stop() { clearTimeout(hide_t); el.remove(); try { synth?.cancel(); } catch { /* ignore */ } },
  };
}

// ordinal for speech: 1 -> first ... 6 -> sixth
export const place_word = (n) => ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'][n - 1] || `${n}th`;
// pick one of a few phrasings
export const one = (...xs) => xs[Math.floor(Math.random() * xs.length)];
