/** Browser lifecycle + failure evidence (screenshot + page HTML into runs/<runId>/). */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { Config } from "../config";
import { log } from "../logger";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

export async function openBrowser(config: Config): Promise<BrowserSession> {
  const browser = await chromium.launch({
    headless: config.headless,
    ...(config.browserChannel ? { channel: config.browserChannel } : {}),
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: config.ignoreHttpsErrors,
    acceptDownloads: true,
    locale: "tr-TR",
    timezoneId: config.timezone,
    viewport: { width: 1440, height: 900 },
  });
  context.setDefaultTimeout(config.timeoutMs);
  context.setDefaultNavigationTimeout(config.timeoutMs);
  const page = await context.newPage();
  return {
    browser,
    context,
    page,
    async close() {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

/** Save a full-page screenshot and the HTML of the page. Never throws. Returns the files written. */
export async function captureFailure(page: Page | undefined, runDir: string, label: string): Promise<string[]> {
  if (!page || page.isClosed()) return [];
  const safe = label.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(runDir, `${safe}-${stamp}`);
  const files: string[] = [];
  try {
    fs.mkdirSync(runDir, { recursive: true });
    await page.screenshot({ path: `${base}.png`, fullPage: true, timeout: 15000 });
    files.push(`${base}.png`);
  } catch (err) {
    log.warn(`screenshot failed: ${(err as Error).message.split("\n")[0]}`);
  }
  try {
    const html = await page.content();
    fs.writeFileSync(`${base}.html`, `<!-- url: ${page.url()} -->\n${html}`);
    files.push(`${base}.html`);
  } catch {
    /* ignore */
  }
  if (files.length) log.info(`failure evidence saved: ${files.join(", ")}`);
  return files;
}
