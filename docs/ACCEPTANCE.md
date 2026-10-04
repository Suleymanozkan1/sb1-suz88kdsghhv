# Acceptance: spec → implementation → evidence

Each area of the master specification is listed with where it lives and what proves it. Test paths are relative to `tests/`.

## Core cost engine (Phase 1)

| Area | Implementation | Evidence |
|---|---|---|
| Money, rounding, UOM conversions | `src/domain/money.ts`, `src/domain/uom.ts` | `unit/money-uom` |
| Purchasing, landed cost, price variance, approvals | `src/domain/landed-cost.ts`, `purchasing.ts`, `server/services/purchasing.ts` | `unit/landed-costing`, `integration/ledger-purchasing`, `e2e/cost-flows` |
| Append-only stock ledger, WAC/FIFO, transfers, counts, periods | `server/services/ledger.ts`, DB triggers `LEDGER_IMMUTABLE` | `integration/ledger-purchasing`, `integration/hardening` |
| Recipes, sub-recipes, frozen versions, yield | `src/domain/recipe-cost.ts`, `yield.ts`, `server/services/recipes.ts`, trigger `RECIPE_VERSION_FROZEN` | `unit/yield-recipe`, `integration/recipe-variance` |
| Waste, staff meals, complimentary items, approvals | `src/domain/waste.ts`, `server/services/waste.ts`, `approvals.ts` | `integration/approvals-waste` |
| Theoretical vs actual, explained/unexplained variance | `src/domain/variance.ts`, `server/services/variance.ts` | `unit/variance-waste-purchasing`, `integration/recipe-variance` |
| Roles, department scope, audit, data quality | `server/auth/*`, `services/audit.ts`, `src/domain/quality.ts` | `integration/security`, `integration/hardening` |

## Excel layer (Phase 1b)

| Area | Implementation | Evidence |
|---|---|---|
| One `.xlsm` with the "TÜM COST RAPORLARINI OLUŞTUR" button and 56 report sheets | `server/excel/workbook.ts`, `package.ts`, `vba/*.bas` | `integration/excel-export`, `unit/vba-project`, LibreOffice `scripts/lo-validate.py` |
| No credentials in the file; secure API with tokens | `api/export/*`, `createApiToken` | `integration/excel-export` (permissions), `unit/vba-project` (source gates) |
| App figures = Excel figures | One export contract, `exportVersion` 1.2 | `integration/excel-export`, reconciliation checks |

## Buffet and minibar (Phase 2)

Buffet sessions, leftover classification, cost per cover, forecast; minibar par, room sub-ledger, shrinkage. Implemented in `domain/buffet.ts`, `domain/minibar.ts` and the matching services. Evidence: `unit/buffet-minibar`, `integration/buffet-minibar`, `e2e/buffet-minibar`.

## Rooms and operating costs (Phase 3)

Expenses, assets, meters, laundry, PMS/reservations, the allocation engine, room cost and the P&L down to GOP/EBITDA. Implemented in `domain/allocation.ts`, `domain/rooms.ts` and the `opex`, `pms`, `allocation`, `operations` services. Evidence: `unit/rooms-allocation`, `integration/rooms-opex`, `e2e/rooms-opex`.

## Planning (Phase 4)

Budget workflow (DRAFT → APPROVED, frozen → revised), targets, forecast, scenarios, what-if, menu engineering, savings. Implemented in `domain/planning.ts` and the `planning` and `savings` services. Evidence: `unit/planning`, `integration/planning`, `e2e/planning`.

## Reports, imports and month-end (Phase 5)

Report archive with content and period hashes, reproducibility check, PDF management pack, CSV/XLSX import engine with preview and rollback, month-end checklist (RED/YELLOW/GREEN), control calendar, weekly review. Evidence: `integration/reports-imports`, `e2e/reports-calendar`.

## Performance, hardening, full E2E (Phase 6)

| Spec area | Implementation | Evidence |
|---|---|---|
| 286 Negative testing | Validation in every service | `integration/hardening` › negative testing |
| 292–293 Volume and performance | Query, aggregation and Excel bulk fast path | `scripts/stress.ts`, `docs/PERFORMANCE.md`, `unit/excel-bulk` |
| 295 Concurrency | Row and advisory locks; unique buffet key; period lock | `integration/hardening` › concurrency (5 parallel tests) |
| 296 Idempotency | Idempotency keys; duplicate-file detection | `integration/hardening` › idempotency |
| 300–305 Integrity, rebuild, interrupted runs, reprocessing | `server/services/integrity.ts`, `/integrity` | `integration/hardening` › cost engine safety, `e2e/hardening` |
| 274 Tenant isolation (IDOR) | Hotel scope on every object | `integration/hardening` › tenant isolation, `integration/security` |
| Security headers / CSP | `next.config.ts` | `e2e/hardening` (no CSP violations on the production build) |
| Accessibility | Contrast palette; keyboard-scrollable tables | `e2e/hardening` (axe-core WCAG 2 A/AA, 11 screens) |
| Background export; shared rate limits | `services/export-jobs.ts`, `RateLimitBucket` | `integration/export-jobs`, `e2e/hardening` |
| Backup and restore | `scripts/ops/*` | `npm run ops:verify-restore`: identical counts, ledger totals and export hash |

## Known limitations (honest)

- **Excel:** there is no Microsoft Excel in CI. The `.xlsm` is validated structurally (oletools) and in LibreOffice (load, VBA compile and execution of pure routines, formula checks). The first refresh in Windows Excel is the final acceptance step. Mac Excel can open the prefilled workbook but cannot refresh it.
- **Browsers:** Playwright runs on Chromium (desktop + Pixel 7 mobile). Firefox/WebKit projects exist (`E2E_ALL_BROWSERS=1`) but are not installed in this environment.
- **Large exports:** a 100k-line month takes about 80 s to build. Use background export for such months; the synchronous download remains for normal months.
- **External integrations:** POS, PMS and accounting data arrive through file and API imports. There are no live vendor connectors.
