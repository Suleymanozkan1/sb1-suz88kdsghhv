# HotelCost — Hotel Cost Control Platform

Cost intelligence for hotels: **purchase → stock → recipe → yield → consumption → waste → actual vs theoretical → variance → department / product cost**, with every figure traceable to source transactions — plus a macro-enabled **Excel reporting layer** (`.xlsm`) that uses the same cost engine.

> Status: **Phase 1 (core cost engine) + Phase 1b (Excel layer) + Phase 2 (buffet & minibar) + Phase 3 (rooms & operating costs)**. Budget and forecast are on the roadmap; wherever they appear (screens, exports, Excel) they are marked `NOT_AVAILABLE` — never shown as zero.

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
| 4 | Budget, forecast, what-if, saving actions, menu engineering |
| 5 | Report archive/PDF pack, Excel/CSV import engine, month-end management pack |
| 6 | Performance at 100k+ volumes, security hardening, full E2E simulation |
