# Multi-tenancy

HotelCost is one application and one code base on shared infrastructure. Tenant data is isolated row by row. The hierarchy is:

```
Platform (operator, no tenant data)
└── Organization (company / tenant)
    └── Hotel
        └── Department ── Cost center
            └── Warehouse / outlet
                └── Operational data (stock, recipes, sales, waste, costs, reports…)
```

## Isolation layers (spec 5–10)

| Layer | Mechanism |
|---|---|
| Session | The tenant context comes from the authenticated user: organization, hotels, departments and role, loaded from the database on every request (`src/server/auth/actors.ts`). A client-sent `hotelId` is only a choice among the user's own hotels. |
| Hotels | Suspended hotels or tenants drop out of the context immediately. Tenant suspension also ends every open session. |
| Authorization | `authorize(actor, permission, { hotelId, departmentId })` runs at the start of every service. It checks four dimensions: role permission, organization (through the hotels), hotel and department. |
| Services | Every lookup by ID is scoped (`findFirst({ where: { id, hotelId } })`). Linked IDs (product, department, warehouse, category, supplier) are checked with `assertHotelRefs`. Department-scoped users are limited by `requireDepartment`, `requireWarehouseScope` and `warehouseScope`. |
| Database | `hc_same_hotel` triggers on every hotel-scoped foreign key, and on child documents through their parent, reject a row that references another hotel (`TENANT_MISMATCH`). Further triggers keep user↔hotel and user↔department grants inside one organization and keep audit rows consistent with their hotel's organization. |
| Exports | Excel, PDF, CSV and API exports are built from the hotel-scoped export service. Tests scan the output for any ID or name of another tenant. |
| Background jobs | Export jobs store hotel and user, reload the actor when they run (a deactivated user's job fails) and serve the file only to its owner. |
| Rate limits | Counters in PostgreSQL are keyed by user or IP and shared by all instances. |
| Audit | Every audit row carries organization and hotel. Platform actions on a tenant are written into that tenant's trail with a `PLATFORM_` prefix. |

There is no application cache holding tenant data. Pages render per request, so no cache key can leak between tenants.

## Roles

| Role | Scope |
|---|---|
| Platform super admin (`platform:admin`) | Lives in the platform organization, which owns no hotels. Creates, suspends and (demo tenants only) deletes tenants. Sees tenant metadata and counts, never costs, stock or revenue. |
| Company administrator (`admin:users`, `admin:hotels`) | Manages users (create, invite, role, hotels, departments, deactivate, reset password), hotels, departments with cost centers, warehouses, categories and thresholds of its own company. Cannot manage a user who also works in a hotel the administrator does not administer. Cannot demote the last administrator. |
| Cost controller, accounting, purchasing, F&B, chefs, rooms division, storekeeper, viewer | Fixed permission templates per tenant. Department-scoped roles see only their departments. |

The whole matrix is verified by calling the real services (`tests/integration/permissions.test.ts`).

## Onboarding

1. The platform creates the company with its first hotel, which gets standard departments, cost centers, warehouses and categories. This produces a single-use invitation link (7 days) for the company administrator.
2. The administrator accepts the link and sets their own password, then invites or creates users, adds hotels and adjusts the structure under **Administration**.
3. Users with several hotels switch between them in the sidebar. Every query follows the active hotel.

Users belong to exactly one organization. A consultant who works for two companies gets two accounts, which keeps the tenant boundary simple and auditable.

## Uniqueness per tenant

Business keys are unique inside a hotel, not globally: SKU, supplier code, department code, warehouse code, invoice number, count and GRN numbers. Two tenants may both have `BURGER-001`. User e-mails are global, because they are the login.

## Data lifecycle

- **Master data** is deactivated, never deleted.
- **Ledgers** (stock, cost, audit, approved recipe versions, approved budgets, posted expenses) are append-only and enforced by database triggers.
- **Real tenants** are suspended, never erased.
- **Demo tenants** (`isDemo`) can be removed by the platform admin or `npm run demo:reset`. This works outside production only, as one transaction in foreign-key order derived from the live schema.

## Scaling path (spec 149, 156)

Shared database with tenant-scoped rows serves one to a few hundred companies on a single PostgreSQL. Everything that needs to scale is already separated:

- **Application:** stateless Next.js servers, with sessions and rate limits in PostgreSQL. Add instances behind a load balancer.
- **Background work:** export jobs can be claimed by any instance (atomic claim) and moved to dedicated worker processes.
- **Reads:** reports and exports are read-only and can be pointed at a read replica (a second Prisma client).
- **Files:** export files are stored in the database today. Swapping them to object storage only touches `ExportJob.file`.
- **Database per tenant:** every service takes `db` as a parameter and every query is hotel-scoped. Routing a tenant to its own database or schema is a connection choice at the request boundary, not a rewrite.
