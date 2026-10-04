# Demo, QA and staging data (spec 37–90, 116–127)

The demo dataset exists to **test** business logic, accounting, inventory, cost, permissions, tenant isolation, performance and reporting. It is not decoration. Every figure follows one chain: purchase → stock → recipe → sale → consumption → waste → closing stock. The verification below proves the chain reconciles.

## Commands

| Command | What it does |
|---|---|
| `npm run seed` | Classic single-company demo (Grand Anatolia), used by the Playwright suite, plus the platform admin `superadmin@hotelcost.test` |
| `npm run seed:demo` | **dev** profile: 5 companies, 10 hotels, about 2 months, every scenario (~10 min) |
| `npm run seed:staging` | **staging** profile: the large realistic dataset (12 months, volumes below) |
| `npm run seed:qa` | **tiny** profile: 2 companies, 3 hotels, 1 month (seconds; used by `test:reconciliation`) |
| `npm run demo:verify` | Post-seed checks on the current database (exit code 1 on any failure) |
| `npm run demo:reset` | Removes every demo tenant (`Organization.isDemo`) |
| `npm run test:reconciliation` | Generates the tiny dataset into the test DB, runs the verification and the deletion tests, then cleans up |

**Safety:**
- Every command refuses to run when `HOTELCOST_ENV`/`APP_ENV` is `production`, or when `NODE_ENV=production` without `ALLOW_DEMO_DATA=1`.
- The reset touches only organizations flagged `isDemo`.
- Test-user passwords come from `DEMO_PASSWORD` (default `Demo!2026-QA`). They are dev/QA only and never shipped to production.

## Companies and hotels

| Company | Hotels |
|---|---|
| Demo Hotel Group | İstanbul (city), Antalya (resort), İzmir (city) |
| Demo Resort Group | Bodrum, Kemer |
| Demo City Hotel | Ankara, Bursa |
| Demo Boutique Hotel | Kapadokya, Alaçatı |
| Demo All Inclusive | Belek. **QA tenant: holds the intentional errors.** |

Each hotel has:
- 17 departments (Front Office, Rooms, Housekeeping, Laundry, F&B, Restaurant, Cafe, Bar, Breakfast, Kitchen, Pastry, Banquet, Minibar, Engineering, Finance, HR, Sales & Marketing), each with its cost center.
- 10 warehouses.
- About 200 products in 25 categories, with the units kg / l / pc and packs case, pack, box, bottle, tray, bag, can, plus their conversions.
- 12 suppliers. Shared categories alternate between two suppliers.
- Rooms in 5 types: Standard, Deluxe, Family, Suite, Villa.
- 500 employees.

### Test users

Company A (Demo Hotel Group) uses the short addresses:
- `companyadmin@test.local`, `controller@test.local`, `fbm@test.local`, `chef@test.local`, `breakfast@test.local`, `pastry@test.local`
- `purchasing@test.local`, `accounting@test.local`, `warehouse@test.local`, `rooms@test.local`, `viewer@test.local`

Every other company has the same roles at `<role>@<company-slug>.test.local`, plus bulk staff accounts: 100 / 50 / 75 / 20 / 30 users.

The platform operator is `superadmin@test.local`.

## How the operation is simulated

- **Occupancy** comes from PMS reservations per room: seasonal curves for resort and city hotels, weekend effects and channel mix.
- **Sales** are POS lines in 3–4 time slots, driven by in-house guests per outlet. Banquet events (weddings, conferences) arrive randomly. Each line carries the recipe version effective on the sale date and its frozen theoretical cost, computed exactly as `commitSales` does.
- **Purchasing:**
  - Fresh suppliers deliver daily, dry and beverage suppliers twice a week, the others weekly. Quantities cover the planned need until the next delivery.
  - Landed cost comes from the real landed-cost engine. Supplier price history, price alerts and an invoice are created per delivery.
  - Food prices drift at about 1.2 % a month.
- **Kitchen issues** run once or twice a day per outlet: store top-up from the main store, then department consumption per the recipe snapshot × over-use factor. Housekeeping amenities and cleaning supplies are issued per occupied room and guest.
- **Waste** happens daily with realistic types and reasons. There are also staff meals and complimentary drinks, and month-end counts in the kitchen, bar and pastry stores.
- **Buffets** (breakfast) and the **minibar** (par levels, consumption, restock, counts) are posted through the real services.
- **Expenses:**
  - Payroll from the employees.
  - Electricity, water, gas, LPG and fuel from the metered use, plus common areas.
  - Contracts, rent, insurance and depreciation.
  - Room repairs and daily small costs.
- **Allocation** runs for every full month through the real allocation engine.
- **Budget**, targets, saving actions and the control calendar are set up. Months older than the previous one are closed.

The high-volume ledger is written by `src/server/demo/engine.ts`. It reproduces `postMovement` / `transferStock` exactly, and `tests/integration/demo-engine.test.ts` posts one scenario both ways and requires identical rows.

## Scenarios (`DemoScenario`, status NORMAL / EDGE_CASE / INTENTIONAL_ERROR)

| # | Scenario | Where it shows |
|---|---|---|
| 1 | Supplier price increases of 3 / 5 / 10 / 15 / 20 / 30 % | Price alerts, purchase price variance, recipe cost |
| 2 | High waste (kitchen, last full month) | Waste % vs target, waste report |
| 3 | Low yield (QA: yield typed as 5 %) | Data quality: implausible yield |
| 4 | Over-portioning (restaurant proteins +25 %) | Theoretical vs actual: unexplained usage |
| 5 | Critical stock (no deliveries in the last week) | Inventory status, order recommendations |
| 6 | Dead stock (bought at go-live, never used) | Stock aging, carrying cost |
| 7 | Theoretical vs actual variance (tomato, cheese) | Variance report |
| 8 | Buffet overproduction (10–18 % leftovers) | Buffet waste HIGH / CRITICAL, cost per cover |
| 9 | Minibar discrepancy | Minibar shrinkage per room |
| 10 | Room cost spike (emergency repairs ×3) | Room cost per night |
| 11 | Energy cost spike (+45 %) | Energy per occupied room |
| 12 | Labor cost increase (+25 % payroll, overtime spike) | Labor %, forecast |
| 13 | Budget overrun (F&B budget below run rate) | Budget vs actual |
| 14 | Unexplained inventory shrinkage (bar spirits at counts) | Count variance |
| 15 | Missing recipe (POS items without mapping) | Unmapped sales |

The QA tenant also has these **intentional errors**:
- a product with no cost used in an approved recipe;
- a purchase unit with no conversion;
- a product with no supplier;
- a 5 % yield;
- negative kitchen stock;
- a POS line dated 30 days ahead.

`demo:verify` requires that the data-quality screen detects every one of them, and that the QA tenant's quality score is lower than every other hotel's.

## Post-seed verification (`src/server/demo/verify.ts`)

Each check recomputes its figure through an independent path:

- **Volumes:** on staging, the spec's minimums; otherwise > 0.
- **Integrity per hotel:** no critical failure, and zero cross-hotel references.
- **Three-way monthly reconciliation:** ledger outflows (SQL) = cost ledger (SQL) = export actual cost = dashboard actual cost. The export's own reconciliation checks must not FAIL.
- **Recipe cost:** the recipe engine's food cost = Σ frozen requirements × unit cost.
- **History:** every sale line uses the version effective on its sale date, and superseded versions are in use.
- **Intentional errors:** each one is detected, and the quality score drops.
- **Tenant isolation:** each company's cost controller against every hotel of every company.
- **Export leaks:** no export contains another hotel's IDs or names.
- **Excel:** opens with all sheets and tables, actual cost equals the export, and no other hotel appears anywhere in the sheet XML.

## UI verification on the demo dataset

Two browser checks run against a running server on a demo database.

**`npm run demo:crawl -- --base=http://localhost:3000`** opens every page as every demo role, in every hotel that role can open: 11 roles × 5 companies plus the platform operator. A page fails the crawl when it has any of:
- an HTTP 5xx;
- the Next.js error page;
- an uncaught browser error or a console error;
- an `/api` call that returns 5xx;
- another company's hotel or company name in the HTML.

**`npm run test:demo-ui`** runs `playwright.demo.config.ts` against a copy of the demo database: `DEMO_E2E_DATABASE_URL`, by default `hotelcost_demo_qa`. It drives the write flows through the UI as the demo users:
- purchase receipt;
- delete request → approval → reversal;
- waste;
- stock count;
- recipe with approval;
- POS import;
- buffet session;
- minibar;
- expense post and reverse;
- reports, Excel (sync and background) and the PDF pack;
- integrity check and data-quality detection on the QA tenant;
- company administration;
- platform tenant creation.

It also sends a write to every mutating API route (found from the file system) as the read-only viewer, and requires 403 from each one before the payload is read.

Results on the dev dataset (5 companies, 10 hotels):

| Check | Result |
|---|---|
| Page crawl | 2,627 page visits by 56 users in 9.5 min. 0 server errors, 0 cross-company leaks. 810 out-of-role pages show the "No permission" page. |
| UI write flows | 15/15 pass |
| Viewer write sweep | 71/71 mutating endpoints answer 403 |

**What the crawl found and what was fixed:**
- Opening a page outside one's role by URL returned HTTP 500. Such pages now redirect to `/forbidden`.
- Date and time used the server's timezone (UTC on a cloud host). They now use the hotel's `timezone`.
- The receipt and recipe forms used random element ids on the server, which broke hydration. Their ids are now stable.
- 24 write endpoints validated the payload before checking the permission, so a viewer got 422 instead of 403. They now check the permission first.
- A read-only viewer could mark control tasks done. Now only the task's owner role or a period manager can.

**Known open item:** about 1 % of page loads under 4 parallel browsers log React hydration error #418. The server HTML and the hydrated DOM were compared for those pages and carry the same content. React re-renders the page on the client and the user sees no difference. It does not reproduce in sequential runs or in development mode.

## Volumes

Measured from the generated databases. Staging was verified with `demo:verify`: 131 checks PASS, including every spec minimum.

| | dev (≈2 months) | staging (13 months) | spec minimum |
|---|---:|---:|---:|
| Organizations / hotels | 5 / 10 | 5 / 10 | 5 / 10 |
| Products | 2,004 | 2,004 | 2,000 |
| Recipes (semi-finished) | 601 (100) | 601 (100) | 500 (100) |
| Recipe versions | 909 | 902 | 150 recipes × 2–4 |
| Suppliers | 120 | 120 | 100 |
| Sale lines | 54,153 | 540,904 | 500,000 |
| Stock transactions | 136,595 | 1,460,514 | 1,000,000 |
| Consumption records | 56,791 | 530,992 | 500,000 |
| Waste records | 3,978 | 69,448 | 50,000 |
| Purchase lines / invoices | 8,172 / 4,285 | 122,769 / 67,470 | 100,000 / 50,000 |
| Minibar transactions | 5,897 | 49,368 | 10,000 |
| Buffet sessions | 200 | 1,000 | 1,000 |
| Rooms / employees | 1,020 / 5,000 | 1,020 / 5,000 | 1,000 / 5,000 |
| Expenses | 6,800 | 119,561 | 100,000 |

Generation time on this container: dev ≈ 10 min, staging ≈ 64 min (including verification).
