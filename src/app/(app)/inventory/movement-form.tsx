"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { ProductPicker, unitsFor, type PickedProduct } from "@/components/product-picker";
import { call } from "@/lib/client";

export function MovementForm({ warehouses, departments, canAdjust }: { warehouses: { id: string; name: string }[]; departments: { id: string; name: string }[]; canAdjust: boolean }) {
  const router = useRouter();
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState("CONSUMPTION");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!product) return setMsg({ tone: "red", text: "Select a product" });
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = Object.fromEntries(f.entries());
      body.productId = product.id;
      body.idempotencyKey = crypto.randomUUID();
      if (!body.departmentId) delete body.departmentId;
      if (!body.unitCost) delete body.unitCost;
      const r = await call<{ totalCost: string; unitCost: string }>("POST", "/api/inventory/movements", body);
      setMsg({ tone: "green", text: `Posted. Cost ${Math.abs(Number(r.totalCost)).toFixed(2)} at ${Number(r.unitCost).toFixed(4)}/unit.` });
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-6">
      {msg && <div className="md:col-span-6"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="md:col-span-2"><Label htmlFor="mv-product">Product</Label><ProductPicker id="mv-product" value={product} onChange={setProduct} /></div>
      <div>
        <Label htmlFor="mv-type">Type</Label>
        <Select id="mv-type" name="type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="CONSUMPTION">Issue / consumption</option>
          <option value="STAFF_MEAL">Staff meal</option>
          <option value="COMPLIMENTARY">Complimentary</option>
          {canAdjust && <option value="OPENING">Opening balance</option>}
          {canAdjust && <option value="ADJUSTMENT_IN">Adjustment +</option>}
          {canAdjust && <option value="ADJUSTMENT_OUT">Adjustment −</option>}
        </Select>
      </div>
      <div><Label htmlFor="mv-wh">Warehouse</Label><Select id="mv-wh" name="warehouseId" required>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></div>
      <div><Label htmlFor="mv-dept">Department</Label><Select id="mv-dept" name="departmentId"><option value="">(warehouse default)</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
      <div><Label htmlFor="mv-date">Date</Label><Input id="mv-date" name="txDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></div>
      <div><Label htmlFor="mv-qty">Quantity</Label><Input id="mv-qty" name="quantity" inputMode="decimal" required /></div>
      <div><Label htmlFor="mv-unit">Unit</Label><Select id="mv-unit" name="unit" key={product?.id}>{unitsFor(product).map((u) => <option key={u}>{u}</option>)}</Select></div>
      {type === "OPENING" && <div><Label htmlFor="mv-cost">Unit cost</Label><Input id="mv-cost" name="unitCost" inputMode="decimal" /></div>}
      <div className="md:col-span-2"><Label htmlFor="mv-reason">Reason / note</Label><Input id="mv-reason" name="reason" /></div>
      <div className="flex items-end"><Button type="submit" disabled={busy}>{busy ? "Posting…" : "Post"}</Button></div>
    </form>
  );
}
