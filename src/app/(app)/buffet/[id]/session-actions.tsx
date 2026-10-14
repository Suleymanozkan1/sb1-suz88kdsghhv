"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { ProductPicker, unitsFor, type PickedProduct } from "@/components/product-picker";
import { call } from "@/lib/client";
import { titleTr } from "@/lib/format";
import { useT, useLocale } from "@/i18n/client";

/** Issue a product (or a dish from its recipe) to the day's breakfast; the first issue of an item and its refills are told apart by the server. */
export function AddLine({ sessionId, recipes }: { sessionId: string; recipes: { id: string; name: string; unit: string }[] }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [mode, setMode] = useState<"product" | "recipe">("product");
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? "");
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const recipeUnit = recipes.find((r) => r.id === recipeId)?.unit ?? "kg";
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<{ totalCost: string }>("POST", `/api/buffet/sessions/${sessionId}/lines`, { quantity: f.quantity, unit: f.unit, ...(mode === "product" ? { productId: product?.id } : { recipeId }) });
      setMsg({ tone: "green", text: t("Issued from stock at cost {cost}", { cost: Number(r.totalCost).toFixed(2) }) });
      (form.elements.namedItem("quantity") as HTMLInputElement | null)?.select();
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
      <div><Label htmlFor="bl-mode">{t("Item type")}</Label><Select id="bl-mode" value={mode} onChange={(e) => setMode(e.target.value as "product" | "recipe")}><option value="product">{t("Product")}</option><option value="recipe">{t("Dish (recipe)")}</option></Select></div>
      <div className="md:col-span-3">
        <Label htmlFor="bl-item">{mode === "product" ? t("Product") : t("Dish")}</Label>
        {mode === "product" ? <ProductPicker id="bl-item" value={product} onChange={setProduct} /> : <Select id="bl-item" value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>{recipes.map((r) => <option key={r.id} value={r.id}>{titleTr(r.name, locale)}</option>)}</Select>}
      </div>
      <div><Label htmlFor="bl-qty">{t("Quantity")}</Label><Input id="bl-qty" name="quantity" inputMode="decimal" required /></div>
      <div><Label htmlFor="bl-unit">{t("Unit")}</Label><Select id="bl-unit" name="unit" key={`${mode}-${product?.id}-${recipeId}`}>{(mode === "product" ? unitsFor(product) : [recipeUnit, ...(recipeUnit === "kg" ? ["g"] : recipeUnit === "l" ? ["ml"] : [])]).map((u) => <option key={u}>{u}</option>)}</Select></div>
      <div className="md:col-span-6"><Button type="submit" disabled={busy || (mode === "product" && !product)}>{busy ? t("Issuing…") : t("Issue to breakfast")}</Button></div>
    </form>
  );
}

/** Whole number typed by a user; a dot between groups of three is a Turkish thousands separator ("1.200" = 1200). Empty → null, anything else → NaN. */
const wholeIn = (v: string) => {
  const s = v.replace(/\s/g, "");
  if (s === "") return null;
  return /^\d+$/.test(s) || /^\d{1,3}(\.\d{3})+$/.test(s) ? Number(s.replace(/\./g, "")) : Number.NaN;
};

/** The day's covers in two numbers; cost per cover uses their sum. */
export function CoversForm({ sessionId, included, paid }: { sessionId: string; included: number | null; paid: number | null }) {
  const t = useT();
  const router = useRouter();
  const [inc, setInc] = useState(included === null ? "" : String(included));
  const [pd, setPd] = useState(paid === null ? "" : String(paid));
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nums = { includedCovers: wholeIn(inc), paidCovers: wholeIn(pd) };
    const bad = ([["Package-included breakfast", nums.includedCovers], ["Breakfast not included", nums.paidCovers]] as const).filter(([, v]) => v !== null && Number.isNaN(v)).map(([l]) => t(l));
    if (bad.length) return setMsg({ tone: "red", text: t("{fields}: enter a whole number of 0 or more (e.g. 1200 or 1.200)", { fields: bad.join(", ") }) });
    setBusy(true);
    setMsg(null);
    try {
      await call("POST", `/api/buffet/sessions/${sessionId}/covers`, nums);
      setMsg({ tone: "green", text: t("Saved.") });
      router.refresh();
    } catch (x) {
      setMsg({ tone: "red", text: x instanceof Error ? x.message : t("Failed") });
    } finally {
      setBusy(false);
    }
  }
  const total = (wholeIn(inc) ?? 0) + (wholeIn(pd) ?? 0);
  return (
    <form onSubmit={submit} className="space-y-3" data-testid="breakfast-covers">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="bc-inc" hint={t("sold in the room rate")}>{t("Package-included breakfast")}</Label><Input id="bc-inc" inputMode="numeric" value={inc} onChange={(e) => setInc(e.target.value)} /></div>
        <div><Label htmlFor="bc-paid" hint={t("sold separately")}>{t("Breakfast not included")}</Label><Input id="bc-paid" inputMode="numeric" value={pd} onChange={(e) => setPd(e.target.value)} /></div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-600">{t("Total covers")}: <span className="font-semibold tabular-nums text-ink-900">{Number.isNaN(total) ? "—" : total.toLocaleString("tr-TR")}</span></p>
        <Button type="submit" disabled={busy}>{busy ? t("Saving…") : t("Save covers")}</Button>
      </div>
    </form>
  );
}
