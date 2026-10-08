/**
 * Minibar charges of the business day — items posted to guest folios in Opera (e.g. a "minibar postings"
 * / transaction-code report filtered on the minibar codes).
 * Selectors: "minibar" block of selectors/opera.json (null = minibar is not read)
 *   steps                 navigation to the postings of the day ({date} = day in "dateFormat")
 *   table / noData        the postings table (or the "no data" message)
 *   row                   one element per posting (relative to table)
 *   nextPage              optional "next page" button
 *   columns.{room, itemCode?, itemName, qty, reference, postedAt?}   CSS relative to the row
 *     reference = folio / posting number: HotelCost uses it to skip charges it already has
 *   postedAtFormat        overrides the file-level "dateTimeFormat"
 *   skipItemNamePattern   regex for rows to ignore
 * The same module works for a Micros minibar outlet report: point a block with the same keys at it.
 */
import type { MinibarCharge } from "../../contract";
import { Screen } from "../../browser/screen";
import type { MinibarScreen } from "../../browser/selectors";
import { BotError, ParseError } from "../../errors";
import { log } from "../../logger";
import type { DetailResult } from "../listDetail";
import type { NumberFormat } from "../../util/numbers";
import { num, screenOptions, toIso, type ScreenContext } from "../context";

const MAX_PAGES = 200;

export async function readMinibar(
  ctx: ScreenContext<{ dateFormat?: string; dateTimeFormat?: string; numberFormat?: NumberFormat; minibar?: MinibarScreen | null }>,
): Promise<DetailResult<MinibarCharge>> {
  const block = ctx.selectors.minibar;
  if (!block) throw new BotError("minibar screen is not configured (\"minibar\" block missing in the selectors file)");
  const fmt = ctx.selectors.numberFormat ?? "auto";
  const postedAtFormat = block.postedAtFormat ?? ctx.selectors.dateTimeFormat ?? "DD.MM.YYYY HH:mm";
  const skip = block.skipItemNamePattern ? new RegExp(block.skipItemNamePattern, "i") : null;
  const screen = new Screen(ctx.page, "minibar", block as unknown as Record<string, unknown>, screenOptions(ctx));
  const warnings: string[] = [];
  const byRef = new Map<string, MinibarCharge>();

  await screen.runSteps("steps");
  if ((await screen.waitAny(["table", "noData"])) === "noData") {
    log.info("[minibar] no minibar postings for this day");
    return { items: [], warnings };
  }
  let prevSignature = "";
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const table = await screen.need("table");
    const rows = await screen.readRows(
      "row",
      { room: "columns.room", itemCode: "columns.itemCode", itemName: "columns.itemName", qty: "columns.qty", reference: "columns.reference", postedAt: "columns.postedAt" },
      ["room", "itemName", "qty", "reference"],
      table,
    );
    for (const r of rows) {
      const itemName = r.itemName ?? "";
      if (!itemName || (skip && skip.test(itemName))) continue;
      try {
        if (!r.room) throw new ParseError(`minibar "${itemName}": empty room`);
        if (!r.reference) throw new ParseError(`minibar room ${r.room} "${itemName}": empty reference`);
        const charge: MinibarCharge = { room: r.room, itemCode: r.itemCode || null, itemName, qty: num(r.qty, `minibar ${r.reference} qty`, fmt), reference: r.reference };
        if (r.postedAt) charge.postedAt = toIso(r.postedAt, postedAtFormat, ctx.timezone, `minibar ${r.reference} postedAt`);
        if (charge.qty <= 0) {
          // corrections / reversals (negative quantities) are not stock consumption
          log.debug(`[minibar] ${r.reference}: non-positive quantity ${charge.qty} ignored`);
          continue;
        }
        if (!byRef.has(charge.reference)) byRef.set(charge.reference, charge);
      } catch (err) {
        if (!(err instanceof ParseError)) throw err;
        warnings.push(`${err.message} — row skipped`);
      }
    }
    // a page of only reversals / skipped rows is still a page: stop on an empty or unchanged page, not on "nothing added"
    const signature = rows.map((r) => `${r.reference ?? ""}|${r.room ?? ""}|${r.itemName ?? ""}`).join("~");
    const next = screen.sel("nextPage", true);
    if (!next || rows.length === 0 || signature === prevSignature) break;
    prevSignature = signature;
    const nextLoc = ctx.page.locator(next).first();
    if ((await nextLoc.count()) === 0 || (await nextLoc.isDisabled().catch(() => false))) break;
    await nextLoc.click();
    await ctx.page.waitForLoadState("domcontentloaded");
  }
  return { items: [...byRef.values()], warnings };
}
