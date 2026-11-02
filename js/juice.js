// game juice: glossy outlined numbers, rolling counters, "+400 PTS" pops with sparkles, stamps.
// colours: purple = points, gold = places / records / timers, green = gains, red = danger, blue = clocks
// (css: .juicy, .j-pop, .j-stamp in style.css)

// set the text of a .juicy element (the outline layer reads data-t)
export function jset(el, text) {
  const t = String(text);
  if (el.dataset.t === t) return;
  el.textContent = t;
  el.dataset.t = t;
}

// a number that rolls up (or down) to its new value and bumps when it grows. fmt(n) -> text
export function roller(el, fmt = (n) => n, ms = 650) {
  let shown = 0, from = 0, to = 0, t0 = 0, raf = 0;
  const tick = (ts) => {
    const k = Math.min(1, (ts - t0) / ms), e = 1 - (1 - k) ** 3;
    shown = Math.round(from + (to - from) * e);
    jset(el, fmt(shown));
    if (k < 1) raf = requestAnimationFrame(tick);
  };
  jset(el, fmt(0));
  return {
    set(v) {
      if (v === to) return;
      const up = v > to;
      from = shown; to = v; t0 = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
      if (up) { el.classList.remove('j-bump'); void el.offsetWidth; el.classList.add('j-bump'); }
    },
    get value() { return to; },
  };
}

// big pop in the middle of the screen: text (+ a smaller line), colour, size ('lg' | 'md'), sparkles burst out
export function pop(parent, text, { color = 'purple', sub = '', sub_color = 'gold', size = 'lg', top = '36%', ms = 2000 } = {}) {
  const el = document.createElement('div');
  el.className = `j-pop ${size}`;
  el.style.top = top;
  el.innerHTML = `<div class="juicy ${color}" data-t="${text}">${text}</div>${sub ? `<div class="juicy ${sub_color} sub" data-t="${sub}">${sub}</div>` : ''}`;
  // sparkles flying out
  const n = size === 'lg' ? 14 : 8;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4, d = (size === 'lg' ? 110 : 70) + Math.random() * 60;
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * d * 0.7}px`);
    s.style.animationDelay = `${Math.random() * 0.12}s`;
    s.textContent = ['✦', '★', '✧', '●'][i % 4];
    s.className = `spark ${color}`;
    el.appendChild(s);
  }
  parent.appendChild(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

// a stamp that slams onto an element (new record!, level up!)
export function stamp(parent, text, color = 'gold') {
  const el = document.createElement('div');
  el.className = `j-stamp juicy ${color}`;
  jset(el, text);
  parent.appendChild(el);
  return el;
}

// make an existing element juicy (keeps its text)
export function juicify(el, color = 'gold') {
  if (!el) return;
  el.classList.add('juicy', color);
  el.dataset.t = el.textContent;
}
