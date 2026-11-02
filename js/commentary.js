// race commentator: short lines shown as a caption above the bottom hud and (optionally) spoken with the
// device's built-in text-to-speech voice. lines are rate-limited; a more important line can cut in.
// priority: 1 colour (stats, gaps), 2 action (overtakes, attacks, nitro), 3 must say (start, finish, last metres)

export function create_commentator(parent, { voice = true } = {}) {
  const el = document.createElement('div');
  el.className = 'commentary hidden';
  parent.appendChild(el);
  const synth = voice && 'speechSynthesis' in window ? window.speechSynthesis : null;
  let speaker = null;
  // an english voice, preferring a british one (sounds like a cycling commentator)
  const pick_voice = () => {
    const vs = synth?.getVoices() || [];
    speaker = vs.find((v) => /en-GB/i.test(v.lang) && /male|daniel|george|uk english male/i.test(v.name))
      || vs.find((v) => /en-GB/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
  };
  if (synth) { pick_voice(); synth.onvoiceschanged = pick_voice; }

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
        const u = new SpeechSynthesisUtterance(text.replace(/[^\p{L}\p{N}\s.,!?'%-]/gu, ''));
        if (speaker) u.voice = speaker;
        u.lang = speaker?.lang || 'en-GB';
        u.rate = prio >= 2 ? 1.12 : 1.02;
        u.pitch = 1;
        u.volume = 1;
        synth.speak(u);
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
