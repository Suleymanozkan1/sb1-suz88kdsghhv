# Performance at volume (spec 292–293)

`scripts/stress.ts` builds a separate, internally consistent hotel and times the heavy read paths.

```bash
createdb hotelcost_stress
DATABASE_URL=postgresql://…/hotelcost_stress npx prisma migrate deploy
DATABASE_URL=postgresql://…/hotelcost_stress npm run stress:seed      # ~5 min
DATABASE_URL=postgresql://…/hotelcost_stress npm run stress:measure   # SKIP_EXCEL=1 to skip the workbook; STRESS_OUT=file.json
```

The stress hotel holds 10,000 products, 5,000 recipes, 100,000 stock transactions (20,000 of them waste), 100,000 sales lines and 50,000 purchase lines, all in one month.

## Results

Single PostgreSQL 16 instance on the CI container; Node 22. Times are wall-clock for one request.

| Path | Before tuning | After |
|---|---:|---:|
| Theoretical vs actual (month, 10k products) | 10.7 s | **2.1 s** |
| Dashboard | 11.7 s | **3.5 s** |
| Inventory status (10k products) | 4.9 s | **0.9 s** |
| Product search | — | **31 ms** |
| Recipe list (5k recipes, costed) | — | **2.6 s** |
| Menu engineering (100k sales) | — | **1.9 s** |
| Integrity check (all ledgers) | — | **0.35 s** |
| Full cost export, JSON (455,000 rows in all sections) | 104 s | **49 s** |
| TSV rendering (71 MB) | — | 1.2 s |
| Excel `.xlsm`, including the export (36.7 MB, 61 sheets) | 448 s | **82 s** |

## What changed

- **Variance:** sales are aggregated per recipe version in SQL (`groupBy`) instead of loading 100,000 lines. Unmapped sales are summed separately.
- **Inventory status:** O(n²) `find`/`filter` scans were replaced by `Map` indexes.
- **Export:** lighter queries. Products, departments, warehouses, cost centers, suppliers, recipes and versions are hydrated from in-memory maps instead of nested Prisma includes. Each section is hashed once.
- **Excel:**
  - Tables with more than `BULK_THRESHOLD` (2,000) rows get only their first data row from ExcelJS. The packager (`src/server/excel/package.ts`) streams the remaining rows straight into the sheet XML, reusing ExcelJS's cell styles, and then widens the table, autofilter and dimension refs.
  - ExcelJS `writeBuffer` dropped from 297 s to about 1 s.
  - Covered by `tests/unit/excel-bulk.test.ts`.
  - The 100k-row stress workbook was validated in LibreOffice: it loads, the VBA compiles and all 10 formula checks pass.
- **Indexes:** the existing composite indexes on `(hotelId, productId, txDate)`, `(warehouseId, productId, txDate)` and `(hotelId, saleDate)` carry the hot queries. No sequential scans remain on the measured paths.

## Multi-tenant staging dataset (spec 98, 127-130)

`npm run seed:staging` generates the full dataset in 64 min on this container, then verifies it (131 checks PASS):
- 5 companies, 10 hotels, 2,004 products, 601 recipes (100 semi-finished, 902 versions), 120 suppliers;
- 1,460,514 stock transactions, 540,904 sale lines, 530,992 consumption records, 69,448 waste records;
- 122,769 purchase lines, 67,470 invoices, 49,368 minibar transactions, 1,000 buffet sessions;
- 1,020 rooms, 5,000 employees, 119,561 expenses.

`npx tsx scripts/demo-perf.ts` ran on the busiest hotel (DHG-AYT: 155,884 stock transactions, 58,448 sale lines; month 2026-08):

| Path | Time |
|---|---:|
| Dashboard (month) | 0.3 s |
| Theoretical vs actual (month / full 13 months) | 0.13 s / 0.19 s |
| Inventory valuation and status | 0.13 s |
| Recipe cost (all recipes) | 0.11 s |
| Department / operating cost (month) | 0.24 s |
| Room cost (month) | 0.07 s |
| Budget vs actual (month) | 0.21 s |
| Integrity check (all ledgers of the hotel) | 5.9 s |
| Monthly cost report: full export, 30,763 rows | 11.1 s |
| Five month-end exports from five companies in parallel | 29.4 s |
| Excel workbook, full 13 months, 36.3 MB | 66.2 s |
| Excel read-back (61 sheets; raw sales 53,396 rows = export) | 27.1 s |

The tables stay fast because the hot queries aggregate in SQL and the per-hotel indexes keep each tenant's slice small, whatever the total volume. Full-year Excel workbooks belong in background export (or on a server without a function time limit).

## Large periods: background export

- On the Excel page, **Generate in background** (`POST /api/export/jobs`) queues the workbook. The server builds it while the user keeps working, and the list polls until the file is ready.
- The download (`GET /api/export/jobs/{id}/download`) is kept for `EXPORT_JOB_TTL_HOURS` (default 24) and is visible only to the user who queued it.
- Jobs are claimed atomically, so they never run twice. Each user can have at most 2 active jobs.
- A job's user is re-checked when it runs: a deactivated user's job fails.
- Jobs interrupted by a restart are marked `FAILED` after 30 minutes, never left hanging.
- The synchronous `GET /api/export/workbook` remains for normal months. Reverse proxies should allow at least 120 s for it.

## Limits and recommendations

- Rate limits (login per IP and per e-mail, exports per user) are fixed-window counters in PostgreSQL (`RateLimitBucket`). They hold across any number of app instances. Login limits are configurable with `RATE_LIMIT_LOGIN_PER_IP` and `RATE_LIMIT_LOGIN_PER_EMAIL`.
- Measurements come from one container. Production sizing should be re-measured on the target hardware with `npm run stress:measure`.
