# Deploying HotelCost on Vercel

HotelCost runs on Vercel as a regular Next.js project. The only external piece is a PostgreSQL database. **Neon**, from the Vercel Marketplace, is the simplest choice, and the steps below use it.

## 1. Project

1. Merge the pull request into `main`, or select the branch `claude/focused-cannon-5ogj2h` in step 2.
2. On vercel.com: **Add New → Project → Import** `Suleymanozkan1/sb1-suz88kdsghhv`. Vercel detects Next.js. `vercel.json` sets the build command (`npm run vercel-build`) and the region `fra1` (Frankfurt, closest to Türkiye).

## 2. Database

In the new project: **Storage → Create Database → Neon (Postgres)**, region Frankfurt, connected to the project for **all** environments (Production, Preview and Development). A deployment of an environment without the database fails at build time. Neon sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) automatically. The build uses the direct URL for migrations and the app uses the pooled one.

Any other PostgreSQL 15+ also works (Supabase, AWS RDS, Azure, your own server). Set `DATABASE_URL`, plus `DATABASE_URL_UNPOOLED` if the main URL goes through a pooler.

## 3. Environment variables

| Name | Value |
|---|---|
| `DATABASE_URL` | Set by the Neon integration (pooled). With PgBouncer add `?pgbouncer=true&connection_limit=1`. |
| `DATABASE_URL_UNPOOLED` | Set by the Neon integration (direct; used for migrations at build time) |
| `PUBLIC_BASE_URL` | Optional: `https://<your-domain>`, written into the Excel workbook's CONTROL sheet |

Do **not** set `ALLOW_DEMO_DATA` in production.

## 4. Deploy

Click **Deploy**. `npm run vercel-build` runs:
- `prisma generate`;
- VBA source generation;
- `prisma migrate deploy` (applies only new migrations, never resets);
- `next build`.

Every later push redeploys and applies only new migrations.

## 5. First company and administrators

Open `https://<project>.vercel.app`. On an empty database every page leads to **/setup** (first setup):

1. **Setup code**: the database password. In Vercel open **Settings → Environment Variables → PGPASSWORD**, click the eye icon and copy the value. This proves you own the installation. To use your own code instead, add a `SETUP_TOKEN` variable and redeploy.
2. Enter the company, the first hotel and the administrator (password: at least 10 characters).
3. Optional: **Also load demo companies**. This adds two sample companies with three hotels and one month of data, in the background (about 1-3 minutes), and shows the progress at `/setup/demo`. The demo users (`companyadmin@test.local`, `controller@test.local`, `chef@test.local`, `warehouse@test.local`, `viewer@test.local` …) get the administrator's password. No platform administrator is created. Remove the demo data at `/setup/demo` at any time, or load it later from there.

The page refuses once any user exists. The default departments, warehouses and categories are created in the language chosen on the page (TR/EN). Users, hotels, departments and warehouses are then managed under **Administration**.

The command-line alternative still works (copy the direct URL from Vercel → Storage):

```bash
DATABASE_URL="<direct url>" npm run setup:first-company -- --company="My Hotel Group" --hotel="My Hotel" \
  --hotel-code=HTL1 --rooms=120 --currency=TRY --admin-email=you@example.com --admin-password='<10+ chars>'
# optional: the SaaS operator who creates further companies at /platform
DATABASE_URL="<direct url>" npm run setup:first-company -- --platform-admin=ops@example.com --platform-password='<12+ chars>'
```

### A demo / training deployment

Use a separate Vercel project and database, never the production one:

```bash
DATABASE_URL="<demo direct url>" ALLOW_DEMO_DATA=1 npm run seed:demo      # 5 companies, 10 hotels (~10 min)
DATABASE_URL="<demo direct url>" ALLOW_DEMO_DATA=1 npm run demo:verify
```

Sign in as `companyadmin@test.local` / `Demo!2026-QA`, or `superadmin@test.local` for `/platform`.

## How it behaves on serverless

- **Sessions and rate limits** are stored in PostgreSQL, so they work across all function instances.
- **Large Excel workbooks:** *Generate in background* queues an export job and builds it after the response with `after()`, up to `maxDuration` 300 s. The file is kept in the database for 24 h. The synchronous download and the PDF pack allow 120 s each.
- **PDF fonts** are traced into the functions (`outputFileTracingIncludes`).
- **Backups:** use the provider's point-in-time restore (Neon branches / PITR). `npm run ops:backup` with `pg_dump` also works against the direct URL.
- **Limits:** on the Hobby plan, check the maximum function duration. A 100k-line month needs about 80 s for Excel, so use background export or the Pro plan for very large hotels.

## Build fails with P1012 / empty DATABASE_URL

`P1012 ... The environment variable DATABASE_URL resolved to an empty string` (or the build's own message *"HotelCost cannot be built: no database is configured"*) means this deployment's environment has no database:

1. **Storage**: the Neon database must be connected to the project and to this environment (Production for `main`, Preview for other branches).
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
