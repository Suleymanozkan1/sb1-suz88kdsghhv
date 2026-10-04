/**
 * Read-only role against every mutating API route: each must answer 403 before looking at the payload.
 * The list is read from the file system, so a new route is covered automatically.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo!2026-QA";
// public or session plumbing, or read-only POSTs that a viewer may call (check, live recipe cost preview)
const ALLOWED = new Set(["/api/auth/login", "/api/auth/logout", "/api/auth/hotel", "/api/invites/accept", "/api/integrity/check", "/api/recipes/preview"]);
const PARAM: Record<string, string> = { "[kind]": "expenses" };

function routes(dir = "src/app/api", base = "/api"): Array<{ path: string; methods: string[] }> {
  const out: Array<{ path: string; methods: string[] }> = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routes(full, `${base}/${PARAM[name] ?? name.replace(/^\[.*\]$/, "x-not-an-id")}`));
    else if (name === "route.ts") {
      const src = readFileSync(full, "utf8");
      const methods = ["POST", "PUT", "PATCH", "DELETE"].filter((m) => new RegExp(`export (const|async function) ${m}\\b`).test(src));
      if (methods.length) out.push({ path: base, methods });
    }
  }
  return out;
}

test("viewer gets 403 from every mutating endpoint", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("user002@demo-hotel-group.test.local");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
  const origin = new URL(page.url()).origin;
  const bad: string[] = [];
  let n = 0;
  for (const r of routes()) {
    if (ALLOWED.has(r.path)) continue;
    for (const m of r.methods) {
      n++;
      const res = await page.request.fetch(r.path, { method: m, data: {}, headers: { origin } });
      if (res.status() !== 403) bad.push(`${m} ${r.path} → ${res.status()} ${(await res.text()).slice(0, 120)}`);
    }
  }
  console.log(`${n} mutating endpoints checked`);
  expect(bad).toEqual([]);
});
