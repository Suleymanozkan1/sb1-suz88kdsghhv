/* global process, console */
/**
 * First step of `npm run vercel-build`: stop early, with instructions, when the deployment has no database.
 * Without it Prisma fails later with "P1012 ... DATABASE_URL resolved to an empty string".
 * Never prints the values themselves.
 */
const env = process.env;
const problems = [];
const isPg = (v) => /^postgres(ql)?:\/\/\S+/.test(v ?? "");

if (!isPg(env.DATABASE_URL)) {
  problems.push(env.DATABASE_URL ? "DATABASE_URL is set but is not a postgres:// or postgresql:// URL" : "DATABASE_URL is missing or empty");
}
if (env.DATABASE_URL_UNPOOLED !== undefined && env.DATABASE_URL_UNPOOLED !== "" && !isPg(env.DATABASE_URL_UNPOOLED)) {
  problems.push("DATABASE_URL_UNPOOLED is set but is not a postgres:// or postgresql:// URL");
}

if (problems.length) {
  const where = env.VERCEL_ENV ? ` (Vercel environment: ${env.VERCEL_ENV})` : "";
  console.error(`
✖ HotelCost cannot be built: no database is configured${where}.
${problems.map((p) => `  - ${p}`).join("\n")}

Fix it in the Vercel dashboard:
  1. Project → Storage → Create Database → Neon (Postgres), or connect an existing one.
     Tick every environment: Production, Preview and Development.
  2. Settings → Environment Variables: DATABASE_URL (and DATABASE_URL_UNPOOLED) must have a value
     for this environment. Delete any DATABASE_URL you added by hand with an empty value.
  3. Deployments → … → Redeploy.
See docs/VERCEL.md ("Build fails with P1012 / empty DATABASE_URL").
`);
  process.exit(1);
}
console.log(`build environment OK: database URL present${env.DATABASE_URL_UNPOOLED ? " (direct URL used for migrations)" : ""}`);
