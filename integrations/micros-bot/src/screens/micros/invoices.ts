/**
 * Purchase invoices of the business day from the Micros purchasing web screens.
 * Selectors: "invoices" block of selectors/micros.json
 *   steps / list / row / rowLink / noData / nextPage / open   as for checks
 *   detail.supplierName / detail.invoiceNo / detail.invoiceDate / detail.warehouse (optional) / detail.total (optional:
 *   grand total incl. VAT; HotelCost rejects an invoice whose lines do not add up to it)
 *   detail.lineRow;  detail.line.{itemCode?, itemName, qty, unit, unitPrice, taxRatePct?}
 *   detail.invoiceDateFormat   overrides the file-level "dateFormat"
 * The purchasing data can also come from export files instead (INVOICE_SOURCE=file, see src/invoices/fileReader.ts).
 */
import type { Invoice, InvoiceLine } from "../../contract";
import { Screen } from "../../browser/screen";
import type { MicrosSelectors } from "../../browser/selectors";
import { ParseError, ScreenChangedError } from "../../errors";
import { traverseListDetail, type DetailResult } from "../listDetail";
import { num, optNum, screenOptions, toDay, type ScreenContext } from "../context";

export async function readInvoicesFromWeb(ctx: ScreenContext<MicrosSelectors>): Promise<DetailResult<Invoice>> {
  const s = ctx.selectors;
  const screen = new Screen(ctx.page, "invoices", s.invoices as unknown as Record<string, unknown>, screenOptions(ctx));
  const fmt = s.numberFormat ?? "auto";
  const skip = s.invoices.detail.skipItemNamePattern ? new RegExp(s.invoices.detail.skipItemNamePattern, "i") : null;
  const dateFormat = (s.invoices.detail.invoiceDateFormat as string | undefined) ?? s.dateFormat ?? "DD.MM.YYYY";

  return traverseListDetail<Invoice>(screen, "invoices", async () => {
    if (screen.sel("detail.ready", true)) await screen.need("detail.ready");
    const supplierName = await screen.text("detail.supplierName");
    const invoiceNo = await screen.text("detail.invoiceNo");
    const invoiceDate = toDay(await screen.text("detail.invoiceDate"), dateFormat, `invoice ${invoiceNo} date`);
    const warehouse = (await screen.optionalText("detail.warehouse")) || null;
    const total = optNum(await screen.optionalText("detail.total"), `invoice ${invoiceNo} total`, fmt);
    const rows = await screen.readRows(
      "detail.lineRow",
      {
        itemCode: "detail.line.itemCode", itemName: "detail.line.itemName", qty: "detail.line.qty",
        unit: "detail.line.unit", unitPrice: "detail.line.unitPrice", taxRatePct: "detail.line.taxRatePct",
      },
      ["itemName", "qty", "unit", "unitPrice"],
    );
    // an invoice always has lines: none matched means the line selector is wrong
    if (rows.length === 0) throw new ScreenChangedError("invoices", "detail.lineRow", screen.sel("detail.lineRow"));
    const lines: InvoiceLine[] = [];
    for (const r of rows) {
      const itemName = r.itemName ?? "";
      if (!itemName || (skip && skip.test(itemName))) continue;
      const where = `invoice ${invoiceNo} "${itemName}"`;
      lines.push({
        itemCode: r.itemCode || null,
        itemName,
        qty: num(r.qty, `${where} qty`, fmt),
        unit: r.unit || "",
        unitPrice: num(r.unitPrice, `${where} unit price`, fmt),
        taxRatePct: optNum(r.taxRatePct, `${where} VAT %`, fmt),
      });
    }
    if (!supplierName || !invoiceNo) throw new ParseError("invoice without supplier or number");
    if (lines.length === 0) throw new ParseError(`invoice ${supplierName} ${invoiceNo} has no lines`);
    return { supplierName, invoiceNo, invoiceDate, warehouse, total, lines };
  });
}
