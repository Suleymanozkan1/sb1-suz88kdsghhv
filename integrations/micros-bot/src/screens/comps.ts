/**
 * Checks closed as on-house (ödenmez) or hospitality (ikram) — from a Micros (or Opera) report, read only when
 * reports.json defines the report ("comps" of that system with its reportName filled in).
 * Selectors: "comps" block of the system's selectors file
 *   steps / table / row / noData / nextPage   as for minibar (row and columns relative to the table)
 *   columns.{checkNo, outlet, kind?, reason?, person?, note?, itemCode?, itemName, qty}   CSS relative to the row
 *   skipItemNamePattern   regex for rows to ignore (totals)
 * reports.json "columns" may name the column headers instead of the CSS; "kindMap" maps the texts of the kind column
 * to ON_HOUSE / HOSPITALITY ("defaultKind" when there is no such column).
 * One row = one item; the rows of a check form one record. Reports that print the check number, outlet … only on a
 * check's first row are filled down. Negative quantities (a comped item voided again) are netted against the item;
 * an item that nets to zero or less is dropped.
 */
import type { Comp, CompKind } from "../contract";
import { Screen } from "../browser/screen";
import type { CompsScreen } from "../browser/selectors";
import { BotError, ParseError } from "../errors";
import { log } from "../logger";
import { compKindOf, type ReportDefinition } from "../reports";
import type { NumberFormat } from "../util/numbers";
import type { DetailResult } from "./listDetail";
import { num, screenOptions, type ScreenContext } from "./context";

const MAX_PAGES = 200;
const FIELDS = ["checkNo", "outlet", "kind", "reason", "person", "note", "itemCode", "itemName", "qty"] as const;
export type CompRow = Record<(typeof FIELDS)[number], string | null>;
/** header values carried from a check's first row to the rows below it */
const CARRIED = ["checkNo", "outlet", "kind", "reason", "person", "note"] as const;

/** Rows of the report → one record per check. Rows that cannot be read are skipped with a warning. */
export function groupCompRows(rows: CompRow[], def: ReportDefinition, fmt: NumberFormat = "auto", skip: RegExp | null = null, prev: Partial<CompRow> = {}): { items: Comp[]; warnings: string[]; last: Partial<CompRow> } {
  const warnings: string[] = [];
  const byCheck = new Map<string, Comp>();
  const last: Partial<CompRow> = { ...prev };
  for (const raw of rows) {
    const r = { ...raw };
    // a new check number starts a new group: its own header values only, nothing carried from the check above
    const newCheck = !!r.checkNo && r.checkNo !== last.checkNo;
    for (const f of CARRIED) {
      if (r[f]) last[f] = r[f];
      else if (newCheck) last[f] = null;
      else r[f] = last[f] ?? null;
    }
    const itemName = r.itemName ?? "";
    if (!itemName || (skip && skip.test(itemName))) continue;
    try {
      if (!r.checkNo) throw new ParseError(`comp "${itemName}": empty check number`);
      if (!r.outlet) throw new ParseError(`comp check ${r.checkNo}: empty outlet`);
      const kind: CompKind | null = compKindOf(def, r.kind);
      if (!kind) throw new ParseError(`comp check ${r.checkNo}: "${r.kind ?? ""}" is neither on-house nor hospitality (kindMap in reports.json)`);
      const qty = num(r.qty, `comp check ${r.checkNo} "${itemName}" qty`, fmt);
      if (qty === 0) continue;
      const key = `${r.checkNo}\u0000${r.outlet}`;
      let comp = byCheck.get(key);
      if (!comp) {
        comp = { checkNo: r.checkNo, outlet: r.outlet, kind, reason: r.reason || null, person: r.person || null, note: r.note || null, lines: [] };
        byCheck.set(key, comp);
      } else if (comp.kind !== kind) {
        warnings.push(`comp check ${r.checkNo}: rows with both on-house and hospitality, kept ${comp.kind}`);
      }
      const line = comp.lines.find((l) => l.itemName === itemName && (l.itemCode ?? null) === (r.itemCode || null));
      if (line) line.qty += qty;
      else comp.lines.push({ itemCode: r.itemCode || null, itemName, qty });
    } catch (err) {
      if (!(err instanceof ParseError)) throw err;
      warnings.push(`${err.message} — row skipped`);
    }
  }
  return { items: [...byCheck.values()], warnings, last };
}

/** Lines that net to zero or less (fully voided) are not consumption; a check left without lines is dropped. */
export function netComps(comps: Comp[]): Comp[] {
  const out: Comp[] = [];
  for (const c of comps) {
    const lines = c.lines.filter((l) => l.qty > 0);
    if (lines.length) out.push({ ...c, lines });
    else log.debug(`[comps] check ${c.checkNo}: every item voided, skipped`);
  }
  return out;
}

export async function readComps(
  ctx: ScreenContext<{ dateFormat?: string; numberFormat?: NumberFormat; comps?: CompsScreen | null }>,
  def: ReportDefinition,
): Promise<DetailResult<Comp>> {
  const block = ctx.selectors.comps;
  if (!block) throw new BotError("comps report is defined in reports.json but the \"comps\" block is missing in the selectors file");
  const fmt = ctx.selectors.numberFormat ?? "auto";
  const skip = block.skipItemNamePattern ? new RegExp(block.skipItemNamePattern, "i") : null;
  const screen = new Screen(ctx.page, "comps", block as unknown as Record<string, unknown>, screenOptions(ctx));
  const warnings: string[] = [];
  const all = new Map<string, Comp>();

  await screen.runSteps("steps");
  if ((await screen.waitAny(["table", "noData"])) === "noData") {
    log.info("[comps] no on-house / hospitality checks for this day");
    return { items: [], warnings };
  }
  let prevSignature = "";
  let carried: Partial<CompRow> = {};
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const table = await screen.need("table");
    const rows = await screen.readRows(
      "row",
      Object.fromEntries(FIELDS.map((f) => [f, `columns.${f}`])) as Record<(typeof FIELDS)[number], string>,
      ["checkNo", "itemName", "qty"],
      table,
      def.columns,
    );
    const page = groupCompRows(rows, def, fmt, skip, carried);
    carried = page.last;
    warnings.push(...page.warnings);
    for (const c of page.items) {
      // a check split over two pages: its lines are added to the record started on the page before
      const key = `${c.checkNo}\u0000${c.outlet}`;
      const prev = all.get(key);
      if (!prev) all.set(key, c);
      else {
        for (const l of c.lines) {
          const same = prev.lines.find((x) => x.itemName === l.itemName && (x.itemCode ?? null) === (l.itemCode ?? null));
          if (same) same.qty += l.qty;
          else prev.lines.push(l);
        }
      }
    }
    const signature = rows.map((r) => `${r.checkNo ?? ""}|${r.itemName ?? ""}|${r.qty ?? ""}`).join("~");
    const next = screen.sel("nextPage", true);
    if (!next || rows.length === 0 || signature === prevSignature) break;
    prevSignature = signature;
    const nextLoc = ctx.page.locator(next).first();
    if ((await nextLoc.count()) === 0 || (await nextLoc.isDisabled().catch(() => false))) break;
    await nextLoc.click();
    await ctx.page.waitForLoadState("domcontentloaded");
  }
  return { items: netComps([...all.values()]), warnings };
}
