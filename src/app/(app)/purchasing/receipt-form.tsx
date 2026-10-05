"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { ProductPicker, unitsFor, type PickedProduct } from "@/components/product-picker";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

interface Line { key: string; product: PickedProduct | null; quantity: string; unit: string; unitPrice: string; discount: string; taxRatePct: string }
// the first line is server-rendered: its key (used in element ids) must be the same on server and client
const blank = (key: string = crypto.randomUUID()): Line => ({ key, product: null, quantity: "", unit: "", unitPrice: "", discount: "", taxRatePct: "" });

interface Impact { product: { name: string }; recipes: { name: string; oldPortionCost: string | null; newPortionCost: string | null; newMarginPct: string | null; belowTarget: boolean }[] }

export function ReceiptForm({ suppliers, warehouses }: { suppliers: { id: string; name: string }[]; warehouses: { id: string; name: string }[] }) {
  const router = useRouter();
  const t = useT();
  const [lines, setLines] = useState<Line[]>([blank("line-0")]);
  const [msg, setMsg] = useState<{ tone: "red" | "green" | "amber"; text: string } | null>(null);
  const [impacts, setImpacts] = useState<Impact[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const items = lines.filter((l) => l.product).map((l) => ({ productId: l.product!.id, quantity: l.quantity, unit: l.unit || l.product!.purchaseUnit, unitPrice: l.unitPrice, ...(l.discount ? { discount: l.discount } : {}), ...(l.taxRatePct ? { taxRatePct: l.taxRatePct } : {}) }));
    if (!items.length) return setMsg({ tone: "red", text: t("Add at least one product line") });
    setBusy(true);
    setMsg(null);
    try {
      const num = (k: string) => (f.get(k) ? String(f.get(k)) : undefined);
      const r = await call<{ receipt: { number: string; landedTotal: string }; priceAlerts: { name: string; changePct: string }[]; impacts: Impact[] }>("POST", "/api/receipts", {
        supplierId: f.get("supplierId"), warehouseId: f.get("warehouseId"), receiptDate: `${f.get("receiptDate")}T12:00:00Z`, invoiceNo: num("invoiceNo"), freight: num("freight"), handling: num("handling"), otherCost: num("otherCost"), allocationMethod: f.get("allocationMethod"), idempotencyKey: crypto.randomUUID(), items,
      });
      setMsg({ tone: r.priceAlerts.length ? "amber" : "green", text: `${t("{number} posted · landed {total}", { number: r.receipt.number, total: Number(r.receipt.landedTotal).toFixed(2) })}${r.priceAlerts.length ? ` · ${t("PRICE ALERT:")} ${r.priceAlerts.map((a) => `${a.name} +${a.changePct}%`).join(", ")}` : ""}` });
      setImpacts(r.impacts);
      setLines([blank()]);
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof Error ? err.message : t("Failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {impacts.some((i) => i.recipes.length) && (
        <Alert tone="amber">
          <strong>{t("Recipe impact:")}</strong>{" "}
          {impacts.flatMap((i) => i.recipes.map((r) => `${r.name}: ${Number(r.oldPortionCost).toFixed(2)} → ${Number(r.newPortionCost).toFixed(2)} (${t("margin")} ${r.newMarginPct ?? "—"}%${r.belowTarget ? ` — ${t("BELOW TARGET")}` : ""})`)).join(" · ")}
        </Alert>
      )}
      <div className="grid gap-3 md:grid-cols-4">
        <div><Label htmlFor="rc-sup">{t("Supplier")}</Label><Select id="rc-sup" name="supplierId" required>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
        <div><Label htmlFor="rc-wh">{t("Warehouse")}</Label><Select id="rc-wh" name="warehouseId">{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></div>
        <div><Label htmlFor="rc-date">{t("Receipt date")}</Label><Input id="rc-date" name="receiptDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
        <div><Label htmlFor="rc-inv">{t("Invoice no")}</Label><Input id="rc-inv" name="invoiceNo" /></div>
        <div><Label htmlFor="rc-fr">{t("Freight")}</Label><Input id="rc-fr" name="freight" inputMode="decimal" placeholder="0" /></div>
        <div><Label htmlFor="rc-hd">{t("Handling")}</Label><Input id="rc-hd" name="handling" inputMode="decimal" placeholder="0" /></div>
        <div><Label htmlFor="rc-ot">{t("Other landed cost")}</Label><Input id="rc-ot" name="otherCost" inputMode="decimal" placeholder="0" /></div>
        <div><Label htmlFor="rc-al">{t("Allocate charges by")}</Label><Select id="rc-al" name="allocationMethod"><option value="BY_VALUE">{t("Value")}</option><option value="BY_QUANTITY">{t("Quantity")}</option></Select></div>
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={l.key} className="grid items-end gap-2 rounded-lg border border-ink-100 p-2 md:grid-cols-12">
            <div className="md:col-span-4"><Label htmlFor={`p-${l.key}`}>{t("Product {n}", { n: i + 1 })}</Label><ProductPicker id={`p-${l.key}`} value={l.product} onChange={(p) => set(l.key, { product: p, unit: p?.purchaseUnit ?? "" })} /></div>
            <div className="md:col-span-2"><Label htmlFor={`q-${l.key}`}>{t("Qty")}</Label><Input id={`q-${l.key}`} inputMode="decimal" value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} required /></div>
            <div className="md:col-span-1"><Label htmlFor={`u-${l.key}`}>{t("Unit")}</Label><Select id={`u-${l.key}`} value={l.unit} onChange={(e) => set(l.key, { unit: e.target.value })}>{unitsFor(l.product).map((u) => <option key={u}>{u}</option>)}</Select></div>
            <div className="md:col-span-2"><Label htmlFor={`pr-${l.key}`}>{t("Unit price (net)")}</Label><Input id={`pr-${l.key}`} inputMode="decimal" value={l.unitPrice} onChange={(e) => set(l.key, { unitPrice: e.target.value })} required /></div>
            <div className="md:col-span-1"><Label htmlFor={`d-${l.key}`}>{t("Discount")}</Label><Input id={`d-${l.key}`} inputMode="decimal" value={l.discount} onChange={(e) => set(l.key, { discount: e.target.value })} /></div>
            <div className="md:col-span-1"><Label htmlFor={`t-${l.key}`}>{t("VAT %")}</Label><Input id={`t-${l.key}`} inputMode="decimal" value={l.taxRatePct} onChange={(e) => set(l.key, { taxRatePct: e.target.value })} /></div>
            <div className="md:col-span-1"><Button type="button" variant="ghost" aria-label={t("Remove line")} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}><Trash2 className="h-4 w-4" /></Button></div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="h-4 w-4" /> {t("Add line")}</Button>
        <Button type="submit" disabled={busy}>{busy ? t("Posting…") : t("Post receipt")}</Button>
      </div>
    </form>
  );
}
