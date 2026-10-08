/**
 * Micros checks (çek / adisyon) of a business day.
 * Selectors: "checks" block of selectors/micros.json
 *   steps            how to reach the closed-checks list of the day ({date} = the day in "dateFormat")
 *   list / row / rowLink / noData / nextPage / open   the list (row and rowLink are relative to list)
 *   detail.ready     optional element to wait for on the check page
 *   detail.checkNo / detail.outlet / detail.closedAt   header fields of the check
 *   detail.lineRow   one element per sold item;  detail.line.{itemCode,itemName,qty,amount}  CSS relative to the row
 *   detail.skipItemNamePattern   regex: lines to ignore (e.g. "^(Toplam|Total|Servis)")
 *   detail.closedAtFormat         overrides the file-level "dateTimeFormat"
 */
import type { Check, CheckLine } from "../../contract";
import { Screen } from "../../browser/screen";
import type { MicrosSelectors } from "../../browser/selectors";
import { ParseError, ScreenChangedError } from "../../errors";
import { log } from "../../logger";
import { traverseListDetail, type DetailResult } from "../listDetail";
import { num, screenOptions, toIso, type ScreenContext } from "../context";

export async function readChecks(ctx: ScreenContext<MicrosSelectors>): Promise<DetailResult<Check>> {
  const s = ctx.selectors;
  const screen = new Screen(ctx.page, "checks", s.checks as unknown as Record<string, unknown>, screenOptions(ctx));
  const fmt = s.numberFormat ?? "auto";
  const skip = s.checks.detail.skipItemNamePattern ? new RegExp(s.checks.detail.skipItemNamePattern, "i") : null;
  const closedAtFormat = (s.checks.detail.closedAtFormat as string | undefined) ?? s.dateTimeFormat ?? "DD.MM.YYYY HH:mm";

  let emptyChecks = 0;
  const result = await traverseListDetail<Check>(screen, "checks", async () => {
    if (screen.sel("detail.ready", true)) await screen.need("detail.ready");
    const checkNo = await screen.text("detail.checkNo");
    const outlet = await screen.text("detail.outlet");
    const closedRaw = await screen.optionalText("detail.closedAt");
    const rows = await screen.readRows(
      "detail.lineRow",
      { itemCode: "detail.line.itemCode", itemName: "detail.line.itemName", qty: "detail.line.qty", amount: "detail.line.amount" },
      ["itemName", "qty", "amount"],
    );
    const lines: CheckLine[] = [];
    for (const r of rows) {
      const itemName = r.itemName ?? "";
      if (!itemName || (skip && skip.test(itemName))) continue;
      const qty = num(r.qty, `check ${checkNo} "${itemName}" qty`, fmt);
      const amount = num(r.amount, `check ${checkNo} "${itemName}" amount`, fmt);
      if (qty === 0) {
        log.debug(`[checks] check ${checkNo}: zero-quantity line "${itemName}" ignored`);
        continue;
      }
      lines.push({ itemCode: r.itemCode || null, itemName, qty, amount });
    }
    if (!checkNo) throw new ParseError("check without a number");
    if (rows.length === 0) emptyChecks++;
    if (lines.length === 0) {
      log.info(`[checks] check ${checkNo} has no item lines (void / empty), skipped`);
      return null;
    }
    const check: Check = { checkNo, outlet, lines };
    if (closedRaw) check.closedAt = toIso(closedRaw, closedAtFormat, ctx.timezone, `check ${checkNo} closedAt`);
    return check;
  });
  // Every check opened but not a single line row matched: the line selector is wrong, not the data.
  if (result.items.length === 0 && emptyChecks > 0) throw new ScreenChangedError("checks", "detail.lineRow", screen.sel("detail.lineRow"));
  return result;
}
