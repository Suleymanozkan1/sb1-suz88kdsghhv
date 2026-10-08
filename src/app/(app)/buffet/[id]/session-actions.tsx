"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select, Table, Td, Th } from "@/components/ui";
import { ProductPicker, unitsFor, type PickedProduct } from "@/components/product-picker";
import { call } from "@/lib/client";
import { parseNum } from "@/lib/format";
import { useT } from "@/i18n/client";

export function AddLine({ sessionId, recipes }: { sessionId: string; recipes: { id: string; name: string; unit: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<"product" | "recipe">("product");
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? "");
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const recipeUnit = recipes.find((r) => r.id === recipeId)?.unit ?? "kg";
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<{ totalCost: string }>("POST", `/api/buffet/sessions/${sessionId}/lines`, { kind: f.kind, quantity: f.quantity, unit: f.unit, ...(mode === "product" ? { productId: product?.id } : { recipeId }) });
      setMsg({ tone: "green", text: t("Issued from stock at cost {cost}", { cost: Number(r.totalCost).toFixed(2) }) });
      router.refresh();
    } catch (x) {
      setMsg({ tone: "red", text: x instanceof Error ? x.message : t("Failed") });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-6">
      {msg && <div className="md:col-span-6"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div><Label htmlFor="bl-kind">{t("Kind")}</Label><Select id="bl-kind" name="kind"><option value="PRODUCTION">{t("Production")}</option><option value="REFILL">{t("Refill")}</option></Select></div>
      <div><Label htmlFor="bl-mode">{t("Item type")}</Label><Select id="bl-mode" value={mode} onChange={(e) => setMode(e.target.value as "product" | "recipe")}><option value="product">{t("Product")}</option><option value="recipe">{t("Dish (recipe)")}</option></Select></div>
      <div className="md:col-span-2">
        <Label htmlFor="bl-item">{mode === "product" ? t("Product") : t("Dish")}</Label>
        {mode === "product" ? <ProductPicker id="bl-item" value={product} onChange={setProduct} /> : <Select id="bl-item" value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>{recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}
      </div>
      <div><Label htmlFor="bl-qty">{t("Quantity")}</Label><Input id="bl-qty" name="quantity" inputMode="decimal" required /></div>
      <div><Label htmlFor="bl-unit">{t("Unit")}</Label><Select id="bl-unit" name="unit" key={`${mode}-${product?.id}-${recipeId}`}>{(mode === "product" ? unitsFor(product) : [recipeUnit, ...(recipeUnit === "kg" ? ["g"] : recipeUnit === "l" ? ["ml"] : [])]).map((u) => <option key={u}>{u}</option>)}</Select></div>
      <div className="md:col-span-6"><Button type="submit" disabled={busy || (mode === "product" && !product)}>{busy ? t("Issuing…") : t("Issue to buffet")}</Button></div>
    </form>
  );
}

const CLASSES = [
  ["reuse", "Reusable", "REFRIGERATED"],
  ["waste", "Waste", "WASTE"],
  ["staff", "Staff meal", "STAFF_MEAL"],
] as const;

export function CloseSession({ sessionId, items, expectedCovers }: { sessionId: string; items: { key: string; name: string; unit: string; input: string; isDish: boolean }[]; expectedCovers: number | null }) {
  const t = useT();
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, Record<string, string>>>({});
  const [covers, setCovers] = useState(expectedCovers ? String(expectedCovers) : "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function close() {
    setErr(null);
    if (!/^\d+$/.test(covers)) return setErr(t("Enter the actual number of covers"));
    const typed = items.flatMap((i) => CLASSES.map(([k, , cls]) => ({ key: i.key, quantity: (vals[i.key]?.[k] ?? "").trim(), class: cls })).filter((l) => l.quantity !== ""));
    // "1,5" is a valid Turkish entry; anything unreadable is reported instead of being left out of the close
    if (typed.some((l) => !(parseNum(l.quantity) >= 0))) return setErr(t("Must be a number"));
    const leftovers = typed.filter((l) => parseNum(l.quantity) > 0);
    if (!window.confirm(t("Close the session with {covers} covers and {n} leftover entries? Closed sessions cannot be edited.", { covers, n: leftovers.length }))) return;
    setBusy(true);
    try {
      await call("POST", `/api/buffet/sessions/${sessionId}/close`, { actualCovers: Number(covers), leftovers });
      router.refresh();
    } catch (x) {
      setErr(x instanceof Error ? x.message : t("Failed"));
    } finally {
      setBusy(false);
    }
  }
  if (!items.length) return <p className="text-sm text-ink-500">{t("Add production first.")}</p>;
  return (
    <div className="space-y-3">
      {err && <Alert>{err}</Alert>}
      <div className="w-40"><Label htmlFor="cs-covers">{t("Actual covers")}</Label><Input id="cs-covers" inputMode="numeric" value={covers} onChange={(e) => setCovers(e.target.value)} /></div>
      <Table>
        <thead><tr><Th>{t("Item")}</Th><Th align="right">{t("Input")}</Th>{CLASSES.map(([k, l]) => <Th key={k} align="right">{t(l)}</Th>)}</tr></thead>
        <tbody className="divide-y divide-ink-100">
          {items.map((i) => (
            <tr key={i.key}>
              <Td>{i.name}<span className="block text-xs text-ink-400">{i.isDish ? t("dish: reusable = carried value") : t("product: reusable returns to stock")}</span></Td>
              <Td align="right">{Number(i.input)} {i.unit}</Td>
              {CLASSES.map(([k, l]) => (
                <Td key={k} align="right"><Input aria-label={`${t(l)} ${i.name}`} className="w-20 text-right" inputMode="decimal" value={vals[i.key]?.[k] ?? ""} onChange={(e) => setVals({ ...vals, [i.key]: { ...vals[i.key], [k]: e.target.value } })} /></Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
      <Button onClick={close} disabled={busy}>{busy ? t("Closing…") : t("Close session")}</Button>
    </div>
  );
}
