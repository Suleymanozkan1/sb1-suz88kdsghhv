# Deploying HotelCost on Vercel

HotelCost runs on Vercel as a regular Next.js project. The only external piece is a PostgreSQL database. **Neon**, from the Vercel Marketplace, is the simplest choice, and the steps below use it.

## 1. Project

1. Merge the pull request into `main`, or select the branch `claude/focused-cannon-5ogj2h` in step 2.
2. On vercel.com: **Add New → Project → Import** `Suleymanozkan1/sb1-suz88kdsghhv`. Vercel detects Next.js. `vercel.json` sets the build command (`npm run vercel-build`) and the region `fra1` (Frankfurt, closest to Türkiye).

## 2. Database

In the new project: **Storage → Create Database → Neon (Postgres)**, region Frankfurt, connected to the project for all environments. Neon sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) automatically. The build uses the direct URL for migrations and the app uses the pooled one.

Any other PostgreSQL 15+ also works (Supabase, AWS RDS, Azure, your own server). Set `DATABASE_URL`, plus `DATABASE_URL_UNPOOLED` if the main URL goes through a pooler.

## 3. Environment variables

| Name | Value |
|---|---|
| `DATABASE_URL` | Set by the Neon integration (pooled). With PgBouncer add `?pgbouncer=true&connection_limit=1`. |
| `DATABASE_URL_UNPOOLED` | Set by the Neon integration (direct; used for migrations at build time) |
| `SESSION_SECRET` | A long random string, e.g. `openssl rand -base64 48` |
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

Run once from your computer against the production database (copy the direct URL from Vercel → Storage):

```bash
DATABASE_URL="<direct url>" npm run setup:first-company -- --company="My Hotel Group" --hotel="My Hotel" \
  --hotel-code=HTL1 --rooms=120 --currency=TRY --admin-email=you@example.com --admin-password='<10+ chars>'
# optional: the SaaS operator who creates further companies at /platform
DATABASE_URL="<direct url>" npm run setup:first-company -- --platform-admin=ops@example.com --platform-password='<12+ chars>'
```

Then open `https://<project>.vercel.app` and sign in. Users, hotels, departments and warehouses are managed under **Administration**. New companies are created at `/platform`.

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

## Verify a deployment

```bash
curl https://<project>.vercel.app/api/health   # {"status":"ok", …}
```

Then sign in, open the dashboard and download one Excel workbook.
