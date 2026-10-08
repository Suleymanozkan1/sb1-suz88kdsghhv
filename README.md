# HotelCost — Hotel Cost Control Platform

Cost intelligence for hotels: **purchase → stock → recipe → yield → consumption → waste → actual vs theoretical → variance → department / product cost**, with every figure traceable to source transactions — plus a macro-enabled **Excel reporting layer** (`.xlsm`) that uses the same cost engine.

> Status: **all six phases are implemented**: core cost engine, Excel layer, buffet & minibar, rooms & operating costs, planning, reports/imports/month-end, plus performance, hardening and full E2E. Wherever source data is missing, screens, exports and Excel show the figure as `NOT_AVAILABLE` / `INSUFFICIENT_DATA`, never as zero. Spec ↔ implementation ↔ tests: [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md).

> Micros / Opera automation (nightly bot, ingest API, run log), automatic ordering and plans: [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md).

## Quick start

```bash
cp .env.example .env                       # DATABASE_URL etc.
npm install
npx prisma migrate deploy                  # create schema (incl. ledger immutability triggers)
npm run db:seed                            # realistic demo month for "Grand Anatolia Resort"
npm run build && npm start                 # http://localhost:3000
```
Demo users (password `HotelCost!2026`): `controller@`, `fb@`, `chef@`, `breakfast@`, `pastry@`, `purchasing@`, `accounting@`, `warehouse@`, `rooms@`, `admin@grandanatolia.test`.
Docker: `docker compose up --build` (then run the seed inside the app container if you want demo data).

## Architecture

```
src/domain/           pure, decimal-only cost engine (no I/O): uom, landed-cost, costing (WAC/FIFO),
                      yield, recipe-cost (sub-recipe cascade), consumption, variance, waste, purchasing, quality
src/server/services/  application services (Prisma, transactions, authorization, audit)
src/server/excel/     Excel reporting layer: workbook builder, MS-OVBA vbaProject writer, xlsm packager, VBA sources
src/app/              Next.js App Router UI + REST API (src/app/api/**)
prisma/               schema, migrations (append-only ledger triggers), seed
tests/                unit (golden formulas), integration (real Postgres), e2e (Playwright)
```

Principles enforced in code and tests:
- **One cost engine.** Screens, dashboard, CSV and Excel all read the same services (`theoreticalVsActual`, `costRecipe`, …).
- **Decimal only.** `decimal.js` + `DECIMAL(20,6)`; rounding only at presentation boundaries (`src/domain/money.ts`).
- **Append-only ledgers.** `StockTransaction`, `CostTransaction`, `AuditLog` reject UPDATE/DELETE at database level; corrections are approved reversals.
- **Historical freeze.** Approved recipe versions are immutable (DB trigger); each sale freezes its version and theoretical cost.
- **No false precision.** Every figure carries ACTUAL / THEORETICAL / ESTIMATED / NOT_AVAILABLE / INSUFFICIENT_DATA; data-quality score gates confidence.
- **Server-side authorization** on every service call: RBAC permissions, hotel isolation (IDOR-tested), department isolation, separate export permission.

## Core formulas

| Metric | Formula |
|---|---|
| Actual cost (COGS) | Opening + Purchases + Transfers in − Transfers out − Closing |
| Theoretical cost | Σ qty sold × cost of the recipe version effective on the sale date |
| Variance | Actual − Theoretical |
| Unexplained | Variance − Price/timing − Recorded waste − Staff meals − Complimentary − Buffet consumption − Minibar consumption |
| Buffet food cost | Production + refills (ledger cost) − returned leftovers − staff meal; **cost / cover** = food cost / actual covers |
| Full room cost | Housekeeping + Laundry + Amenities + Energy + Maintenance + Labor + Other (direct + allocated) + Distribution |
| Room cost / night | Full room cost / occupied room nights; per room = rooms-division pool × (nights × m²) / Σ + room-tagged costs + channel cost |
| Cost per occupied / available room | Hotel operating cost (excl. rent, insurance, depreciation) / occupied (available) room nights |
| Net room contribution | Gross room revenue − commission − payment fee − other distribution − room cost |
| Allocation | Source cost × destination driver / Σ drivers, exact to 6 decimals (largest remainder), per cost category |
| GOP | Revenue − cost of sales − labor − energy − departmental expenses − A&G − S&M/distribution |
| Budget variance | Actual − budget (positive = over budget); variance % = variance / budget; YTD = Jan → period end |
| Forecast | Fixed share × average monthly cost + variable rate × expected volume (occupied rooms, or covers for F&B) × (1 + known price change); running month = actual + rate × remaining volume |
| Menu engineering | High seller: menu mix ≥ 70 % × 1/n; high margin: contribution / unit ≥ weighted average → Star, Plowhorse, Puzzle, Dog |
| Saving | Current − potential (formula + assumption per opportunity); gap = target − realized |
| Minibar contribution | Revenue − cost of consumed items; shrinkage = expected room qty − counted qty (posted as count adjustment) |
| Landed cost | Net price − discount + freight + shipping + customs + handling + other (tax separate) |
| WAC | (Old qty × old avg + received qty × landed unit cost) / total qty |
| Yield / required AP | EP / AP ; AP = EP / yield |
| Recipe line | AP qty × unit cost × (1 + standard waste %) |
| Order recommendation | Expected consumption + safety stock + lead-time demand − stock − open PO, rounded up to purchase units |

The workbook's `49_FORMULAS` sheet lists all formulas in English and Turkish.

## Buffet & minibar (Phase 2)

**Buffet** (`/buffet`, `/api/buffet/*`): a session = date + meal + outlet. Production and refill lines (products or recipe dishes, exploded to ingredients) are issued from stock through the ledger (`sourceType=BUFFET`). At close, leftovers are classified once: *reusable* returns to stock at the original cost, *waste* posts a `WASTE` movement + `BUFFET_LEFTOVER` waste record, *staff meal* posts `STAFF_MEAL` — so food is never counted both as consumption and as waste. KPIs: input cost, food cost, cost/cover, waste/cover, waste %, leftover %, oversupply, category split, grams per guest (estimated), and a forecast from comparable sessions.

**Minibar** (`/minibar`, `/api/minibar/*`): items stay in inventory until consumed. A *Minibar store* and an *in-room* warehouse are created on first use; each room has a sub-ledger (`MinibarMovement`): restock (transfer to rooms), consumption (cost + revenue, folio ref), return, waste and physical count (difference = shrinkage). Par levels per room type or room; "restock to par" in one click. Invariant (checked in every export): Σ room quantities = in-room warehouse balance.

Both feed the variance engine as documented causes (`BUFFET_CONSUMPTION`, `MINIBAR_CONSUMPTION`) — they have no POS sale behind them, so they are not reported as unexplained — and fill Excel sheets 14–17 (buffet cost, summary, product; minibar cost), with pivots and the cost/cover chart.

## Rooms & operating costs (Phase 3)

- **Expenses** (`/operations`, `/api/opex/*`): housekeeping, amenities, laundry, labor (payroll), energy (per utility), engineering (per asset / room), A&G, S&M, rent, insurance, depreciation. Each expense posts one `CostTransaction` (kind `EXPENSE`, DIRECT); posted expenses cannot be edited or deleted (DB trigger) — they are reversed.
- **Imports** (`/imports`, `/api/imports/{expenses|occupancy|reservations}/{preview|commit}`): accounting / payroll / utility CSV and PMS daily statistics + reservations. Preview first, all-or-nothing, the same file cannot be posted twice (content hash), every batch can be rolled back (expenses through ledger reversals).
- **Allocation** (`/allocation`, `/api/allocation/*`): rules (source category / sub-category / department → destinations) with drivers revenue, covers, m², headcount, sub-meter consumption or fixed weights. Preview → post (ALLOCATED rows, net zero for the hotel, one run per period) → reverse. An "ALL" rule keeps each cost category, so allocated payroll stays labor.
- **Room cost** (`/rooms`): rooms-division cost (Rooms, Housekeeping, Laundry incl. allocations) split to rooms by occupied nights × m², plus room-tagged costs and channel cost; by room, type, floor, area and channel; CPOR, CPAR, cost per guest, cost per stay; warnings when allocation or occupancy is missing.
- **Module reports**: housekeeping (per occupied room / guest night), laundry (per kg / piece / occupied room, linen lost / damaged / discarded / replacement), labor (by department, cost %), energy (billed vs metered, unit cost, per room / m²), engineering (by type, emergency vs preventive, cost per asset).
- **Excel**: sheets 18–24 and 37 are filled (plus floor/area, channel, linen, meter and asset tables); P&L reaches GOP and EBITDA when payroll, energy and occupancy data exist (never estimated). Export contract `exportVersion` 1.1.

## Planning (Phase 4)

- **Budget & targets** (`/budget`, `/api/budgets/*`, `/api/targets`): budgets per year (month × department × category, revenue lines and cost-% targets), CSV load, approval (frozen by DB trigger), revisions (copy × factor) that supersede the approved version. Budget vs actual by category and department, month and YTD. Configurable targets with early-warning level for food / beverage / waste / unexplained %, labor %, energy per room, room cost per night, CPOR, buffet cost per cover, minibar shrinkage.
- **Forecast & what-if** (`/forecast`, `/api/forecast`, `/api/what-if`): month forecast per category from the last 3 months (fixed / variable split), expected occupancy (input, or actual + on-the-books), covers, known price change; base / best / worst scenarios with revenue and result. What-if levers: ingredient price (with affected recipes and monthly impact), occupancy, buffet covers, waste points, labor, energy.
- **Menu engineering** (`/menu-engineering`): Kasavana–Smith classes from sales × frozen recipe cost, margin vs the hotel target, cost change since sale.
- **Savings** (`/savings`, `/api/savings/*`): opportunities (supplier price, waste, portion control, yield, recipe re-engineering, overstock carrying cost, energy, labor, OTA → direct) each with formula and stated assumption; actions with root cause, owner, due date, target vs realized saving, overdue flag.
- **Excel**: sheets 39–41 filled, menu engineering on sheet 54, department / cost-center budget columns; export contract `exportVersion` 1.2.

## Reports, imports and month-end (Phase 5)

- **Management cost pack** (`/reports`, `GET /api/reports/management-pack?from=&to=`): PDF with executive summary, F&B, rooms, labor, energy, laundry, housekeeping, engineering, purchasing & supplier changes, waste, stock, variance, top drivers, budget / P&L, recommended actions and the month-end checklist — rendered from the full-cost export (same engine as screens and Excel), DejaVu font for Turkish text.
- **Archive & reproducibility**: every export, pack and period close is stored with period, parameters, author, data version, content hash and a *period hash* over period-bound sections. `POST /api/reports/{id}/verify` rebuilds it and lists the sections that changed (only possible after a reopen).
- **Month-end**: checklist extended to buffets, minibar, invoices, production, POS / PMS coverage, payroll, utilities and allocation; status GREEN / YELLOW / RED; critical gaps block closing unless overridden with a reason; closing archives a PERIOD_CLOSE snapshot.
- **Import engine** (`/imports`): CSV or Excel (.xlsx, first sheet) or JSON rows for expenses, PMS occupancy, reservations, product master, supplier price lists / contracts (price-change warnings) and go-live opening stock. Preview shows valid / invalid / duplicate / warning; commits are all-or-nothing with file hash, format, mapping version and source row; rollbacks reverse ledger postings (expenses, opening stock) or remove statistics; used products are deactivated, never deleted.
- **Control calendar** (`/calendar`) with the standard recurring controls, due status, system evidence and audited completions; **weekly review** (`/review`) of top cost increases, waste, variance, critical / high stock, price and recipe changes. CSV download of any export table: `/api/export/{group}?format=csv&table=<key>`.

## Multi-tenant SaaS

One application, one code base and one shared database host many companies, each with several hotels. Data is isolated row by row on every layer:
- session-derived tenant context;
- authorization on role + hotel + department;
- tenant-scoped service queries;
- database triggers that reject any cross-hotel reference;
- export leak tests.

Roles and screens:
- **Platform super admin** (`/platform`): creates and suspends tenants, sees no tenant data.
- **Company administrator** (`/admin`): users and invitations, hotels, departments with cost centers, warehouses, categories, thresholds.
- Users switch between their hotels in the sidebar.

Details and scaling path: [`docs/MULTI_TENANCY.md`](docs/MULTI_TENANCY.md).

## Demo, QA and staging data

```bash
npm run seed:demo        # 5 companies, 10 hotels, ~2 months, 15 cost scenarios + intentional errors (~10 min)
npm run seed:staging     # 12 months: 1M+ stock transactions, 500k+ sales, 50k+ waste …
npm run demo:verify      # counts, integrity, 3-way cost reconciliation, recipe cost, history, data quality, isolation, Excel
npm run demo:reset       # removes demo tenants only; refused in production
```

Test users: `companyadmin@test.local`, `controller@test.local`, `chef@test.local`, … and `superadmin@test.local`; password `Demo!2026-QA` (dev/QA only).

Details: [`docs/DEMO_DATA.md`](docs/DEMO_DATA.md).

## Cloud deployment (Vercel)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FSuleymanozkan1%2Fsb1-suz88kdsghhv&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%7D%5D)

The deploy uses:
- Next.js on Vercel with a Neon PostgreSQL database;
- migrations applied during the build;
- the first company created with `npm run setup:first-company`.

Step by step: [`docs/VERCEL.md`](docs/VERCEL.md).

## Windows installer (on-premise)

`HotelCost-Setup-<version>.exe` (built with `bash installer/build-windows.sh`) installs:
- PostgreSQL 16, Node.js 22 and the web application as two auto-starting Windows services;
- the first company, through a short console dialogue;
- Start-menu shortcuts for backup, demo data, start, stop and status.

Upgrades keep the data and apply new migrations. See [`docs/WINDOWS_INSTALL.md`](docs/WINDOWS_INSTALL.md).

## Performance, hardening and operations (Phase 6)

- **Volume:** measured with 10k products, 5k recipes, 100k stock transactions, 100k sales and 50k purchase lines.
  - Interactive screens respond in under 3.6 s; the integrity check runs in 0.35 s.
  - The full Excel workbook takes 82 s (it was 448 s): large tables are streamed directly into the sheet XML.
  - Large months can be generated in the background from the Excel page.
  - Details: [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md).
- **Concurrency:**
  - balance row locks;
  - advisory lock against the same import file being posted twice at once;
  - a unique buffet session key;
  - one allocation run per period;
  - idempotency keys.
  - All of these are proven by parallel tests in `tests/integration/hardening.test.ts`.
- **Calculation integrity** (`/integrity`, `/api/integrity/*`):
  - ledger ↔ balance, FIFO, cost ledger, expense, allocation, recipe snapshot, minibar and run checks;
  - an audited rebuild of the derived balances from the immutable ledger;
  - interrupted runs flagged `PENDING_REPROCESS`;
  - reprocessing of late-mapped sales; closed periods are left untouched.
- **Security:**
  - authorize before validate on every service; IDOR tests cover Phase 3–5 objects;
  - a deactivated user's session is refused;
  - production CSP without `'unsafe-eval'`, plus `object-src 'none'`;
  - formula-injection-safe exports.
- **Accessibility:** axe-core WCAG 2 A/AA scan of the main screens and the login screen (`tests/e2e/hardening.spec.ts`): no serious or critical violations. Muted text colours were darkened to at least 4.5:1, and tables are keyboard-scrollable.
- **Backup and restore:**
  - `npm run ops:backup`, then `ops:restore`, then `ops:verify-restore`;
  - the verification compares per-table row counts, ledger totals, triggers and the export content hash, then runs the integrity check on the restored copy.
  - Runbook: [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Excel Full Cost Report (.xlsm)

Web app → **Excel Export** → *Download .xlsm* (`GET /api/export/workbook?from=YYYY-MM-DD&to=YYYY-MM-DD[&departmentId&warehouseId&group]`).

- Opens on **01_CONTROL** (parameters, export score, navigation) with the **TÜM COST RAPORLARINI OLUŞTUR / GENERATE FULL COST REPORT** button; 56 report sheets + hidden `RAW_*`, `RUN_LOG`, `_LISTS`.
- Every dataset is an Excel Table `tbl_<section>` with filters, frozen headers, number formats, conditional formatting, print setup.
- **Prefilled by the server** — valid without macros. With macros enabled (Windows Excel), the button runs `modMain.GenerateFullCostReport`: validate parameters → authenticated `GET /api/export/full-cost?format=tsv` (retry/backoff) → validate → bulk-write tables → pivots (`55_PIVOTS`) → charts (`53_DASHBOARD_CHARTS`) → reconciliation (`46_RECONCILIATION`) → format/protect → `RUN_LOG`. Failures are logged in `48_EXPORT_ERRORS` and never reported as success.
- **VBA does no cost math** — it writes server datasets and reconciles them. Sources: `src/server/excel/vba/*.bas` (ASCII; regenerate the embedded copy with `npm run vba:gen`).
- **Credentials:** none in the file. Create a 30-day personal token on the Excel Export page; the macro asks for it (or reads `HOTELCOST_TOKEN`) and keeps it in memory only.
- Contract: `GET /api/export/full-cost` (JSON, `exportVersion` 1.0) — sub-exports `/api/export/{cost|inventory|recipes|waste|purchasing|buffet|minibar|rooms|departments|pnl}`. Exports are rate-limited, audited and archived (`Report`).
- Security note for IT: scanners such as `olevba` flag the project for its HTTP download (MSXML), `Environ` and `Workbook_Open` — these are the refresh mechanism, documented in the workbook README sheet.

QA of the Excel layer: `tests/unit/vba-project.test.ts` (MS-OVBA compression/encryption round-trips, source gates), `tests/integration/excel-export.test.ts` (scenario: 100 kg chicken → 500 burgers → waste → count → close → export; app == Excel, permissions, workbook structure), Playwright download test, and independent validation:
```bash
npm run excel:sample -- controller@grandanatolia.test /tmp     # writes an .xlsm from the seeded DB
pip install oletools && olevba /tmp/HotelCost_Cost_Report_GAR_2026_09.xlsm
npm run excel:validate -- /tmp/HotelCost_Cost_Report_GAR_2026_09.xlsm   # LibreOffice Calc: loads, imports & compiles VBA, recalculates checks
```
Limitation: there is no Microsoft Excel in CI; VBA is validated structurally (oletools) and by LibreOffice import/compile/execution of pure routines. The first refresh in Windows Excel is the final acceptance test. Mac Excel can read the prefilled workbook but cannot refresh (no MSXML).

## Testing

```bash
npm run lint && npm run typecheck
npm test                    # unit + golden formula tests
npm run test:integration    # Postgres (TEST_DATABASE_URL), each file uses its own isolated hotel
npm run test:tenant-isolation   # tenant / hotel / department / export matrices, DB tenant triggers, lifecycle
npm run test:permissions        # role × capability matrix through the real services
npm run test:reconciliation     # tiny demo dataset → integrity, 3-way reconciliation, isolation, Excel; engine = services
npm run test:excel              # workbook fast path, VBA project, app = Excel
npm run test:e2e            # Playwright against hotelcost_e2e (seeded automatically)
npm run build
```

## Roadmap

| Phase | Scope |
|---|---|
| 1 ✅ | Domain, DB, UOM, purchasing/landed cost, ledger, WAC/FIFO, recipes/sub-recipes/versions, yield, waste, consumption, theoretical vs actual, variance, approvals, periods, audit, data quality, UI, API |
| 1b ✅ | Excel `.xlsm` reporting layer + export contract |
| 2 ✅ | Buffet sessions (production/refill/leftover, cost & waste per cover, forecast), minibar (par, room sub-ledger, shrinkage, contribution) |
| 3 ✅ | Rooms, housekeeping, laundry, labor, energy, engineering, allocation engine, PMS & accounting import |
| 4 ✅ | Budget, targets, forecast, scenarios, what-if, saving opportunities & actions, menu engineering |
| 5 ✅ | Report archive & reproducibility, PDF management pack, Excel/CSV import engine, month-end checklist, control calendar, weekly review |
| 6 ✅ | Performance at 100k+ volumes, concurrency & idempotency, integrity check / rebuild / reprocess, security & accessibility hardening, backup/restore verification, full E2E |
