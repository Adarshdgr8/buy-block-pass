/* UI for the Buy, Block or Pass prototype. All numbers come from engine.js. */
(function () {
  'use strict';
  const B = window.BBP;
  const $ = id => document.getElementById(id);
  const world = B.buildWorld(42);
  const state = { budget: 50, risk: 'balanced', stress: '', showAll: false };
  let res = null, nv = null, stressRes = null, stressNv = null;
  const naiveCache = {};

  // ---------- formatting ----------
  const cr = x => (x < 0 ? '−' : '') + '₹' + Math.abs(x / 1e7).toFixed(2) + ' Cr';
  const lakh = x => (x < 0 ? '−' : '') + '₹' + Math.abs(x / 1e5).toFixed(1) + ' L';
  const inr = x => '₹' + Math.round(x).toLocaleString('en-IN');
  const k = x => x >= 1000 ? (x / 1000).toFixed(1) + 'k' : Math.round(x).toString();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const laneName = r => r.H > 0 && r.K > 0 ? 'Buy + Block' : r.lane === 'buy' ? 'Buy' : r.lane === 'block' ? 'Block' : 'Pass';
  const unit = r => r.cell.prod.kind === 'flight' ? 'seats' : 'room-nights';

  // ---------- controls ----------
  $('budget').addEventListener('input', e => { state.budget = +e.target.value; $('budgetOut').textContent = '₹' + state.budget + ' Cr'; });
  $('budget').addEventListener('change', run);
  function seg(id, key) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      [...$(id).querySelectorAll('button')].forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      state[key] = b.dataset.v; key === 'stress' ? renderStressOnly() : run();
    });
  }
  seg('risk', 'risk'); seg('stress', 'stress');
  $('toggleAll').addEventListener('click', () => { state.showAll = !state.showAll; $('toggleAll').textContent = state.showAll ? 'Show top 15' : 'Show all rows'; renderTable(); });
  $('csv').addEventListener('click', downloadCSV);
  $('radarSel').addEventListener('change', renderRadar);

  // ---------- run ----------
  function run() {
    $('status').textContent = 'Running 600 scenarios for 600 product-weeks…';
    document.querySelector('main').classList.add('busy');
    setTimeout(() => {
      const t0 = performance.now();
      res = B.optimise(world, state.budget * 1e7, state.risk);
      nv = naiveCache[state.budget] || (naiveCache[state.budget] = B.naive(world, state.budget * 1e7));
      computeStress();
      renderAll();
      document.querySelector('main').classList.remove('busy');
      $('status').textContent = 'Plan solved in ' + Math.round(performance.now() - t0) + ' ms on this device.';
    }, 30);
  }
  function computeStress() {
    stressRes = state.stress ? B.stressTest(world, res, state.stress) : null;
    stressNv = state.stress ? B.stressTest(world, nv, state.stress) : null;
  }
  function renderStressOnly() { if (!res) return; computeStress(); renderKPIs(); renderCompare(); }
  function renderAll() { renderKPIs(); renderCompare(); renderSplit(); renderMap(); renderTable(); fillRadar(); renderSignals(); }

  // ---------- KPIs ----------
  function renderKPIs() {
    const s = stressRes, label = state.stress ? B.SHOCKS[state.stress].label : '';
    const exp = s ? s.expProfit : res.expProfit, p5 = s ? s.p5 : res.p5, wo = s ? s.wo95 : res.wo95;
    const unused = res.budget - res.capital;
    const tiles = [
      { lab: 'Expected extra gross profit', val: cr(exp), neg: exp < 0,
        sub: s ? 'if ' + label + ' hits (normally ' + cr(res.expProfit) + ')' : 'vs staying on free sale, this quarter' },
      { lab: 'Cash committed', val: cr(res.capital),
        sub: unused > 0.5e7 ? 'of ' + cr(res.budget) + '. More spend did not pay, so it stopped' : 'of ' + cr(res.budget) + ' (prepay + allotment deposits)' },
      { lab: 'Bad quarter (1 in 20)', val: cr(p5), neg: p5 < 0,
        sub: s ? 'extra gross profit, ' + label : 'extra gross profit in the worst 5% of scenarios' },
      { lab: 'Write-off at risk (1 in 20)', val: cr(wo), neg: wo > res.woLimit,
        sub: 'cap ' + cr(res.woLimit) + ' (' + Math.round(B.RISK[state.risk] * 100) + '% of budget)' },
      { lab: 'Sold-out demand recovered', val: Math.round(res.recovered * 100) + '%',
        sub: k(res.extraUnits) + ' extra room-nights and seats sold' }
    ];
    $('kpis').innerHTML = tiles.map(t => `<div class="kpi"><div class="lab">${t.lab}</div><div class="val${t.neg ? ' neg' : ''}">${t.val}</div><div class="sub">${t.sub}</div></div>`).join('');
  }

  // ---------- comparison ----------
  // Each metric is its own small bar chart with its own zero line (no shared scale across metrics).
  function renderCompare() {
    const groups = [
      { m: 'Expected extra gross profit', a: res.expProfit, b: nv.expProfit, note: 'higher is better' },
      { m: 'Bad quarter (1 in 20)', a: res.p5, b: nv.p5, note: 'higher is better' },
      { m: 'Write-off at risk (1 in 20)', a: res.wo95, b: nv.wo95, note: 'lower is better' }
    ];
    if (state.stress) groups.splice(1, 0, { m: 'Expected if ' + B.SHOCKS[state.stress].label + ' hits', a: stressRes.expProfit, b: stressNv.expProfit, note: 'higher is better' });
    const block = g => {
      const lo = Math.min(0, g.a, g.b), hi = Math.max(0, g.a, g.b), span = (hi - lo) || 1;
      const padL = lo < 0 ? 24 : 2, padR = hi > 0 ? 22 : 2;
      const X = v => padL + ((v - lo) / span) * (100 - padL - padR);
      const row = (who, v, col) => {
        const x0 = X(0), x1 = X(v), left = Math.min(x0, x1), w = Math.abs(x1 - x0);
        const labPos = v >= 0 ? `left:calc(${x1}% + 6px)` : `left:calc(${x1}% - 6px);transform:translateX(-100%)`;
        return `<div class="cmp-row"><div class="who">${who}</div><div class="bar-track" data-tip="<b>${esc(who)}</b><br>${esc(g.m)}: ${cr(v)}">
          <div class="bar-zero" style="left:${x0}%"></div>
          <div class="bar" style="left:${left}%;width:${Math.max(w, 0.4)}%;background:${col}"></div>
          <div class="bar-lab" style="${labPos}">${cr(v)}</div></div></div>`;
      };
      return `<div class="cmp-metric">${g.m} <span style="font-weight:400;color:var(--ink-3)">· ${g.note}</span></div>`
        + row('Buy, Block or Pass', g.a, 'var(--ink)') + row('Pre-buy hottest weeks', g.b, '#9AA3AE');
    };
    $('compare').innerHTML = groups.map(block).join('');
  }

  // ---------- split + insights ----------
  function renderSplit() {
    const L = res.lanes, tot = L.buy.cap + L.block.cap || 1;
    $('split').innerHTML = `<div class="lanesplit" role="img" aria-label="Cash split: Buy ${Math.round(L.buy.cap / tot * 100)}%, Block ${Math.round(L.block.cap / tot * 100)}%">
        <div class="lane-buy" style="width:${L.buy.cap / tot * 100}%"></div><div class="lane-block" style="width:${L.block.cap / tot * 100}%"></div></div>
      <div class="split-lab"><span><i class="lane-buy" style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px"></i>Buy ${cr(L.buy.cap)} · ${L.buy.n} product-weeks</span>
      <span><i class="lane-block" style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px"></i>Block ${cr(L.block.cap)} cash (deposits) · ${L.block.n}</span>
      <span>Pass · ${L.pass.n}</span></div>`;

    // per-destination lane shares (hotels only)
    const byD = {};
    res.plan.filter(r => r.cell.prod.kind === 'hotel').forEach(r => {
      const d = r.cell.prod.dest; const o = byD[d.id] || (byD[d.id] = { d, n: 0, buy: 0, block: 0, pass: 0 });
      o.n++; o[r.lane]++;
    });
    const arr = Object.values(byD);
    const avgSeason = d => d.season.reduce((a, b) => a + b, 0) / d.season.length;
    const top = lane => arr.slice().sort((a, b) => b[lane] / b.n - a[lane] / a.n)[0];
    const tb = top('buy'), tk = top('block'), tp = top('pass');
    const why = {
      buy: d => avgSeason(d) < 0.95 ? 'Low season, so hotels give the deepest prepay discounts' : 'Steady demand that reliably sells through',
      block: d => (d.region === 'Europe' || d.vol > 0.33) ? 'Strong demand but shock-prone, so keep the right to hand rooms back' : avgSeason(d) > 1.1 ? 'Peak weeks where the fixed allotment rate beats the market' : 'Demand swings week to week',
      pass: d => avgSeason(d) < 0.6 ? 'Demand largely disappears during the Umrah pause around Hajj' : 'Too little upside to cover contract cost and risk'
    };
    const line = (cls, title, o, lane) => o && o[lane] > 0 ? `<div style="display:flex;gap:10px;align-items:flex-start;margin:8px 0">
        <span class="pill ${cls}" style="min-width:52px;text-align:center">${title}</span>
        <span style="font-size:13px;color:var(--ink-2)"><b style="color:var(--ink)">${o.d.name}</b> · ${Math.round(o[lane] / o.n * 100)}% of hotel-weeks. ${why[lane](o.d)}.</span></div>` : '';
    $('insights').innerHTML = line('buy', 'Buy', tb, 'buy') + line('block', 'Block', tk, 'block') + line('pass', 'Pass', tp, 'pass');
  }

  // ---------- plan map ----------
  function renderMap() {
    const weeks = B.WEEKS.map(B.fmt);
    let h = '<div></div>' + weeks.map((w, i) => `<div class="hd">${i % 2 === 0 ? w : ''}</div>`).join('');
    const colour = { buy: 'var(--orange)', block: 'var(--blue)', pass: 'var(--pass)' };
    const groups = {};
    res.plan.forEach(r => {
      const key = r.cell.prod.kind === 'hotel' ? 'H:' + r.cell.prod.dest.name : 'F:' + r.cell.prod.id;
      (groups[key] = groups[key] || Array.from({ length: 12 }, () => []))[r.cell.w].push(r);
    });
    const rowsH = Object.keys(groups).filter(x => x[0] === 'H'), rowsF = Object.keys(groups).filter(x => x[0] === 'F');
    const rowHtml = key => {
      let s = `<div class="rl" title="${esc(key.slice(2))}">${esc(key.slice(2))}</div>`;
      groups[key].forEach((cells, w) => {
        const cnt = { buy: 0, block: 0, pass: 0 }; let mix = false, exp = 0;
        cells.forEach(r => { cnt[r.lane]++; if (r.H > 0 && r.K > 0) mix = true; exp += r.exp; });
        const lane = cnt.buy >= cnt.block && cnt.buy >= cnt.pass && cnt.buy > 0 ? 'buy' : cnt.block >= cnt.pass && cnt.block > 0 ? 'block' : 'pass';
        if (cnt.buy > 0 && cnt.block > 0) mix = true;
        const tip = `<b>${esc(key.slice(2))} · week of ${weeks[w]}</b><br>` + cells.map(r =>
          `${esc(r.cell.prod.kind === 'hotel' ? r.cell.prod.name.split(' · ')[1] : 'Series seats')}: ${laneName(r)}${r.H ? ' · prepay ' + r.H : ''}${r.K ? ' · allot ' + r.K : ''}`).join('<br>')
          + `<br>Expected extra GP: ${lakh(exp)}`;
        s += `<div class="c${mix ? ' mix' : ''}" style="background:${colour[lane]}" data-tip="${esc(tip)}"></div>`;
      });
      return s;
    };
    h += '<div class="sep">Hotels (4 per destination)</div>' + rowsH.map(rowHtml).join('');
    h += '<div class="sep">Flight series from India</div>' + rowsF.map(rowHtml).join('');
    $('map').innerHTML = h;
  }

  // ---------- table ----------
  function rows() { return res.plan.filter(r => r.lane !== 'pass').sort((a, b) => b.exp - a.exp); }
  function renderTable() {
    const all = rows(), list = state.showAll ? all : all.slice(0, 15);
    let h = `<thead><tr><th>Product</th><th>Week of</th><th>Decision</th><th class="num">Prepay</th><th class="num">Allotment</th><th>Per night/day</th><th>Sign by</th><th>Release by</th><th class="num">Agent price</th><th class="num">Exp. extra GP</th><th class="num">Cash</th></tr></thead><tbody>`;
    list.forEach(r => {
      const t = B.terms(r), cls = r.lane;
      h += `<tr><td>${esc(r.cell.prod.name)}</td><td>${B.fmt(r.cell.week)}</td><td><span class="pill ${cls}">${laneName(r)}</span></td>
        <td class="num">${r.H || '-'}</td><td class="num">${r.K || '-'}</td><td>${t.perNight}</td><td>${t.signBy}</td><td>${t.release}</td>
        <td class="num" data-tip="Market ${inr(t.price.market)}, ${(t.price.cut * 100).toFixed(1)}% below">${inr(t.price.sell)}</td>
        <td class="num">${lakh(r.exp)}</td><td class="num">${lakh(r.capital)}</td></tr>`;
    });
    h += `</tbody><caption style="caption-side:bottom;text-align:left;font-size:12px;color:var(--ink-3);padding-top:8px">${list.length} of ${all.length} active product-weeks shown · ${res.lanes.pass.n} product-weeks on Pass · quantities in room-nights (hotels) or seats (flights) for the week</caption>`;
    $('tbl').innerHTML = h;
  }
  function downloadCSV() {
    const head = ['product', 'kind', 'week_of', 'decision', 'prepay_units', 'allotment_units', 'sign_by', 'release_by', 'agent_price_inr', 'market_price_inr', 'expected_extra_gp_inr', 'cash_inr'];
    const lines = [head.join(',')];
    res.plan.slice().sort((a, b) => b.exp - a.exp).forEach(r => {
      const t = B.terms(r);
      lines.push(['"' + r.cell.prod.name + '"', r.cell.prod.kind, B.fmt(r.cell.week), laneName(r), r.H, r.K, t.signBy, t.release, t.price.sell, t.price.market, Math.round(r.exp), Math.round(r.capital)].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'buy-block-pass-plan-' + state.budget + 'cr-' + state.risk + '.csv'; a.click();
  }

  // ---------- release radar ----------
  function fillRadar() {
    const opts = res.plan.filter(r => r.K > 0).sort((a, b) => b.K * b.cell.prod.price - a.K * a.cell.prod.price).slice(0, 25);
    $('radarSel').innerHTML = opts.map(r => `<option value="${r.cell.idx}">${esc(r.cell.prod.name)} · week of ${B.fmt(r.cell.week)} · ${r.K} ${unit(r)} held</option>`).join('');
    renderRadar();
  }
  function renderRadar() {
    const idx = +$('radarSel').value, r = res.plan[idx];
    if (!r) { $('radar').innerHTML = '<p class="hint">No allotments in this plan.</p>'; $('radarNote').textContent = ''; return; }
    const dm = B.demandFor(world, r.cell, null);
    const sortedIdx = Array.from(dm.D.keys()).sort((a, b) => dm.D[a] - dm.D[b]);
    const s = sortedIdx[Math.floor(0.25 * sortedIdx.length)]; // a softer-than-expected scenario
    const Ds = Array.from(dm.D).sort((a, b) => a - b);
    const q = p => Ds[Math.floor(p * (Ds.length - 1))];
    const med = q(0.5), p10 = q(0.1), p90 = q(0.9), proj = dm.Dh[s];
    const ec = r.cell.prod.econ, keep = Math.min(r.K, Math.max(ec.attritionFloor * r.K, proj - r.H)), rel = r.K - keep;
    const W = 520, H = 220, m = { l: 44, r: 14, t: 12, b: 30 };
    const ymax = Math.max(p90, r.H + r.K) * 1.08;
    const x = t => m.l + (90 - t) / 90 * (W - m.l - m.r), y = v => H - m.b - v / ymax * (H - m.t - m.b);
    const days = []; for (let t = 90; t >= 0; t -= 2) days.push(t);
    const path = (f, from, to) => days.filter(t => t <= from && t >= to).map((t, i) => (i ? 'L' : 'M') + x(t).toFixed(1) + ',' + y(f(t)).toFixed(1)).join('');
    const band = days.map(t => x(t).toFixed(1) + ',' + y(p90 * B.bookedShare(t)).toFixed(1)).join(' ') + ' ' + days.slice().reverse().map(t => x(t).toFixed(1) + ',' + y(p10 * B.bookedShare(t)).toFixed(1)).join(' ');
    const actual = t => proj * B.bookedShare(t) * (1 + 0.025 * Math.sin(t / 3.1) * (t > 14 ? 1 : 0));
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(ymax * f / 10) * 10);
    const relDate = B.fmt(B.addDays(r.cell.week, -B.LEAD.release));
    $('radar').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Booking pickup versus forecast for the selected allotment">
      ${ticks.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="#EEF0F3"/><text x="${m.l - 6}" y="${y(v) + 4}" font-size="10" text-anchor="end" fill="#7A8290">${v}</text>`).join('')}
      ${[90, 60, 30, 14, 0].map(t => `<text x="${x(t)}" y="${H - 10}" font-size="10" text-anchor="middle" fill="#7A8290">${t === 0 ? 'arrival' : 'T-' + t}</text>`).join('')}
      <polygon points="${band}" fill="#237AE3" opacity="0.10"/>
      <path d="${path(t => med * B.bookedShare(t), 90, 0)}" fill="none" stroke="#237AE3" stroke-width="2" stroke-dasharray="4 3"/>
      <line x1="${m.l}" x2="${W - m.r}" y1="${y(r.H + r.K)}" y2="${y(r.H + r.K)}" stroke="#14181F" stroke-width="1" stroke-dasharray="2 3"/>
      <text x="${W - m.r}" y="${y(r.H + r.K) - 4}" font-size="10" text-anchor="end" fill="#4A5260">held: ${r.H + r.K}</text>
      ${r.H > 0 ? `<line x1="${m.l}" x2="${W - m.r}" y1="${y(r.H)}" y2="${y(r.H)}" stroke="#ED691F" stroke-width="1" stroke-dasharray="2 3"/><text x="${W - m.r}" y="${y(r.H) - 4}" font-size="10" text-anchor="end" fill="#9A3F0B">prepaid: ${r.H}</text>` : ''}
      <path d="${path(actual, 90, 14)}" fill="none" stroke="#14181F" stroke-width="2"/>
      <path d="${path(t => proj * B.bookedShare(t), 14, 0)}" fill="none" stroke="#14181F" stroke-width="1.5" stroke-dasharray="1 3"/>
      <line x1="${x(14)}" x2="${x(14)}" y1="${m.t}" y2="${H - m.b}" stroke="#ED691F" stroke-width="1.5"/>
      <circle cx="${x(14)}" cy="${y(actual(14))}" r="4" fill="#14181F" stroke="#fff" stroke-width="2"/>
      <text x="${x(14) - 6}" y="${m.t + 10}" font-size="10" text-anchor="end" fill="#9A3F0B">release check · ${relDate}</text>
    </svg>
    <div class="legend" style="margin:4px 0 0"><span><i style="background:#14181F;height:2px;width:14px"></i>Booked so far (one simulated season)</span><span><i style="background:#237AE3;height:2px;width:14px"></i>Forecast, with 10-90% band</span></div>`;
    const below = proj < med;
    $('radarNote').innerHTML = `Pickup is running <b>${below ? 'below' : 'above'} forecast</b>: on track for ${Math.round(proj)} ${unit(r)} vs ${Math.round(med)} expected.
      ${rel > 0.5 ? `Keep <b>${Math.round(keep)}</b> of ${r.K} allotment ${unit(r)} and <b>hand back ${Math.round(rel)}</b> on ${relDate}.` : `Keep all ${r.K} allotment ${unit(r)}.`}
      Kept units become payable; released ones cost nothing.`;
  }

  // ---------- signals ----------
  function renderSignals() {
    const src = ['TBO bookings and cancellations', 'Searches and sold-out searches', 'Look-to-book by market', 'Event calendars', 'Visa and airfare changes', 'Risk and news alerts'];
    $('signals').innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${src.map(s => `<span style="font-size:12px;border:1px solid var(--line);border-radius:999px;padding:3px 9px;color:var(--ink-2)">${s}</span>`).join('')}</div>
      <table><tbody>${B.DEST.map(d => `<tr><td style="font-weight:600;width:90px">${d.name}</td><td style="white-space:normal;color:var(--ink-2)">${d.signals.join(' · ')}</td></tr>`).join('')}</tbody></table>`;
  }

  // ---------- tooltip ----------
  const tip = $('tip');
  document.addEventListener('mousemove', e => {
    const el = e.target.closest('[data-tip]');
    if (!el) { tip.style.opacity = 0; return; }
    tip.innerHTML = el.getAttribute('data-tip');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let lx = e.clientX + 14, ly = e.clientY + 14;
    if (lx + w > innerWidth - 8) lx = e.clientX - w - 14;
    if (ly + h > innerHeight - 8) ly = e.clientY - h - 14;
    tip.style.left = lx + 'px'; tip.style.top = ly + 'px'; tip.style.opacity = 1;
  });

  run();
})();
