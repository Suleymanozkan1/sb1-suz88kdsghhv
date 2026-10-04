/**
 * Page crawl on a demo dataset: every page × every demo role × every hotel the user can open.
 *   npx tsx scripts/qa/crawl-demo.ts --base=http://localhost:3300 [--orgs=all|first] [--out=file.json]
 * DATABASE_URL must point at the same database the server uses (read-only here: users, hotels, ids).
 * Fails (exit 1) on: HTTP ≥ 500, a Next.js error page, an uncaught page error, a console error,
 * an /api response ≥ 500, or another company's hotel / company name in the rendered page.
 */
import { writeFileSync } from "node:fs";
import { chromium, type Browser } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { actorForUser } from "../../src/server/auth/actors";

const prisma = new PrismaClient();
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg("base") ?? "http://localhost:3300";
const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo!2026-QA";
const CONCURRENCY = Number(arg("concurrency") ?? 4);

const PAGES = [
  "/", "/admin", "/allocation", "/approvals", "/audit", "/budget", "/buffet", "/calendar", "/data-quality", "/excel", "/forecast",
  "/imports", "/integrity", "/inventory", "/inventory/counts", "/inventory/ledger", "/menu-engineering", "/minibar", "/operations",
  "/periods", "/products", "/purchasing", "/purchasing/orders", "/recipes", "/recipes/new", "/reports", "/review", "/rooms", "/sales",
  "/savings", "/variance", "/waste",
];
const ROLE_LOCAL = ["companyadmin", "controller", "fbm", "chef", "breakfast", "pastry", "purchasing", "accounting", "warehouse", "rooms", "viewer"];

type Finding = { user: string; hotel: string; path: string; kind: string; detail: string };
type Visit = { user: string; hotel: string; path: string; status: number; ms: number; denied: boolean };
const findings: Finding[] = [];
const visits: Visit[] = [];

async function users() {
  const orgs = await prisma.organization.findMany({ where: { isDemo: true, isPlatform: false }, orderBy: { createdAt: "asc" } });
  const list: string[] = [];
  for (const [i, o] of orgs.entries()) {
    if (arg("orgs") === "first" && i > 0) break;
    const slug = o.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    for (const r of ROLE_LOCAL) {
      const email = i === 0 ? `${r}@test.local` : `${r}@${slug}.test.local`;
      if (await prisma.user.findUnique({ where: { email } })) list.push(email);
      else {
        // viewer / warehouse may only exist as bulk staff accounts
        const key = r === "viewer" ? "viewer" : r === "warehouse" ? "warehouse" : null;
        const u = key && (await prisma.user.findFirst({ where: { organizationId: o.id, role: { key }, active: true }, orderBy: { email: "asc" } }));
        if (u) list.push(u.email);
        else findings.push({ user: email, hotel: "-", path: "-", kind: "missing-user", detail: `${o.name}: no ${r} user` });
      }
    }
  }
  const sa = await prisma.user.findFirst({ where: { organization: { isPlatform: true } } });
  if (sa) list.push(sa.email);
  return list;
}

async function crawlUser(browser: Browser, email: string, hotelNames: Map<string, { name: string; org: string; orgName: string }>) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const actor = await actorForUser(user.id);
  const ctx = await browser.newContext({ baseURL: BASE });
  const login = await ctx.request.post("/api/auth/login", { data: { email, password: PASSWORD }, headers: { origin: BASE } });
  if (!login.ok()) {
    findings.push({ user: email, hotel: "-", path: "/api/auth/login", kind: "login", detail: `${login.status()} ${await login.text()}` });
    await ctx.close();
    return;
  }
  const page = await ctx.newPage();
  let current = { hotel: "-", path: "-" };
  let hydration = false;
  let rawHtml = "";
  page.on("pageerror", (e) => {
    if (/#418|#423|#425/.test(e.message)) hydration = true;
    findings.push({ user: email, ...current, kind: "pageerror", detail: e.message.slice(0, 300) });
  });
  page.on("console", (m) => {
    if (m.type() === "error") findings.push({ user: email, ...current, kind: "console", detail: m.text().slice(0, Number(process.env.CRAWL_DETAIL ?? 300)) });
  });
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 500) findings.push({ user: email, ...current, kind: "api5xx", detail: `${r.status()} ${r.url()}` });
  });

  const hotels = actor && actor.hotelIds.length ? [...actor.hotelIds] : [null];
  const own = new Set(hotels.filter(Boolean).map((h) => hotelNames.get(h!)!.org));
  const foreign = [...hotelNames.values()].filter((h) => !own.has(h.org)).flatMap((h) => [h.name, h.orgName]);
  // the platform operator lists tenants by design (/platform); everyone else must never see another company
  const foreignSet = actor?.permissions.has("platform:admin") ? [] : [...new Set(foreign)];

  for (const hotelId of hotels) {
    const code = hotelId ? hotelNames.get(hotelId)!.name : "-";
    if (hotelId) await ctx.addCookies([{ name: "hc_hotel", value: hotelId, url: BASE }]);
    const extra: string[] = [];
    if (hotelId) {
      const b = await prisma.buffetSession.findFirst({ where: { hotelId }, orderBy: { serviceDate: "desc" } });
      if (b) extra.push(`/buffet/${b.id}`);
      const r = await prisma.recipe.findFirst({ where: { hotelId }, orderBy: { code: "asc" } });
      if (r) extra.push(`/recipes/${r.id}`);
    }
    const paths = hotelId ? [...PAGES, ...extra, "/platform"] : ["/platform", "/"];
    for (const path of paths) {
      current = { hotel: code, path };
      const t = Date.now();
      let status = 0;
      try {
        const res = await page.goto(path, { waitUntil: "load", timeout: 60_000 });
        status = res?.status() ?? 0;
        rawHtml = process.env.CRAWL_SNAPSHOTS ? await res?.text().catch(() => "") ?? "" : "";
        // client components fetch after hydration; some pages poll, so idle is best-effort
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
      } catch (e) {
        findings.push({ user: email, ...current, kind: "timeout", detail: (e as Error).message.slice(0, 200) });
        continue;
      }
      const ms = Date.now() - t;
      const text = await page.locator("body").innerText().catch(() => "");
      if (status >= 500) findings.push({ user: email, ...current, kind: "http5xx", detail: String(status) });
      if (/Application error|server-side exception|Internal Server Error|Unhandled Runtime Error/i.test(text)) findings.push({ user: email, ...current, kind: "error-page", detail: text.slice(0, 200) });
      if (/\bNaN\b|undefined|\[object Object\]|Invalid Date/.test(text)) findings.push({ user: email, ...current, kind: "bad-render", detail: (text.match(/.{0,60}(\bNaN\b|undefined|\[object Object\]|Invalid Date).{0,60}/)?.[0] ?? "").replace(/\s+/g, " ") });
      const html = await page.content();
      if (hydration && process.env.CRAWL_SNAPSHOTS) {
        const base = `${process.env.CRAWL_SNAPSHOTS}/${email.replace(/[@.]/g, "_")}_${code.replace(/\W+/g, "")}${path.replace(/\//g, "_")}`;
        writeFileSync(`${base}.client.html`, html);
        writeFileSync(`${base}.server.html`, rawHtml);
        hydration = false;
      }
      for (const n of foreignSet) if (html.includes(n)) findings.push({ user: email, ...current, kind: "LEAK", detail: n });
      const denied = /permission|not allowed|No access|yetki/i.test(text) && text.length < 4000;
      visits.push({ user: email, hotel: code, path, status, ms, denied });
      if (process.env.CRAWL_VERBOSE) console.log(`    ${email} ${code} ${path} ${status} ${ms}ms`);
    }
  }
  await ctx.close();
}

async function main() {
  const hotels = await prisma.hotel.findMany({ include: { organization: true } });
  const hotelNames = new Map(hotels.map((h) => [h.id, { name: h.name, org: h.organizationId, orgName: h.organization.name }]));
  const list = await users();
  console.log(`crawling ${list.length} users × their hotels × ${PAGES.length}+ pages on ${BASE}`);
  const browser = await chromium.launch();
  const queue = [...list];
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let u = queue.shift(); u; u = queue.shift()) {
        await crawlUser(browser, u, hotelNames);
        const pages = visits.filter((v) => v.user === u).length;
        const mine = findings.filter((f) => f.user === u).length;
        console.log(`  ${u.padEnd(48)} ${String(pages).padStart(4)} pages  ${mine ? `${mine} findings` : "ok"}`);
      }
    }),
  );
  await browser.close();
  const slow = [...visits].sort((a, b) => b.ms - a.ms).slice(0, 10);
  const summary = {
    users: list.length,
    pageVisits: visits.length,
    deniedPages: visits.filter((v) => v.denied).length,
    durationS: Math.round((Date.now() - t0) / 1000),
    findings,
    slowest: slow,
  };
  writeFileSync(arg("out") ?? "/tmp/crawl-demo.json", JSON.stringify({ ...summary, visits }, null, 2));
  const byKind = findings.reduce<Record<string, number>>((a, f) => ((a[f.kind] = (a[f.kind] ?? 0) + 1), a), {});
  console.log(`\n${visits.length} page visits, ${summary.deniedPages} permission-denied pages, ${findings.length} findings`, byKind);
  for (const f of findings.slice(0, 80)) console.log(`  [${f.kind}] ${f.user} ${f.hotel} ${f.path}: ${f.detail}`);
  console.log("slowest:", slow.map((v) => `${v.path} ${v.ms}ms`).join(", "));
  if (findings.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
