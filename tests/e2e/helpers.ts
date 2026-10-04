import { expect, type Page } from "@playwright/test";

export const PASSWORD = "HotelCost!2026";
export const uniq = () => Date.now().toString(36).toUpperCase();

export async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${user}@grandanatolia.test`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
}

export async function pickProduct(page: Page, label: string | RegExp, search: string, optionText: string | RegExp) {
  const box = page.getByLabel(label);
  await box.click();
  await box.fill(search);
  await page.getByRole("option", { name: optionText }).first().click();
}

/** Answer browser prompt/confirm/alert dialogs in order. */
export function answerDialogs(page: Page, answers: Array<string | true>) {
  const queue = [...answers];
  page.on("dialog", async (d) => {
    const a = queue.shift();
    if (a === undefined) return d.dismiss();
    await d.accept(a === true ? undefined : a);
  });
}
