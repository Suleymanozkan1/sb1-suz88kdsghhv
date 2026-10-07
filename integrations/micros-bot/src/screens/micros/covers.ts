/**
 * Covers (kişi sayısı) sold per outlet and meal — e.g. breakfasts — from a Micros report.
 * Selectors: "covers" block of selectors/micros.json
 *   steps                 navigation to the report of the day
 *   table / noData        the report table (or the "no data" message)
 *   row                   one element per outlet/meal (relative to table)
 *   columns.{outlet, meal, covers}   CSS relative to the row; meal may be null → "defaultMeal" is used
 *   skipOutletPattern     regex for total / header rows (e.g. "^(Toplam|Total)")
 * Rows with the same outlet + meal are added up.
 */
import type { Covers } from "../../contract";
import { Screen } from "../../browser/screen";
import type { MicrosSelectors } from "../../browser/selectors";
import { BotError } from "../../errors";
import { log } from "../../logger";
import type { DetailResult } from "../listDetail";
import { num, screenOptions, type ScreenContext } from "../context";

export async function readCovers(ctx: ScreenContext<MicrosSelectors>): Promise<DetailResult<Covers>> {
  const s = ctx.selectors;
  const screen = new Screen(ctx.page, "covers", s.covers as unknown as Record<string, unknown>, screenOptions(ctx));
  const fmt = s.numberFormat ?? "auto";
  const skip = s.covers.skipOutletPattern ? new RegExp(s.covers.skipOutletPattern, "i") : null;
  const warnings: string[] = [];

  await screen.runSteps("steps");
  if ((await screen.waitAny(["table", "noData"])) === "noData") {
    log.info("[covers] no covers for this day");
    return { items: [], warnings };
  }
  const table = await screen.need("table");
  const rows = await screen.readRows("row", { outlet: "columns.outlet", meal: "columns.meal", covers: "columns.covers" }, ["outlet", "covers"], table);
  const byKey = new Map<string, Covers>();
  for (const r of rows) {
    const outlet = r.outlet ?? "";
    if (!outlet || (skip && skip.test(outlet))) continue;
    const meal = r.meal || s.covers.defaultMeal || "";
    if (!meal) throw new BotError("covers: no meal column and no defaultMeal configured in the selectors file");
    let covers: number;
    try {
      covers = num(r.covers, `covers ${outlet}/${meal}`, fmt);
    } catch (err) {
      warnings.push((err as Error).message);
      continue;
    }
    const key = `${outlet}\u0000${meal}`;
    const prev = byKey.get(key);
    if (prev) prev.covers += covers;
    else byKey.set(key, { outlet, meal, covers });
  }
  return { items: [...byKey.values()], warnings };
}
