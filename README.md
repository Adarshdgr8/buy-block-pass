# Buy, Block or Pass

**An inventory engine for TBO.com.** For every hotel-week and flight-week, it decides whether TBO should:

- **Buy**: prepay rooms or series seats. Deepest discount; TBO owns whatever doesn't sell.
- **Block**: hold an allotment with a release date. Smaller discount; at T-14, TBO keeps what it expects to sell and hands the rest back.
- **Pass**: stay on free sale. No risk, normal margin, but demand is lost when the hotel or fare sells out.

Built for **TBO VoyageHack 4.0** (Inventory Optimization problem) by Bhumi Khandelwal, Astha Singh and Adarsh Singh, IIM Lucknow.

**Live site:** https://adarshdgr8.github.io/buy-block-pass/

The site has two parts:

- **The story** (`index.html`): a 90-second animated walk-through of the problem, the trap in prepaying the hottest weeks, the three contracts, how the engine decides, the results and the plan. Press **Play** for autoplay (handy for screen-recording).
- **The engine** (`app.html`): the working prototype. Set the cash budget and risk appetite and the engine re-plans live in your browser. Views:
  - **Overview**: the plan in one sentence, KPIs, and a comparison with the naive plan.
  - **Plan**: every market and week; open a destination to see its hotels, then click a week for the reasoning and a 600-outcome demand chart.
  - **Contracts**: the negotiation brief, with filters, CSV export, and a drafted supplier message for each deal.
  - **Release radar**: pickup against forecast and how many allotment rooms to hand back at T-14.
  - **Stress lab**: force a Gulf or Europe shock into every scenario and compare the two plans.
  - **Method**: assumptions and limits.

> All data in this prototype is synthetic. Nothing here uses TBO data or forecasts TBO's results. The point is to show the method and the decisions it produces.

---

## Why the engine picks a contract type

Wholesalers choose a contract as well as a quantity. A prepaid deal earns the deepest discount but carries the full risk of unsold stock. An allotment costs a deposit, earns a smaller discount and can be handed back before the release date. The engine picks the contract type and the quantity together.

The prototype surfaces three patterns:

1. **Hotels give their smallest prepay discounts on the weeks with the hottest demand.** Pre-buying the hottest weeks is therefore the worst trade. In those weeks the engine blocks rather than buys.
2. **Low season is where prepaying pays.** Example: Maldives during the monsoon.
3. **Some weeks are best left alone.** Example: Makkah during the Umrah pause around Hajj.

## Results in the demo (₹50 Cr cash budget, Balanced risk)

Compared with the intuitive approach of prepaying 60% of forecast demand in the hottest, most sold-out weeks until the budget runs out. Figures are extra gross profit for the quarter, measured against free sale only, in ₹ crore.

| Random world (seed) | Expected: engine | Expected: naive | Bad quarter (1 in 20): engine | Bad quarter: naive | Write-off at risk: engine | Write-off at risk: naive | Gulf shock: engine | Gulf shock: naive | Europe shock: engine | Europe shock: naive |
|---|---|---|---|---|---|---|---|---|---|---|
| 42 (demo) | 4.58 | 0.10 | 2.69 | −4.51 | 1.94 | 6.02 | 3.46 | −1.19 | 2.95 | −3.97 |
| 7 | 4.75 | −0.07 | 2.75 | −5.35 | 1.85 | 6.74 | 3.85 | −1.46 | 3.10 | −4.46 |
| 101 | 4.50 | 0.22 | 2.49 | −4.70 | 1.87 | 6.23 | 3.59 | −0.78 | 2.77 | −4.10 |
| 2027 | 4.56 | −0.06 | 2.68 | −5.26 | 1.79 | 6.63 | 3.52 | −1.14 | 2.90 | −4.87 |
| 555 | 4.75 | −0.06 | 2.86 | −4.66 | 1.84 | 5.98 | 3.96 | −1.21 | 3.00 | −4.20 |

The engine also stops spending when more commitment doesn't pay. With a ₹100 Cr budget, it commits about ₹63 Cr.

## How it works

1. **Sense:** bookings, searches, sold-out searches (unmet demand), look-to-book, cancellations, events, visas, airfares and risk news.
2. **Forecast:** demand for each product-week as a range of 600 scenarios. Regional shocks (Europe, Gulf, APAC) hit every product in a region at once, so the portfolio sees correlated risk.
3. **Decide:** a greedy allocator adds inventory in small steps. Each step goes to the option with the best expected extra gross profit per rupee of cash. Two limits apply:
   - **Cash budget:** prepayments plus a 20% deposit on allotments.
   - **Write-off cap:** in a 1-in-20 bad quarter, the cost of unsold committed stock must stay under 3% / 6% / 10% of budget (Cautious / Balanced / Bold).

   Minimum contract sizes and a per-contract handling cost stop it from signing tiny deals. Each decision comes with a sign-by date, a release date and an agent price.
4. **Watch:** the release radar compares pickup with forecast and says how many allotment units to keep or hand back at T-14.

## Assumptions (all editable in `engine.js`)

| Item | Value | Basis |
|---|---|---|
| Free-sale margin | 8% hotels, 1.2% air | ~8% hotel take rate in TBO's Q1 FY27 shareholder letter; air gross profit guided at 1-1.2% (Q2 FY27 call) |
| Prepay discount | 10-18% hotels, 8-14% series seats, smaller in peak weeks | Public ranges for hard allotments (10-25% below rack) |
| Allotment rate | 4-8% below free sale, ±5 pts with season | The contracted rate is fixed; market prices move with demand |
| Release / attrition | T-14; keep at least 30% (hotels) / 40% (seats) | Common release structures are 30/21/14/7 days |
| Unsold prepaid stock | 30% recovered (hotels), 15% (seats) | Assumption |
| Saving passed to agents | 60% | Own stock must undercut other wholesalers |
| Sold-out demand | 50% books an alternative on TBO anyway | Assumption; only the truly lost half counts as upside |
| Shocks per quarter | Europe 15% (×0.50), Gulf 12% (×0.55), APAC 6% (×0.75) | Set to echo the Oct 2026 Saudi and Europe cancellations TBO reported |
| Contract cost | ₹15k per hotel-week, ₹40k per route-week | Contracting, loading, reconciliation |

## Run it

No build step and no dependencies. Serve the folder and open it:

```
python3 -m http.server 8000
# then open http://localhost:8000/
```

Opening `app.html` straight from disk also works; the engine then runs on the main thread instead of a web worker.

To reproduce the results table:

```
node -e "const B=require('./engine.js');const w=B.buildWorld(42);const r=B.optimise(w,50e7,'balanced');console.log(r.expProfit/1e7, r.p5/1e7, r.wo95/1e7)"
```

## Files

- `engine.js`: synthetic market, scenario model, allocator, naive comparator, stress test
- `worker.js`: runs the engine off the main thread and reports progress
- `app.html`, `app.js`, `app.css`: the engine's interface
- `index.html`, `story.js`, `story.css`: the animated story
- `story-data.js`: numbers for the story, generated from `engine.js` by `node tools/make-story-data.js` (seed 42, ₹50 Cr, Balanced)

## Roadmap (Round 2)

- Train demand forecasts on real booking, search and sold-out logs (quantile gradient boosting per market-week)
- Treat a hotel's season as one contract with week-level allotment sizes
- Replace the greedy allocator with a stochastic program (e.g. OR-Tools) and compare
- Feed live pickup into the release radar; push at-risk allotment stock to the agents most likely to sell it

## Licence

MIT. Not affiliated with or endorsed by TBO.
