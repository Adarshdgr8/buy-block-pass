/* Inventory desk: the working prototype. All numbers come from engine.js. */
(function () {
  'use strict';
  const B = window.BBP;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const world = B.buildWorld(42);
  const state = { budget: 50, risk: 'balanced', view: 'overview', planFilter: 'all', laneFilter: 'all', search: '', open: new Set(), shock: 'Gulf', radar: null, showAll: false };
  let res = null, nv = null, stress = null, runId = 0, first = true;
  const prevKpi = {};

  // ---------- format ----------
  const cr = x => (x < 0 ? '−' : '') + '₹' + Math.abs(x / 1e7).toFixed(2) + ' Cr';
  const cr1 = x => (x < 0 ? '−' : '') + '₹' + Math.abs(x / 1e7).toFixed(1) + ' Cr';
  const lakh = x => (x < 0 ? '−' : '') + '₹' + Math.abs(x / 1e5).toFixed(1) + ' L';
  const inr = x => '₹' + Math.round(x).toLocaleString('en-IN');
  const pct = x => (x * 100).toFixed(1).replace(/\.0$/, '') + '%';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const unit = c => c.prod.kind === 'flight' ? 'seats' : 'room-nights';
  const laneName = r => r.H > 0 && r.K > 0 ? 'Buy + Block' : r.lane === 'buy' ? 'Buy' : r.lane === 'block' ? 'Block' : 'Pass';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function tweenNum(el, key, to, fmt, dur) {
    const from = prevKpi[key] == null ? 0 : prevKpi[key]; prevKpi[key] = to;
    if (reduced) { el.textContent = fmt(to); return; }
    const t0 = performance.now(); dur = dur || 900;
    const step = now => { const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3); el.textContent = fmt(from + (to - from) * e); if (t < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2200); }

  // ---------- controls ----------
  $('#budget').addEventListener('input', e => { state.budget = +e.target.value; $('#budgetOut').textContent = '₹' + state.budget + ' Cr'; });
  $('#budget').addEventListener('change', run);
  function seg(id, fn) { $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; [...$(id).querySelectorAll('button')].forEach(x => x.classList.toggle('on', x === b)); fn(b); }); }
  seg('#risk', b => { state.risk = b.dataset.v; run(); });
  seg('#planFilter', b => { state.planFilter = b.dataset.f; renderPlan(); });
  seg('#laneFilter', b => { state.laneFilter = b.dataset.f; renderContracts(); });
  seg('#shock', b => { state.shock = b.dataset.v; renderStress(); });
  $('#search').addEventListener('input', e => { state.search = e.target.value.toLowerCase(); renderContracts(); });
  $('#csv').addEventListener('click', downloadCSV);
  $$('#nav a').forEach(a => a.addEventListener('click', () => show(a.dataset.v)));
  document.addEventListener('click', e => { const g = e.target.closest('[data-goto]'); if (g) show(g.dataset.goto); });
  function show(v) {
    state.view = v;
    $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === v));
    $$('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
    history.replaceState(null, '', '#' + v);
    if (res) renderView(v);
    scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- engine run (worker with live progress, sync fallback) ----------
  let worker = null;
  try { worker = new Worker('worker.js'); worker.onerror = () => { worker = null; run(); }; } catch (e) { worker = null; }
  if (worker) worker.onmessage = e => {
    const m = e.data; if (m.id !== runId) return;
    if (m.type === 'progress') progress(m.f, m.steps);
    else if (m.type === 'done') apply(m.res, m.nv, m.stress, m.ms);
  };
  function progress(f, steps) {
    $('#runFill').style.width = Math.min(98, f * 100) + '%';
    $('#runText').textContent = `Committing cash: ${cr1(f * state.budget * 1e7)} of ₹${state.budget} Cr · ${steps.toLocaleString('en-IN')} steps, each tested on 600 scenarios`;
  }
  function run() {
    runId++;
    $('#runner').classList.remove('idle'); $('#runFill').style.width = '4%';
    $('#runText').textContent = 'Simulating 600 demand scenarios for 600 product-weeks…';
    const msg = { budget: state.budget * 1e7, risk: state.risk, seed: 42, id: runId };
    if (worker) { worker.postMessage(msg); return; }
    setTimeout(() => {
      const t0 = Date.now(), r = B.optimise(world, msg.budget, msg.risk), n = B.naive(world, msg.budget), st = {};
      ['Europe', 'Gulf'].forEach(g => { st[g] = { e: B.stressTest(world, r, g), n: B.stressTest(world, n, g) }; });
      const strip = x => Object.assign({}, x, { plan: x.plan.map(p => ({ idx: p.cell.idx, H: p.H, K: p.K, k: p.k, exp: p.exp, capital: p.capital, lane: p.lane, extra: p.extra })) });
      apply(strip(r), strip(n), st, Date.now() - t0);
    }, 40);
  }
  function hydrate(x) { x.plan.forEach(p => { p.cell = world.cells[p.idx]; }); return x; }
  function apply(r, n, st, ms) {
    res = hydrate(r); nv = hydrate(n); stress = st;
    $('#runFill').style.width = '100%';
    setTimeout(() => { $('#runner').classList.add('idle'); $('#runText').textContent = `Plan ready · solved in ${(ms / 1000).toFixed(1)} s · 360,000 demand scenarios behind it`; }, 300);
    renderOverview();
    if (state.view !== 'overview') renderView(state.view);
    first = false;
  }
  function renderView(v) { ({ overview: renderOverview, plan: renderPlan, contracts: renderContracts, radar: renderRadarList, stress: renderStress, method: renderMethod })[v](); }

  // ---------- overview ----------
  function renderOverview() {
    const L = res.lanes, unused = res.budget - res.capital;
    $('#headline').innerHTML = `Commit ${cr1(res.capital)}: prepay <span class="o">${cr1(L.buy.cap)}</span> across ${L.buy.n} product-weeks and hold <span class="b">allotments</span> on ${L.block.n} more.`;
    $('#hsub').textContent = `Expected extra gross profit of ${cr1(res.expProfit)} this quarter. In a 1-in-20 bad quarter the plan is still ${res.p5 >= 0 ? 'up' : 'down'} ${cr1(Math.abs(res.p5))}, and write-offs stay under ${cr1(res.woLimit)}.` + (unused > 0.5e7 ? ` It leaves ${cr1(unused)} of the budget unspent because more commitment stopped paying.` : '');
    const tiles = [
      ['exp', 'Expected extra gross profit', res.expProfit, cr, 'vs staying on free sale', res.expProfit < 0],
      ['cap', 'Cash committed', res.capital, cr, `of ₹${state.budget} Cr (prepay + deposits)`],
      ['p5', 'Bad quarter (1 in 20)', res.p5, cr, 'extra gross profit, worst 5% of outcomes', res.p5 < 0],
      ['wo', 'Write-off at risk (1 in 20)', res.wo95, cr, `cap ${cr(res.woLimit)} (${Math.round(B.RISK[state.risk] * 100)}% of budget)`],
      ['rec', 'Sold-out demand won back', res.recovered, v => Math.round(v * 100) + '%', `${(res.extraUnits / 1000).toFixed(1)}k extra room-nights and seats`]
    ];
    if (!$('#kpis').children.length) $('#kpis').innerHTML = tiles.map(t => `<div class="kpi" id="k-${t[0]}"><div class="lab">${t[1]}</div><div class="val">…</div><div class="sub"></div></div>`).join('');
    tiles.forEach(([k, , v, fmt, sub, neg]) => {
      const el = $('#k-' + k); el.querySelector('.sub').textContent = sub;
      const val = el.querySelector('.val'); val.classList.toggle('neg', !!neg); tweenNum(val, k, v, fmt);
      el.classList.remove('lit'); void el.offsetWidth; el.classList.add('lit');
    });
    renderCompare(); renderSplit(); renderMap('#miniMap', true);
  }
  function bars(groups, labels) {
    return groups.map(g => {
      const lo = Math.min(0, g.a, g.b), hi = Math.max(0, g.a, g.b), span = (hi - lo) || 1;
      const padL = lo < 0 ? 22 : 2, padR = hi > 0 ? 20 : 2, X = v => padL + (v - lo) / span * (100 - padL - padR);
      const row = (who, v, col) => {
        const x0 = X(0), x1 = X(v), left = Math.min(x0, x1), w = Math.max(Math.abs(x1 - x0), .5);
        const lab = v >= 0 ? `left:calc(${x1}% + 6px)` : `left:calc(${x1}% - 6px);transform:translateX(-100%)`;
        return `<div class="cmp-row"><span>${who}</span><div class="track"><div class="zero" style="left:${x0}%"></div><div class="fill" style="left:${x0}%;width:0;background:${col}" data-l="${left}" data-w="${w}"></div><span class="flab" style="${lab}">${g.fmt(v)}</span></div></div>`;
      };
      return `<div class="cmp-metric">${g.m} <span>· ${g.note}</span></div>` + row(labels[0], g.a, '#14181F') + row(labels[1], g.b, '#9AA3AE');
    }).join('');
  }
  function animateBars(root) { requestAnimationFrame(() => requestAnimationFrame(() => root.querySelectorAll('.fill').forEach((f, i) => { f.style.transitionDelay = (i * 60) + 'ms'; f.style.left = f.dataset.l + '%'; f.style.width = f.dataset.w + '%'; }))); }
  function renderCompare() {
    const g = [
      { m: 'Expected extra gross profit', a: res.expProfit, b: nv.expProfit, fmt: cr, note: 'higher is better' },
      { m: 'Bad quarter (1 in 20)', a: res.p5, b: nv.p5, fmt: cr, note: 'higher is better' },
      { m: 'Write-off at risk (1 in 20)', a: res.wo95, b: nv.wo95, fmt: cr, note: 'lower is better' }
    ];
    $('#compare').innerHTML = bars(g, ['Buy, Block or Pass', 'Pre-buy hottest weeks']); animateBars($('#compare'));
  }
  function renderSplit() {
    const L = res.lanes, tot = (L.buy.cap + L.block.cap) || 1;
    $('#split').innerHTML = `<div class="lanesplit"><div class="lane-buy" style="width:0" data-w="${L.buy.cap / tot * 100}"></div><div class="lane-block" style="width:0" data-w="${L.block.cap / tot * 100}"></div></div>
      <div class="split-lab"><span><span class="pill buy">Buy</span> ${cr1(L.buy.cap)} · ${L.buy.n} product-weeks</span><span><span class="pill block">Block</span> ${cr1(L.block.cap)} in deposits · ${L.block.n}</span><span><span class="pill pass">Pass</span> ${L.pass.n}</span></div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => $$('#split .lanesplit div').forEach(d => d.style.width = d.dataset.w + '%')));
    const byD = {};
    res.plan.filter(r => r.cell.prod.kind === 'hotel').forEach(r => { const d = r.cell.prod.dest; const o = byD[d.id] || (byD[d.id] = { d, n: 0, buy: 0, block: 0, pass: 0 }); o.n++; o[r.lane]++; });
    const arr = Object.values(byD), avg = d => d.season.reduce((a, b) => a + b, 0) / 12;
    const top = l => arr.slice().sort((a, b) => b[l] / b.n - a[l] / a.n)[0];
    const why = { buy: d => avg(d) < 0.95 ? 'Low season, so hotels give the deepest prepay discounts' : 'Steady demand that reliably sells through', block: d => (d.region === 'Europe' || d.vol > 0.33) ? 'Strong demand but shock-prone, so it keeps the right to hand rooms back' : 'Busy weeks where the fixed allotment rate beats the market', pass: d => avg(d) < 0.6 ? 'Demand drops away during the Umrah pause around Hajj' : 'Too little upside to cover contract cost and risk' };
    $('#insights').innerHTML = ['buy', 'block', 'pass'].map(l => { const o = top(l); return o && o[l] ? `<div class="ins"><span class="pill ${l}">${l[0].toUpperCase() + l.slice(1)}</span><span><b>${o.d.name}</b> · ${Math.round(o[l] / o.n * 100)}% of hotel-weeks. ${why[l](o.d)}.</span></div>` : ''; }).join('');
  }

  // ---------- plan map ----------
  const colour = { buy: 'var(--orange)', block: 'var(--blue)', pass: 'var(--pass)' };
  function laneOf(cells) { const c = { buy: 0, block: 0, pass: 0 }; let mix = false; cells.forEach(r => { c[r.lane]++; if (r.H > 0 && r.K > 0) mix = true; }); if (c.buy && c.block) mix = true; return { lane: c.buy >= c.block && c.buy >= c.pass && c.buy ? 'buy' : c.block >= c.pass && c.block ? 'block' : 'pass', mix }; }
  function renderMap(sel, mini) {
    const weeks = B.WEEKS.map(B.fmt);
    const byKey = {};
    res.plan.forEach(r => { const k = r.cell.prod.kind === 'hotel' ? 'D:' + r.cell.prod.dest.id : 'F:' + r.cell.prod.id; (byKey[k] = byKey[k] || []).push(r); });
    let h = '<div></div>' + weeks.map((w, i) => `<div class="hd">${i % 2 === 0 ? w : ''}</div>`).join('');
    let rowN = 0;
    const cellsHtml = (rows, label) => Array.from({ length: 12 }, (_, w) => {
      const cs = rows.filter(r => r.cell.w === w), { lane, mix } = laneOf(cs);
      const tip = `<b>${esc(label)} · week of ${weeks[w]}</b><br>` + cs.map(r => `${esc(r.cell.prod.kind === 'hotel' ? r.cell.prod.name.split(' · ')[1] : 'Series seats')}: ${laneName(r)}${r.H ? ' · prepay ' + r.H : ''}${r.K ? ' · allot ' + r.K : ''}`).join('<br>');
      const one = cs.length === 1 ? ` data-idx="${cs[0].idx}"` : '';
      return `<div class="c${mix ? ' mix' : ''} pop" style="background:${colour[lane]};animation-delay:${(w * 22 + rowN * 8)}ms" data-tip="${esc(tip)}"${one}${!mini && cs.length > 1 ? ` data-exp="${esc(label)}"` : ''}></div>`;
    }).join('');
    const showH = state.planFilter !== 'flight' || mini, showF = state.planFilter !== 'hotel' || mini;
    if (showH) {
      h += '<div class="sep">Hotels</div>';
      B.DEST.forEach(d => {
        const rows = byKey['D:' + d.id], open = !mini && state.open.has(d.id);
        h += `<div class="rl${mini ? '' : ' click'}${open ? ' open' : ''}" ${mini ? '' : `data-dest="${d.id}"`}>${mini ? '' : '<span class="car">›</span>'}${d.name}</div>` + cellsHtml(rows, d.name); rowN++;
        if (open) world.products.filter(p => p.dest === d && p.kind === 'hotel').forEach(p => { const pr = rows.filter(r => r.cell.prod === p); h += `<div class="rl sub" title="${esc(p.name)}">${esc(p.name.split(' · ')[1])}</div>` + cellsHtml(pr, p.name); rowN++; });
      });
    }
    if (showF) {
      h += '<div class="sep">Flight series from India</div>';
      B.ROUTES.forEach(rt => { h += `<div class="rl">${rt.id}</div>` + cellsHtml(byKey['F:' + rt.id], rt.id + ' series seats'); rowN++; });
    }
    $(sel).innerHTML = h;
  }
  function renderPlan() { renderMap('#planMap', false); }
  $('#planMap').addEventListener('click', e => {
    const rl = e.target.closest('[data-dest]'); if (rl) { const d = rl.dataset.dest; state.open.has(d) ? state.open.delete(d) : state.open.add(d); renderPlan(); return; }
    const c = e.target.closest('.c'); if (!c) return;
    if (c.dataset.idx) openCell(+c.dataset.idx);
    else { const d = B.DEST.find(x => x.name === c.dataset.exp); if (d) { state.open.add(d.id); renderPlan(); toast('Showing ' + d.name + ' hotels. Click a week for details.'); } }
  });

  // ---------- drawer: one product-week ----------
  function openCell(idx) {
    const r = res.plan[idx], c = r.cell, p = c.prod, dm = B.demandFor(world, c, null);
    const D = Array.from(dm.D).sort((a, b) => a - b), q = f => D[Math.floor(f * (D.length - 1))];
    let sell = 0, A = 0; for (let s = 0; s < B.N_SCEN; s++) { if (dm.D[s] > dm.A[s]) sell++; A += dm.A[s]; } A /= B.N_SCEN;
    const pd = p.buyDisc * c.peakAdj, bd = p.blockDisc + c.blockShift, t = B.terms(r), sh = B.SHOCKS[p.region], u = unit(c);
    const why = [
      `<b>Demand forecast:</b> about ${Math.round(q(.5))} ${u} (10-90% of outcomes: ${Math.round(q(.1))} to ${Math.round(q(.9))}).`,
      `<b>Free sale</b> covers about ${Math.round(A)}. This ${p.kind === 'flight' ? 'route' : 'hotel'} sells out in ${Math.round(sell / B.N_SCEN * 100)}% of outcomes.`,
      `<b>Prepay</b> would come ${pct(pd)} below the free-sale cost; an <b>allotment</b> ${bd >= 0 ? pct(bd) + ' below' : pct(-bd) + ' above'} it this week.`,
      r.lane === 'pass' ? '<b>Why Pass:</b> the expected gain does not cover the contract cost and the risk of unsold stock, so this week stays on free sale.'
        : r.H > 0 && r.K > 0 ? `<b>Why Buy + Block:</b> demand reliably clears about ${r.H}, so that base is prepaid for the deeper discount. The uncertain part sits in an allotment that can be handed back on ${t.release}.`
        : r.H > 0 ? `<b>Why Buy:</b> demand reliably clears the ${r.H} ${u} prepaid, and the prepay discount here is worth the risk.`
        : `<b>Why Block:</b> the week is ${c.season > 1.05 ? 'busy, so the fixed allotment rate beats the market' : 'uncertain'}, and an allotment keeps the right to hand back unsold ${u} on ${t.release}.`,
      `<b>${p.region} shock risk:</b> ${Math.round(sh.p * 100)}% chance per quarter that demand falls to ${sh.mult}× of normal. The write-off cap allows for it.`
    ];
    $('#drawerBody').innerHTML = `
      <span class="pill ${r.lane}">${laneName(r)}</span>
      <h2>${esc(p.name)}</h2><p class="meta">Week of ${B.fmt(c.week)} · ${p.region} · market price ${inr(p.price)} per ${p.kind === 'flight' ? 'seat' : 'room-night'}</p>
      <div class="facts">
        <div class="fact"><div class="l">Prepay</div><div class="v">${r.H || '0'} ${u}</div></div>
        <div class="fact"><div class="l">Allotment</div><div class="v">${r.K || '0'} ${u}</div></div>
        <div class="fact"><div class="l">Expected extra gross profit</div><div class="v">${lakh(r.exp)}</div></div>
        <div class="fact"><div class="l">Cash committed</div><div class="v">${lakh(r.capital)}</div></div>
        ${r.lane !== 'pass' ? `<div class="fact"><div class="l">Sign by</div><div class="v">${t.signBy}</div></div><div class="fact"><div class="l">${r.K ? 'Release check' : 'Agent price'}</div><div class="v">${r.K ? t.release : inr(t.price.sell)}</div></div>` : ''}
      </div>
      <h3 style="font-size:15px;margin-top:6px">600 possible weeks of demand</h3>
      <div id="histo"></div>
      <ul class="why">${why.map(w => `<li>${w}</li>`).join('')}</ul>
      ${r.lane !== 'pass' ? `<button class="btn primary" id="draftBtn">Draft the supplier message</button><div id="draftBox"></div>` : ''}`;
    histogram(dm, A, r, u);
    if (r.lane !== 'pass') $('#draftBtn').addEventListener('click', () => showDraft(r));
    openDrawer();
  }
  function histogram(dm, A, r, u) {
    const vals = Array.from(dm.D), max = Math.max(...vals, r.H + r.K) * 1.05, bins = 24, cnt = new Array(bins).fill(0);
    vals.forEach(v => cnt[Math.min(bins - 1, Math.floor(v / max * bins))]++);
    const W = 460, H = 170, m = { l: 8, r: 8, t: 14, b: 26 }, bw = (W - m.l - m.r) / bins, cmax = Math.max(...cnt);
    const x = v => m.l + v / max * (W - m.l - m.r), y = c => H - m.b - c / cmax * (H - m.t - m.b);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="histo" role="img" aria-label="Distribution of 600 demand outcomes">`;
    cnt.forEach((c, i) => { s += `<rect class="bar" x="${m.l + i * bw + 1}" width="${bw - 2}" y="${H - m.b}" height="0" data-y="${y(c)}" data-h="${H - m.b - y(c)}" rx="2" fill="#BFD5F3"/>`; });
    const vline = (v, col, lab, dy, dash) => `<line x1="${x(v)}" x2="${x(v)}" y1="${m.t - 4}" y2="${H - m.b}" stroke="${col}" stroke-width="2" ${dash ? 'stroke-dasharray="4 3"' : ''}/><text x="${x(v) + 4}" y="${m.t + dy}" font-size="11" fill="${col}" font-family="Inter">${lab}</text>`;
    s += vline(A, '#7A8290', 'free sale', 6, true);
    if (r.H) s += vline(r.H, '#B4500F', 'prepaid', 20);
    if (r.K) s += vline(r.H + r.K, '#1658A8', 'held', 34);
    s += `<text x="${m.l}" y="${H - 6}" font-size="11" fill="#7A8290" font-family="Inter">0</text><text x="${W - m.r}" y="${H - 6}" font-size="11" fill="#7A8290" text-anchor="end" font-family="Inter">${Math.round(max)} ${u}</text></svg>`;
    $('#histo').innerHTML = s;
    requestAnimationFrame(() => requestAnimationFrame(() => $$('#histo .bar').forEach((b, i) => { b.style.transitionDelay = (i * 18) + 'ms'; b.setAttribute('y', b.dataset.y); b.setAttribute('height', b.dataset.h); })));
  }
  function draftText(r) {
    const c = r.cell, p = c.prod, t = B.terms(r), fl = p.kind === 'flight', wk = B.fmt(c.week);
    const pd = Math.round(p.buyDisc * c.peakAdj * 100), bd = Math.max(1, Math.round((p.blockDisc + c.blockShift) * 100));
    const who = fl ? `${p.name.replace(' series seats', '')} revenue team` : `${p.name.replace(' · ', ' ')} revenue team`;
    const lines = [`Subject: Summer 2027 ${fl ? 'series seats' : 'rooms'} · week of ${wk}`, '', `Hi ${who},`, ''];
    if (r.K) lines.push(`For the week of ${wk} we’d like to hold ${Math.round(r.K / 7)} ${fl ? 'seats a day' : 'rooms a night'} (${r.K} ${fl ? 'seats' : 'room-nights'}) as an allotment at ${bd}% below our current net rate. We would release any unsold ${fl ? 'seats' : 'rooms'} 14 days before arrival (${t.release}) and can place a 20% deposit on signing.`, '');
    if (r.H) lines.push(`${r.K ? 'Alongside that, we’d' : 'We’d'} like to prepay ${r.H} ${fl ? 'seats' : 'room-nights'} for the same week if you can offer ${pd}% below net, with payment on confirmation.`, '');
    lines.push(`Could we agree terms by ${t.signBy}? Happy to get on a call this week.`, '', 'Thanks,', '[Your name]', 'Contracting, TBO');
    return lines.join('\n');
  }
  function showDraft(r) {
    const txt = draftText(r);
    $('#draftBox').innerHTML = `<div class="draft" id="draftTxt">${esc(txt)}</div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn" id="copyDraft">Copy</button><span class="hint" style="margin:8px 0 0">Drafted from the plan’s numbers. Edit before sending.</span></div>`;
    $('#copyDraft').addEventListener('click', () => { if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => toast('Draft copied'), () => toast('Copy failed: select the text instead')); });
  }
  function openDrawer() { $('#drawer').classList.add('on'); $('#scrim').classList.add('on'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#drawer').scrollTop = 0; }
  function closeDrawer() { $('#drawer').classList.remove('on'); $('#scrim').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true'); }
  $('#drawerClose').addEventListener('click', closeDrawer); $('#scrim').addEventListener('click', closeDrawer);
  addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

  // ---------- contracts ----------
  function contractRows() {
    return res.plan.filter(r => r.lane !== 'pass')
      .filter(r => state.laneFilter === 'all' || (state.laneFilter === 'buy' ? r.H > 0 : r.K > 0))
      .filter(r => !state.search || r.cell.prod.name.toLowerCase().includes(state.search) || r.cell.prod.dest.name.toLowerCase().includes(state.search))
      .sort((a, b) => b.exp - a.exp);
  }
  function renderContracts() {
    const all = contractRows(), list = state.showAll ? all : all.slice(0, 40);
    let h = `<thead><tr><th>Product</th><th>Week of</th><th>Decision</th><th class="num">Prepay</th><th class="num">Allotment</th><th>Per night/day</th><th>Sign by</th><th>Release</th><th class="num">Agent price</th><th class="num">Exp. extra GP</th><th class="num">Cash</th><th></th></tr></thead><tbody>`;
    list.forEach((r, i) => {
      const t = B.terms(r);
      h += `<tr class="fade" style="animation-delay:${Math.min(i, 20) * 18}ms"><td>${esc(r.cell.prod.name)}</td><td>${B.fmt(r.cell.week)}</td><td><span class="pill ${r.lane}">${laneName(r)}</span></td><td class="num">${r.H || '-'}</td><td class="num">${r.K || '-'}</td><td>${t.perNight}</td><td>${t.signBy}</td><td>${t.release}</td><td class="num" data-tip="Market ${inr(t.price.market)}, ${(t.price.cut * 100).toFixed(1)}% below">${inr(t.price.sell)}</td><td class="num">${lakh(r.exp)}</td><td class="num">${lakh(r.capital)}</td><td><button class="btn" data-open="${r.idx}">Details</button></td></tr>`;
    });
    $('#tbl').innerHTML = h + '</tbody>';
    $('#tblNote').innerHTML = `${list.length} of ${all.length} contracts shown${all.length > 40 ? ` · <a href="#" id="toggleAll">${state.showAll ? 'Show top 40' : 'Show all'}</a>` : ''} · quantities are room-nights (hotels) or seats (flights) for the week.`;
    const tg = $('#toggleAll'); if (tg) tg.addEventListener('click', e => { e.preventDefault(); state.showAll = !state.showAll; renderContracts(); });
  }
  $('#tbl').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openCell(+b.dataset.open); });
  function downloadCSV() {
    const head = ['product', 'kind', 'week_of', 'decision', 'prepay_units', 'allotment_units', 'sign_by', 'release', 'agent_price_inr', 'market_price_inr', 'expected_extra_gp_inr', 'cash_inr'];
    const lines = [head.join(',')];
    res.plan.slice().sort((a, b) => b.exp - a.exp).forEach(r => { const t = B.terms(r); lines.push(['"' + r.cell.prod.name + '"', r.cell.prod.kind, B.fmt(r.cell.week), laneName(r), r.H, r.K, t.signBy, t.release, t.price.sell, t.price.market, Math.round(r.exp), Math.round(r.capital)].join(',')); });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `buy-block-pass-${state.budget}cr-${state.risk}.csv`; a.click(); toast('Plan downloaded');
  }

  // ---------- release radar ----------
  function radarCalc(r) {
    const dm = B.demandFor(world, r.cell, null), idx = Array.from(dm.D.keys()).sort((a, b) => dm.D[a] - dm.D[b]);
    const s = idx[Math.floor(0.25 * idx.length)], D = Array.from(dm.D).sort((a, b) => a - b), q = f => D[Math.floor(f * (D.length - 1))];
    const proj = dm.Dh[s], ec = r.cell.prod.econ, keep = Math.min(r.K, Math.max(ec.attritionFloor * r.K, proj - r.H));
    return { med: q(.5), p10: q(.1), p90: q(.9), proj, keep, rel: r.K - keep };
  }
  function renderRadarList() {
    const items = res.plan.filter(r => r.K > 0).sort((a, b) => b.K * b.cell.prod.price - a.K * a.cell.prod.price).slice(0, 24);
    if (!items.length) { $('#radarList').innerHTML = '<p class="hint">No allotments in this plan.</p>'; return; }
    if (state.radar == null || !items.find(r => r.idx === state.radar)) state.radar = items[0].idx;
    $('#radarList').innerHTML = items.map(r => { const k = radarCalc(r), give = k.rel > 0.5; return `<div class="ritem${r.idx === state.radar ? ' on' : ''}" data-r="${r.idx}"><span class="nm">${esc(r.cell.prod.name)}</span><span class="status ${give ? 'give' : 'keep'}">${give ? 'Hand back ' + Math.round(k.rel) : 'Keep all'}</span><span class="wk">Week of ${B.fmt(r.cell.week)} · ${r.K} ${unit(r.cell)} held</span></div>`; }).join('');
    renderRadar();
  }
  $('#radarList').addEventListener('click', e => { const it = e.target.closest('[data-r]'); if (!it) return; state.radar = +it.dataset.r; $$('#radarList .ritem').forEach(x => x.classList.toggle('on', x === it)); renderRadar(); });
  function renderRadar() {
    const r = res.plan[state.radar], k = radarCalc(r), u = unit(r.cell);
    $('#radarTitle').textContent = `${r.cell.prod.name} · week of ${B.fmt(r.cell.week)}`;
    const W = 760, H = 320, m = { l: 48, r: 18, t: 18, b: 34 }, ymax = Math.max(k.p90, r.H + r.K) * 1.1;
    const x = t => m.l + (90 - t) / 90 * (W - m.l - m.r), y = v => H - m.b - v / ymax * (H - m.t - m.b);
    const days = []; for (let t = 90; t >= 0; t -= 2) days.push(t);
    const path = (f, a, b) => days.filter(t => t <= a && t >= b).map((t, i) => (i ? 'L' : 'M') + x(t).toFixed(1) + ',' + y(f(t)).toFixed(1)).join('');
    const band = days.map(t => `${x(t)},${y(k.p90 * B.bookedShare(t))}`).join(' ') + ' ' + days.slice().reverse().map(t => `${x(t)},${y(k.p10 * B.bookedShare(t))}`).join(' ');
    const ticks = [0, .25, .5, .75, 1].map(f => Math.round(ymax * f / 10) * 10), rel = B.fmt(B.addDays(r.cell.week, -B.LEAD.release));
    const giving = k.rel > .5;
    $('#radarChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Pickup versus forecast for the selected allotment">
      ${ticks.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="#EEF0F3"/><text x="${m.l - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#7A8290" font-family="Inter">${v}</text>`).join('')}
      ${[90, 60, 30, 14, 0].map(t => `<text x="${x(t)}" y="${H - 10}" font-size="11" text-anchor="middle" fill="#7A8290" font-family="Inter">${t ? 'T-' + t : 'Arrival'}</text>`).join('')}
      <polygon points="${band}" fill="#237AE3" opacity=".1"/>
      <path d="${path(t => k.med * B.bookedShare(t), 90, 0)}" fill="none" stroke="#237AE3" stroke-width="2" stroke-dasharray="5 4"/>
      <line x1="${m.l}" x2="${W - m.r}" y1="${y(r.H + r.K)}" y2="${y(r.H + r.K)}" stroke="#14181F" stroke-dasharray="2 4"/><text x="${W - m.r}" y="${y(r.H + r.K) - 5}" font-size="11" text-anchor="end" fill="#4A5260" font-family="Inter">held: ${r.H + r.K}</text>
      ${giving ? `<line x1="${m.l}" x2="${W - m.r}" y1="${y(k.keep + r.H)}" y2="${y(k.keep + r.H)}" stroke="#12805C" stroke-dasharray="2 4"/><text x="${m.l + 6}" y="${y(k.keep + r.H) - 5}" font-size="11" fill="#12805C" font-family="Inter">keep: ${Math.round(k.keep + r.H)}</text>` : ''}
      <path class="drawpath" id="actPath" d="${path(t => k.proj * B.bookedShare(t) * (1 + 0.025 * Math.sin(t / 3.1)), 90, 14)}" fill="none" stroke="#14181F" stroke-width="2.5" stroke-linecap="round"/>
      <path d="${path(t => k.proj * B.bookedShare(t), 14, 0)}" fill="none" stroke="#14181F" stroke-width="1.5" stroke-dasharray="1 4"/>
      <line x1="${x(14)}" x2="${x(14)}" y1="${m.t}" y2="${H - m.b}" stroke="#ED691F" stroke-width="1.5"/><text x="${x(14) - 6}" y="${m.t + 10}" font-size="11" text-anchor="end" fill="#B4500F" font-family="Inter">release check · ${rel}</text>
    </svg><div class="legend" style="margin:6px 0 0"><span><i style="background:#14181F;height:3px"></i>Booked so far (one simulated season)</span><span><i style="background:#237AE3;height:3px"></i>Forecast with 10-90% band</span></div>`;
    const p = $('#actPath'), L = p.getTotalLength(); p.style.strokeDasharray = L; p.style.strokeDashoffset = L; requestAnimationFrame(() => requestAnimationFrame(() => { p.style.strokeDashoffset = 0; }));
    $('#radarNote').innerHTML = `Pickup is running <b>${k.proj < k.med ? 'below' : 'above'} forecast</b>: on track for ${Math.round(k.proj)} ${u} against ${Math.round(k.med)} expected. ` + (giving ? `Keep <b>${Math.round(k.keep)}</b> of the ${r.K} allotment ${u} and <b>hand back ${Math.round(k.rel)}</b> on ${rel}.` : `Keep all ${r.K} allotment ${u}.`) + ' Kept units become payable; released ones cost nothing.';
  }

  // ---------- stress lab ----------
  function renderStress() {
    const g = state.shock, s = stress[g], sh = B.SHOCKS[g];
    $('#stressTitle').textContent = `If ${sh.label} hits`;
    $('#stressHint').textContent = `Every scenario gets the shock: ${g} demand falls to ${sh.mult}× of normal. In an ordinary quarter the chance is ${Math.round(sh.p * 100)}%.`;
    $('#stressBars').innerHTML = bars([
      { m: 'Expected extra gross profit, normal quarter', a: res.expProfit, b: nv.expProfit, fmt: cr, note: 'higher is better' },
      { m: 'Expected extra gross profit, shock quarter', a: s.e.expProfit, b: s.n.expProfit, fmt: cr, note: 'higher is better' },
      { m: 'Worst 5% of shock quarters', a: s.e.p5, b: s.n.p5, fmt: cr, note: 'higher is better' },
      { m: 'Write-off at risk in a shock quarter', a: s.e.wo95, b: s.n.wo95, fmt: cr, note: 'lower is better' }
    ], ['Buy, Block or Pass', 'Pre-buy hottest weeks']);
    animateBars($('#stressBars'));
    const regions = ['Gulf', 'APAC', 'Europe'], capBy = x => { const o = { Gulf: 0, APAC: 0, Europe: 0 }; x.plan.forEach(r => { o[r.cell.prod.region] += r.capital; }); return o; };
    const ce = capBy(res), cn = capBy(nv), mx = Math.max(...regions.map(k => Math.max(ce[k], cn[k]))) || 1;
    const nTot = regions.reduce((t, k) => t + cn[k], 0) || 1, eTot = regions.reduce((t, k) => t + ce[k], 0) || 1;
    const topN = regions.slice().sort((a, b) => cn[b] - cn[a])[0];
    $('#regionHint').textContent = `Cash each plan commits per region. The naive plan puts ${Math.round(cn[topN] / nTot * 100)}% of its cash into ${topN}, against ${Math.round(ce[topN] / eTot * 100)}% for ours.`;
    $('#regionBars').innerHTML = regions.map(k => `<div class="regrow"><b>${k}</b><div class="regbars"><div class="regbar" style="width:0;background:#14181F" data-w="${ce[k] / mx * 80}"><span>${cr1(ce[k])}</span></div><div class="regbar" style="width:0;background:#9AA3AE" data-w="${cn[k] / mx * 80}"><span>${cr1(cn[k])}</span></div></div></div>`).join('') + '<div class="legend" style="margin-top:12px"><span><i style="background:#14181F"></i>Buy, Block or Pass</span><span><i style="background:#9AA3AE"></i>Pre-buy hottest weeks</span></div>';
    requestAnimationFrame(() => requestAnimationFrame(() => $$('#regionBars .regbar').forEach((b, i) => { b.style.transitionDelay = (i * 60) + 'ms'; b.style.width = b.dataset.w + '%'; })));
  }

  // ---------- method ----------
  function renderMethod() {
    if ($('#assume').children.length) return;
    const rows = [
      ['Data', 'Fully synthetic: 600 product-weeks, 600 scenarios each, fixed random seed', 'No TBO data. Built to show the method, not to forecast TBO’s results.'],
      ['Free-sale margin', '8% hotels, 1.2% air', 'Hotel take rates of about 8% in TBO’s Q1 FY27 shareholder letter; air gross profit guided at 1-1.2% on the Q2 FY27 call.'],
      ['Prepay discount', '10-18% hotels, 8-14% series seats, smaller in peak weeks', 'Public ranges for hard allotments (10-25% below rack). Hotels discount least on dates they expect to fill.'],
      ['Allotment rate', '4-8% below free sale, ±5 points with season', 'The contracted rate is fixed; free-sale prices rise in peak weeks and fall in low season.'],
      ['Release and attrition', 'Release at T-14; keep at least 30% (hotels) or 40% (seats)', 'Common release structures are 30/21/14/7 days; attrition clauses vary.'],
      ['Unsold prepaid stock', '30% recovered (hotels), 15% (seats)', 'Assumption.'],
      ['Saving passed to agents', '60%', 'Own stock has to undercut other wholesalers selling the same hotel.'],
      ['Sold-out demand', 'Half books an alternative on TBO anyway', 'Assumption. Only the truly lost half counts as upside.'],
      ['Shocks per quarter', 'Europe 15% (×0.50), Gulf 12% (×0.55), APAC 6% (×0.75)', 'Set to echo the October 2026 Saudi and Europe cancellations TBO reported.'],
      ['Contract cost', '₹15k per hotel-week, ₹40k per route-week', 'Contracting, loading and reconciliation.'],
      ['Cash budget', 'Prepayments plus a 20% deposit on allotments', 'An allotment’s real cost is attrition risk, which the write-off cap controls.']
    ];
    $('#assume').innerHTML = '<thead><tr><th>Item</th><th>Value used</th><th>Basis</th></tr></thead><tbody>' + rows.map(r => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('') + '</tbody>';
  }

  // ---------- tooltip ----------
  const tip = $('#tip');
  document.addEventListener('mousemove', e => {
    const el = e.target.closest('[data-tip]'); if (!el) { tip.style.opacity = 0; return; }
    tip.innerHTML = el.getAttribute('data-tip'); const w = tip.offsetWidth, h = tip.offsetHeight;
    let lx = e.clientX + 14, ly = e.clientY + 14; if (lx + w > innerWidth - 8) lx = e.clientX - w - 14; if (ly + h > innerHeight - 8) ly = e.clientY - h - 14;
    tip.style.left = lx + 'px'; tip.style.top = ly + 'px'; tip.style.opacity = 1;
  });

  // start
  const hv = location.hash.slice(1); if (['overview', 'plan', 'contracts', 'radar', 'stress', 'method'].includes(hv)) show(hv);
  run();
})();
