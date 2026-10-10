"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

interface Preview { summary: { rows: number; valid: number; invalid: number; duplicates: number; warnings: number }; rows: { row: number; status: string; messages: string[] }[] }

export function SalesImporter() {
  const t = useT();
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
    if (f.size > 5_000_000) return setMsg({ tone: "red", text: t("File too large (max 5 MB)") });
    if (!/\.(csv|txt)$/i.test(f.name)) return setMsg({ tone: "red", text: t("Only .csv files are accepted") });
    const text = await f.text();
    setCsv(text);
    setFile(f.name);
    try { setPreview(await call<Preview>("POST", "/api/sales/preview", { csv: text })); } catch (err) { setMsg({ tone: "red", text: err instanceof Error ? err.message : t("Preview failed") }); }
  }
  const [busy, setBusy] = useState(false);
  async function commit() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await call<{ summary: Preview["summary"]; theoreticalCost: string }>("POST", "/api/sales/commit", { csv, fileName: file });
      setMsg({ tone: "green", text: t("Imported {n} lines. Theoretical cost {cost}.", { n: r.summary.valid, cost: Number(r.theoreticalCost).toFixed(2) }) });
      setPreview(null);
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof Error ? err.message : t("Import failed") });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">{t("Columns:")} <code>external_id, sale_date, department, pos_code, quantity, net_revenue</code> {t("(department = code, e.g. REST).")}</p>
      <input type="file" accept=".csv,text/csv" onChange={onFile} aria-label={t("Sales CSV file")} className="block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-white" />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {preview && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge>{t("{n} rows", { n: preview.summary.rows })}</Badge><Badge tone="green">{t("{n} valid", { n: preview.summary.valid })}</Badge><Badge tone="red">{t("{n} invalid", { n: preview.summary.invalid })}</Badge><Badge tone="violet">{t("{n} duplicates", { n: preview.summary.duplicates })}</Badge><Badge tone="amber">{t("{n} warnings", { n: preview.summary.warnings })}</Badge>
          </div>
          {preview.rows.some((r) => r.status !== "VALID") && (
            <Table className="max-h-64">
              <thead><tr><Th>{t("Row")}</Th><Th>{t("Status")}</Th><Th>{t("Messages")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">{preview.rows.filter((r) => r.status !== "VALID").slice(0, 100).map((r) => <tr key={r.row}><Td>{r.row}</Td><Td><Badge tone={r.status === "INVALID" ? "red" : r.status === "DUPLICATE" ? "violet" : "amber"}>{t(r.status)}</Badge></Td><Td className="whitespace-normal text-xs">{r.messages.join("; ")}</Td></tr>)}</tbody>
            </Table>
          )}
          <Button onClick={commit} disabled={busy || preview.summary.valid === 0}>{t("Commit {n} lines", { n: preview.summary.valid })}</Button>
        </>
      )}
    </div>
  );
}
