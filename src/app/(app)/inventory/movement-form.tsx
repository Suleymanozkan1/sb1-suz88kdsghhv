"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { ProductPicker, unitsFor, type PickedProduct } from "@/components/product-picker";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

export function MovementForm({ warehouses, departments, canAdjust, today }: { warehouses: { id: string; name: string }[]; departments: { id: string; name: string }[]; canAdjust: boolean; today: string }) {
  const router = useRouter();
  const t = useT();
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState("CONSUMPTION");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (!product) return setMsg({ tone: "red", text: t("Select a product") });
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = Object.fromEntries(f.entries());
      body.productId = product.id;
      body.idempotencyKey = crypto.randomUUID();
      if (!body.departmentId) delete body.departmentId;
      if (!body.unitCost) delete body.unitCost;
      const r = await call<{ totalCost: string; unitCost: string }>("POST", "/api/inventory/movements", body);
      setMsg({ tone: "green", text: t("Posted. Cost {cost} at {unitCost}/unit.", { cost: Math.abs(Number(r.totalCost)).toFixed(2), unitCost: Number(r.unitCost).toFixed(4) }) });
      // a second click must not post the same movement again under a new idempotency key
      form.reset();
      setProduct(null);
      setType("CONSUMPTION");
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof Error ? err.message : t("Failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-6">
      {msg && <div className="md:col-span-6"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="md:col-span-2"><Label htmlFor="mv-product">{t("Product")}</Label><ProductPicker id="mv-product" value={product} onChange={setProduct} /></div>
      <div>
        <Label htmlFor="mv-type">{t("Type")}</Label>
        <Select id="mv-type" name="type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="CONSUMPTION">{t("Issue / consumption")}</option>
          <option value="STAFF_MEAL">{t("Staff meal")}</option>
          <option value="COMPLIMENTARY">{t("Complimentary")}</option>
          {canAdjust && <option value="OPENING">{t("Opening balance")}</option>}
          {canAdjust && <option value="ADJUSTMENT_IN">{t("Adjustment +")}</option>}
          {canAdjust && <option value="ADJUSTMENT_OUT">{t("Adjustment −")}</option>}
        </Select>
      </div>
      <div><Label htmlFor="mv-wh">{t("Warehouse")}</Label><Select id="mv-wh" name="warehouseId" required>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></div>
      <div><Label htmlFor="mv-dept">{t("Department")}</Label><Select id="mv-dept" name="departmentId"><option value="">{t("(warehouse default)")}</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
      <div><Label htmlFor="mv-date">{t("Date")}</Label><Input id="mv-date" name="txDate" type="date" defaultValue={today} required /></div>
      <div><Label htmlFor="mv-qty">{t("Quantity")}</Label><Input id="mv-qty" name="quantity" inputMode="decimal" required /></div>
      <div><Label htmlFor="mv-unit">{t("Unit")}</Label><Select id="mv-unit" name="unit" key={product?.id}>{unitsFor(product).map((u) => <option key={u}>{u}</option>)}</Select></div>
      {type === "OPENING" && <div><Label htmlFor="mv-cost">{t("Unit cost")}</Label><Input id="mv-cost" name="unitCost" inputMode="decimal" /></div>}
      <div className="md:col-span-2"><Label htmlFor="mv-reason">{t("Reason / note")}</Label><Input id="mv-reason" name="reason" /></div>
      <div className="flex items-end"><Button type="submit" disabled={busy}>{busy ? t("Posting…") : t("Post")}</Button></div>
    </form>
  );
}
