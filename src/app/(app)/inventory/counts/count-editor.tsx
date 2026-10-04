"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";
import { qty } from "@/lib/format";

export function NewCount({ warehouses }: { warehouses: { id: string; name: string }[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await call("POST", "/api/counts", { warehouseId: f.get("warehouseId"), countDate: `${f.get("countDate")}T23:00:00Z` });
      router.refresh();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Failed");
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      {err && <Alert>{err}</Alert>}
      <div><Label htmlFor="nc-wh">Warehouse</Label><Select id="nc-wh" name="warehouseId" className="w-56">{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></div>
      <div><Label htmlFor="nc-date">Count date</Label><Input id="nc-date" name="countDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="w-44" /></div>
      <Button type="submit">Start count sheet</Button>
    </form>
  );
}

interface Line { productId: string; name: string; unit: string; systemQty: string; countedQty: string; varianceQty: string; varianceValue: string; reason: string }

export function CountEditor({ countId, lines, editable }: { countId: string; lines: Line[]; editable: boolean }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, { countedQty: string; reason: string }>>(Object.fromEntries(lines.map((l) => [l.productId, { countedQty: l.countedQty, reason: l.reason }])));
  const [msg, setMsg] = useState<{ tone: "red" | "green" | "amber"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(submit: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await call("PUT", `/api/counts/${countId}`, { lines: Object.entries(vals).map(([productId, v]) => ({ productId, countedQty: v.countedQty, reason: v.reason || null })) });
      if (submit) {
        const r = await call<{ status: string }>("POST", `/api/counts/${countId}/submit`);
        setMsg(r.status === "POSTED" ? { tone: "green", text: "Count posted to the ledger." } : { tone: "amber", text: "Variance exceeds the threshold — sent for manager approval." });
      } else setMsg({ tone: "green", text: "Saved." });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  if (lines.length === 0) return <p className="text-sm text-ink-500">No products in this warehouse.</p>;
  return (
    <div>
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <Table>
        <thead><tr><Th>Product</Th><Th align="right">System</Th><Th align="right">Counted</Th><Th align="right">Variance</Th><Th align="right">Variance value</Th><Th>Reason</Th></tr></thead>
        <tbody className="divide-y divide-ink-100">
          {lines.map((l) => {
            const v = vals[l.productId]!;
            const diff = Number(v.countedQty || 0) - Number(l.systemQty);
            return (
              <tr key={l.productId}>
                <Td>{l.name}</Td>
                <Td align="right">{qty(l.systemQty, l.unit)}</Td>
                <Td align="right">{editable ? <Input aria-label={`Counted ${l.name}`} inputMode="decimal" className="w-28 text-right" value={v.countedQty} onChange={(e) => setVals({ ...vals, [l.productId]: { ...v, countedQty: e.target.value } })} /> : qty(l.countedQty, l.unit)}</Td>
                <Td align="right" className={diff < 0 ? "text-red-700" : diff > 0 ? "text-brand-700" : ""}>{editable ? qty(diff, l.unit) : qty(l.varianceQty, l.unit)}</Td>
                <Td align="right">{editable ? "on save" : Number(l.varianceValue).toFixed(2)}</Td>
                <Td>{editable ? <Input aria-label={`Reason ${l.name}`} className="w-48" value={v.reason} onChange={(e) => setVals({ ...vals, [l.productId]: { ...v, reason: e.target.value } })} /> : l.reason}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {editable && (
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => save(false)}>Save</Button>
          <Button disabled={busy} onClick={() => save(true)}>Submit & post</Button>
        </div>
      )}
    </div>
  );
}
