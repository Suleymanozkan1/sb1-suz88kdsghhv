"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { ProductPicker, unitsFor, type PickedProduct } from "@/components/product-picker";
import { call } from "@/lib/client";

export function WasteForm({ types, departments, warehouses }: { types: string[]; departments: { id: string; name: string }[]; warehouses: { id: string; name: string; departmentId: string | null }[] }) {
  const router = useRouter();
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [dept, setDept] = useState(departments[0]?.id ?? "");
  const [msg, setMsg] = useState<{ tone: "red" | "green" | "amber"; text: string } | null>(null);
  const whs = warehouses.filter((w) => !w.departmentId || w.departmentId === dept);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!product) return setMsg({ tone: "red", text: "Select a product" });
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form).entries());
    try {
      const r = await call<{ status: string; record: { costValue: string | null } }>("POST", "/api/waste", { ...f, productId: product.id, departmentId: dept, wasteDate: `${f.wasteDate}T12:00:00Z` });
      setMsg(r.status === "POSTED" ? { tone: "green", text: `Waste posted at cost ${Number(r.record.costValue).toFixed(2)}.` } : { tone: "amber", text: "Above the approval threshold — waiting for manager approval. Stock is unchanged until approved." });
      setProduct(null);
      form.reset();
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof Error ? err.message : "Failed" });
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-6">
      {msg && <div className="md:col-span-6"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="md:col-span-2"><Label htmlFor="wf-p">Product</Label><ProductPicker id="wf-p" value={product} onChange={setProduct} /></div>
      <div><Label htmlFor="wf-d">Department</Label><Select id="wf-d" value={dept} onChange={(e) => setDept(e.target.value)}>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
      <div><Label htmlFor="wf-w">Warehouse</Label><Select id="wf-w" name="warehouseId">{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></div>
      <div><Label htmlFor="wf-t">Waste type</Label><Select id="wf-t" name="wasteType">{types.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ").toLowerCase()}</option>)}</Select></div>
      <div><Label htmlFor="wf-date">Date</Label><Input id="wf-date" name="wasteDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
      <div><Label htmlFor="wf-q">Quantity</Label><Input id="wf-q" name="quantity" inputMode="decimal" required /></div>
      <div><Label htmlFor="wf-u">Unit</Label><Select id="wf-u" name="unit" key={product?.id}>{unitsFor(product).map((u) => <option key={u}>{u}</option>)}</Select></div>
      <div className="md:col-span-3"><Label htmlFor="wf-r">Reason</Label><Input id="wf-r" name="reason" /></div>
      <div className="flex items-end"><Button type="submit">Record waste</Button></div>
    </form>
  );
}
