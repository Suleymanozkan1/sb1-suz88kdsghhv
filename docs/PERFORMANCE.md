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

## Limits and recommendations

- A 100k-line month takes about 80 s to export to Excel. For hotels at this volume, schedule the workbook overnight (cron calling `GET /api/export/workbook`) or use the TSV/CSV endpoints. The request is synchronous; reverse proxies must allow at least 120 s.
- The rate limiter is in memory, per Node process. Behind several instances, put the limits in the proxy (or in Redis).
- Measurements come from one container. Production sizing should be re-measured on the target hardware with `npm run stress:measure`.
