import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/** Every list/report page shows PDF, Excel and CSV buttons, and each one downloads a file. Detail pages ([id]) are reached from their list. */
const ROOT = path.join(process.cwd(), "src/app/(app)");

function pages(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) pages(p, out);
    else if (f === "page.tsx" && /exportKey="/.test(readFileSync(p, "utf8"))) out.push(path.relative(ROOT, path.dirname(p)).split(path.sep).join("/"));
  }
  return out;
}

const ROUTES = pages(ROOT)
  .filter((r) => !r.includes("["))
  .map((r) => `/${r}`.replace(/\/$/, "") || "/")
  .sort();

test("every list/report page downloads PDF, Excel and CSV", async ({ page }) => {
  test.setTimeout((ROUTES.length + 2) * 15_000);
  await login(page, "admin");
  const failed: string[] = [];
  const details: string[] = [];
  for (const list of ["/recipes", "/buffet"]) {
    await page.goto(list);
    const href = await page.locator(`main a[href^="${list}/"]:not([href$="/new"])`).first().getAttribute("href");
    if (href) details.push(href);
    else failed.push(`${list}: no detail page to open`);
  }
  for (const route of [...ROUTES, ...details]) {
    await page.goto(route);
    const box = page.locator("[data-export]").first();
    // the buttons are a client component: give a slow page (e.g. /reports verifying hashes) time to hydrate
    if (!(await box.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false))) {
      failed.push(`${route}: no export buttons`);
      continue;
    }
    for (const [label, type, magic] of [["PDF", "application/pdf", "%PDF-"], ["Excel", "spreadsheetml", "PK"], ["CSV", "text/csv", "\uFEFF"]] as const) {
      const href = await box.getByRole("link", { name: label }).getAttribute("href");
      const res = await page.request.get(href!);
      const body = await res.body();
      if (res.status() !== 200 || !(res.headers()["content-type"] ?? "").includes(type) || !body.toString("utf8", 0, 8).startsWith(magic)) failed.push(`${route} ${label}: ${res.status()} ${res.headers()["content-type"]}`);
    }
  }
  expect(failed).toEqual([]);
  expect(ROUTES.length).toBeGreaterThan(25);
});
