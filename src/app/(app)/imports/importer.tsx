"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Label, Select, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

const KINDS = {
  expenses: { label: "Expenses (accounting / payroll / utilities)", template: "date,department,category,subcategory,description,amount,tax,quantity,unit,supplier,invoice_no,asset,room,external_id\n2026-09-30,HK,LABOR,SALARY,Housekeeping payroll,185000,,,,,,,,PAY-HK-2026-09" },
  occupancy: { label: "PMS daily occupancy", template: "business_date,available_rooms,occupied_rooms,out_of_order,guests,room_revenue\n2026-09-01,90,71,0,138,412000" },
  reservations: { label: "PMS reservations / stays", template: "external_id,room,room_type,arrival,departure,guests,channel,board_basis,status,gross_room_revenue,commission,payment_fee,other_distribution\nRES-1001,101,Standard,2026-09-01,2026-09-04,2,OTA,BB,CHECKED_OUT,13500,2025,0,0" },
  products: { label: "Product master (new products)", template: "name,category,stock_unit,purchase_unit,case_size,recipe_unit,supplier,standard_cost,sku\nZucchini,Vegetables,kg,case,5,g,HAL-SEBZE,42," },
  "supplier-prices": { label: "Supplier price list / contract", template: "supplier,product,price_date,purchase_unit,price,source\nANT-ET,Chicken Breast,2026-10-01,case,2050,CONTRACT" },
  "opening-stock": { label: "Opening stock (go-live)", template: "warehouse,product,quantity,unit_cost\nMAIN,Chicken Breast,40,205" },
} as const;
type Kind = keyof typeof KINDS;

interface Preview {
  rows: Array<{ row: number; status: string; messages: string[] }>;
  counts: { total: number; valid: number; invalid: number; duplicate: number; warning?: number };
  totalAmount?: string;
}

export type ImportKindKey = Kind;
export function Importer({ allowed }: { allowed: Kind[] }) {
  const t = useT();
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
      setMsg({ tone: "red", text: e instanceof Error ? e.message : t("Preview failed") });
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<{ posted: number; duplicates: number }>("POST", `/api/imports/${kind}/commit`, { ...payload(), fileName: fileName || `${kind}.csv` });
      setMsg({ tone: "green", text: `${t("Imported {n} row(s)", { n: r.posted })}${r.duplicates ? t(", skipped {n} duplicate(s)", { n: r.duplicates }) : ""}.` });
      setPreview(null);
      setCsv("");
      setXlsx(null);
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : t("Import failed") });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-3 md:grid-cols-3">
        <div><Label htmlFor="im-kind">{t("Data")}</Label><Select id="im-kind" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setPreview(null); }}>{allowed.map((k) => <option key={k} value={k}>{t(KINDS[k].label)}</option>)}</Select></div>
        <div className="md:col-span-2">
          <Label htmlFor="im-file">{t("CSV (comma or semicolon) or Excel .xlsx (first sheet)")}</Label>
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
              const text = await f.text();
              setXlsx(null);
              setCsv(text);
              await doPreview(text, null);
            }
          }} />
        </div>
      </div>
      <details className="text-sm"><summary className="cursor-pointer text-ink-600">{t("Template")}</summary><pre tabIndex={0} className="mt-2 overflow-x-auto rounded bg-ink-50 p-2 text-xs">{KINDS[kind].template}</pre></details>
      {xlsx ? <p className="text-sm text-ink-600">{t("Excel file loaded: {name}", { name: fileName })}</p> : <textarea aria-label={t("CSV content")} className="h-28 w-full rounded-lg border border-ink-200 p-2 font-mono text-xs" placeholder={t("…or paste CSV here")} value={csv} onChange={(e) => setCsv(e.target.value)} />}
      <div className="flex gap-2">
        <Button variant="secondary" disabled={(!csv && !xlsx) || busy} onClick={() => doPreview()}>{t("Preview")}</Button>
        <Button disabled={!preview || preview.counts.invalid > 0 || preview.counts.valid === 0 || busy} onClick={commit}>{t("Import {n} row(s)", { n: preview ? preview.counts.valid : "" })}</Button>
      </div>
      {preview && (
        <div className="space-y-2">
          <p className="text-sm">
            <Badge tone="green">{t("{n} valid", { n: preview.counts.valid })}</Badge> <Badge tone="red">{t("{n} invalid", { n: preview.counts.invalid })}</Badge> <Badge tone="amber">{t("{n} duplicate", { n: preview.counts.duplicate })}</Badge> {preview.counts.warning ? <Badge tone="violet">{t("{n} warning", { n: preview.counts.warning })}</Badge> : null}
            {preview.totalAmount && <span className="ml-2">{t("Total {amount}", { amount: Number(preview.totalAmount).toLocaleString("tr-TR") })}</span>}
            {preview.counts.invalid > 0 && <span className="ml-2 text-red-700">{t("Fix invalid rows first — imports are all-or-nothing.")}</span>}
          </p>
          {preview.rows.some((r) => r.status !== "VALID") && (
            <Table>
              <thead><tr><Th>{t("Row")}</Th><Th>{t("Status")}</Th><Th>{t("Problem")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">{preview.rows.filter((r) => r.status !== "VALID").slice(0, 50).map((r) => <tr key={r.row}><Td>{r.row}</Td><Td><Badge tone={r.status === "INVALID" ? "red" : r.status === "WARNING" ? "violet" : "amber"}>{t(r.status)}</Badge></Td><Td className="text-xs">{r.messages.join("; ")}</Td></tr>)}</tbody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}
