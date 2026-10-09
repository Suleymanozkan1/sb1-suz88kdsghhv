"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Alert, Button, Input, Label, Select, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";
import { money, parseNum, qty } from "@/lib/format";
import { useT } from "@/i18n/client";

/** Only the selected warehouse's counts are listed; changing it reloads the page (and the export) for that store. */
export function WarehousePicker({ warehouses, selected }: { warehouses: { id: string; name: string }[]; selected: string }) {
  const router = useRouter();
  const t = useT();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="cnt-wh">{t("Show counts of")}</Label>
        <Select id="cnt-wh" className="w-64" value={selected} onChange={(e) => router.push(`/inventory/counts?warehouseId=${encodeURIComponent(e.target.value)}`)}>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      </div>
    </div>
  );
}

/** Soft delete (authorised users only; the server checks count:delete and refuses posted counts). */
export function DeleteCount({ countId, number }: { countId: string; number: string }) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  async function go() {
    if (busy || !window.confirm(t("Do you want to delete this count?"))) return;
    setBusy(true);
    try {
      await call("DELETE", `/api/counts/${countId}`);
      router.refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t("Failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" disabled={busy} onClick={go} title={t("Delete count")} aria-label={t("Delete count {number}", { number })} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-500 hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50">
      <X className="h-4 w-4" />
    </button>
  );
}

export function NewCount({ warehouses, selected, today }: { warehouses: { id: string; name: string }[]; selected: string; today: string }) {
  const router = useRouter();
  const t = useT();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErr(null);
    try {
      const wh = String(f.get("warehouseId") ?? "");
      await call("POST", "/api/counts", { warehouseId: wh, countDate: `${f.get("countDate")}T23:00:00Z` });
      // show the new count sheet: the list is per warehouse
      if (wh !== selected) router.push(`/inventory/counts?warehouseId=${encodeURIComponent(wh)}`);
      else router.refresh();
    } catch (x) {
      setErr(x instanceof Error ? x.message : t("Failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      {err && <Alert>{err}</Alert>}
      <div><Label htmlFor="nc-wh">{t("Warehouse")}</Label><Select key={selected} id="nc-wh" name="warehouseId" className="w-56" defaultValue={selected}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></div>
      <div><Label htmlFor="nc-date">{t("Count date")}</Label><Input id="nc-date" name="countDate" type="date" defaultValue={today} className="w-44" /></div>
      <Button type="submit" disabled={busy}>{busy ? t("Starting…") : t("Start count sheet")}</Button>
    </form>
  );
}

interface Line { productId: string; name: string; unit: string; systemQty: string; countedQty: string; varianceQty: string; varianceValue: string; reason: string }

export function CountEditor({ countId, lines, editable, currency }: { countId: string; lines: Line[]; editable: boolean; currency: string }) {
  const router = useRouter();
  const t = useT();
  const [vals, setVals] = useState<Record<string, { countedQty: string; reason: string }>>(Object.fromEntries(lines.map((l) => [l.productId, { countedQty: l.countedQty, reason: l.reason }])));
  const [msg, setMsg] = useState<{ tone: "red" | "green" | "amber"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(submit: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await call("PUT", `/api/counts/${countId}`, { lines: Object.entries(vals).map(([productId, v]) => ({ productId, countedQty: v.countedQty, reason: v.reason || null })) });
      if (submit) {
        await call("POST", `/api/counts/${countId}/submit`);
        setMsg({ tone: "amber", text: t("Sent for approval. Stock changes when an authorised manager approves the count.") });
      } else setMsg({ tone: "green", text: t("Saved.") });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : t("Failed") });
    } finally {
      setBusy(false);
    }
  }

  if (lines.length === 0) return <p className="text-sm text-ink-500">{t("No products in this warehouse.")}</p>;
  return (
    <div>
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <Table>
        <thead><tr><Th>{t("Product")}</Th><Th align="right">{t("System")}</Th><Th align="right">{t("Counted")}</Th><Th align="right">{t("Variance")}</Th><Th align="right">{t("Variance value")}</Th><Th>{t("Reason")}</Th></tr></thead>
        <tbody className="divide-y divide-ink-100">
          {lines.map((l) => {
            const v = vals[l.productId]!;
            const counted = parseNum(v.countedQty);
            const diff = (Number.isNaN(counted) ? 0 : counted) - Number(l.systemQty);
            // the stored variance value is only current while the input still matches what was saved
            const saved = counted === Number(l.countedQty);
            return (
              <tr key={l.productId}>
                <Td>{l.name}</Td>
                <Td align="right">{qty(l.systemQty, l.unit)}</Td>
                <Td align="right">{editable ? <Input aria-label={t("Counted {name}", { name: l.name })} inputMode="decimal" className="w-28 text-right" value={v.countedQty} onChange={(e) => setVals({ ...vals, [l.productId]: { ...v, countedQty: e.target.value } })} /> : qty(l.countedQty, l.unit)}</Td>
                <Td align="right" className={diff < 0 ? "text-red-700" : diff > 0 ? "text-brand-700" : ""}>{editable ? qty(diff, l.unit) : qty(l.varianceQty, l.unit)}</Td>
                <Td align="right">{editable && !saved ? t("on save") : money(l.varianceValue, currency)}</Td>
                <Td>{editable ? <Input aria-label={t("Reason {name}", { name: l.name })} className="w-48" value={v.reason} onChange={(e) => setVals({ ...vals, [l.productId]: { ...v, reason: e.target.value } })} /> : l.reason}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {editable && (
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => save(false)}>{t("Save")}</Button>
          <Button disabled={busy} onClick={() => save(true)}>{t("Send for approval")}</Button>
        </div>
      )}
    </div>
  );
}
