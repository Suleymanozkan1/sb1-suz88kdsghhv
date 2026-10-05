/**
 * Empty installation → /setup (Turkish) → company + admin + demo data in the background → demo account works,
 * setup is closed afterwards, language switch works. The setup code is the database password.
 */
import { expect, test } from "@playwright/test";

const PASSWORD = "Guclu-Sifre-2026";
const dbPassword = () => decodeURIComponent(new URL(process.env.SETUP_E2E_DATABASE_URL ?? "postgresql://hotelcost:hotelcost@localhost:5432/hotelcost_setup_e2e").password);

test("first-run setup in Turkish with demo data", async ({ page, browser }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("İlk kurulum");

  await page.locator("#secret").fill("wrong-code");
  await page.locator("#organizationName").fill("Deneme Otelcilik A.Ş.");
  await page.locator("#hotelName").fill("Deneme Otel");
  await page.locator("#hotelCode").fill("DNM1");
  await page.locator("#adminName").fill("Ayşe Yılmaz");
  await page.locator("#adminEmail").fill("ayse@example.com");
  await page.locator("#adminPassword").fill(PASSWORD);
  await page.locator("#adminPassword2").fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Kurulumu tamamla" }).click();
  await expect(page.getByText("Kurulum kodu doğru değil")).toBeVisible();

  await page.locator("#secret").fill(dbPassword());
  await page.getByRole("button", { name: "Kurulumu tamamla" }).click();
  await expect(page).toHaveURL(/\/setup\/demo$/, { timeout: 60_000 });
  await expect(page.getByText(/Adım \d+\/11/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Demo veri hazır: 2 şirket, 3 otel/)).toBeVisible({ timeout: 300_000 });

  await page.getByRole("link", { name: "Gösterge paneline git" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Deneme Otel");
  await expect(page.locator("select#hotel option")).toHaveText(["Deneme Otel"]);

  const ctx = await browser.newContext();
  const demo = await ctx.newPage();
  await demo.goto("/login");
  await demo.locator("#email").fill("controller@test.local");
  await demo.locator("#password").fill(PASSWORD);
  await demo.getByRole("button", { name: "Giriş yap" }).click();
  await expect(demo.getByRole("navigation").first()).toBeVisible();
  await expect(demo.locator("select#hotel option")).toHaveCount(2);
  const again = await demo.request.post("/api/setup", { data: { secret: dbPassword() }, headers: { origin: new URL(demo.url()).origin } });
  expect(again.status()).toBe(409);
  await ctx.close();

  await page.locator("select#lang").selectOption("en");
  await expect(page.getByRole("navigation").first().getByRole("link").first()).toHaveText("Dashboard");
});
