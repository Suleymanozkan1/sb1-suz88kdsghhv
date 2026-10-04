"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";

interface Preview { summary: { rows: number; valid: number; invalid: number; duplicates: number; warnings: number }; rows: { row: number; status: string; messages: string[] }[] }

export function SalesImporter() {
  const router = useRouter();
  const [csv, setCsv] = useState<string | null>(null);
  const [file, setFile] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setPreview(null);
    setMsg(null);
    if (!f) return;
    if (f.size > 5_000_000) return setMsg({ tone: "red", text: "File too large (max 5 MB)" });
    if (!/\.(csv|txt)$/i.test(f.name)) return setMsg({ tone: "red", text: "Only .csv files are accepted" });
    const text = await f.text();
    setCsv(text);
    setFile(f.name);
    try { setPreview(await call<Preview>("POST", "/api/sales/preview", { csv: text })); } catch (err) { setMsg({ tone: "red", text: err instanceof Error ? err.message : "Preview failed" }); }
  }
  async function commit() {
    try {
      const r = await call<{ summary: Preview["summary"]; theoreticalCost: string }>("POST", "/api/sales/commit", { csv, fileName: file });
      setMsg({ tone: "green", text: `Imported ${r.summary.valid} lines. Theoretical cost ${Number(r.theoreticalCost).toFixed(2)}.` });
      setPreview(null);
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof Error ? err.message : "Import failed" });
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">Columns: <code>external_id, sale_date, department, pos_code, quantity, net_revenue</code> (department = code, e.g. REST).</p>
      <input type="file" accept=".csv,text/csv" onChange={onFile} aria-label="Sales CSV file" className="block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-white" />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {preview && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge>{preview.summary.rows} rows</Badge><Badge tone="green">{preview.summary.valid} valid</Badge><Badge tone="red">{preview.summary.invalid} invalid</Badge><Badge tone="violet">{preview.summary.duplicates} duplicates</Badge><Badge tone="amber">{preview.summary.warnings} warnings</Badge>
          </div>
          {preview.rows.some((r) => r.status !== "VALID") && (
            <Table className="max-h-64">
              <thead><tr><Th>Row</Th><Th>Status</Th><Th>Messages</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">{preview.rows.filter((r) => r.status !== "VALID").slice(0, 100).map((r) => <tr key={r.row}><Td>{r.row}</Td><Td><Badge tone={r.status === "INVALID" ? "red" : r.status === "DUPLICATE" ? "violet" : "amber"}>{r.status}</Badge></Td><Td className="whitespace-normal text-xs">{r.messages.join("; ")}</Td></tr>)}</tbody>
            </Table>
          )}
          <Button onClick={commit} disabled={preview.summary.valid === 0}>Commit {preview.summary.valid} lines</Button>
        </>
      )}
    </div>
  );
}
