// generated songs for rides: one beat per pedal stroke (tempo = your cadence), real song structure
// (intro, groove, full, breakdown sections every 8 bars) and layers that join as your effort rises.
// everything is synthesised (no sample files): drums, bass, pads, e-piano, leads, through a mix bus with
// reverb, echo, sidechain pumping and a compressor, so it sounds like a produced track.

// ---- the tracks ----
// patterns are one bar of 16 steps. drums: X accent, x hit, o ghost. bass: r root, o octave, f fifth, - hold, . rest.
// lead / arp: digits = chord tone (0 root, 1 third, 2 fifth, 3 = root an octave up ...), - hold, . rest.
// chords: x hit, - hold, . rest. chords are midi notes; the first note is the bass root (two octaves down)
export const tracks = {
  golden_hour: {
    name: 'Golden Hour', style: 'melodic house',
    chords: [[57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62, 67]], bars_per_chord: 2,
    kick: 'X...x...x...x...', clap: '....x.......x...', hat: 'o.o.o.o.o.o.o.o.', ohat: '..x...x...x...x.',
    bass: { kind: 'pluck_bass', pat: '..r...r...r...o.' },
    chords_play: { kind: 'stab', pat: '..x..x....x..x..' }, pad: 'pad',
    arp: { kind: 'pluck', pat: '0.2.1.2.3.2.1.2.' }, lead: { kind: 'bell', pat: ['4---3---2---1---', '2---3-4-5---4---'] },
    sidechain: true, swing: 0,
  },
  neon_drive: {
    name: 'Neon Drive', style: 'synthwave',
    chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], bars_per_chord: 1,
    kick: 'X.......x.......', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.',
    bass: { kind: 'saw_bass', pat: 'r.r.r.r.r.r.o.r.' },
    pad: 'pad', arp: { kind: 'pluck', pat: '0123012301230123' },
    lead: { kind: 'synth', pat: ['4-------3---2---', '1-------2---0---'] },
    big_snare: true, swing: 0,
  },
  breakaway: {
    name: 'Breakaway', style: 'breakbeat',
    chords: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], bars_per_chord: 2,
    kick: 'X.....x...x.....', snare: '....X..o....X..o', hat: 'xoxoxoxoxoxoxoxo',
    bass: { kind: 'reese', pat: 'r---------------' },
    chords_play: { kind: 'stab', pat: '......x.......x.' }, pad: 'pad',
    arp: { kind: 'pluck', pat: '0..2..1..3..2...' }, lead: { kind: 'bell', pat: ['3-----2-----1---', '0-------2---1---'] },
    swing: 0,
  },
  lofi_spin: {
    name: 'Lo-fi Spin', style: 'lo-fi hip hop',
    chords: [[50, 53, 57, 60, 64], [43, 53, 59, 62, 65], [48, 52, 55, 59, 62], [45, 52, 55, 61, 64]], bars_per_chord: 1,
    kick: 'X.....x...x.....', snare: '....x.......x...', shaker: 'x.x.x.x.x.x.x.x.',
    bass: { kind: 'sub', pat: 'r---------r.f...' },
    chords_play: { kind: 'keys', pat: 'x-----x---------' }, pad: null,
    lead: { kind: 'keys_lead', pat: ['..4.3...2.......', '....3.4.5...4...'] },
    swing: 0.2, crackle: true, soft: true,
  },
  summit_anthem: {
    name: 'Summit Anthem', style: 'rock',
    chords: [[52, 59, 64], [48, 55, 60], [55, 62, 67], [50, 57, 62]], bars_per_chord: 2,
    kick: 'X.....x.x.......', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.',
    bass: { kind: 'rock_bass', pat: 'r.r.r.r.r.r.r.r.' },
    chords_play: { kind: 'power', pat: 'x.x.x.x.x.x.x.x.' }, pad: null,
    lead: { kind: 'synth', pat: ['3---4---5---4---', '3-------2---0---'] },
    crash: true, swing: 0,
  },
  pixel_sprint: {
    name: 'Pixel Sprint', style: 'chiptune',
    chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], bars_per_chord: 1,
    kick: 'X...x...X...x...', snare: '....x.......x..o', hat: '..x...x...x...x.',
    bass: { kind: 'chip_bass', pat: 'r.o.r.o.r.o.r.o.' },
    pad: null, arp: { kind: 'chip', pat: '0120012001200120' },
    lead: { kind: 'chip', pat: ['3-4-5---4-3-2---', '1-2-3---2-1-0---'] },
    chip_drums: true, swing: 0,
  },
};
export const track_ids = Object.keys(tracks);

// 8-bar sections in order (endless loop); which layers play in each
const arrangement = ['intro', 'groove', 'full', 'full', 'break', 'groove', 'full', 'full'];
const layers = {
  intro: ['pad', 'hat', 'shaker', 'kick_soft'],
  groove: ['pad', 'kick', 'snare', 'clap', 'hat', 'ohat', 'shaker', 'bass', 'chords'],
  full: ['pad', 'kick', 'snare', 'clap', 'hat', 'ohat', 'shaker', 'bass', 'chords', 'arp', 'lead'],
  break: ['pad', 'ohat', 'shaker', 'lead', 'chords_soft'],
};

const hz = (m) => 440 * 2 ** ((m - 69) / 12);

// play one track. ctx = AudioContext, out = destination node, start_bar = where the song starts (previews).
// returns { update(dt, cadence, effort), stop() }
export function create_music(ctx, out, id, start_bar = 0) {
  const T = tracks[id] || tracks.golden_hour;
  // ---- mix bus: instruments -> (duck) -> master -> compressor -> out, with reverb and echo sends ----
  const master = ctx.createGain();
  master.gain.value = 0;
  master.gain.setTargetAtTime(T.soft ? 0.36 : 0.42, ctx.currentTime, 1.2);   // fade in
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.18; comp.knee.value = 8;
  master.connect(comp).connect(out);
  const duck = ctx.createGain();   // pumps on every kick (sidechain feel)
  duck.connect(master);
  const tone_lp = ctx.createBiquadFilter();   // lo-fi: dull the top end
  tone_lp.type = 'lowpass';
  tone_lp.frequency.value = T.soft ? 4200 : 18000;
  tone_lp.connect(master);
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, T.big_snare ? 3 : 2.2);
  const rev_ret = ctx.createGain();
  rev_ret.gain.value = 0.32;
  reverb.connect(rev_ret).connect(master);
  const echo = ctx.createDelay(2);
  const echo_fb = ctx.createGain(), echo_lp = ctx.createBiquadFilter(), echo_ret = ctx.createGain();
  echo_fb.gain.value = 0.34; echo_lp.type = 'lowpass'; echo_lp.frequency.value = 2600; echo_ret.gain.value = 0.28;
  echo.connect(echo_lp).connect(echo_fb).connect(echo);
  echo_lp.connect(echo_ret).connect(master);
  const noise = noise_buffer(ctx);
  const bus = (node, rev = 0, del = 0, to = tone_lp) => {
    node.connect(to);
    if (rev) { const g = ctx.createGain(); g.gain.value = rev; node.connect(g).connect(reverb); }
    if (del) { const g = ctx.createGain(); g.gain.value = del; node.connect(g).connect(echo); }
    return node;
  };
  // vinyl crackle (lo-fi)
  let crackle = null;
  if (T.crackle) {
    crackle = ctx.createBufferSource();
    crackle.buffer = crackle_buffer(ctx);
    crackle.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0.06;
    crackle.connect(g).connect(master);
    crackle.start();
  }

  // ---- instruments: each schedules its notes at time t ----
  const env = (g, t, v, a, d, s = 0.0001) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(Math.max(s, 0.0001), t + a + d); };
  const osc = (type, f, t, len) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t + len + 0.1); return o; };
  const noise_src = (t, len) => { const n = ctx.createBufferSource(); n.buffer = noise; n.start(t, Math.random() * 0.5); n.stop(t + len + 0.05); return n; };
  const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const gain = () => ctx.createGain();

  const drum = {
    kick(t, v) {
      const o = osc('sine', T.chip_drums ? 220 : 165, t, 0.4), g = gain();
      o.frequency.exponentialRampToValueAtTime(T.chip_drums ? 60 : 46, t + 0.11);
      env(g, t, 0.95 * v, 0.003, 0.36);
      o.connect(g); bus(g, 0, 0, master);
      const c = noise_src(t, 0.01), cg = gain(), hp = filt('highpass', 3000);
      env(cg, t, 0.25 * v, 0.001, 0.012);
      c.connect(hp).connect(cg); bus(cg, 0, 0, master);
      if (T.sidechain) { duck.gain.cancelScheduledValues(t); duck.gain.setValueAtTime(0.35, t); duck.gain.linearRampToValueAtTime(1, t + 0.42 * beat_len); }
    },
    snare(t, v) {
      const n = noise_src(t, 0.3), bp = filt('bandpass', T.chip_drums ? 3500 : 1900, 0.7), g = gain();
      env(g, t, 0.55 * v, 0.002, T.big_snare ? 0.28 : 0.18);
      n.connect(bp).connect(g); bus(g, T.big_snare ? 0.9 : 0.25);
      if (!T.chip_drums) {
        const o = osc('triangle', 200, t, 0.15), og = gain();
        o.frequency.exponentialRampToValueAtTime(165, t + 0.08);
        env(og, t, 0.35 * v, 0.002, 0.09);
        o.connect(og); bus(og, 0.2);
      }
    },
    clap(t, v) {
      const n = noise_src(t, 0.3), bp = filt('bandpass', 1300, 1.1), g = gain();
      g.gain.setValueAtTime(0.0001, t);
      for (const d of [0, 0.011, 0.022]) { g.gain.setValueAtTime(0.5 * v, t + d); g.gain.exponentialRampToValueAtTime(0.05, t + d + 0.009); }
      g.gain.setValueAtTime(0.4 * v, t + 0.032); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      n.connect(bp).connect(g); bus(g, 0.35);
    },
    hat(t, v, open = false) {
      const n = noise_src(t, 0.4), hp = filt('highpass', 7600), g = gain();
      env(g, t, (open ? 0.16 : 0.13) * v, 0.001, open ? 0.26 : 0.045);
      n.connect(hp).connect(g); bus(g, 0.08);
    },
    shaker(t, v) {
      const n = noise_src(t, 0.1), bp = filt('bandpass', 5200, 1.5), g = gain();
      env(g, t, 0.09 * v, 0.012, 0.06);
      n.connect(bp).connect(g); bus(g, 0.1);
    },
    crash(t) {
      const n = noise_src(t, 1.8), hp = filt('highpass', 5000), g = gain();
      env(g, t, 0.16, 0.002, 1.6);
      n.connect(hp).connect(g); bus(g, 0.4);
    },
  };

  // bass: note length in seconds
  function bass(t, m, len, kind) {
    const f = hz(m), g = gain();
    const end = t + len;
    const shape = (v) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.006); g.gain.setTargetAtTime(v * 0.7, t + 0.05, 0.1); g.gain.setTargetAtTime(0.0001, end - 0.02, 0.025); };
    if (kind === 'sub') {
      const o = osc('sine', f, t, len); shape(0.5); o.connect(g);
    } else if (kind === 'reese') {
      const lp = filt('lowpass', 520, 1.5);
      for (const c of [-12, 12]) { const o = osc('sawtooth', f, t, len); o.detune.value = c; o.connect(lp); }
      const s = osc('sine', f, t, len); s.connect(lp);
      lp.frequency.setValueAtTime(380, t); lp.frequency.linearRampToValueAtTime(900, t + len * 0.5); lp.frequency.linearRampToValueAtTime(420, end);
      shape(0.26); lp.connect(g);
    } else if (kind === 'chip_bass') {
      const o = osc('triangle', f, t, len); shape(0.45); o.connect(g);
    } else if (kind === 'rock_bass') {
      const lp = filt('lowpass', 1100), o = osc('sawtooth', f, t, len), ws = ctx.createWaveShaper();
      ws.curve = drive_curve(6); o.connect(ws).connect(lp); shape(0.22); lp.connect(g);
    } else {
      // saw / pluck bass: filter opens on the attack and closes
      const lp = filt('lowpass', 900, kind === 'pluck_bass' ? 4 : 2), o = osc('sawtooth', f, t, len), s = osc('sine', f / 2, t, len), sg = gain();
      sg.gain.value = 0.6;
      lp.frequency.setValueAtTime(kind === 'pluck_bass' ? 1600 : 1100, t); lp.frequency.exponentialRampToValueAtTime(180, t + Math.min(len, 0.25));
      o.connect(lp); s.connect(sg).connect(g);
      shape(0.3); lp.connect(g);
    }
    bus(g, 0, 0, T.sidechain ? duck : tone_lp);
  }

  // chord instruments: notes = midi list, len in seconds, v = loudness
  function chord(t, notes, len, kind, v = 1) {
    for (const m of notes) {
      const f = hz(m), g = gain();
      if (kind === 'pad') {
        const lp = filt('lowpass', 1500, 0.5);
        for (const c of [-9, 9]) { const o = osc('sawtooth', f, t, len + 0.6); o.detune.value = c; o.connect(lp); }
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 * v, t + Math.min(0.6, len * 0.3));
        g.gain.setTargetAtTime(0.0001, t + len, 0.25);
        lp.connect(g); bus(g, 0.55, 0, T.sidechain ? duck : tone_lp);
      } else if (kind === 'keys') {
        // e-piano: fm (modulator at the same frequency, bright attack mellowing out) + a soft tremolo
        const car = osc('sine', f, t, len + 0.8), mod = osc('sine', f, t, len + 0.8), mg = gain();
        mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.25, t + 0.6);
        mod.connect(mg).connect(car.frequency);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11 * v, t + 0.006); g.gain.setTargetAtTime(0.03 * v, t + 0.05, 0.5);
        g.gain.setTargetAtTime(0.0001, t + len, 0.2);
        car.connect(g); bus(g, 0.4, 0.15);
      } else if (kind === 'stab') {
        const lp = filt('lowpass', 2400, 1.2);
        for (const ty of ['sawtooth', 'square']) osc(ty, f, t, 0.3).connect(lp);
        lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.22);
        env(g, t, 0.06 * v, 0.004, 0.24);
        lp.connect(g); bus(g, 0.45, 0.2, T.sidechain ? duck : tone_lp);
      } else if (kind === 'power') {
        // distorted guitar-ish chug: saws through a waveshaper, palm-muted short notes
        const ws = ctx.createWaveShaper(), lp = filt('lowpass', 2600);
        ws.curve = drive_curve(18);
        for (const c of [-6, 6]) { const o = osc('sawtooth', f, t, len); o.detune.value = c; o.connect(ws); }
        ws.connect(lp);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045 * v, t + 0.005); g.gain.setTargetAtTime(0.0001, t + len * 0.85, 0.03);
        lp.connect(g); bus(g, 0.15);
      }
    }
  }

  // melodic voices: lead / arp notes
  function voice(t, m, len, kind, v = 1) {
    const f = hz(m), g = gain();
    if (kind === 'pluck') {
      const lp = filt('lowpass', 3500, 3), o = osc('sawtooth', f, t, len + 0.3);
      lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(600, t + 0.2);
      env(g, t, 0.07 * v, 0.003, Math.max(0.15, len));
      o.connect(lp).connect(g); bus(g, 0.35, 0.35);
    } else if (kind === 'bell') {
      const car = osc('sine', f, t, len + 1.2), mod = osc('sine', f * 3.5, t, len + 1.2), mg = gain();
      mg.gain.setValueAtTime(f * 1.6, t); mg.gain.exponentialRampToValueAtTime(f * 0.1, t + 0.9);
      mod.connect(mg).connect(car.frequency);
      env(g, t, 0.09 * v, 0.004, len + 0.9);
      car.connect(g); bus(g, 0.5, 0.35);
    } else if (kind === 'keys_lead') {
      const car = osc('sine', f, t, len + 0.8), mod = osc('sine', f * 2, t, len + 0.8), mg = gain();
      mg.gain.setValueAtTime(f * 1.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.2, t + 0.5);
      mod.connect(mg).connect(car.frequency);
      env(g, t, 0.08 * v, 0.006, len + 0.5);
      car.connect(g); bus(g, 0.45, 0.25);
    } else if (kind === 'chip') {
      const o = osc('square', f, t, len), vib = osc('sine', 6, t, len), vg = gain();
      vg.gain.value = f * 0.008; vib.connect(vg).connect(o.frequency);
      g.gain.setValueAtTime(0.045 * v, t); g.gain.setValueAtTime(0.0001, t + len * 0.92);
      o.connect(g); bus(g, 0.1, 0.2);
    } else {
      // synth lead: two detuned saws, filter, gentle vibrato after the attack
      const lp = filt('lowpass', 2600, 1.5), vib = osc('sine', 5.5, t, len), vg = gain();
      vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.006, t + 0.3);
      for (const c of [-7, 7]) { const o = osc('sawtooth', f, t, len + 0.1); o.detune.value = c; vib.connect(vg).connect(o.frequency); o.connect(lp); }
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06 * v, t + 0.02); g.gain.setTargetAtTime(0.0001, t + len, 0.06);
      lp.connect(g); bus(g, 0.4, 0.3);
    }
  }

  // ---- sequencer ----
  let next = ctx.currentTime + 0.15, step = start_bar * 16, bpm_now = 90, beat_len = 60 / 90, effort_now = 0.6, alive = true;
  const chord_at = (bar) => T.chords[Math.floor(bar / T.bars_per_chord) % T.chords.length];
  const tone_of = (chord, i) => chord[i % chord.length] + 12 * Math.floor(i / chord.length);   // chord tone i, octaves up
  const vel = (c) => (c === 'X' ? 1 : c === 'x' ? 0.8 : c === 'o' ? 0.35 : 0);
  // length of a held note: 1 step + the '-' after it
  const held = (pat, i) => { let n = 1; while (pat[(i + n) % 16] === '-' && n < 16) n++; return n; };

  function play_step(t, s, idle) {
    const bar = Math.floor(s / 16), i = s % 16;
    const sec_bar = bar % 8, section = idle ? 'intro' : arrangement[Math.floor(bar / 8) % arrangement.length];
    let on = new Set(layers[section]);
    // effort shapes it: easy riding keeps it mellow, hard riding brings in everything
    if (!idle && effort_now < 0.5) { on.delete('lead'); on.delete('arp'); }
    if (!idle && effort_now > 0.95 && section !== 'break') { on.add('arp'); on.add('lead'); on.add('kick'); on.add('bass'); }
    if (idle) on = new Set(['pad']);
    const ch = chord_at(bar), root = ch[0] - 24, step_s = beat_len / 4;
    // drums
    if (T.kick && (on.has('kick') || on.has('kick_soft'))) { const v = vel(T.kick[i]); if (v) drum.kick(t, on.has('kick') ? v : v * 0.5); }
    if (T.snare && on.has('snare')) { const v = vel(T.snare[i]); if (v) drum.snare(t, v); }
    if (T.clap && on.has('clap')) { const v = vel(T.clap[i]); if (v) drum.clap(t, v); }
    if (T.hat && on.has('hat')) { const v = vel(T.hat[i]); if (v) drum.hat(t, v); }
    if (T.ohat && on.has('ohat')) { const v = vel(T.ohat[i]); if (v) drum.hat(t, v, true); }
    if (T.shaker && on.has('shaker')) { const v = vel(T.shaker[i]); if (v) drum.shaker(t, v); }
    // build-up: a snare roll in the last bar before a full section, a crash when it lands
    const next_sec = arrangement[(Math.floor(bar / 8) + 1) % arrangement.length];
    if (!idle && sec_bar === 7 && next_sec === 'full' && section !== 'full' && i >= 8 && (T.snare || T.clap)) drum.snare(t, 0.3 + (i - 8) * 0.08);
    if (!idle && sec_bar === 0 && i === 0 && section === 'full' && (T.crash || T.big_snare)) drum.crash(t);
    // bass
    if (T.bass && on.has('bass')) {
      const c = T.bass.pat[i];
      if ('rof'.includes(c)) bass(t, root + (c === 'o' ? 12 : c === 'f' ? 7 : 0), held(T.bass.pat, i) * step_s, T.bass.kind);
    }
    // pad: at each chord change
    if (T.pad && on.has('pad') && i === 0 && bar % T.bars_per_chord === 0) chord(t, ch, T.bars_per_chord * 16 * step_s, 'pad', idle ? 0.7 : 1);
    // comping chords
    if (T.chords_play && (on.has('chords') || on.has('chords_soft'))) {
      const c = T.chords_play.pat[i];
      if (c === 'x') chord(t, ch, held(T.chords_play.pat, i) * step_s, T.chords_play.kind, on.has('chords') ? 1 : 0.5);
    }
    // arpeggio and lead (an octave above the chord)
    if (T.arp && on.has('arp')) {
      const c = T.arp.pat[i];
      if (c >= '0' && c <= '9') voice(t, tone_of(ch, +c) + 12, step_s * 0.9, T.arp.kind, 0.8);
    }
    if (T.lead && on.has('lead')) {
      const pat = T.lead.pat[bar % T.lead.pat.length], c = pat[i];
      if (c >= '0' && c <= '9') voice(t, tone_of(ch, +c) + 12, held(pat, i) * step_s, T.lead.kind);
    }
  }

  return {
    name: T.name,
    // dt (s), cadence (rpm), effort (watts / ftp)
    update(dt, cadence, effort) {
      if (!alive) return;
      const idle = !(cadence > 25);
      bpm_now = idle ? 72 : Math.min(125, Math.max(60, cadence));
      beat_len = 60 / bpm_now;
      effort_now += ((effort || 0) - effort_now) * Math.min(1, dt * 0.8);
      echo.delayTime.setTargetAtTime(beat_len * 0.75, ctx.currentTime, 0.5);   // dotted-eighth echo in time
      if (next < ctx.currentTime - 0.5) next = ctx.currentTime + 0.05;   // fell behind (tab hidden): resync
      while (next < ctx.currentTime + 0.12) {
        const sw = step % 2 ? T.swing * beat_len / 4 : 0;
        play_step(next + sw, step, idle);
        next += beat_len / 4;
        step++;
      }
    },
    stop() {
      alive = false;
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => { try { crackle?.stop(); comp.disconnect(); } catch { /* gone */ } }, 1500);
    },
  };
}

// ---- helpers ----
function noise_buffer(ctx) {
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
// reverb impulse: stereo decaying noise
function impulse(ctx, secs) {
  const n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  }
  return b;
}
// vinyl crackle: sparse clicks over a faint hiss
function crackle_buffer(ctx) {
  const n = ctx.sampleRate * 3, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * 0.04 + (Math.random() < 0.0004 ? (Math.random() - 0.5) * 1.6 : 0);
  return b;
}
// soft clipping curve for overdrive
function drive_curve(k) {
  const c = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return c;
}
