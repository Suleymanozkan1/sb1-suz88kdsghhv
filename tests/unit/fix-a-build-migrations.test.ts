import { describe, expect, it } from "vitest";
import { migrationDecision, migrationUrl } from "../../scripts/lib/build-migrations";

describe("vercel-build migrations (ARCH-03)", () => {
  it("migrates on a Vercel production build", () => {
    expect(migrationDecision({ VERCEL_ENV: "production" }).migrate).toBe(true);
  });

  it("never migrates a Vercel preview or development build by default", () => {
    for (const VERCEL_ENV of ["preview", "development"]) {
      const d = migrationDecision({ VERCEL_ENV, DATABASE_URL: "postgresql://x/y" });
      expect(d.migrate).toBe(false);
      expect(d.reason).toContain("SKIPPED");
      expect(d.reason).toContain("branch per preview");
    }
  });

  it("a preview migrates only with the explicit opt-in; the opt-in never applies to development", () => {
    expect(migrationDecision({ VERCEL_ENV: "preview", MIGRATE_ON_PREVIEW: "1" }).migrate).toBe(true);
    expect(migrationDecision({ VERCEL_ENV: "preview", MIGRATE_ON_PREVIEW: "0" }).migrate).toBe(false);
    expect(migrationDecision({ VERCEL_ENV: "preview", MIGRATE_ON_PREVIEW: "" }).migrate).toBe(false);
    expect(migrationDecision({ VERCEL_ENV: "development", MIGRATE_ON_PREVIEW: "1" }).migrate).toBe(false);
  });

  it("off Vercel the build keeps migrating", () => {
    expect(migrationDecision({}).migrate).toBe(true);
  });

  it("migrations use the direct URL when there is one", () => {
    expect(migrationUrl({ DATABASE_URL: "postgresql://pooled", DATABASE_URL_UNPOOLED: "postgresql://direct" })).toBe("postgresql://direct");
    expect(migrationUrl({ DATABASE_URL: "postgresql://pooled", DATABASE_URL_UNPOOLED: "" })).toBe("postgresql://pooled");
    expect(migrationUrl({ DATABASE_URL: "postgresql://pooled" })).toBe("postgresql://pooled");
  });
});
