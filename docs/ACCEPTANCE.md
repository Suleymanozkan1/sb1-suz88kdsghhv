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

## Multi-tenant SaaS + demo data + full validation (second specification)

| Spec | Implementation | Evidence |
|---|---|---|
| 1–4, 149, 152, 156 Shared platform, tenant-scoped rows, hierarchy | `Organization → Hotel → Department → CostCenter → Warehouse`; every operational row is hotel-scoped. Scaling path in `docs/MULTI_TENANCY.md`. | Schema, `tenancy.test.ts` |
| 5–10, 13–15 Isolation on every layer; tenant context from the session | `actors.ts`, `authorize`, `assertHotelRefs`, `warehouseScope`, DB `hc_same_hotel` triggers | `tenancy.test.ts` (tenant, hotel and department matrices; ID swapping; linked foreign IDs; DB triggers), `hardening.test.ts`, `security.test.ts` |
| 11–12, 29–35 Super admin, company admin, tenant / hotel creation, invitations, assignment, hotel switch | `services/tenancy.ts`, `services/admin.ts`, `/platform`, `/admin`, `/invite` | `tenancy.test.ts` (lifecycle), `e2e/tenancy.spec.ts` |
| 16–23 Report, Excel, PDF, dashboard, cache and job isolation | Hotel-scoped export service; export jobs reload the actor, owner-only download; no shared caches | `tenancy.test.ts` (export leak), `export-jobs.test.ts`, `demo:verify` (Excel XML scan) |
| 24–25 DB constraints; per-tenant uniqueness | Tenant-consistency triggers; `@@unique([hotelId, sku])` etc. | `tenancy.test.ts` (same SKU in two tenants; trigger refusals) |
| 26–28, 142–143 Soft delete, financial isolation, multi-tenant audit, super-admin audit | Deactivate-only master data; immutable ledgers; `AuditLog.organizationId` enforced by trigger; `PLATFORM_*` actions in the tenant trail | `tenancy.test.ts` |
| 37–83 Demo tenants, hotels, master data, volumes, scenarios, intentional errors | `src/server/demo/*`; `DemoScenario` | `docs/DEMO_DATA.md`; `demo:verify` counts |
| 84–90 Post-seed checks and reconciliations | `src/server/demo/verify.ts` | `test:reconciliation`; dev run: 131 checks PASS |
| 91–94, 119 Tenant, hotel, department and export matrices | | `tenancy.test.ts`, `permissions.test.ts` (role × 14 capabilities through real services) |
| 95 Full E2E demo flow | | `full-flow.test.ts` (fresh tenant → … → Excel); Playwright suite |
| 98–101, 127–130 Performance, background processing, load | Export jobs, bulk Excel, shared rate limits | `scripts/demo-perf.ts` on staging; `docs/PERFORMANCE.md` |
| 102–106 Error injection, recovery, idempotency, concurrency, transaction integrity | | `hardening.test.ts` (parallel posting, duplicate imports, interrupted runs, rebuild), `export-jobs.test.ts` (stale / failed jobs) |
| 107–112 Audit, historical price, recipe and stock integrity, month close and reopen | | `full-flow.test.ts` (closed month refuses postings), `demo:verify` (sales use their own version), existing period tests |
| 113–114 Data quality detects the intentional errors and the score drops | New checks: implausible yield, missing conversion, future-dated records | `demo:verify` |
| 115 Security tests | | IDOR / tenant escape: `tenancy.test.ts`. Privilege escalation: `permissions.test.ts`, `tenancy.test.ts`. SQL injection: `security.test.ts`. XSS, CSRF, oversized and malformed body: `e2e/hardening.spec.ts`. Session abuse: `hardening.test.ts`, `tenancy.test.ts`. Rate limiting: `export-jobs.test.ts`. |
| 116–118 Test users per company; dev-only passwords | `generate.ts` (`DEMO_PASSWORD`) | `demo-dataset.test.ts` |
| 120–124 Tenant deletion (authorised, demo only), backup, reset, production safety | `demo/reset.ts` (FK-ordered purge), `ops:*` scripts | `demo-dataset.test.ts` |
| 125–126, 154 Commands | `seed`, `seed:demo`, `seed:qa`, `seed:staging`, `demo:reset`, `demo:verify`, `test:tenant-isolation`, `test:permissions`, `test:reconciliation`, `test:excel` | package.json |
| 144–148 Onboarding, default master data, customization, no hard-coded tenants | `createTenant`, `applyHotelDefaults`, admin screens; no tenant names in code (demo names only in the generator) | `tenancy.test.ts`, `e2e/tenancy.spec.ts` |
| On-premise Windows installation | `installer/*` | `docs/WINDOWS_INSTALL.md` (setup tested end to end on Linux) |

## Known limitations (honest)

- **Excel:** there is no Microsoft Excel in CI. The `.xlsm` is validated structurally (oletools) and in LibreOffice (load, VBA compile and execution of pure routines, formula checks). The first refresh in Windows Excel is the final acceptance step. Mac Excel can open the prefilled workbook but cannot refresh it.
- **Browsers:** Playwright runs on Chromium (desktop + Pixel 7 mobile). Firefox/WebKit projects exist (`E2E_ALL_BROWSERS=1`) but are not installed in this environment.
- **Large exports:** a 100k-line month takes about 80 s to build. Use background export for such months; the synchronous download remains for normal months.
- **External integrations:** POS, PMS and accounting data arrive through file and API imports. There are no live vendor connectors.
- **Windows installer:** only the setup logic was tested here, on Linux. The Windows-specific steps (`pg_ctl register` service, WinSW, `icacls`, firewall, shortcuts) still need one run on a real Windows PC.
- **Notifications, e-mail and attachments (spec 136-141):** there is no e-mail sender and no file attachment store yet. Invitations are delivered as links by the administrator. When those features are added they must use the same hotel-scoped services.
- **Organization switch (spec 36):** a user belongs to one organization; multi-company people get one account per company.
