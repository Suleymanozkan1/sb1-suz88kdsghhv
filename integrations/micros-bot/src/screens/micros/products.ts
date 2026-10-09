/**
 * Product cards added in the Micros purchasing module since the last pull ("Ürünleri çek" in HotelCost). The store
 * keeper creates the card (name, unit, kilo / gramaj, VAT …) when entering an invoice; HotelCost creates the same
 * product in its own product list, once (matched by name).
 * Selectors: "products" block of selectors/micros.json (null = not set up; the pull then fails with a clear message)
 *   steps                 navigation to the product list, filtered on "created since" ({since} = last pull date in
 *                         "dateFormat", {sinceDay} = YYYY-MM-DD; first pull: 01.01.2000)
 *   table / noData        the product table (or the "no data" message)
 *   row                   one element per product (relative to table)
 *   nextPage              optional "next page" button
 *   columns.{name, code?, unit, packSize?, packUnit?, taxRatePct?, category?, createdAt?}   CSS relative to the row
 *     createdAt: when given, rows created before the last pull are skipped here as well
 *   createdAtFormat       overrides the file-level "dateFormat"
 *   skipNamePattern       regex for rows to ignore (totals, headers)
 * TODO (on site): find the purchasing module's product / stock card list and fill the selectors (see README).
 */
import type { ProductCard } from "../../contract";
import { Screen } from "../../browser/screen";
import type { MicrosSelectors } from "../../browser/selectors";
import { BotError, ParseError } from "../../errors";
import { log } from "../../logger";
import type { DetailResult } from "../listDetail";
import { optNum, screenOptions, toDay, type ScreenContext } from "../context";
import { formatDay } from "../../util/time";

const MAX_PAGES = 200;
const FIRST_PULL = "2000-01-01";

/** `since`: ISO time of the last successful pull (null / undefined = everything). */
export async function readProducts(ctx: ScreenContext<MicrosSelectors>, since?: string | null): Promise<DetailResult<ProductCard>> {
  const block = ctx.selectors.products;
  if (!block) throw new BotError("products screen is not configured (\"products\" block missing in the Micros selectors file)");
  const fmt = ctx.selectors.numberFormat ?? "auto";
  const dateFormat = ctx.selectors.dateFormat ?? "DD.MM.YYYY";
  const createdAtFormat = block.createdAtFormat ?? dateFormat;
  const skip = block.skipNamePattern ? new RegExp(block.skipNamePattern, "i") : null;
  // the pull time is a moment: the screen filters by day, in the hotel's time zone (a product made that day is read again; HotelCost skips it)
  const sinceDay = since ? new Intl.DateTimeFormat("en-CA", { timeZone: ctx.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(since)) : FIRST_PULL;
  const opts = screenOptions(ctx);
  const screen = new Screen(ctx.page, "products", block as unknown as Record<string, unknown>, { ...opts, vars: { ...opts.vars, since: formatDay(sinceDay, dateFormat), sinceDay } });
  const warnings: string[] = [];
  const byName = new Map<string, ProductCard>();

  await screen.runSteps("steps");
  if ((await screen.waitAny(["table", "noData"])) === "noData") {
    log.info(`[products] no new products since ${sinceDay}`);
    return { items: [], warnings };
  }
  let prevSignature = "";
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const table = await screen.need("table");
    const rows = await screen.readRows(
      "row",
      { name: "columns.name", code: "columns.code", unit: "columns.unit", packSize: "columns.packSize", packUnit: "columns.packUnit", taxRatePct: "columns.taxRatePct", category: "columns.category", createdAt: "columns.createdAt" },
      ["name", "unit"],
      table,
    );
    for (const r of rows) {
      const name = r.name ?? "";
      if (!name || (skip && skip.test(name))) continue;
      try {
        if (r.createdAt && toDay(r.createdAt, createdAtFormat, `product "${name}" created`) < sinceDay) continue;
        if (!r.unit) throw new ParseError(`product "${name}": empty unit`);
        const card: ProductCard = {
          name,
          code: r.code || null,
          unit: r.unit,
          packSize: optNum(r.packSize, `product "${name}" pack size`, fmt),
          packUnit: r.packUnit || null,
          taxRatePct: optNum(r.taxRatePct, `product "${name}" VAT %`, fmt),
          category: r.category || null,
        };
        const key = name.toLocaleLowerCase("tr");
        if (!byName.has(key)) byName.set(key, card);
      } catch (err) {
        if (!(err instanceof ParseError)) throw err;
        warnings.push(`${err.message} — row skipped`);
      }
    }
    const signature = rows.map((r) => `${r.code ?? ""}|${r.name ?? ""}`).join("~");
    const next = screen.sel("nextPage", true);
    if (!next || rows.length === 0 || signature === prevSignature) break;
    prevSignature = signature;
    const nextLoc = ctx.page.locator(next).first();
    if ((await nextLoc.count()) === 0 || (await nextLoc.isDisabled().catch(() => false))) break;
    await nextLoc.click();
    await ctx.page.waitForLoadState("domcontentloaded");
  }
  return { items: [...byName.values()], warnings };
}
