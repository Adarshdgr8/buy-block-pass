/*
 * Buy, Block or Pass: inventory decision engine (prototype)
 * Team: Bhumi Khandelwal, Astha Singh, Adarsh Singh: IIM Lucknow
 *
 * Everything here runs on SYNTHETIC data. Ranges are set from public figures
 * (allotment discounts, release periods, B2B hotel take rates), not TBO's data.
 *
 * Decision per product-week ("cell"):
 *   BUY  : prepay rooms / series seats. Deepest discount, you own unsold units.
 *   BLOCK: allotment with a release date. Smaller discount; at T-14 you keep what
 *           you expect to sell and hand the rest back (an attrition floor applies).
 *   PASS : stay on free sale. No risk, normal margin, but you lose the demand
 *           that arrives when the hotel or fare is sold out.
 *
 * Method: sample-average approximation. 600 demand scenarios per cell, with
 * regional shocks shared across cells (so a Europe shock hits every European
 * cell at once). A greedy allocator adds inventory in small steps, always taking
 * the step with the best expected profit per rupee of capital at risk, and refuses
 * any step that pushes the portfolio's 1-in-20 bad-season result below the risk limit.
 */
(function (root) {
  'use strict';

  // ---------- seeded RNG ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ---------- calendar: 12 weeks, Summer 2027 = Q1 FY28 (Apr-Jun 2027) ----------
  const WEEKS = [];
  (function () {
    const start = Date.UTC(2027, 3, 5); // Mon 5 Apr 2027
    for (let i = 0; i < 12; i++) WEEKS.push(new Date(start + i * 7 * 864e5));
  })();
  const fmt = d => d.toUTCString().slice(5, 11).trim(); // "04 Jan"
  const addDays = (d, n) => new Date(d.getTime() + n * 864e5);

  // ---------- markets ----------
  // season: weekly demand index (1 = normal), from events in the window (dates approximate):
  // Songkran 13-15 Apr, Eid al-Adha ~16 May, Umrah pause around Hajj (late Apr-mid Jun, assumed),
  // Indian school holidays mid-May to June, European summer peak, Maldives/Phuket monsoon low season.
  const DEST = [
    { id: 'DXB', name: 'Dubai',     region: 'Gulf',   adr: 12000, base: 380, vol: 0.30,
      season: [1.00, 0.95, 0.90, 0.90, 0.95, 1.05, 1.15, 1.05, 1.00, 1.05, 1.05, 1.00],
      signals: ['Eid al-Adha ~16 May', 'Indian school holidays from mid-May', 'Summer heat caps peak'] },
    { id: 'MKH', name: 'Makkah',    region: 'Gulf',   adr: 11000, base: 300, vol: 0.30,
      season: [0.90, 0.80, 0.60, 0.35, 0.25, 0.20, 0.20, 0.20, 0.25, 0.35, 0.60, 0.85],
      signals: ['Umrah pause around Hajj (assumed late Apr-mid Jun)', 'Demand returns late June'] },
    { id: 'BKK', name: 'Bangkok',   region: 'APAC',   adr: 6500,  base: 420, vol: 0.27,
      season: [1.00, 1.30, 1.00, 0.95, 1.00, 1.05, 1.15, 1.15, 1.15, 1.10, 1.05, 1.00],
      signals: ['Songkran 13-15 Apr', 'Indian school holidays', 'Visa-free entry assumed in force'] },
    { id: 'HKT', name: 'Phuket',    region: 'APAC',   adr: 9000,  base: 260, vol: 0.30,
      season: [1.10, 1.20, 1.00, 0.95, 0.85, 0.80, 0.85, 0.85, 0.80, 0.80, 0.75, 0.75],
      signals: ['Monsoon from May', 'Charter capacity from Mumbai'] },
    { id: 'DPS', name: 'Bali',      region: 'APAC',   adr: 9500,  base: 280, vol: 0.32,
      season: [0.95, 0.95, 1.00, 1.00, 1.05, 1.15, 1.25, 1.30, 1.30, 1.30, 1.30, 1.25],
      signals: ['Dry season begins', 'Honeymoon + family holidays'] },
    { id: 'SIN', name: 'Singapore', region: 'APAC',   adr: 15000, base: 300, vol: 0.24,
      season: [0.95, 0.95, 1.00, 1.00, 1.05, 1.10, 1.20, 1.25, 1.30, 1.30, 1.25, 1.20],
      signals: ['Indian school holidays', 'Cruise departures'] },
    { id: 'MLE', name: 'Maldives',  region: 'APAC',   adr: 28000, base: 150, vol: 0.30,
      season: [1.00, 0.95, 0.90, 0.85, 0.80, 0.75, 0.75, 0.70, 0.70, 0.70, 0.70, 0.70],
      signals: ['South-west monsoon low season', 'Deep resort discounts likely'] },
    { id: 'LHR', name: 'London',    region: 'Europe', adr: 19000, base: 240, vol: 0.36,
      season: [0.95, 1.00, 1.00, 1.05, 1.10, 1.15, 1.20, 1.25, 1.30, 1.35, 1.35, 1.40],
      signals: ['Summer peak builds', 'Unrest risk flagged by TBO (Nov 2026)'] },
    { id: 'CDG', name: 'Paris',     region: 'Europe', adr: 18000, base: 230, vol: 0.40,
      season: [0.95, 1.00, 1.05, 1.05, 1.10, 1.15, 1.20, 1.25, 1.30, 1.35, 1.35, 1.40],
      signals: ['Summer peak builds', 'Riots / cancellations seen Oct-Nov 2026'] },
    { id: 'IST', name: 'Istanbul',  region: 'Europe', adr: 9000,  base: 250, vol: 0.34,
      season: [1.00, 1.05, 1.05, 1.10, 1.15, 1.20, 1.25, 1.30, 1.30, 1.30, 1.30, 1.30],
      signals: ['Peak season', 'Transit hub for Europe trips'] }
  ];
  const TIERS = [
    { tag: 'Central 4★',  adr: 1.00, dem: 1.00 },
    { tag: 'Beach/Resort 5★', adr: 1.70, dem: 0.65 },
    { tag: 'Value 3★',    adr: 0.60, dem: 1.25 },
    { tag: 'Business 4★', adr: 0.90, dem: 0.85 }
  ];
  const ROUTES = [
    { id: 'DEL-DXB', dest: 'DXB', fare: 16000, base: 900 },
    { id: 'BOM-DXB', dest: 'DXB', fare: 15000, base: 850 },
    { id: 'DEL-JED', dest: 'MKH', fare: 26000, base: 650 },
    { id: 'BOM-JED', dest: 'MKH', fare: 25000, base: 600 },
    { id: 'DEL-BKK', dest: 'BKK', fare: 17000, base: 800 },
    { id: 'BOM-HKT', dest: 'HKT', fare: 19000, base: 450 },
    { id: 'BOM-SIN', dest: 'SIN', fare: 21000, base: 600 },
    { id: 'BLR-MLE', dest: 'MLE', fare: 14000, base: 350 },
    { id: 'DEL-LHR', dest: 'LHR', fare: 48000, base: 420 },
    { id: 'BOM-CDG', dest: 'CDG', fare: 46000, base: 300 }
  ];
  // Regional shocks: probability in the quarter and demand multiplier when it hits.
  const SHOCKS = {
    Europe: { p: 0.15, mult: 0.50, label: 'Europe unrest' },
    Gulf:   { p: 0.12, mult: 0.55, label: 'Gulf disruption' },
    APAC:   { p: 0.06, mult: 0.75, label: 'APAC disruption' }
  };

  // Contract economics (assumptions, set from public industry ranges)
  const ECON = {
    // margin: TBO's free-sale take on the agent price. Discounts are vs the free-sale net cost.
    // passThrough: share of the purchase saving given to agents so own stock wins against other wholesalers.
    // fixedCost: contracting, loading and reconciling one product-week contract (₹)
    hotel:  { fixedCost: 15000, margin: 0.08,  blockDisc: [0.04, 0.08], buyDisc: [0.10, 0.18], salvage: 0.30, attritionFloor: 0.30, passThrough: 0.6 },
    flight: { fixedCost: 40000, margin: 0.012, blockDisc: [0.03, 0.06], buyDisc: [0.08, 0.14], salvage: 0.15, attritionFloor: 0.40, passThrough: 0.6 }
  };
  const LEAD = { hotelBuy: 75, hotelBlock: 60, flightBuy: 90, flightBlock: 75, release: 14 };

  const N_SCEN = 600;
  // When a product is sold out, about half of agents book an alternative on TBO anyway.
  // Only the other half is truly lost, so only that half counts as upside.
  const SUBST = 0.5;

  // ---------- build the synthetic world ----------
  function buildWorld(seed) {
    const rng = mulberry32(seed || 42);
    const cells = [];
    const products = [];
    DEST.forEach(d => {
      TIERS.forEach((t, ti) => {
        const prod = {
          id: d.id + '-H' + (ti + 1), kind: 'hotel', dest: d, region: d.region,
          name: d.name + ' · ' + t.tag,
          price: Math.round(d.adr * t.adr * (0.92 + 0.16 * rng()) / 100) * 100,
          baseDemand: d.base * t.dem * (0.85 + 0.3 * rng()),
          vol: d.vol * (1.05 + 0.25 * rng()),
          blockDisc: lerp(ECON.hotel.blockDisc, rng()),
          buyDisc: lerp(ECON.hotel.buyDisc, rng()),
          econ: ECON.hotel
        };
        products.push(prod);
      });
    });
    ROUTES.forEach(r => {
      const d = DEST.find(x => x.id === r.dest);
      products.push({
        id: r.id, kind: 'flight', dest: d, region: d.region, name: r.id + ' series seats',
        price: r.fare, baseDemand: r.base * (0.9 + 0.2 * rng()), vol: d.vol * 1.15,
        blockDisc: lerp(ECON.flight.blockDisc, rng()),
        buyDisc: lerp(ECON.flight.buyDisc, rng()),
        econ: ECON.flight
      });
    });

    // Shared shock draws and macro factor across all cells
    const shockU = { Europe: new Float64Array(N_SCEN), Gulf: new Float64Array(N_SCEN), APAC: new Float64Array(N_SCEN) };
    const macro = new Float64Array(N_SCEN);
    for (let s = 0; s < N_SCEN; s++) {
      shockU.Europe[s] = rng(); shockU.Gulf[s] = rng(); shockU.APAC[s] = rng();
      macro[s] = Math.exp(0.07 * gauss(rng) - 0.5 * 0.07 * 0.07);
    }

    products.forEach(p => {
      for (let w = 0; w < 12; w++) {
        const season = p.dest.season[w];
        const mean = p.baseDemand * season;
        // sold-out pressure rises with season: share of demand free sale cannot serve
        const soldOut = clamp(0.06 + 0.55 * (season - 0.9) + 0.05 * gauss(rng), 0.03, 0.55);
        const sig = p.vol;
        const z = new Float64Array(N_SCEN), a = new Float64Array(N_SCEN), e = new Float64Array(N_SCEN);
        for (let s = 0; s < N_SCEN; s++) {
          z[s] = Math.exp(sig * gauss(rng) - 0.5 * sig * sig);       // idiosyncratic demand noise
          a[s] = 0.9 + 0.2 * rng();                                 // free-sale capacity noise
          e[s] = Math.exp(0.15 * gauss(rng));                        // forecast error at release date
        }
        cells.push({
          idx: cells.length, prod: p, w, week: WEEKS[w], season, mean, soldOut,
          freeCap: (1 - soldOut) * mean,
          // hotels and airlines give smaller discounts for weeks they expect to fill anyway
          peakAdj: clamp(1.45 - 0.55 * season, 0.6, 1.1),
          // an allotment rate is fixed at signing; free-sale prices move with demand. In peak weeks the
          // market climbs above the contracted rate, in low season it falls below it.
          blockShift: clamp(0.15 * (season - 1), -0.06, 0.05), // capped: hotels use blackout dates and stop-sales in peak weeks
          z, a, e
        });
      }
    });
    return { cells, products, shockU, macro, seed: seed || 42 };
  }
  function lerp(r, u) { return r[0] + (r[1] - r[0]) * u; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // Demand matrix for a scenario set (stress = force a region's shock in every scenario)
  function demandFor(world, cell, stress) {
    const reg = cell.prod.region, sh = SHOCKS[reg];
    const D = new Float64Array(N_SCEN), A = new Float64Array(N_SCEN), Dh = new Float64Array(N_SCEN);
    for (let s = 0; s < N_SCEN; s++) {
      const hit = stress === reg || world.shockU[reg][s] < sh.p;
      const m = hit ? sh.mult : 1;
      D[s] = cell.mean * cell.z[s] * world.macro[s] * m;
      // free-sale capacity does not shrink in a shock (hotels have rooms; agents cancel)
      A[s] = cell.freeCap * cell.a[s];
      Dh[s] = D[s] * cell.e[s];
    }
    return { D, A, Dh };
  }

  // ---------- profit of one cell for a given position ----------
  // returns incremental profit vector vs Pass (free sale only)
  function cellVec(cell, dm, H, K, k) {
    const p = cell.prod, ec = p.econ, P = p.price;
    const cF = P * (1 - ec.margin), cB = cF * (1 - (p.blockDisc + cell.blockShift)), cH = cF * (1 - p.buyDisc * cell.peakAdj);
    const sellH = (P - ec.passThrough * (cF - cH)) * (1 - (k || 0));
    const sellK = (P - ec.passThrough * (cF - cB)) * (1 - (k || 0));
    const uplift = 1 + 2.5 * (k || 0); // price-sensitive agents: a 1% cut lifts captured demand 2.5%
    const out = new Float64Array(N_SCEN), wo = new Float64Array(N_SCEN);
    for (let s = 0; s < N_SCEN; s++) {
      const D0 = dm.D[s], A = dm.A[s];
      const base = Math.min(D0, A) * (P - cF) + SUBST * Math.max(0, D0 - A) * (P - cF);
      const D = (H + K) > 0 ? D0 * uplift : D0;
      // blocks: at release, keep what the forecast says will sell (attrition floor applies)
      const keep = K > 0 ? Math.min(K, Math.max(ec.attritionFloor * K, dm.Dh[s] * uplift - H)) : 0;
      const sH = Math.min(D, H);
      const sK = Math.min(D - sH, keep);
      const sF = Math.min(D - sH - sK, A);
      const w = (H - sH) * cH * (1 - ec.salvage) + (keep - sK) * cB * (1 - ec.salvage);
      const spill = Math.max(0, D - sH - sK - sF) * SUBST * (P - cF);
      const prof = sH * (sellH - cH) + sK * (sellK - cB) + sF * (P - cF) + spill - w;
      out[s] = prof - base - ((H + K) > 0 ? ec.fixedCost : 0);
      wo[s] = w;
    }
    out.wo = wo;
    return out;
  }
  // Capital = cash the budget must fund up front: prepaid buys + a deposit on each allotment.
  // An allotment's real cost is attrition risk, which the write-off cap controls separately.
  const BLOCK_DEPOSIT = 0.20;
  function capitalOf(cell, dm, H, K) {
    const p = cell.prod, ec = p.econ, cF = p.price * (1 - ec.margin);
    const cH = cF * (1 - p.buyDisc * cell.peakAdj), cB = cF * (1 - (p.blockDisc + cell.blockShift));
    return H * cH + BLOCK_DEPOSIT * K * cB;
  }
  function servedExtra(cell, dm, H, K) {
    // expected extra units sold vs free sale only (= sold-out demand recovered)
    let ex = 0, lost = 0; const ec = cell.prod.econ;
    for (let s = 0; s < N_SCEN; s++) {
      const D = dm.D[s], A = dm.A[s];
      const keep = K > 0 ? Math.min(K, Math.max(ec.attritionFloor * K, dm.Dh[s] - H)) : 0;
      const served = Math.min(D, H + keep + A);
      ex += served - Math.min(D, A);
      lost += Math.max(0, D - A);
    }
    return { extra: ex / N_SCEN, lost: lost / N_SCEN };
  }

  const mean = v => { let t = 0; for (let i = 0; i < v.length; i++) t += v[i]; return t / v.length; };
  function pct(v, q) { const a = Array.from(v).sort((x, y) => x - y); return a[Math.floor(q * (a.length - 1))]; }

  // ---------- greedy allocator ----------
  const RISK = { cautious: 0.03, balanced: 0.06, bold: 0.10 }; // max write-off in a 1-in-20 bad quarter, as share of budget

  function optimise(world, budgetRs, appetite, opts) {
    opts = opts || {};
    const woLimit = RISK[appetite || 'balanced'] * budgetRs;
    const cells = world.cells;
    const dms = cells.map(c => demandFor(world, c, null));
    const zero = () => { const v = new Float64Array(N_SCEN); v.wo = new Float64Array(N_SCEN); return v; };
    const pos = cells.map(() => ({ H: 0, K: 0, vec: zero() }));
    const step = cells.map(c => Math.max(5, Math.round(0.08 * c.mean)));
    const total = new Float64Array(N_SCEN), totWo = new Float64Array(N_SCEN);
    let capital = 0;
    const blocked = cells.map(() => ({ H: false, K: false }));

    function cand(i, type) {
      const c = cells[i], ps = pos[i];
      // minimum contract sizes: a prepaid deal or an allotment below these is not worth a supplier's time
      const minH = Math.round(0.25 * c.mean), minK = Math.round(0.20 * c.mean);
      const addH = type === 'H' ? (ps.H === 0 ? Math.max(minH, step[i]) : step[i]) : 0;
      const addK = type === 'K' ? (ps.K === 0 ? Math.max(minK, step[i]) : step[i]) : 0;
      const H = ps.H + addH, K = ps.K + addK;
      if (type === 'H' && H > 1.6 * c.mean) return null;
      if (type === 'K' && H + K > 1.8 * c.mean) return null;
      const v = cellVec(c, dms[i], H, K, 0);
      const dMean = mean(v) - mean(ps.vec);
      const dCap = capitalOf(c, dms[i], H, K) - capitalOf(c, dms[i], ps.H, ps.K);
      return { i, type, H, K, v, dMean, dCap, score: dMean / dCap };
    }
    const best = cells.map((c, i) => ({ H: cand(i, 'H'), K: cand(i, 'K') }));

    let guard = 0;
    while (guard++ < 20000) {
      let top = null;
      for (let i = 0; i < cells.length; i++) {
        for (const t of ['H', 'K']) {
          const cd = best[i][t];
          if (!cd || blocked[i][t] || cd.dMean <= 0) continue;
          if (capital + cd.dCap > budgetRs) continue;
          if (!top || cd.score > top.score) top = cd;
        }
      }
      if (!top) break;
      // risk check on the portfolio
      const trial = new Float64Array(N_SCEN), trialWo = new Float64Array(N_SCEN), ps = pos[top.i];
      for (let s = 0; s < N_SCEN; s++) { trial[s] = total[s] - ps.vec[s] + top.v[s]; trialWo[s] = totWo[s] - ps.vec.wo[s] + top.v.wo[s]; }
      if (pct(trialWo, 0.95) > woLimit) { blocked[top.i][top.type] = true; continue; }
      total.set(trial); totWo.set(trialWo);
      capital += top.dCap;
      ps.H = top.H; ps.K = top.K; ps.vec = top.v;
      best[top.i] = { H: cand(top.i, 'H'), K: cand(top.i, 'K') };
    }

    // price tuning: for cells holding inventory, try small markdowns on own units
    const plan = cells.map((c, i) => {
      const ps = pos[i];
      let k = 0, vec = ps.vec;
      if (ps.H + ps.K > 0) {
        let bestM = mean(vec);
        for (const kk of [0.02, 0.04, 0.06]) {
          const v = cellVec(c, dms[i], ps.H, ps.K, kk);
          const m = mean(v);
          if (m > bestM * 1.01) { bestM = m; k = kk; vec = v; }
        }
      }
      return { cell: c, H: ps.H, K: ps.K, k, vec, capital: capitalOf(c, dms[i], ps.H, ps.K) };
    });
    return summarise(world, plan, budgetRs, dms, appetite);
  }

  // ---------- naive comparator: "pre-buy where demand is hottest" ----------
  function naive(world, budgetRs) {
    const cells = world.cells;
    const dms = cells.map(c => demandFor(world, c, null));
    const order = cells.map((c, i) => i).sort((a, b) =>
      (cells[b].mean * cells[b].soldOut * cells[b].prod.price) - (cells[a].mean * cells[a].soldOut * cells[a].prod.price));
    let capital = 0;
    const plan = cells.map(c => { const v = new Float64Array(N_SCEN); v.wo = new Float64Array(N_SCEN); return { cell: c, H: 0, K: 0, k: 0, vec: v, capital: 0 }; });
    for (const i of order) {
      const c = cells[i];
      const H = Math.round(0.6 * c.mean);
      const cap = capitalOf(c, dms[i], H, 0);
      if (capital + cap > budgetRs) continue;
      capital += cap;
      plan[i] = { cell: c, H, K: 0, k: 0, vec: cellVec(c, dms[i], H, 0, 0), capital: cap };
    }
    return summarise(world, plan, budgetRs, dms, 'naive');
  }

  function summarise(world, plan, budgetRs, dms, appetite) {
    const total = new Float64Array(N_SCEN), wo = new Float64Array(N_SCEN);
    let capital = 0, extra = 0, lost = 0, units = 0;
    const lanes = { buy: { n: 0, cap: 0 }, block: { n: 0, cap: 0 }, pass: { n: 0, cap: 0 } };
    plan.forEach((r, i) => {
      for (let s = 0; s < N_SCEN; s++) { total[s] += r.vec[s]; wo[s] += r.vec.wo[s]; }
      capital += r.capital;
      const se = servedExtra(r.cell, dms[i], r.H, r.K);
      r.extra = se.extra; r.lostBase = se.lost;
      extra += se.extra; lost += se.lost;
      units += r.H + r.K;
      r.lane = r.H > 0 ? 'buy' : (r.K > 0 ? 'block' : 'pass');
      lanes[r.lane].n++; lanes[r.lane].cap += r.capital;
      r.exp = mean(r.vec);
    });
    return {
      plan, budget: budgetRs, appetite, capital, total,
      expProfit: mean(total), p5: pct(total, 0.05), p50: pct(total, 0.5),
      expWo: mean(wo), wo95: pct(wo, 0.95), woLimit: RISK[appetite] ? RISK[appetite] * budgetRs : null,
      roc: capital > 0 ? mean(total) / capital : 0,
      extraUnits: extra, lostUnits: lost, recovered: lost > 0 ? extra / lost : 0,
      units, lanes
    };
  }

  // evaluate an existing plan under a forced regional shock
  function stressTest(world, result, region) {
    const total = new Float64Array(N_SCEN), wo = new Float64Array(N_SCEN);
    result.plan.forEach(r => {
      if (r.H + r.K === 0) return;
      const dm = demandFor(world, r.cell, region);
      const v = cellVec(r.cell, dm, r.H, r.K, r.k);
      for (let s = 0; s < N_SCEN; s++) { total[s] += v[s]; wo[s] += v.wo[s]; }
    });
    return { expProfit: mean(total), p5: pct(total, 0.05), expWo: mean(wo), wo95: pct(wo, 0.95) };
  }

  // contract terms for a plan row
  function terms(r) {
    const fl = r.cell.prod.kind === 'flight';
    const wk = r.cell.week;
    return {
      signBy: fmt(addDays(wk, -(r.lane === 'buy' ? (fl ? LEAD.flightBuy : LEAD.hotelBuy) : (fl ? LEAD.flightBlock : LEAD.hotelBlock)))),
      release: r.K > 0 ? fmt(addDays(wk, -LEAD.release)) : '-',
      perNight: fl ? Math.round((r.H + r.K) / 7) + ' seats/day' : Math.round((r.H + r.K) / 7) + ' rooms/night',
      price: ownPrice(r)
    };
  }

  // recommended agent price for our own stock: market price less the share of the saving we pass on
  function ownPrice(r) {
    const c = r.cell, p = c.prod, ec = p.econ, P = p.price, cF = P * (1 - ec.margin);
    const cost = r.H > 0 ? cF * (1 - p.buyDisc * c.peakAdj) : cF * (1 - (p.blockDisc + c.blockShift));
    const sell = (P - ec.passThrough * (cF - cost)) * (1 - (r.k || 0));
    return { sell: Math.round(sell / 10) * 10, market: P, cut: (P - sell) / P };
  }

  // booking curve for the release radar: share of final demand booked by t days out
  function bookedShare(t) {
    const f = x => 1 / (1 + Math.exp((x - 30) / 10));
    return f(t) / f(0);
  }

  const api = { buildWorld, optimise, naive, stressTest, terms, ownPrice, bookedShare, demandFor, cellVec,
    WEEKS, DEST, ROUTES, SHOCKS, ECON, LEAD, RISK, N_SCEN, SUBST, fmt, addDays, mean, pct };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BBP = api;
})(typeof window !== 'undefined' ? window : globalThis);
