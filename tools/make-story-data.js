const B=require('../engine.js');
const w=B.buildWorld(42); const r=B.optimise(w,50e7,'balanced'); const n=B.naive(w,50e7);
const g=B.stressTest(w,r,'Gulf'), gn=B.stressTest(w,n,'Gulf'), e=B.stressTest(w,r,'Europe'), en=B.stressTest(w,n,'Europe');
const cr=x=>Math.round(x/1e5)/100;
// grid rows
const rows=[]; const dests=B.DEST.map(d=>d.name);
const laneOf=cells=>{const c={buy:0,block:0,pass:0};cells.forEach(p=>c[p.lane]++);return c.buy>=c.block&&c.buy>=c.pass&&c.buy>0?'buy':c.block>=c.pass&&c.block>0?'block':'pass';};
dests.forEach(d=>{rows.push({name:d,kind:'hotel',lanes:Array.from({length:12},(_,wk)=>laneOf(r.plan.filter(p=>p.cell.prod.kind==='hotel'&&p.cell.prod.dest.name===d&&p.cell.w===wk)))});});
B.ROUTES.forEach(rt=>{rows.push({name:rt.id,kind:'flight',lanes:Array.from({length:12},(_,wk)=>laneOf(r.plan.filter(p=>p.cell.prod.id===rt.id&&p.cell.w===wk)))});});
// Dubai central 4* sold-out series
const hotel=w.products.find(p=>p.id==='DXB-H1');
const hc=w.cells.filter(c=>c.prod===hotel);
const sold=hc.map(c=>{const dm=B.demandFor(w,c,null);let D=0,A=0,L=0;for(let s=0;s<B.N_SCEN;s++){D+=dm.D[s];A+=Math.min(dm.D[s],dm.A[s]);L+=Math.max(0,dm.D[s]-dm.A[s]);}return {d:Math.round(D/B.N_SCEN),served:Math.round(A/B.N_SCEN),lost:Math.round(L/B.N_SCEN),cap:Math.round(c.freeCap)};});
// fan paths for the same hotel: 140 scenarios across 12 weeks
const dms=hc.map(c=>B.demandFor(w,c,null));
const fan=[];for(let s=0;s<140;s++)fan.push(dms.map(dm=>Math.round(dm.D[s])));
// discount bands (hotels)
const bands=[[0,0.6,'Lull'],[0.6,0.95,'Quiet'],[0.95,1.1,'Normal'],[1.1,1.25,'Busy'],[1.25,9,'Peak']].map(([lo,hi,name])=>{const c=r.plan.filter(p=>p.cell.prod.kind==='hotel'&&p.cell.season>=lo&&p.cell.season<hi);const k={buy:0,block:0,pass:0};let pd=0,bd=0;c.forEach(p=>{k[p.lane]++;pd+=p.cell.prod.buyDisc*p.cell.peakAdj;bd+=p.cell.prod.blockDisc+p.cell.blockShift;});const t=c.length;return {name,n:t,buy:Math.round(k.buy/t*100),block:Math.round(k.block/t*100),pass:Math.round(k.pass/t*100),prepay:+(pd/t*100).toFixed(1),allot:+(bd/t*100).toFixed(1)};});
// release example: largest hotel allotment in London
const blk=r.plan.filter(p=>p.K>0&&p.cell.prod.kind==='hotel').sort((a,b)=>b.K-a.K)[0];
const dm=B.demandFor(w,blk.cell,null); const idx=Array.from(dm.D.keys()).sort((a,b)=>dm.D[a]-dm.D[b]); const s=idx[Math.floor(0.25*idx.length)];
const Ds=Array.from(dm.D).sort((a,b)=>a-b); const med=Ds[Math.floor(0.5*Ds.length)];
const proj=dm.Dh[s]; const ec=blk.cell.prod.econ; const keep=Math.min(blk.K,Math.max(ec.attritionFloor*blk.K,proj-blk.H));
const release={name:blk.cell.prod.name,week:B.fmt(blk.cell.week),H:blk.H,K:blk.K,med:Math.round(med),proj:Math.round(proj),keep:Math.round(keep),rel:Math.round(blk.K-keep),relDate:B.fmt(B.addDays(blk.cell.week,-14)),p10:Math.round(Ds[60]),p90:Math.round(Ds[540])};
const data={weeks:B.WEEKS.map(B.fmt),rows,sold,hotelName:hotel.name,fan,bands,release,
 res:{exp:cr(r.expProfit),p5:cr(r.p5),wo:cr(r.wo95),rec:Math.round(r.recovered*100),gulf:cr(g.expProfit),eu:cr(e.expProfit),cap:cr(r.capital),buyCap:cr(r.lanes.buy.cap),blockCap:cr(r.lanes.block.cap)},
 naive:{exp:cr(n.expProfit),p5:cr(n.p5),wo:cr(n.wo95),rec:Math.round(n.recovered*100),gulf:cr(gn.expProfit),eu:cr(en.expProfit)}};
require('fs').writeFileSync(require('path').join(__dirname,'..','story-data.js'),'/* Precomputed from engine.js (seed 42, ₹50 Cr, Balanced). Regenerate with: node tools/make-story-data.js. */\nwindow.STORY='+JSON.stringify(data)+';\n');
console.log(JSON.stringify({sold,bands,release,res:data.res,naive:data.naive},null,0));
