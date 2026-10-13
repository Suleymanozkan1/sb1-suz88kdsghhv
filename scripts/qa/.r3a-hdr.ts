import { chromium } from "@playwright/test";
async function main() {
  const [outDir, h, ...paths] = process.argv.slice(2);
  const BASE = "http://localhost:3000";
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: Number(process.env.W ?? 1440), height: 1000 }, locale: "tr-TR" });
  await ctx.addCookies([{ name: "hc_lang", value: "tr", url: BASE }]);
  const page = await ctx.newPage();
  await page.request.post(`${BASE}/api/auth/login`, { data: { email: process.env.USER_EMAIL ?? "admin@grandanatolia.test", password: "HotelCost!2026" }, headers: { origin: BASE } });
  for (const p of paths) {
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 120_000 });
    const f = `${outDir}/${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}.png`;
    await page.screenshot({ path: f, clip: { x: 0, y: 0, width: Number(process.env.W ?? 1440), height: Number(h) } });
    console.log(f);
  }
  await browser.close();
}
void main();
