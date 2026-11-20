/* Runs the engine off the main thread so the page stays smooth and can show live progress. */
importScripts('engine.js');
let world = null;
function strip(r) {
  return {
    budget: r.budget, capital: r.capital, expProfit: r.expProfit, p5: r.p5, p50: r.p50, roc: r.roc,
    expWo: r.expWo, wo95: r.wo95, woLimit: r.woLimit, extraUnits: r.extraUnits, lostUnits: r.lostUnits,
    recovered: r.recovered, units: r.units, lanes: r.lanes,
    plan: r.plan.map(p => ({ idx: p.cell.idx, H: p.H, K: p.K, k: p.k, exp: p.exp, capital: p.capital, lane: p.lane, extra: p.extra }))
  };
}
onmessage = e => {
  const { budget, risk, seed, id } = e.data;
  if (!world) world = BBP.buildWorld(seed || 42);
  const t0 = Date.now();
  const res = BBP.optimise(world, budget, risk, { onProgress: (f, steps) => postMessage({ type: 'progress', id, f, steps }) });
  const nv = BBP.naive(world, budget);
  const stress = {};
  ['Europe', 'Gulf'].forEach(g => { stress[g] = { e: BBP.stressTest(world, res, g), n: BBP.stressTest(world, nv, g) }; });
  postMessage({ type: 'done', id, ms: Date.now() - t0, res: strip(res), nv: strip(nv), stress });
};
