/* Story page motion. Every number comes from story-data.js, which is generated from engine.js. */
(function () {
  'use strict';
  const S = window.STORY;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';
  const timers = new Map(); // scene id -> list of cancel fns

  // ---------- helpers ----------
  const ease = { out: t => 1 - Math.pow(1 - t, 3), inOut: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 };
  function later(scene, ms, fn) { const id = setTimeout(fn, reduced ? 0 : ms); track(scene, () => clearTimeout(id)); }
  function every(scene, ms, fn) { const id = setInterval(fn, ms); track(scene, () => clearInterval(id)); }
  function track(scene, cancel) { if (!timers.has(scene)) timers.set(scene, []); timers.get(scene).push(cancel); }
  function clearScene(scene) { (timers.get(scene) || []).forEach(c => c()); timers.set(scene, []); }
  function tween(scene, dur, fn, ez) {
    if (reduced) { fn(1); return; }
    let raf, t0 = null; ez = ez || ease.out;
    const step = ts => { if (t0 === null) t0 = ts; const t = Math.min(1, (ts - t0) / dur); fn(ez(t)); if (t < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step); track(scene, () => cancelAnimationFrame(raf));
  }
  function countUp(scene, el, to, fmt, dur, delay) {
    el.textContent = fmt(0);
    later(scene, delay || 0, () => tween(scene, dur || 1600, p => { el.textContent = fmt(to * p); }));
  }
  const crf = v => (v < 0 ? '−' : '') + '₹' + Math.abs(v).toFixed(1) + ' Cr';
  function svg(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function txt(parent, x, y, s, attrs) { const t = svg('text', Object.assign({ x, y, class: 'svgtxt' }, attrs || {}), parent); t.textContent = s; return t; }
  function sizeCanvas(cv) { const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.max(1, r.width * d); cv.height = Math.max(1, r.height * d); const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0); return { c, w: r.width, h: r.height }; }
  const bookedShare = t => { const f = x => 1 / (1 + Math.exp((x - 30) / 10)); return f(t) / f(0); };

  // ---------- 0 · hero grid ----------
  (function heroGrid() {
    const g = $('#heroGrid'); let h = '';
    S.rows.forEach((row, r) => row.lanes.forEach((lane, c) => {
      const delay = (r + c) * 28, pulse = Math.random() < 0.12;
      h += `<i class="${lane}${pulse ? ' pulse' : ''}" style="transition-delay:${delay}ms;${pulse ? `animation-delay:${(Math.random() * 4).toFixed(2)}s` : ''}"></i>`;
    }));
    g.innerHTML = h;
  })();

  // ---------- 1 · sold-out chart ----------
  const sold = (function () {
    const box = $('#soldChart'), W = 640, H = 360, m = { l: 44, r: 10, t: 16, b: 34 };
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Weekly demand at one Dubai hotel versus rooms on free sale; red shows demand that found the hotel full' }, box);
    const max = 460, bw = (W - m.l - m.r) / 12;
    const y = v => H - m.b - v / max * (H - m.t - m.b);
    [100, 200, 300, 400].forEach(v => { svg('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: 'rgba(255,255,255,.06)' }, s); txt(s, m.l - 8, y(v) + 4, v, { 'text-anchor': 'end' }); });
    S.sold.forEach((d, i) => {
      const x = m.l + i * bw + bw * .18, w = bw * .64;
      svg('rect', { x, y: y(d.served), width: w, height: y(0) - y(d.served), rx: 3, fill: '#3E4B60', class: 'bar-served', style: `transition-delay:${i * 60}ms` }, s);
      svg('rect', { x, y: y(d.d), width: w, height: y(d.served) - y(d.d), rx: 3, fill: '#F0585C', class: 'bar-lost', style: `transition-delay:${900 + i * 60}ms` }, s);
      if (i % 2 === 0) txt(s, x + w / 2, H - 12, S.weeks[i], { 'text-anchor': 'middle' });
    });
    const pts = S.sold.map((d, i) => `${m.l + i * bw + bw / 2},${y(d.cap)}`).join(' ');
    svg('polyline', { points: pts, fill: 'none', stroke: '#EEF1F5', 'stroke-width': 2, 'stroke-dasharray': '6 5', class: 'capline', opacity: .8 }, s);
    txt(s, m.l, m.t - 2, 'Room-nights per week', {});
    const cv = document.createElement('canvas'); box.appendChild(cv);
    function particles(scene) {
      if (reduced) return;
      const { c, w, h } = sizeCanvas(cv), k = w / W, dots = [];
      let alive = true, raf, t0 = performance.now();
      track(scene, () => { alive = false; cancelAnimationFrame(raf); c.clearRect(0, 0, w, h); });
      const frame = now => {
        if (!alive) return;
        const el = now - t0;
        if (el > 1400 && el < 10500) for (let n = 0; n < 2; n++) {
          const i = Math.floor(Math.random() * 12), d = S.sold[i];
          const tx = (m.l + i * bw + bw / 2 + (Math.random() - .5) * bw * .5) * k;
          const v = Math.random() * d.d, ty = y(v) * k;
          dots.push({ x: -8, y: (40 + Math.random() * 260) * k, tx, ty, lost: v > d.served, t: 0, r: 2 + Math.random() * 1.5 });
        }
        c.clearRect(0, 0, w, h);
        for (let j = dots.length - 1; j >= 0; j--) {
          const p = dots[j]; p.t += 0.018;
          if (p.t <= 1) { const e = ease.inOut(p.t); p.cx = p.x + (p.tx - p.x) * e; p.cy = p.y + (p.ty - p.y) * e - Math.sin(e * Math.PI) * 40 * k; }
          else if (p.lost) { const q = p.t - 1; p.cx = p.tx + q * 90 * k; p.cy = p.ty - q * 120 * k + q * q * 160 * k; }
          const a = p.t <= 1 ? .9 : Math.max(0, 1 - (p.t - 1) * 1.6);
          if (a <= 0 || (!p.lost && p.t > 1.15)) { dots.splice(j, 1); continue; }
          c.beginPath(); c.arc(p.cx, p.cy, p.r * (p.t > 1 && !p.lost ? 1 + (p.t - 1) * 6 : 1), 0, Math.PI * 2);
          c.fillStyle = p.t > 1 ? (p.lost ? `rgba(240,88,92,${a})` : `rgba(140,190,250,${Math.max(0, 1 - (p.t - 1) * 7)})`) : `rgba(200,214,232,${a})`;
          c.fill();
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }
    return { particles };
  })();

  // ---------- 2 · discount chart ----------
  const disc = (function () {
    const box = $('#discChart'), W = 640, H = 270, m = { l: 44, r: 70, t: 18, b: 34 };
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Prepay discount falls from 14% in quiet weeks to about 11% at peak; allotment discount rises from 3% to 11%' }, box);
    const B = S.bands, x = i => m.l + i * (W - m.l - m.r) / (B.length - 1), y = v => H - m.b - (v + 1) / 17 * (H - m.t - m.b);
    [0, 5, 10, 15].forEach(v => { svg('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: 'rgba(255,255,255,.06)' }, s); txt(s, m.l - 8, y(v) + 4, v + '%', { 'text-anchor': 'end' }); });
    B.forEach((b, i) => txt(s, x(i), H - 10, b.name, { 'text-anchor': 'middle' }));
    txt(s, W - m.r, H - 10, '', {});
    const lines = [];
    [['prepay', '#F07A35'], ['allot', '#4A93F0']].forEach(([key, col], li) => {
      const d = B.map((b, i) => (i ? 'L' : 'M') + x(i) + ',' + y(b[key])).join('');
      const p = svg('path', { d, fill: 'none', stroke: col, 'stroke-width': 3, 'stroke-linecap': 'round', class: 'drawline' }, s);
      lines.push(p);
      B.forEach((b, i) => {
        const g = svg('g', { class: 'ptlab', style: `transition-delay:${0.5 + i * 0.35 + li * 0.2}s` }, s);
        svg('circle', { cx: x(i), cy: y(b[key]), r: 5, fill: col, stroke: '#0E1420', 'stroke-width': 2 }, g);
        if (i === 1 || i === 4) txt(g, x(i) + (i === 4 ? 10 : 0), y(b[key]) + (key === 'prepay' ? -12 : 20), (b[key] < 0 ? 0 : b[key]).toFixed(0) + '%', { 'text-anchor': i === 4 ? 'start' : 'middle', style: `fill:${col};font-weight:700;font-size:14px` });
      });
    });
    txt(s, x(0), y(15.6), 'Quieter weeks', { style: 'fill:#6B7686' }); txt(s, x(4), y(15.6), 'Busier weeks →', { 'text-anchor': 'end', style: 'fill:#6B7686' });
    function reset() { lines.forEach(p => { const L = p.getTotalLength(); p.style.transition = 'none'; p.style.strokeDasharray = L; p.style.strokeDashoffset = L; }); }
    function draw(scene) {
      reset();
      requestAnimationFrame(() => requestAnimationFrame(() => lines.forEach((p, i) => { p.style.transition = ''; p.style.transitionDelay = (i * 0.25) + 's'; p.style.strokeDashoffset = 0; })));
      const nF = $('#shockN'), eF = $('#shockE'); nF.style.width = '0'; eF.style.width = '0';
      later(scene, 2600, () => { nF.style.width = (S.naive.wo / 7 * 100) + '%'; eF.style.width = (S.res.wo / 7 * 100) + '%'; });
      countUp(scene, $('#shockNv'), S.naive.wo, crf, 1600, 2600);
      countUp(scene, $('#shockEv'), S.res.wo, crf, 1600, 2600);
    }
    reset();
    return { draw };
  })();

  // ---------- 4 · engine stage ----------
  const engine = (function () {
    const steps = $$('#steps li'), stages = $$('#stage > div');
    let cur = -1;
    // chips
    const chipNames = ['Bookings', 'Searches', 'Sold-out searches', 'Look-to-book', 'Cancellations', 'Event calendar', 'Visa changes', 'Airfares', 'Risk news', 'Hotel rates', 'Release dates', 'Supplier terms'];
    const chipsEl = $('#chips');
    chipsEl.innerHTML = chipNames.map(n => `<span class="chip">${n}</span>`).join('');
    function runChips(scene) {
      const box = $('#stage').getBoundingClientRect(), cx = box.width / 2, cy = box.height / 2 - 10;
      const chips = $$('#chips .chip');
      chips.forEach((ch, i) => {
        const a = i / chips.length * Math.PI * 2, R = Math.min(cx, cy) * 0.82, far = Math.max(box.width, box.height);
        const w = ch.offsetWidth, h = ch.offsetHeight;
        ch.style.left = (cx - w / 2) + 'px'; ch.style.top = (cy - h / 2) + 'px';
        ch.style.transition = 'none'; ch.style.opacity = 0;
        ch.style.transform = `translate(${Math.cos(a) * far}px, ${Math.sin(a) * far}px)`;
        later(scene, 60 + i * 90, () => { ch.style.transition = ''; ch.style.opacity = 1; ch.style.transform = `translate(${Math.cos(a) * R}px, ${Math.sin(a) * R * .8}px)`; });
        later(scene, 2600 + i * 110, () => { ch.style.opacity = 0; ch.style.transform = 'translate(0,0) scale(.4)'; });
      });
    }
    // fan: each week becomes a strip of possible outcomes, then the 10-90% band and the average appear
    function runFan(scene) {
      const cv = $('#fan'); const { c, w, h } = sizeCanvas(cv);
      const F = S.fan, max = Math.max(...F.flat()) * 1.05, m = { l: 40, r: 14, t: 18, b: 66 };
      const X = i => m.l + 18 + i * (w - m.l - m.r - 36) / 11, Y = v => h - m.b - v / max * (h - m.t - m.b);
      const axes = () => {
        c.fillStyle = '#6B7686'; c.font = '12px Inter, sans-serif'; c.textAlign = 'center';
        S.weeks.forEach((wk, i) => { if (i % 2 === 0) c.fillText(wk, X(i), h - m.b + 20); });
        c.textAlign = 'right'; [200, 400, 600, 800].forEach(v => { if (v < max) { c.fillText(v, m.l - 6, Y(v) + 4); c.strokeStyle = 'rgba(255,255,255,.05)'; c.beginPath(); c.moveTo(m.l, Y(v)); c.lineTo(w - m.r, Y(v)); c.stroke(); } });
      };
      // per-week sorted outcomes for quantiles
      const weeks = Array.from({ length: 12 }, (_, i) => F.map(p => p[i]).sort((a, b) => a - b));
      const q = (arr, p) => arr[Math.floor(p * (arr.length - 1))];
      const jit = F.map(() => Array.from({ length: 12 }, () => (Math.random() - .5) * 22));
      c.clearRect(0, 0, w, h); axes();
      let k = 0;
      const dot = (s, i) => { c.beginPath(); c.arc(X(i) + jit[s][i], Y(F[s][i]), 2.1, 0, Math.PI * 2); c.fill(); };
      c.fillStyle = 'rgba(120,175,245,.42)';
      if (reduced) { F.forEach((p, s) => p.forEach((_, i) => dot(s, i))); }
      else every(scene, 16, () => { for (let j = 0; j < 5 && k < F.length; j++, k++) for (let i = 0; i < 12; i++) dot(k, i); });
      later(scene, 2300, () => {
        c.fillStyle = 'rgba(74,147,240,.16)'; c.beginPath();
        weeks.forEach((arr, i) => i ? c.lineTo(X(i), Y(q(arr, .9))) : c.moveTo(X(i), Y(q(arr, .9))));
        for (let i = 11; i >= 0; i--) c.lineTo(X(i), Y(q(weeks[i], .1)));
        c.closePath(); c.fill();
        const line = (vals, col, lw, dash) => { c.strokeStyle = col; c.lineWidth = lw; c.setLineDash(dash || []); c.beginPath(); vals.forEach((v, i) => i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))); c.stroke(); c.setLineDash([]); };
        const avg = S.sold.map(d => d.d), cap = S.sold.map(d => d.cap);
        line(avg, '#F07A35', 3); line(cap, 'rgba(238,241,245,.85)', 2, [6, 5]);
        c.font = '600 13px Inter, sans-serif'; c.textAlign = 'left';
        c.fillStyle = '#F7A574'; c.fillText('Average demand', X(6) + 8, Y(avg[6]) - 12);
        c.fillStyle = '#C3CAD4'; c.fillText('Rooms on free sale', X(1), Y(cap[1]) + 24);
        c.fillStyle = '#8FBCF7'; c.fillText('10-90% of outcomes', X(9) - 30, Y(q(weeks[9], .9)) - 10);
      });
    }
    // sort
    const sortEl = $('#sortgrid'); const sample = [];
    (function () { const flat = S.rows.flatMap(r => r.lanes); for (let i = 0; i < 60; i++) sample.push(flat[Math.floor(i * flat.length / 60)]); })();
    sortEl.innerHTML = sample.map(() => '<i></i>').join('') + '<span class="colhead" style="color:#F7A574">Buy</span><span class="colhead" style="color:#8FBCF7">Block</span><span class="colhead" style="color:#9AA4B2">Pass</span>';
    function runSort(scene) {
      const r = sortEl.getBoundingClientRect(), cells = $$('#sortgrid i'), heads = $$('#sortgrid .colhead');
      const sz = 26, gap = 6, cols = 10;
      const ox = (r.width - (cols * (sz + gap))) / 2, oy = 40;
      cells.forEach((el, i) => { el.style.transition = 'none'; el.style.background = '#2A313D'; el.style.transform = `translate(${ox + (i % cols) * (sz + gap)}px, ${oy + Math.floor(i / cols) * (sz + gap)}px)`; });
      const colW = r.width / 3, per = 4, cnt = { buy: 0, block: 0, pass: 0 }, ci = { buy: 0, block: 1, pass: 2 };
      heads.forEach((hd, i) => { hd.style.left = (colW * i + colW / 2 - 24) + 'px'; });
      later(scene, 500, () => cells.forEach((el, i) => { el.style.transition = ''; el.style.background = sample[i] === 'buy' ? '#E0703A' : sample[i] === 'block' ? '#3D86E6' : '#4E5766'; el.style.transitionDelay = (i * 12) + 'ms'; }));
      later(scene, 1500, () => cells.forEach((el, i) => {
        const L = sample[i], n = cnt[L]++, cx = colW * ci[L] + colW / 2 - (per * (sz + gap)) / 2;
        el.style.transitionDelay = (i * 18) + 'ms';
        el.style.transform = `translate(${cx + (n % per) * (sz + gap)}px, ${oy + Math.floor(n / per) * (sz + gap)}px)`;
      }));
    }
    // radar
    function runRadar(scene) {
      const box = $('#radarChart'); box.innerHTML = '';
      const R = S.release, W = 600, H = 400, m = { l: 44, r: 20, t: 20, b: 40 };
      const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Booking pickup against forecast for one allotment, with the release check at T-14' }, box);
      const ymax = Math.max(R.p90, R.H + R.K) * 1.08, x = t => m.l + (90 - t) / 90 * (W - m.l - m.r), y = v => H - m.b - v / ymax * (H - m.t - m.b);
      const days = []; for (let t = 90; t >= 0; t -= 2) days.push(t);
      const band = days.map(t => `${x(t)},${y(R.p90 * bookedShare(t))}`).join(' ') + ' ' + days.slice().reverse().map(t => `${x(t)},${y(R.p10 * bookedShare(t))}`).join(' ');
      svg('polygon', { points: band, fill: 'rgba(74,147,240,.12)' }, s);
      const path = (f, a, b) => days.filter(t => t <= a && t >= b).map((t, i) => (i ? 'L' : 'M') + x(t) + ',' + y(f(t))).join('');
      svg('path', { d: path(t => R.med * bookedShare(t), 90, 0), fill: 'none', stroke: '#4A93F0', 'stroke-width': 2, 'stroke-dasharray': '5 4' }, s);
      svg('line', { x1: m.l, x2: W - m.r, y1: y(R.K + R.H), y2: y(R.K + R.H), stroke: 'rgba(238,241,245,.6)', 'stroke-dasharray': '2 4' }, s);
      txt(s, W - m.r, y(R.K + R.H) - 6, 'Held: ' + (R.K + R.H), { 'text-anchor': 'end' });
      [90, 60, 30, 14, 0].forEach(t => txt(s, x(t), H - 14, t ? 'T-' + t : 'Arrival', { 'text-anchor': 'middle' }));
      const act = svg('path', { d: path(t => R.proj * bookedShare(t) * (1 + 0.025 * Math.sin(t / 3.1)), 90, 14), fill: 'none', stroke: '#EEF1F5', 'stroke-width': 3, 'stroke-linecap': 'round' }, s);
      const L = act.getTotalLength(); act.style.strokeDasharray = L; act.style.strokeDashoffset = L;
      const proj = svg('path', { d: path(t => R.proj * bookedShare(t), 14, 0), fill: 'none', stroke: '#EEF1F5', 'stroke-width': 2, 'stroke-dasharray': '1 5', opacity: 0 }, s);
      const rl = svg('line', { x1: x(14), x2: x(14), y1: m.t, y2: H - m.b, stroke: '#F07A35', 'stroke-width': 2, opacity: 0 }, s);
      const rt = txt(s, x(14) - 8, m.t + 14, 'Release check · ' + R.relDate, { 'text-anchor': 'end', style: 'fill:#F7A574;font-weight:600', opacity: 0 });
      tween(scene, 2200, p => { act.style.strokeDashoffset = L * (1 - p); }, ease.inOut);
      later(scene, 2200, () => { [proj, rl, rt].forEach(e => e.setAttribute('opacity', 1)); });
      $('#radarCap').textContent = `${R.name}, week of ${R.week}: pickup is below forecast (on track for ${R.proj} vs ${R.med}). Keep ${R.keep} of ${R.K} rooms, hand back ${R.rel} on ${R.relDate}.`;
    }
    const runs = [runChips, runFan, runSort, runRadar];
    function show(scene, i) {
      cur = i; clearScene('s4-step');
      steps.forEach((li, j) => li.classList.toggle('on', j === i));
      stages.forEach((st, j) => st.classList.toggle('on', j === i));
      runs[i]('s4-step');
      const bar = steps[i].querySelector('.bar i'); bar.style.transition = 'none'; bar.style.width = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = `width ${STEP_MS}ms linear`; bar.style.width = '100%'; }));
    }
    const STEP_MS = 4800;
    steps.forEach((li, i) => li.addEventListener('click', () => { clearScene('s4'); show('s4', i); loop(i); }));
    function loop(from) { let i = from; every('s4', STEP_MS, () => { i = (i + 1) % 4; show('s4', i); }); }
    function start() { show('s4', 0); loop(0); }
    function stop() { clearScene('s4-step'); }
    return { start, stop };
  })();

  // ---------- 5 · results ----------
  const results = (function () {
    const box = $('#results');
    const groups = [['Expected extra gross profit', S.res.exp, S.naive.exp], ['Bad quarter (1 in 20)', S.res.p5, S.naive.p5], ['If a Gulf shock hits', S.res.gulf, S.naive.gulf]];
    box.innerHTML = groups.map(([n, a, b]) => `<div class="rgroup"><h3>${n}</h3>
      <div class="rbar"><span>Buy, Block or Pass</span><div class="rtrack"><div class="rzero"></div><div class="rfill e" data-v="${a}"></div><span class="rval" data-v="${a}">${crf(a).replace(/^₹/, a > 0 ? '+₹' : '₹')}</span></div></div>
      <div class="rbar"><span>Prepay hottest weeks</span><div class="rtrack"><div class="rzero"></div><div class="rfill n" data-v="${b}"></div><span class="rval n" data-v="${b}">${b > 0 ? '+' : ''}${crf(b)}</span></div></div></div>`).join('');
    const pos = v => { const w = Math.abs(v) / 5 * 46; return v >= 0 ? { left: 50, width: w } : { left: 50 - w, width: w }; };
    function reset() { $$('#results .rfill').forEach(f => { f.style.left = '50%'; f.style.width = '0'; }); $$('#results .rval').forEach(v => { const val = +v.dataset.v, p = pos(val); v.style.left = val >= 0 ? `calc(${p.left + p.width}% + 8px)` : `calc(50% + 8px)`; }); }
    function run(scene) {
      reset();
      later(scene, 300, () => $$('#results .rfill').forEach((f, i) => { const p = pos(+f.dataset.v); f.style.transitionDelay = (i * 120) + 'ms'; f.style.left = p.left + '%'; f.style.width = p.width + '%'; }));
      countUp(scene, $('#tWo'), S.res.wo, crf, 1500, 1200);
      countUp(scene, $('#tRec'), S.res.rec, v => Math.round(v) + '%', 1500, 1400);
    }
    reset();
    return { run };
  })();

  // ---------- 6 · plan grid ----------
  const plan = (function () {
    const g = $('#planGrid');
    let h = '<span></span>' + S.weeks.map((w, i) => `<span class="hd">${i % 3 === 0 ? w : ''}</span>`).join('');
    S.rows.forEach((row, r) => { h += `<span class="rl" data-row="${row.name}">${row.name}</span>` + row.lanes.map((l, c) => `<i class="${l}" data-row="${row.name}" title="${row.name} · week of ${S.weeks[c]} · ${l}" style="transition-delay:${c * 55 + r * 14}ms"></i>`).join(''); });
    g.innerHTML = h;
    const callouts = $$('#callouts .callout');
    function focus(i) {
      callouts.forEach((c, j) => c.classList.toggle('on', j === i));
      const rows = i < 0 ? null : callouts[i].dataset.row.split(',');
      $$('#planGrid i').forEach(el => el.classList.toggle('dimmed', !!rows && !rows.includes(el.dataset.row)));
      $$('#planGrid .rl').forEach(el => el.classList.toggle('hl', !!rows && rows.includes(el.dataset.row)));
      if (window.FXSKY) window.FXSKY.highlight(rows);
    }
    callouts.forEach((c, i) => c.addEventListener('click', () => { clearScene('s6'); focus(i); }));
    function run(scene) { focus(-1); let i = -1; later(scene, 1800, () => { i = 0; focus(0); every(scene, 3200, () => { i = (i + 1) % 3; focus(i); }); }); }
    return { run };
  })();

  // ---------- scene lifecycle ----------
  const scenes = $$('.scene');
  const enter = {
    s1: id => { countUp(id, $('#lostNum'), S.sold.reduce((a, d) => a + d.lost, 0), v => Math.round(v).toLocaleString('en-IN'), 2600, 900); sold.particles(id); },
    s2: id => disc.draw(id),
    s4: () => engine.start(),
    s5: id => results.run(id),
    s6: id => { window.__s6in = true; if (window.FXSKY) window.FXSKY.play(); plan.run(id); }
  };
  const active = new Set();
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    const id = e.target.id;
    if (e.intersectionRatio >= 0.35 && !active.has(id)) { active.add(id); e.target.classList.add('in'); enter[id] && enter[id](id); }
    else if (!e.isIntersecting && active.has(id)) { active.delete(id); e.target.classList.remove('in'); clearScene(id); if (id === 's4') engine.stop(); if (id === 's6') { window.__s6in = false; if (window.FXSKY) window.FXSKY.stop(); } }
  }), { threshold: [0, 0.35, 0.6] });
  scenes.forEach(s => io.observe(s));

  // nav dots + current scene
  const dots = $('#dots');
  dots.innerHTML = scenes.map(s => `<a href="#${s.id}" aria-label="${s.id}"></a>`).join('');
  let current = 0;
  function updateCurrent() {
    const mid = innerHeight / 2; let best = 0;
    scenes.forEach((s, i) => { const r = s.getBoundingClientRect(); if (r.top <= mid && r.bottom >= mid) best = i; });
    current = best;
    $$('#dots a').forEach((a, i) => a.classList.toggle('on', i === best));
    $$('.top nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + scenes[best].id));
    if (!playing) $('#prog').style.width = (scrollY / (document.documentElement.scrollHeight - innerHeight) * 100) + '%';
  }
  addEventListener('scroll', updateCurrent, { passive: true });

  // ---------- autoplay director ----------
  const durs = scenes.map(s => +s.dataset.dur * 1000), total = durs.reduce((a, b) => a + b, 0);
  const names = ['Intro', 'The problem', 'The trap', 'The options', 'The engine', 'The result', 'The plan', 'Try it'];
  let playing = false, idx = 0, sceneStart = 0, raf = null;
  const btn = $('#playBtn'), lbl = $('#playLbl');
  function goTo(i) { if (window.LENIS) window.LENIS.scrollTo(scenes[i], { duration: reduced ? 0 : 1.6 }); else scenes[i].scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); }
  function tick(now) {
    if (!playing) return;
    const el = now - sceneStart, done = durs.slice(0, idx).reduce((a, b) => a + b, 0);
    $('#prog').style.width = ((done + Math.min(el, durs[idx])) / total * 100) + '%';
    if (el >= durs[idx]) {
      if (idx >= scenes.length - 1) { stop(true); return; }
      idx++; sceneStart = now; goTo(idx); setLabel();
    }
    raf = requestAnimationFrame(tick);
  }
  function setLabel() { lbl.textContent = `${idx + 1} / ${scenes.length} · ${names[idx]}`; }
  function play() {
    playing = true; idx = current >= scenes.length - 1 ? 0 : current; goTo(idx);
    sceneStart = performance.now(); btn.textContent = '❚❚ Pause'; btn.setAttribute('aria-label', 'Pause the story'); setLabel();
    raf = requestAnimationFrame(tick);
  }
  function stop(ended) {
    playing = false; cancelAnimationFrame(raf);
    btn.textContent = ended ? '↺ Replay' : '▶ Play'; btn.setAttribute('aria-label', 'Play the story');
    lbl.textContent = ended ? 'Story finished' : '90-second story';
    if (ended) current = scenes.length - 1;
  }
  btn.addEventListener('click', () => playing ? stop() : play());
  $('#heroPlay').addEventListener('click', () => { if (!playing) play(); });
  ['wheel', 'touchstart'].forEach(ev => addEventListener(ev, () => { if (playing) stop(); }, { passive: true }));
  addEventListener('keydown', e => {
    if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); playing ? stop() : play(); }
    else if (['ArrowDown', 'PageDown', 'ArrowUp', 'PageUp'].includes(e.code) && playing) stop();
  });
  updateCurrent();
})();
