# Operations runbook

## Backup

```bash
DATABASE_URL=postgresql://…/hotelcost npm run ops:backup -- /var/backups/hotelcost   # KEEP=14 by default
```

- `pg_dump --format=custom` takes a single snapshot, so the ledgers, balances, cost postings and archives in a backup are always mutually consistent.
- A `.sha256` file is written next to each dump. Old dumps beyond `KEEP` are pruned.
- Schedule it at least daily (for example `15 2 * * *`) and copy the dumps off-host.
- Take an extra backup before every period close and before every migration.

## Restore

```bash
TARGET_URL=postgresql://…/hotelcost_restore npm run ops:restore -- /var/backups/hotelcost/hotelcost_YYYYMMDDTHHMMSSZ.dump
SOURCE_URL=postgresql://…/hotelcost TARGET_URL=postgresql://…/hotelcost_restore npm run ops:verify-restore
```

- `restore.sh` first verifies the checksum and creates the target database if it is missing.
- It refuses a non-empty target unless `FORCE=1` is set.
- It restores in one transaction, so a failed restore leaves nothing half-written.

`verify-restore.ts` compares source and restore:

- the row count of every table;
- ledger totals (stock value, quantity, cost ledger, balances);
- immutability triggers;
- the full cost export content hash per hotel (same period → same hash).

It then runs the integrity check on the restored copy. Exit code 0 means the restore is the same cost operation.

Tested end to end on the seeded database: 72 tables and 28,722 rows, with identical ledger totals and export hash.

**Restore drill:** do it monthly into a scratch database, then drop that database.

## Integrity and recovery (spec 300–305)

- **`/integrity`** (or `POST /api/integrity/check`) checks:
  - balances = ledger;
  - FIFO layers = balance;
  - every usage movement has a cost-ledger row with a matching amount;
  - expenses ↔ cost ledger;
  - allocations net to zero;
  - approved recipe versions carry their snapshot;
  - no negative stock;
  - minibar sub-ledger = in-room warehouse;
  - unmapped sales;
  - failed or interrupted calculation runs.
- **Rebuild balances from ledger** (permission `period:close_override`, reason required) recomputes only the derived `StockBalance` table from the immutable ledger. Every correction is logged in the run and in the audit trail. Ledgers are never modified.
- **Interrupted calculations:** a calculation still `RUNNING` after 30 minutes is shown as `PENDING_REPROCESS`.
- **Reprocess unmapped sales:** once a recipe mapping exists, this posts the theoretical cost for sales in open periods. Closed periods are left unchanged and reported (`PARTIAL`).

## Concurrency guarantees (spec 295–296)

| Situation | Guard |
|---|---|
| Parallel issues, receipts or transfers on one product | Row lock on the balance (`FOR UPDATE`) inside the posting transaction; negative stock is refused |
| Same import file submitted twice at once | `pg_advisory_xact_lock(hotel, kind, fileHash)` + duplicate check → imported once |
| Same buffet session opened twice | Unique index `(hotelId, departmentId, type, serviceDate)` |
| Allocation posted twice for one period | Period row lock + one-run-per-period check |
| API retries | `Idempotency-Key` on movement endpoints |

## Security

- Sessions are httpOnly, SameSite=Lax cookies (`secure` in production). Only token hashes are stored, and a deactivated user's session is refused at once.
- Excel/API bearer tokens are personal, expire after 30 days and are stored as hashes. No credentials are stored in the `.xlsm`.
- Rate limits apply to login (per IP and per e-mail) and to exports (30 per hour per user).
- Every service authorizes before validating. Hotel and department scope is checked on every object, so cross-hotel IDs are refused (IDOR tests in `tests/integration/hardening.test.ts`).
- Security headers:
  - CSP without `'unsafe-eval'` in production, plus `object-src 'none'` and `frame-ancestors 'none'`;
  - HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- Exported CSV and Excel text is neutralized against formula injection.
- All postings, approvals, overrides, rebuilds and exports are audited.

## Deployment checklist

1. Backup (`ops:backup`).
2. `npx prisma migrate deploy` (non-interactive; never `migrate reset` in production).
3. `npm run build && npm start` behind TLS. Allow request timeouts of at least 120 s for `/api/export/workbook`.
4. Smoke test: `/api/health`, log in, run an integrity check.
5. Monitor: failed calculation runs (`/integrity`), the export error log in the workbook, and the audit trail.
