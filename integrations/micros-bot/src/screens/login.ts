/**
 * Generic username/password login, shared by Micros and Opera (selectors in the "login" block).
 *   path      page with the login form, relative to the system URL (null = the URL itself)
 *   steps     optional extra clicks before the form (e.g. "Sign in with password")
 *   username / password / submit   the form
 *   loggedIn  an element that exists only after a successful login (menu, user name, logout button)
 *   error     optional: the element that shows "invalid user/password"
 */
import type { Page } from "playwright";
import { LoginFailedError, ScreenChangedError } from "../errors";
import { log } from "../logger";
import { Screen, type ScreenOptions } from "../browser/screen";
import type { LoginSelectors } from "../browser/selectors";

export async function login(page: Page, system: string, selectors: LoginSelectors, credentials: { username: string; password: string }, opts: ScreenOptions): Promise<void> {
  const screen = new Screen(page, "login", selectors as unknown as Record<string, unknown>, opts);
  const path = screen.sel("path", true);
  const url = screen.url(path ?? "");
  log.info(`[${system}] opening login page ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs });

  const loggedInSel = screen.sel("loggedIn");
  if ((await page.locator(loggedInSel).count()) > 0) {
    log.info(`[${system}] already signed in`);
    return;
  }
  await screen.runSteps("steps");
  const user = await screen.need("username");
  const pass = await screen.need("password");
  const submit = await screen.need("submit");
  await user.fill(credentials.username);
  await pass.fill(credentials.password);
  await submit.click();

  const errorSel = screen.sel("error", true);
  const outcome = await Promise.race([
    page.locator(loggedInSel).first().waitFor({ state: "attached", timeout: opts.timeoutMs }).then(() => "ok" as const),
    errorSel
      ? page.locator(errorSel).first().waitFor({ state: "visible", timeout: opts.timeoutMs }).then(() => "error" as const)
      : new Promise<never>(() => undefined),
  ]).catch(() => "timeout" as const);

  if (outcome === "ok") {
    log.info(`[${system}] signed in as ${credentials.username}`);
    return;
  }
  if (outcome === "error") {
    const msg = ((await page.locator(errorSel!).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
    throw new LoginFailedError(system, msg || "the system rejected the username/password");
  }
  // Neither marker appeared. Still on the login form → wrong credentials (or a silent rejection);
  // otherwise we got somewhere unknown → the "loggedIn" marker no longer matches.
  const stillOnForm = (await page.locator(screen.sel("username")).count()) > 0 && (await page.locator(screen.sel("password")).count()) > 0;
  if (stillOnForm) throw new LoginFailedError(system, "still on the login page after submitting (check username/password)");
  throw new ScreenChangedError("login", "loggedIn", loggedInSel);
}
