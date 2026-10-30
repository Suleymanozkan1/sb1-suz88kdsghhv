/**
 * Should this build apply database migrations (and re-cost frozen recipe snapshots)? Pure, so it can be tested.
 *
 * On Vercel only the PRODUCTION build migrates. A Preview build of any branch would otherwise apply that branch's
 * unreviewed migrations to whatever database the Preview environment points at, which is the production database
 * when Neon is connected to every environment. A preview whose database is its own Neon branch can opt in with
 * MIGRATE_ON_PREVIEW=1 (set for the Preview environment only). Off Vercel (a local `npm run vercel-build`) the
 * build migrates as before.
 */
export interface MigrationDecision {
  migrate: boolean;
  reason: string;
}

const yes = (v: string | undefined) => ["1", "true", "on", "yes"].includes((v ?? "").trim().toLowerCase());

export function migrationDecision(env: Record<string, string | undefined>): MigrationDecision {
  const vercelEnv = env.VERCEL_ENV;
  if (!vercelEnv) return { migrate: true, reason: "not a Vercel build (VERCEL_ENV is not set): migrations run" };
  if (vercelEnv === "production") return { migrate: true, reason: "Vercel production build: migrations run" };
  if (vercelEnv === "preview" && yes(env.MIGRATE_ON_PREVIEW)) {
    return { migrate: true, reason: "Vercel preview build with MIGRATE_ON_PREVIEW=1: migrations run on this preview's own database" };
  }
  return {
    migrate: false,
    reason:
      `Vercel ${vercelEnv} build: migrations and recipes:refreeze SKIPPED. Only production builds change the database schema, ` +
      "so an unreviewed branch can never migrate the production database. For a migrated preview database enable Neon's " +
      '"branch per preview deployment" (Vercel Storage → Neon) and set MIGRATE_ON_PREVIEW=1 for the Preview environment only. ' +
      "See docs/VERCEL.md.",
  };
}

/** The URL migrations use: the direct (unpooled) one when the provider gives one, as Prisma migrate needs. */
export function migrationUrl(env: Record<string, string | undefined>): string | undefined {
  return env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
}
