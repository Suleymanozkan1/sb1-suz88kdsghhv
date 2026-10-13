/** QA (r3b, temporary): breakfast day → covers → issues → keyboard count → correction, as breakfast@. */
import { chromium, expect } from "@playwright/test";
import fs from "node:fs";

async function main() {
  const [outDir, date = "2026-10-12"] = process.argv.slice(2);
  const BASE = "http://localhost:3000";
  fs.mkdirSync(outDir!, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "tr-TR" });
  await ctx.addCookies([{ name: "hc_lang", value: "tr", url: BASE }]);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const r = await page.request.post(`${BASE}/api/auth/login`, { data: { email: process.env.USER_EMAIL ?? "breakfast@grandanatolia.test", password: "HotelCost!2026" }, headers: { origin: BASE } });
  if (!r.ok()) throw new Error(`login ${r.status()}`);

  // 1. new breakfast record: meal (breakfast only) + date
  await page.goto(`${BASE}/buffet`, { waitUntil: "networkidle" });
  const meal = page.getByLabel("Öğün");
  console.log("meal options:", await meal.locator("option").allTextContents());
  await page.getByLabel("Tarih", { exact: true }).fill(date);
  await page.getByRole("button", { name: "Oluştur" }).click();
  await page.waitForURL(/\/buffet\/[a-z0-9]+$/, { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  console.log("day h1:", await page.locator("h1").textContent());

  // 2. covers
  await page.getByLabel(/Paket dahil kahvaltı/).fill("286");
  await page.getByLabel(/Paket dahil olmayan kahvaltı/).fill("24");
  await page.getByRole("button", { name: "Kuverleri kaydet" }).click();
  await expect(page.getByTestId("breakfast-covers").getByText("Kaydedildi.")).toBeVisible();

  // 3. issues (only when the day has none yet: the script can be re-run)
  {
    const list = process.env.ISSUES === "rest" ? ([["Tomato", /Tomato/, "12"], ["Egg", /Egg \(L\)/, "420"], ["Cheddar", /Cheddar Slices/, "2"]] as const) : ([["Cheddar", /Cheddar Slices/, "7,5"], ["Tomato", /Tomato/, "12"], ["Egg", /Egg \(L\)/, "420"], ["Cheddar", /Cheddar Slices/, "2"]] as const);
    for (const [search, name, q] of list) {
      const change = page.getByRole("button", { name: "Değiştir" });
      if (await change.count()) await change.click();
      const box = page.locator("#bl-item");
      await box.click();
      await box.fill(search);
      await page.getByRole("option", { name }).first().click();
      await page.getByLabel("Miktar").fill(q);
      await page.getByRole("button", { name: "Kahvaltıya çıkış" }).click();
      await expect(page.getByText(/Stoktan .* maliyetle çıkış yapıldı/)).toBeVisible({ timeout: 30_000 });
      await page.waitForLoadState("networkidle");
    }
  }
  await page.screenshot({ path: `${outDir}/1-day.png`, fullPage: true });

  // 4. the count, keyboard only
  await page.getByRole("link", { name: /Kahvaltı sayımı/ }).first().click();
  await page.waitForURL(/\/buffet\/count/);
  await page.waitForLoadState("networkidle");
  const rows = await page.getByTestId("breakfast-count").locator("tbody tr").allTextContents();
  console.log("count rows:", rows.length, rows.map((x) => x.replace(/\s+/g, " ").slice(0, 60)));
  const focused = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") ?? document.activeElement?.textContent);
  console.log("focus at start:", await focused());
  // row 1 Cheddar: 0,8 kg left, back to stock (Tüketim, default) → Enter
  await page.keyboard.type("0,8");
  await page.keyboard.press("Enter");
  // row 2 Egg: 24 pieces left, cooked → F marks waste → Enter
  console.log("focus row 2:", await focused());
  await page.keyboard.type("24");
  await page.keyboard.press("f");
  await page.keyboard.press("Enter");
  // row 3 Tomato: 1,1 kg; Tab to the switch, Space switches to Fire, Space back to Tüketim, then Tab → next/save
  console.log("focus row 3:", await focused());
  await page.keyboard.type("1,1");
  await page.keyboard.press("Tab");
  console.log("focus after Tab:", await focused());
  await page.keyboard.press("Space");
  console.log("after Space:", await focused(), await page.locator('[role=radio][aria-checked=true]').allTextContents());
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");
  console.log("focus at end:", await focused());
  await page.screenshot({ path: `${outDir}/2-count-typed.png`, fullPage: true });
  await page.keyboard.press("Enter"); // Save button focused
  await expect(page.getByText("Kahvaltı sayımı kaydedildi.")).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${outDir}/3-count-saved.png`, fullPage: true });

  // 5. correction: tomato remainder becomes waste
  const tomato = page.getByLabel("Kalan Tomato");
  await tomato.click();
  await page.keyboard.type("1,3");
  await page.keyboard.press("f");
  await page.getByRole("button", { name: "Sayımı yeniden kaydet" }).click();
  await expect(page.getByText("Kahvaltı sayımı kaydedildi.")).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  await page.goto(page.url(), { waitUntil: "networkidle" });
  console.log("after correction radios:", await page.locator('[role=radio][aria-checked=true]').allTextContents(), await page.getByLabel("Kalan Tomato").inputValue());
  await page.getByRole("link", { name: "Kahvaltı gününü aç" }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${outDir}/4-day-after.png`, fullPage: true });
  console.log("cards:", (await page.locator("p.text-2xl").allTextContents()).join(" | "));
  console.log("errors:", errors);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
