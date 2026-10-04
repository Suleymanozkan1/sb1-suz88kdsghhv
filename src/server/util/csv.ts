/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string, delimiter?: string): string[][] {
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
      row = [];
    } else field += ch;
  }
  if (inQuotes) throw new Error("Malformed CSV: unterminated quoted field");
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Map rows to objects keyed by normalized header names. */
export function csvToObjects(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text);
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
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
