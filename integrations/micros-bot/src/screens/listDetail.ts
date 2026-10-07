/**
 * Shared traversal for "list of records → open each record" screens (checks, invoices):
 *   steps → wait for "list" (or "noData") → collect row links (following "nextPage") → open each → readDetail.
 * open = "link"  (default): the hrefs are collected first, then each detail page is opened with goto.
 * open = "click": for screens without real links (JavaScript grids): click the n-th row link, read the detail,
 *                 then go back ("detail.back" selector or the browser's back button).
 * A problem with ONE record (unreadable number, empty lines) skips that record with a warning; a missing
 * element (ScreenChangedError) or a timeout stops the whole screen.
 */
import { BotError, ParseError, ScreenChangedError, SelectorNotConfiguredError } from "../errors";
import { log } from "../logger";
import type { Screen } from "../browser/screen";

export interface DetailResult<T> { items: T[]; warnings: string[] }

const MAX_PAGES = 500;

function isFatal(err: unknown): boolean {
  if (err instanceof ScreenChangedError || err instanceof SelectorNotConfiguredError) return true;
  if (err instanceof ParseError) return false;
  if (err instanceof BotError) return false;
  return true; // timeouts, navigation / network errors
}

export async function traverseListDetail<T>(screen: Screen, label: string, readDetail: () => Promise<T | null>): Promise<DetailResult<T>> {
  const page = screen.page;
  const warnings: string[] = [];
  const items: T[] = [];

  await screen.runSteps("steps");
  const found = await screen.waitAny(["list", "noData"]);
  if (found === "noData") {
    log.info(`[${screen.name}] no ${label} for this day`);
    return { items, warnings };
  }

  const mode = screen.raw<string>("open") === "click" ? "click" : "link";
  const handleError = (err: unknown, which: string) => {
    if (isFatal(err)) throw err;
    const msg = `${label} ${which} skipped: ${(err as Error).message}`;
    log.warn(`[${screen.name}] ${msg}`);
    warnings.push(msg);
  };

  if (mode === "link") {
    const links: string[] = [];
    const seen = new Set<string>();
    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
      const list = await screen.need("list");
      const pageLinks = await screen.rowLinks("row", "rowLink", list);
      let added = 0;
      for (const l of pageLinks) if (!seen.has(l)) {
        seen.add(l);
        links.push(l);
        added++;
      }
      log.debug(`[${screen.name}] list page ${pageNo}: ${pageLinks.length} rows`);
      const next = screen.sel("nextPage", true);
      if (!next || added === 0) break;
      const nextLoc = page.locator(next).first();
      if ((await nextLoc.count()) === 0 || (await nextLoc.isDisabled().catch(() => false))) break;
      await nextLoc.click();
      await page.waitForLoadState("domcontentloaded");
    }
    log.info(`[${screen.name}] ${links.length} ${label} found, reading details`);
    for (let i = 0; i < links.length; i++) {
      try {
        await page.goto(links[i]!, { waitUntil: "domcontentloaded", timeout: screen.opts.timeoutMs });
        const item = await readDetail();
        if (item) items.push(item);
      } catch (err) {
        handleError(err, links[i]!);
      }
      if ((i + 1) % 100 === 0) log.info(`[${screen.name}] ${i + 1}/${links.length} read`);
    }
    return { items, warnings };
  }

  // click mode (single list page; pagination is not supported here)
  const list = await screen.need("list");
  const rowSel = screen.sel("row");
  const linkSel = screen.sel("rowLink");
  const count = await list.locator(rowSel).count();
  log.info(`[${screen.name}] ${count} ${label} found, reading details (click mode)`);
  for (let i = 0; i < count; i++) {
    try {
      const listNow = await screen.need("list");
      const row = listNow.locator(rowSel).nth(i);
      const link = row.locator(linkSel).first();
      await ((await link.count()) > 0 ? link : row).click();
      const item = await readDetail();
      if (item) items.push(item);
    } catch (err) {
      handleError(err, `row ${i + 1}`);
    }
    const back = screen.sel("detail.back", true);
    if (back && (await page.locator(back).count()) > 0) await page.locator(back).first().click();
    else await page.goBack({ waitUntil: "domcontentloaded" });
    await screen.need("list");
  }
  return { items, warnings };
}
