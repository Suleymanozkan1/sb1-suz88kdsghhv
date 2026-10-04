"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Label, Select, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";

const KINDS = {
  expenses: { label: "Expenses (accounting / payroll / utilities)", template: "date,department,category,subcategory,description,amount,tax,quantity,unit,supplier,invoice_no,asset,room,external_id\n2026-09-30,HK,LABOR,SALARY,Housekeeping payroll,185000,,,,,,,,PAY-HK-2026-09" },
  occupancy: { label: "PMS daily occupancy", template: "business_date,available_rooms,occupied_rooms,out_of_order,guests,room_revenue\n2026-09-01,90,71,0,138,412000" },
  reservations: { label: "PMS reservations / stays", template: "external_id,room,room_type,arrival,departure,guests,channel,board_basis,status,gross_room_revenue,commission,payment_fee,other_distribution\nRES-1001,101,Standard,2026-09-01,2026-09-04,2,OTA,BB,CHECKED_OUT,13500,2025,0,0" },
  products: { label: "Product master (new SKUs)", template: "sku,name,category,stock_unit,purchase_unit,case_size,recipe_unit,supplier,standard_cost,reorder_point,safety_stock,yield_pct,barcode\nVEG-ZUCCHINI,Zucchini,Vegetables,kg,case,5,g,HAL-SEBZE,42,10,5,90," },
  "supplier-prices": { label: "Supplier price list / contract", template: "supplier,sku,price_date,purchase_unit,price,source\nANT-ET,CHK-BREAST,2026-10-01,case,2050,CONTRACT" },
  "opening-stock": { label: "Opening stock (go-live)", template: "warehouse,sku,quantity,unit_cost\nMAIN,CHK-BREAST,40,205" },
} as const;
type Kind = keyof typeof KINDS;

interface Preview {
  rows: Array<{ row: number; status: string; messages: string[] }>;
  counts: { total: number; valid: number; invalid: number; duplicate: number; warning?: number };
  totalAmount?: string;
}

export type ImportKindKey = Kind;
export function Importer({ allowed }: { allowed: Kind[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(allowed[0] ?? "expenses");
  const [csv, setCsv] = useState("");
  const [xlsx, setXlsx] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const payload = (text = csv, x = xlsx) => (x ? { xlsx: x } : { csv: text });
  async function doPreview(text = csv, x = xlsx) {
    setMsg(null);
    setPreview(null);
    setBusy(true);
    try {
      setPreview(await call<Preview>("POST", `/api/imports/${kind}/preview`, payload(text, x)));
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Preview failed" });
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<{ posted: number; duplicates: number }>("POST", `/api/imports/${kind}/commit`, { ...payload(), fileName: fileName || `${kind}.csv` });
      setMsg({ tone: "green", text: `Imported ${r.posted} row(s)${r.duplicates ? `, skipped ${r.duplicates} duplicate(s)` : ""}.` });
      setPreview(null);
      setCsv("");
      setXlsx(null);
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Import failed" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-3 md:grid-cols-3">
        <div><Label htmlFor="im-kind">Data</Label><Select id="im-kind" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setPreview(null); }}>{allowed.map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}</Select></div>
        <div className="md:col-span-2">
          <Label htmlFor="im-file">CSV (comma or semicolon) or Excel .xlsx (first sheet)</Label>
          <input id="im-file" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="block w-full text-sm" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFileName(f.name);
            if (/\.xlsx$/i.test(f.name)) {
              const buf = new Uint8Array(await f.arrayBuffer());
              let bin = "";
              for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
              const b64 = btoa(bin);
              setXlsx(b64);
              setCsv("");
              await doPreview("", b64);
            } else {
              const t = await f.text();
              setXlsx(null);
              setCsv(t);
              await doPreview(t, null);
            }
          }} />
        </div>
      </div>
      <details className="text-sm"><summary className="cursor-pointer text-ink-600">Template</summary><pre tabIndex={0} className="mt-2 overflow-x-auto rounded bg-ink-50 p-2 text-xs">{KINDS[kind].template}</pre></details>
      {xlsx ? <p className="text-sm text-ink-600">Excel file loaded: {fileName}</p> : <textarea aria-label="CSV content" className="h-28 w-full rounded-lg border border-ink-200 p-2 font-mono text-xs" placeholder="…or paste CSV here" value={csv} onChange={(e) => setCsv(e.target.value)} />}
      <div className="flex gap-2">
        <Button variant="secondary" disabled={(!csv && !xlsx) || busy} onClick={() => doPreview()}>Preview</Button>
        <Button disabled={!preview || preview.counts.invalid > 0 || preview.counts.valid === 0 || busy} onClick={commit}>Import {preview ? preview.counts.valid : ""} row(s)</Button>
      </div>
      {preview && (
        <div className="space-y-2">
          <p className="text-sm">
            <Badge tone="green">{preview.counts.valid} valid</Badge> <Badge tone="red">{preview.counts.invalid} invalid</Badge> <Badge tone="amber">{preview.counts.duplicate} duplicate</Badge> {preview.counts.warning ? <Badge tone="violet">{preview.counts.warning} warning</Badge> : null}
            {preview.totalAmount && <span className="ml-2">Total {Number(preview.totalAmount).toLocaleString("tr-TR")}</span>}
            {preview.counts.invalid > 0 && <span className="ml-2 text-red-700">Fix invalid rows first — imports are all-or-nothing.</span>}
          </p>
          {preview.rows.some((r) => r.status !== "VALID") && (
            <Table>
              <thead><tr><Th>Row</Th><Th>Status</Th><Th>Problem</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">{preview.rows.filter((r) => r.status !== "VALID").slice(0, 50).map((r) => <tr key={r.row}><Td>{r.row}</Td><Td><Badge tone={r.status === "INVALID" ? "red" : r.status === "WARNING" ? "violet" : "amber"}>{r.status}</Badge></Td><Td className="text-xs">{r.messages.join("; ")}</Td></tr>)}</tbody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}
