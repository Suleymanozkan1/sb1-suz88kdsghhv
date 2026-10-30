# Deploying HotelCost on Vercel

HotelCost runs on Vercel as a regular Next.js project. The only external piece is a PostgreSQL database. **Neon**, from the Vercel Marketplace, is the simplest choice, and the steps below use it.

## 1. Project

1. Merge the pull request into `main`, or select the branch `claude/focused-cannon-5ogj2h` in step 2.
2. On vercel.com: **Add New → Project → Import** `Suleymanozkan1/sb1-suz88kdsghhv`. Vercel detects Next.js. `vercel.json` sets the build command (`npm run vercel-build`) and the region `fra1` (Frankfurt, closest to Türkiye).

## 2. Database

In the new project: **Storage → Create Database → Neon (Postgres)**, region Frankfurt. Neon sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) automatically. The build uses the direct URL for migrations and the app uses the pooled one.

Choose the environments carefully:

| Environment | Database |
|---|---|
| **Production** | the production database |
| **Preview** | **never the production database.** Turn on Neon's **"Create a branch for each preview deployment"** in the integration settings, so every preview gets its own copy of the data, or leave Preview unconnected |
| **Development** | a separate Neon branch or none (local development uses your own `.env`) |

A deployment of an environment without a database stops at the first build step with an explanation (see "Build fails with P1012" below). With Preview unconnected, preview builds simply fail there, which is harmless.

Only **production** builds change the database: see "Preview deployments" below.

Any other PostgreSQL 15+ also works (Supabase, AWS RDS, Azure, your own server). Set `DATABASE_URL`, plus `DATABASE_URL_UNPOOLED` if the main URL goes through a pooler.

## 3. Environment variables

| Name | Value |
|---|---|
| `DATABASE_URL` | Set by the Neon integration (pooled). With PgBouncer add `?pgbouncer=true&connection_limit=1`. |
| `DATABASE_URL_UNPOOLED` | Set by the Neon integration (direct; used for migrations at build time) |
| `PUBLIC_BASE_URL` | Optional: `https://<your-domain>`, written into the Excel workbook's CONTROL sheet |
| `BILLING_ENFORCEMENT` | Optional: `off` disables subscription enforcement (see "Billing") |
| `MIGRATE_ON_PREVIEW` | Optional, **Preview environment only**, and only with a Neon branch per preview: `1` lets preview builds migrate their own branch |

Do **not** set `ALLOW_DEMO_DATA` in production.

## 4. Deploy

Click **Deploy**. `npm run vercel-build` runs:
- a check that this environment has a database (`scripts/check-build-env.mjs`);
- `prisma generate`;
- VBA source generation;
- on a **production** build only (`VERCEL_ENV=production`): `prisma migrate deploy` over the direct URL (applies only new migrations, never resets), then `recipes:refreeze` (`scripts/vercel-migrate.ts`);
- `next build`.

Every later push to `main` redeploys production and applies only new migrations.

### Before a production deploy that contains a migration

A migration cannot be undone by redeploying an older commit. Before merging a pull request that adds a folder under `prisma/migrations/`:

1. In the Neon console, open the project → **Branches → Create branch** from `main` (the production branch), named for example `before-<migration-name>`. This is an instant copy of the data at that moment. Neon's point-in-time restore also works, within the history window of your plan.
2. Merge and let the production deployment finish. Check `/api/health` and sign in.
3. If something is wrong: in Neon, **restore** the production branch from the snapshot branch (or point `DATABASE_URL` and `DATABASE_URL_UNPOOLED` at it), then redeploy the previous commit. Delete the snapshot branch after a few days.

### Preview deployments

A preview build of any branch **skips** the migrations and `recipes:refreeze` and logs:

```
vercel-migrate: Vercel preview build: migrations and recipes:refreeze SKIPPED. …
```

This keeps an unreviewed branch from changing the production schema. A preview of a branch that adds a migration then runs against an unmigrated database and fails on the new tables or columns. To test such a branch on Vercel:

1. Turn on Neon's **branch per preview deployment** (Vercel → Storage → Neon → settings). Every preview gets its own database branch, copied from production.
2. Add the variable `MIGRATE_ON_PREVIEW=1` with the **Preview** environment ticked **only**. Preview builds then migrate their own branch.

Never set `MIGRATE_ON_PREVIEW` while Preview is connected to the production database: it would bring back the original problem.

## 5. First company and administrators

Open `https://<project>.vercel.app`. On an empty database every page leads to **/setup** (first setup):

1. **Setup code**: the database password. In Vercel open **Settings → Environment Variables → PGPASSWORD**, click the eye icon and copy the value. This proves you own the installation. To use your own code instead, add a `SETUP_TOKEN` variable and redeploy.
2. Enter the company, the first hotel and the administrator (password: at least 10 characters).
3. Optional: **Also load demo companies**. This adds two sample companies with three hotels and one month of data, in the background (about 1-3 minutes), and shows the progress at `/setup/demo`. The demo users (`companyadmin@test.local`, `controller@test.local`, `chef@test.local`, `warehouse@test.local`, `viewer@test.local` …) get the administrator's password. No platform administrator is created. Remove the demo data at `/setup/demo` at any time, or load it later from there.

The page refuses once any user exists. The default departments, warehouses and categories are created in the language chosen on the page (TR/EN). Users, hotels, departments and warehouses are then managed under **Administration**.

The command-line alternative still works (copy the direct URL from Vercel → Storage):

```bash
DATABASE_URL="<direct url>" npm run setup:first-company -- --company="My Hotel Group" --hotel="My Hotel" \
  --hotel-code=HTL1 --rooms=120 --currency=TRY --admin-email=you@example.com --admin-password='<10+ chars>' \
  --plan=STANDARD --paid-through=2027-10-31
# optional: the SaaS operator who creates further companies at /platform
DATABASE_URL="<direct url>" npm run setup:first-company -- --platform-admin=ops@example.com --platform-password='<12+ chars>'
```

Subscription options of the first form:

| Option | Meaning |
|---|---|
| `--plan=BASIC\|STANDARD\|PREMIUM` | the company's package. Default: `BASIC` |
| `--paid-through=YYYY-MM-DD` | service paid up to the end of that day (UTC). Without it the company runs on the 30-day free trial |

**Creating the platform administrator switches billing on** for the whole installation (see "Billing" below). A company created without `--paid-through` then becomes **read-only** when its 30-day trial ends. The command prints a warning in that case, and the `--platform-admin` form lists every company that is only on a trial. For a paying first customer always pass `--plan` and `--paid-through`.

### A demo / training deployment

Use a separate Vercel project and database, never the production one. The demo users' password is taken from `DEMO_PASSWORD` when the data is generated. Without it the generator falls back to a development default that is published in the source code, so **always set your own value** for a deployment anyone else can reach:

```bash
export DEMO_PASSWORD='<a long password of your own>'   # never the development default
DATABASE_URL="<demo direct url>" ALLOW_DEMO_DATA=1 npm run seed:demo      # 5 companies, 10 hotels (~10 min)
DATABASE_URL="<demo direct url>" ALLOW_DEMO_DATA=1 npm run demo:verify
```

Sign in as `companyadmin@test.local` with that password, or as `superadmin@test.local` (platform console, `/platform`). Share the password only with the people who need it, and keep it out of the repository and of tickets. A demo that was generated with the default password must be regenerated with `DEMO_PASSWORD` set, or have its passwords changed, before its address is shared.

## Billing

Subscriptions and read-only mode apply **only when a platform administrator exists** (created with `--platform-admin`). Without one, every company keeps every feature. Each new company starts a 30-day trial with every feature; after it the company keeps its own package if paid (`paidThrough`), gets a 7-day grace period after the paid period ends, and then becomes **read-only**: everything stays visible and exportable, but new postings wait for payment. Nothing is deleted.

The platform console (`/platform`) lists, at the top, every company whose trial or paid period ends within 7 days or has already ended.

### Kill switch

Set `BILLING_ENFORCEMENT=off` (Vercel → Settings → Environment Variables, Production) and redeploy: no company is read-only and no package gate applies, while the platform console keeps working. Remove the variable (or set `on`) and redeploy to enforce billing again. The trial and payment dates are not changed by the switch. Use it if real customers turn read-only by mistake, or until billing really starts.

### Before launch: billing checklist

1. Check whether billing is on: `SELECT count(*) FROM "Organization" WHERE "isPlatform";` (more than 0 means on).
2. List the real customers and their dates:
   `SELECT name, plan, "trialEndsAt", "paidThrough" FROM "Organization" WHERE NOT "isDemo" AND NOT "isPlatform";`
   The billing migration gave **every company that existed at that time** a trial ending 30 days after the migration ran.
3. For every paying customer: in `/platform → Subscriptions`, issue a payment notice and mark it paid (sets the package and `paidThrough`), or extend the trial. No customer should rely on the migration's trial date.
4. If billing should not be enforced yet, set `BILLING_ENFORCEMENT=off` before the first trial ends.
5. Fill in the list prices, bank details and VAT rate in `/platform`.
6. Open `/platform` and check that the warning list at the top is empty, or that every company in it is expected there.

## How it behaves on serverless

- **Sessions and rate limits** are stored in PostgreSQL, so they work across all function instances.
- **Large Excel workbooks:** *Generate in background* queues an export job and builds it after the response with `after()`, up to `maxDuration` 300 s. The file is kept in the database for 24 h. The synchronous download and the PDF pack allow 120 s each.
- **PDF fonts** are traced into the functions (`outputFileTracingIncludes`).
- **Backups:** use the provider's point-in-time restore (Neon branches / PITR). `npm run ops:backup` with `pg_dump` also works against the direct URL.
- **Limits:** on the Hobby plan, check the maximum function duration. A 100k-line month needs about 80 s for Excel, so use background export or the Pro plan for very large hotels.

## Build fails with P1012 / empty DATABASE_URL

`P1012 ... The environment variable DATABASE_URL resolved to an empty string` (or the build's own message *"HotelCost cannot be built: no database is configured"*) means this deployment's environment has no database:

1. **Storage**: the Neon database must be connected to the project and to this environment (Production for `main`, Preview for other branches). For Preview use Neon's branch per preview deployment, never the production database (see "Preview deployments"), or leave Preview unconnected and ignore its failed builds.
2. **Settings → Environment Variables**: `DATABASE_URL` must have a value for this environment. Delete any `DATABASE_URL` added by hand with an empty value; it overrides the integration's.
3. **Deployments → Redeploy**.

The build checks this first (`scripts/check-build-env.mjs`) and never prints the URL.

## Language

The interface is Turkish by default, with English available from the TR/EN switch (stored per browser). Set `DEFAULT_LOCALE=en` to make English the default.

## Verify a deployment

```bash
curl https://<project>.vercel.app/api/health   # {"status":"ok", "dbLatencyMs": …, "region": …}
```

`dbLatencyMs` should be a few milliseconds. Tens of milliseconds mean the functions (`vercel.json` → `regions`, default `fra1`) and the Neon database run in different regions, and every page will be slow; create the database in the same region (Frankfurt) or change `regions`.

Then sign in, open the dashboard and download one Excel workbook.
