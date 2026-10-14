import { DomainError } from "@/domain/errors";

/** Import limits: the objects built are header columns × data rows, so both and their product are bounded. */
export const CSV_MAX_COLUMNS = 200;
export const CSV_MAX_ROWS = 50_000;
export const CSV_MAX_CELLS = 2_000_000;

/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF). `maxDataRows`: rows after the header line. */
export function parseCsv(text: string, delimiter?: string, maxDataRows = Infinity): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = delimiter ?? (firstLine.split(";").length > firstLine.split(",").length ? ";" : ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      if (rows.length > maxDataRows + 1) throw new DomainError("VALIDATION", `The file has more than ${maxDataRows} rows`);
      row = [];
    } else field += ch;
  }
  if (inQuotes) throw new Error("Malformed CSV: unterminated quoted field");
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  if (rows.length > maxDataRows + 1) throw new DomainError("VALIDATION", `The file has more than ${maxDataRows} rows`);
  return rows;
}

/** Map rows to objects keyed by normalized header names. */
export function csvToObjects(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text, undefined, CSV_MAX_ROWS);
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  if (header.length > CSV_MAX_COLUMNS) throw new DomainError("VALIDATION", `The file has more than ${CSV_MAX_COLUMNS} columns`);
  if (header.length * rows.length > CSV_MAX_CELLS) throw new DomainError("VALIDATION", `The file has more than ${CSV_MAX_CELLS} cells: split it into smaller files`);
  return rows.map((r) => {
    const o: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) o[header[i]!] = (r[i] ?? "").trim();
    return o;
  });
}

/** Neutralize spreadsheet formula injection on export (=, +, -, @). */
export function csvSafe(v: string): string {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Map common POS export column names onto the sale import schema. */
export function mapSaleRow(r: Record<string, string>) {
  return { externalId: r.external_id ?? r.id ?? r.ticket_line ?? "", saleDate: r.sale_date ?? r.date ?? "", department: r.department ?? r.outlet ?? "", posCode: r.pos_code ?? r.item_code ?? r.plu ?? "", quantity: r.quantity ?? r.qty ?? "", netRevenue: r.net_revenue ?? r.revenue ?? r.amount ?? "" };
}
