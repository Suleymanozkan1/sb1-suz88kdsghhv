/**
 * Click-everything crawl: on each page, click every visible button / tab / summary one at a time (fresh load per click),
 * answer prompts with a test reason, and record uncaught errors, console errors, /api 5xx and Next.js error pages.
 * Destructive by design (it deletes recipes, reverses expenses …) — run only against a throwaway database; it refuses
 * to start without --allow-destructive.
 *   npx tsx scripts/qa/click-all.ts --allow-destructive --base=http://localhost:3400 --email=admin@grandanatolia.test --password=HotelCost!2026 [--out=file.json]
 */
import { writeFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg("base") ?? "http://localhost:3400";
const EMAIL = arg("email") ?? "admin@grandanatolia.test";
const PASSWORD = arg("password") ?? "HotelCost!2026";
const ONLY = arg("only");
const ALLOW_DESTRUCTIVE = process.argv.includes("--allow-destructive");
const PAGES = [
  "/", "/admin", "/approvals", "/audit", "/buffet", "/calendar", "/data-quality", "/excel", "/insights/waste", "/insights/price-changes",
  "/imports", "/integrity", "/inventory", "/inventory/counts", "/inventory/counts/summary", "/inventory/ledger", "/menu-engineering", "/minibar",
  "/operations", "/periods", "/products", "/purchasing", "/purchasing/orders", "/recipes", "/recipes/new", "/reports", "/review", "/rooms", "/rooms/expenses",
  "/sales", "/savings", "/variance", "/waste",
];
// never click: sign-out and the language switch (they change the session, not the page)
const SKIP = /çıkış|sign out|log ?out|english|türkçe/i;

type Finding = { path: string; control: string; kind: string; detail: string };
const findings: Finding[] = [];
const clicked: { path: string; control: string; result: string }[] = [];

async function controls(page: Page) {
  return page.locator("main button:visible, main [role=tab]:visible, main summary:visible").evaluateAll((els) =>
    els.map((e, i) => ({ i, label: ((e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60)) || `#${i}`, disabled: (e as HTMLButtonElement).disabled === true })),
  );
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
}

async function main() {
  if (!ALLOW_DESTRUCTIVE) throw new Error("Refusing to run without --allow-destructive: this crawler clicks every button and changes data");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, acceptDownloads: true });
  const login = await ctx.request.post("/api/auth/login", { data: { email: EMAIL, password: PASSWORD }, headers: { origin: BASE } });
  if (!login.ok()) throw new Error(`login ${login.status()} ${await login.text()}`);
  const page = await ctx.newPage();
  let cur = { path: "-", control: "load" };
  page.on("pageerror", (e) => findings.push({ ...cur, kind: "pageerror", detail: e.message.slice(0, 300) }));
  page.on("console", (m) => { if (m.type() === "error") findings.push({ ...cur, kind: "console", detail: m.text().slice(0, 300) }); });
  page.on("response", (r) => { if (r.status() >= 500) findings.push({ ...cur, kind: "http5xx", detail: `${r.status()} ${r.request().method()} ${r.url()}` }); });
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "QA test reason" : undefined).catch(() => {}));

  const pages = [...PAGES];
  // a navigation that fails is a finding, never the end of the crawl (the report is still written)
  const go = async (path: string, control: string) => {
    try {
      return await page.goto(path);
    } catch (e) {
      findings.push({ path, control, kind: "navigation", detail: ((e as Error).message.split("\n")[0] ?? "").slice(0, 200) });
      return undefined;
    }
  };
  for (const list of ["/recipes", "/buffet"]) {
    if (!(await go(list, "discover"))) continue;
    const href = await page.locator(`main a[href^="${list}/"]:not([href$="/new"])`).first().getAttribute("href").catch(() => null);
    if (href) pages.push(href);
  }
  for (const path of pages.filter((p) => !ONLY || p.startsWith(ONLY))) {
    cur = { path, control: "load" };
    const res = await go(path, "load");
    if (res === undefined) continue;
    await settle(page);
    if (!res || res.status() >= 400) findings.push({ ...cur, kind: "status", detail: String(res?.status()) });
    // every in-app link on the page must resolve
    const hrefs = await page.locator("main a[href^='/']").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")!))]);
    for (const h of hrefs) {
      if (h.startsWith("/api/")) continue;
      const r = await ctx.request.get(h, { maxRedirects: 0 }).catch(() => null);
      if (!r || r.status() >= 400) findings.push({ path, control: `link ${h}`, kind: "link", detail: String(r?.status()) });
    }
    const list = await controls(page);
    for (const c of list) {
      if (SKIP.test(c.label)) continue;
      cur = { path, control: c.label };
      if (c.disabled) { clicked.push({ path, control: c.label, result: "disabled" }); continue; }
      if (!(await go(path, c.label))) {
        clicked.push({ path, control: c.label, result: "reload failed" });
        continue;
      }
      await settle(page);
      const now = await controls(page);
      const target = now.find((n) => n.i === c.i && n.label === c.label) ?? now.find((n) => n.label === c.label);
      if (!target) { clicked.push({ path, control: c.label, result: "gone after reload" }); continue; }
      const apiCalls: string[] = [];
      const onResp = (r: import("@playwright/test").Response) => { if (r.url().includes("/api/")) apiCalls.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); };
      page.on("response", onResp);
      try {
        await page.locator("main button:visible, main [role=tab]:visible, main summary:visible").nth(target.i).click({ timeout: 5000 });
      } catch (e) {
        findings.push({ ...cur, kind: "click", detail: ((e as Error).message.split("\n")[0] ?? "").slice(0, 200) });
      }
      await settle(page);
      await page.waitForTimeout(300);
      page.off("response", onResp);
      const errorPage = await page.locator("text=/Application error|Unhandled Runtime Error|Beklenmeyen hata|Unexpected error/i").count();
      if (errorPage) findings.push({ ...cur, kind: "error-text", detail: "error message rendered" });
      const alert = (await page.locator("main [role=alert]:visible").allTextContents()).join(" | ").slice(0, 200);
      clicked.push({ path, control: c.label, result: [apiCalls.join(", "), alert && `alert: ${alert}`, page.url() !== new URL(path, BASE).href ? `→ ${new URL(page.url()).pathname}${new URL(page.url()).search}` : ""].filter(Boolean).join(" ; ") || "no request" });
    }
    console.log(`${path}: ${list.length} controls`);
  }
  await browser.close();
  const out = { findings, clicked };
  writeFileSync(arg("out") ?? "click-all.json", JSON.stringify(out, null, 2));
  console.log(`findings: ${findings.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
