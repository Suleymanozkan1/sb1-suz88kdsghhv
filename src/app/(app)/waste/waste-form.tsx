"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { ProductPicker, unitsFor, type PickedProduct } from "@/components/product-picker";
import { call } from "@/lib/client";
import { money } from "@/lib/format";
import { useT } from "@/i18n/client";

interface Line { key: string; product: PickedProduct | null; quantity: string; unit: string; wasteType: string; reason: string }
// the first line is server-rendered: its key (used in element ids) must be the same on server and client
const blank = (key: string = crypto.randomUUID()): Line => ({ key, product: null, quantity: "", unit: "", wasteType: "SPOILED", reason: "" });

/**
 * Waste entry as a list: during the day staff write waste down ("5 of 50 eggs"); at the end of the day the chef
 * enters every line here and saves them together. One line works the same way.
 */
export function WasteForm({ types, departments, warehouses }: { types: string[]; departments: { id: string; name: string }[]; warehouses: { id: string; name: string; departmentId: string | null }[] }) {
  const router = useRouter();
  const t = useT();
  const [dept, setDept] = useState(departments[0]?.id ?? "");
  const whs = warehouses.filter((w) => !w.departmentId || w.departmentId === dept);
  const [wh, setWh] = useState(whs[0]?.id ?? "");
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([blank("w-0")]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green" | "amber"; text: string } | null>(null);
  const set = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const ready = lines.filter((l) => l.product && Number(l.quantity) > 0);

  async function save() {
    setMsg(null);
    if (!ready.length) return setMsg({ tone: "red", text: t("Add at least one product with a quantity") });
    setBusy(true);
    try {
      const r = await call<{ posted: number; pending: number; cost: string }>("POST", "/api/waste/batch", {
        departmentId: dept,
        warehouseId: wh || whs[0]?.id,
        wasteDate: `${day}T12:00:00Z`,
        lines: ready.map((l) => ({ productId: l.product!.id, quantity: l.quantity, unit: l.unit || l.product!.stockUnit, wasteType: l.wasteType, reason: l.reason || null })),
      });
      setMsg(r.pending
        ? { tone: "amber", text: t("{posted} line(s) posted ({cost}); {pending} above the approval threshold wait for a manager.", { posted: r.posted, pending: r.pending, cost: money(r.cost) }) }
        : { tone: "green", text: t("{posted} line(s) posted, total {cost}.", { posted: r.posted, cost: money(r.cost) }) });
      setLines([blank()]);
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof Error ? err.message : t("Failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-3 md:grid-cols-4">
        <div><Label htmlFor="wf-d">{t("Department")}</Label><Select id="wf-d" value={dept} onChange={(e) => { setDept(e.target.value); setWh(""); }}>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
        <div><Label htmlFor="wf-w">{t("Warehouse")}</Label><Select id="wf-w" value={wh || whs[0]?.id || ""} onChange={(e) => setWh(e.target.value)}>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></div>
        <div><Label htmlFor="wf-date">{t("Date")}</Label><Input id="wf-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></div>
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={l.key} className="grid items-end gap-2 rounded-lg border border-ink-100 p-2 md:grid-cols-12">
            <div className="md:col-span-4"><Label htmlFor={`wp-${l.key}`}>{t("Product {n}", { n: i + 1 })}</Label><ProductPicker id={`wp-${l.key}`} value={l.product} onChange={(p) => set(l.key, { product: p, unit: p?.stockUnit ?? "" })} /></div>
            <div className="md:col-span-1"><Label htmlFor={`wq-${l.key}`}>{t("Quantity")}</Label><Input id={`wq-${l.key}`} inputMode="decimal" value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} /></div>
            <div className="md:col-span-1"><Label htmlFor={`wu-${l.key}`}>{t("Unit")}</Label><Select id={`wu-${l.key}`} value={l.unit} onChange={(e) => set(l.key, { unit: e.target.value })}>{unitsFor(l.product).map((u) => <option key={u}>{u}</option>)}</Select></div>
            <div className="md:col-span-2"><Label htmlFor={`wt-${l.key}`}>{t("Waste type")}</Label><Select id={`wt-${l.key}`} value={l.wasteType} onChange={(e) => set(l.key, { wasteType: e.target.value })}>{types.map((x) => <option key={x} value={x}>{t(x.replace(/_/g, " ").toLowerCase())}</option>)}</Select></div>
            <div className="md:col-span-3"><Label htmlFor={`wr-${l.key}`}>{t("Reason")}</Label><Input id={`wr-${l.key}`} value={l.reason} placeholder={t("e.g. cracked eggs")} onChange={(e) => set(l.key, { reason: e.target.value })} /></div>
            <div className="md:col-span-1"><Button type="button" variant="ghost" aria-label={t("Remove")} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blank()]))}><Trash2 className="h-4 w-4" /></Button></div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="h-4 w-4" /> {t("Add line")}</Button>
        <Button type="button" disabled={busy || !ready.length} onClick={save}>{ready.length > 1 ? t("Save all ({n} lines)", { n: ready.length }) : t("Record waste")}</Button>
        <span className="text-xs text-ink-500">{t("Waste is deducted from stock at cost when saved; each line records who entered it.")}</span>
      </div>
    </div>
  );
}
