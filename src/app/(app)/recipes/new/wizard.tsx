"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, Input, Label, Select, Table, Td, Th } from "@/components/ui";
import { ProductPicker, unitsFor, type PickedProduct } from "@/components/product-picker";
import { call } from "@/lib/client";
import { money, pct, qty } from "@/lib/format";

interface Line { key: string; kind: "product" | "sub"; product: PickedProduct | null; subRecipeId: string; quantity: string; unit: string; yieldPct: string; wastePct: string }
const blank = (): Line => ({ key: crypto.randomUUID(), kind: "product", product: null, subRecipeId: "", quantity: "", unit: "", yieldPct: "", wastePct: "" });
type Cost = { foodCost: string; fullBatchCost: string; portionCost: string | null; foodPortionCost: string | null; foodCostPct: string | null; grossMarginPct: string | null; grossContribution: string | null; yieldAdjustment: string; wasteCost: string; ingredientCost: string; lines: { name: string; lineCost: string; apQty: string; baseUnit: string; unitCost: string | null; issues: string[] }[] };

export function RecipeWizard({ types, departments, subRecipes }: { types: string[]; departments: { id: string; name: string }[]; subRecipes: { id: string; name: string; unit: string }[] }) {
  const router = useRouter();
  const [head, setHead] = useState({ type: "RESTAURANT", code: "", name: "", departmentId: departments[0]?.id ?? "", posCode: "", batchYieldQty: "1", yieldUnit: "portion", portions: "1", sellingPrice: "", packagingCost: "", laborCost: "", energyCost: "", otherCost: "", productionLossPct: "" });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [preview, setPreview] = useState<{ issues: { field: string; message: string }[]; cost: Cost | null } | null>(null);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const set = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  const version = useMemo(() => {
    const opt = (v: string) => (v.trim() === "" ? undefined : v);
    return {
      batchYieldQty: head.batchYieldQty, yieldUnit: head.yieldUnit, portions: head.portions, sellingPrice: opt(head.sellingPrice) ?? null,
      packagingCost: opt(head.packagingCost), laborCost: opt(head.laborCost), energyCost: opt(head.energyCost), otherCost: opt(head.otherCost), productionLossPct: opt(head.productionLossPct),
      lines: lines.filter((l) => (l.kind === "product" ? l.product : l.subRecipeId) && l.quantity).map((l) => ({ productId: l.kind === "product" ? l.product!.id : null, subRecipeId: l.kind === "sub" ? l.subRecipeId : null, quantity: l.quantity, unit: l.unit || (l.kind === "product" ? l.product!.recipeUnit : "g"), yieldPct: opt(l.yieldPct) ?? null, wastePct: opt(l.wastePct) ?? null })),
    };
  }, [head, lines]);

  // Live cost: calculated on the server by the shared engine (no financial math in the browser).
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!version.lines.length) return setPreview(null);
      try {
        setPreview(await call("POST", "/api/recipes/preview", { name: head.name || "Draft", version }));
      } catch (e) {
        setPreview({ issues: [{ field: "request", message: e instanceof Error ? e.message : "Preview failed" }], cost: null });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [version, head.name]);

  async function save() {
    setMsg(null);
    try {
      const r = await call<{ id: string }>("POST", "/api/recipes", { code: head.code, name: head.name, type: head.type, departmentId: head.departmentId || null, posCode: head.posCode || null, version: { ...version, reason: "Initial version" } });
      router.push(`/recipes/${r.id}`);
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Failed" });
    }
  }

  const H = (k: keyof typeof head) => ({ value: head[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setHead({ ...head, [k]: e.target.value }) });
  const c = preview?.cost;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <Card title="1 · Recipe">
          <div className="grid gap-3 md:grid-cols-4">
            <div><Label htmlFor="w-type">Recipe type</Label><Select id="w-type" {...H("type")}>{types.map((t) => <option key={t}>{t}</option>)}</Select></div>
            <div><Label htmlFor="w-code">Code</Label><Input id="w-code" {...H("code")} required /></div>
            <div className="md:col-span-2"><Label htmlFor="w-name">Menu / product name</Label><Input id="w-name" {...H("name")} required /></div>
            <div><Label htmlFor="w-dept">Department</Label><Select id="w-dept" {...H("departmentId")}>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
            <div><Label htmlFor="w-pos">POS code</Label><Input id="w-pos" {...H("posCode")} /></div>
            <div><Label htmlFor="w-by">Batch yield</Label><Input id="w-by" inputMode="decimal" {...H("batchYieldQty")} /></div>
            <div><Label htmlFor="w-yu">Yield unit</Label><Select id="w-yu" {...H("yieldUnit")}>{["portion", "kg", "l", "pc", "tray"].map((u) => <option key={u}>{u}</option>)}</Select></div>
            <div><Label htmlFor="w-por">Usable portions</Label><Input id="w-por" inputMode="decimal" {...H("portions")} /></div>
            <div><Label htmlFor="w-sp">Selling price (net)</Label><Input id="w-sp" inputMode="decimal" {...H("sellingPrice")} /></div>
            <div><Label htmlFor="w-pl">Production loss %</Label><Input id="w-pl" inputMode="decimal" {...H("productionLossPct")} /></div>
          </div>
        </Card>
        <Card title="2 · Ingredients">
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={l.key} className="grid items-end gap-2 rounded-lg border border-ink-100 p-2 md:grid-cols-12">
                <div className="md:col-span-2"><Label htmlFor={`k-${l.key}`}>Line {i + 1}</Label><Select id={`k-${l.key}`} value={l.kind} onChange={(e) => set(l.key, { kind: e.target.value as Line["kind"], product: null, subRecipeId: "", unit: "" })}><option value="product">Ingredient</option><option value="sub">Sub-recipe</option></Select></div>
                <div className="md:col-span-4">
                  <Label htmlFor={`i-${l.key}`}>{l.kind === "product" ? "Search ingredient" : "Sub-recipe"}</Label>
                  {l.kind === "product" ? <ProductPicker id={`i-${l.key}`} value={l.product} onChange={(p) => set(l.key, { product: p, unit: p?.recipeUnit ?? "" })} /> : (
                    <Select id={`i-${l.key}`} value={l.subRecipeId} onChange={(e) => set(l.key, { subRecipeId: e.target.value, unit: subRecipes.find((s) => s.id === e.target.value)?.unit === "kg" ? "g" : (subRecipes.find((s) => s.id === e.target.value)?.unit ?? "") })}><option value="">Select…</option>{subRecipes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
                  )}
                </div>
                <div className="md:col-span-2"><Label htmlFor={`q-${l.key}`}>Qty (EP)</Label><Input id={`q-${l.key}`} inputMode="decimal" value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} /></div>
                <div className="md:col-span-1"><Label htmlFor={`u-${l.key}`}>UOM</Label><Select id={`u-${l.key}`} value={l.unit} onChange={(e) => set(l.key, { unit: e.target.value })}>{(l.kind === "product" ? unitsFor(l.product) : ["g", "kg", "ml", "l", "portion", "pc"]).map((u) => <option key={u}>{u}</option>)}</Select></div>
                <div className="md:col-span-1"><Label htmlFor={`y-${l.key}`}>Yield %</Label><Input id={`y-${l.key}`} inputMode="decimal" placeholder="default" value={l.yieldPct} onChange={(e) => set(l.key, { yieldPct: e.target.value })} /></div>
                <div className="md:col-span-1"><Label htmlFor={`w-${l.key}`}>Waste %</Label><Input id={`w-${l.key}`} inputMode="decimal" value={l.wastePct} onChange={(e) => set(l.key, { wastePct: e.target.value })} /></div>
                <div className="md:col-span-1"><Button type="button" variant="ghost" aria-label="Remove" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}><Trash2 className="h-4 w-4" /></Button></div>
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" className="mt-3" onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="h-4 w-4" /> Add ingredient</Button>
        </Card>
        <Card title="3 · Other costs per batch">
          <div className="grid gap-3 md:grid-cols-4">
            <div><Label htmlFor="w-pk">Packaging</Label><Input id="w-pk" inputMode="decimal" {...H("packagingCost")} /></div>
            <div><Label htmlFor="w-lb">Direct labor</Label><Input id="w-lb" inputMode="decimal" {...H("laborCost")} /></div>
            <div><Label htmlFor="w-en">Energy</Label><Input id="w-en" inputMode="decimal" {...H("energyCost")} /></div>
            <div><Label htmlFor="w-ot">Other</Label><Input id="w-ot" inputMode="decimal" {...H("otherCost")} /></div>
          </div>
        </Card>
      </div>
      <div className="space-y-4">
        <Card title="4 · Review cost">
          {!c ? <p className="text-sm text-ink-500">Add ingredients to see the live cost.</p> : (
            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-2 gap-y-1">
                <dt className="text-ink-500">Ingredient (EP)</dt><dd className="text-right tabular-nums">{money(c.ingredientCost)}</dd>
                <dt className="text-ink-500">+ Yield adjustment</dt><dd className="text-right tabular-nums">{money(c.yieldAdjustment)}</dd>
                <dt className="text-ink-500">+ Standard waste</dt><dd className="text-right tabular-nums">{money(c.wasteCost)}</dd>
                <dt className="font-medium">= Food cost</dt><dd className="text-right font-medium tabular-nums">{money(c.foodCost)}</dd>
                <dt className="font-medium">Full batch cost</dt><dd className="text-right font-medium tabular-nums">{money(c.fullBatchCost)}</dd>
                <dt className="font-semibold">Cost per portion</dt><dd className="text-right font-semibold tabular-nums">{money(c.portionCost)}</dd>
                <dt className="text-ink-500">Food cost %</dt><dd className="text-right tabular-nums">{pct(c.foodCostPct)}</dd>
                <dt className="text-ink-500">Margin %</dt><dd className="text-right tabular-nums">{pct(c.grossMarginPct)}</dd>
              </dl>
              <Table>
                <thead><tr><Th>Line</Th><Th align="right">AP</Th><Th align="right">Cost</Th></tr></thead>
                <tbody className="divide-y divide-ink-100">{c.lines.map((l, i) => <tr key={i}><Td>{l.name} {l.issues.map((x) => <Badge key={x} tone="red">{x}</Badge>)}</Td><Td align="right">{qty(l.apQty, l.baseUnit)}</Td><Td align="right">{money(l.lineCost)}</Td></tr>)}</tbody>
              </Table>
            </div>
          )}
          {preview && preview.issues.length > 0 && <div className="mt-3"><Alert tone="amber"><p className="font-medium">Validation</p><ul className="list-disc pl-4">{preview.issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul></Alert></div>}
        </Card>
        <Card title="5 · Save">
          {msg && <div className="mb-2"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
          <p className="mb-3 text-xs text-ink-500">Saved as a <strong>draft version</strong>. A user with recipe approval rights must approve it before it is used for theoretical cost. Incomplete drafts are allowed; approval is blocked until validation passes.</p>
          <Button onClick={save} disabled={!head.code || !head.name}>Save draft</Button>
        </Card>
      </div>
    </div>
  );
}
