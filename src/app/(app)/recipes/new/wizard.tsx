"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, Input, Label, Select, Table, Td, Th } from "@/components/ui";
import { ProductPicker, unitsFor, type PickedProduct } from "@/components/product-picker";
import { call } from "@/lib/client";
import { money, pct, qty, titleTr } from "@/lib/format";
import { useLocale, useT } from "@/i18n/client";
import { translateMessage } from "@/i18n/core";
import { Title } from "@/components/title";

export interface Line { key: string; kind: "product" | "sub"; product: PickedProduct | null; subRecipeId: string; quantity: string; unit: string }
export interface WizardHead { type: string; code: string; name: string; departmentId: string; posCode: string; batchYieldQty: string; yieldUnit: string; portions: string; sellingPrice: string }
// the first line is server-rendered: its key (used in element ids) must be the same on server and client
const blank = (key: string = crypto.randomUUID()): Line => ({ key, kind: "product", product: null, subRecipeId: "", quantity: "", unit: "" });
type Cost = { foodCost: string; portionCost: string | null; foodCostPct: string | null; grossMarginPct: string | null; lines: { name: string; lineCost: string; apQty: string; baseUnit: string; unitCost: string | null; issues: string[] }[] };
/** recipes that are made in a batch and used inside other recipes (sauces, doughs): they need an output quantity */
const BATCH_TYPES = ["SEMI_FINISHED", "PRODUCTION"];

/**
 * New recipe, or (with `edit`) the "Güncelle" form of an existing one: prefilled, and saving makes the change the
 * recipe's new version, in force at once (no separate approval; the previous version stays in the history).
 */
export function RecipeWizard({ types, departments, subRecipes, currency, edit }: { types: string[]; departments: { id: string; name: string }[]; subRecipes: { id: string; name: string; unit: string }[]; currency: string; edit?: { recipeId: string; head: WizardHead; lines: Line[]; /** the version's standard portion: not edited here, sent back unchanged */ portion?: { size: string | null; unit: string | null } } }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [head, setHead] = useState<WizardHead>(edit?.head ?? { type: "RESTAURANT", code: "", name: "", departmentId: departments[0]?.id ?? "", posCode: "", batchYieldQty: "1", yieldUnit: "kg", portions: "1", sellingPrice: "" });
  const batch = BATCH_TYPES.includes(head.type);
  const [lines, setLines] = useState<Line[]>(edit?.lines.length ? edit.lines : [blank("line-0")]);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ issues: { field: string; message: string }[]; cost: Cost | null } | null>(null);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  const version = useMemo(() => {
    const opt = (v: string) => (v.trim() === "" ? undefined : v);
    // a dish: the recipe makes `portions` portions; a batch recipe (sauce, dough): it makes `batchYieldQty` kg / l / pc
    const isBatch = BATCH_TYPES.includes(head.type);
    return {
      batchYieldQty: isBatch ? head.batchYieldQty : head.portions, yieldUnit: isBatch ? head.yieldUnit : "portion", portions: isBatch ? head.batchYieldQty : head.portions, sellingPrice: opt(head.sellingPrice) ?? null,
      ...(edit?.portion ? { portionSize: edit.portion.size, portionUnit: edit.portion.unit } : {}),
      lines: lines.filter((l) => (l.kind === "product" ? l.product : l.subRecipeId) && l.quantity).map((l) => ({ productId: l.kind === "product" ? l.product!.id : null, subRecipeId: l.kind === "sub" ? l.subRecipeId : null, quantity: l.quantity, unit: l.unit || (l.kind === "product" ? l.product!.recipeUnit : "g") })),
    };
  }, [head, lines, edit?.portion]);

  // Live cost: calculated on the server by the shared engine (no financial math in the browser).
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!version.lines.length) return setPreview(null);
      try {
        setPreview(await call("POST", "/api/recipes/preview", { name: head.name || "Draft", version }));
      } catch (e) {
        setPreview({ issues: [{ field: "request", message: e instanceof Error ? e.message : t("Preview failed") }], cost: null });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [version, head.name, t]);

  async function save() {
    if (busy) return;
    setMsg(null);
    setBusy(true);
    try {
      const header = { code: head.code.trim() || null, name: head.name, type: head.type, departmentId: head.departmentId || null, posCode: head.posCode || null };
      const r = edit
        ? await call<{ id: string }>("PUT", `/api/recipes/${edit.recipeId}`, { ...header, version: { ...version, reason: reason.trim() || null } })
        : await call<{ id: string }>("POST", "/api/recipes", { ...header, version: { ...version, reason: "Initial version" } });
      router.push(`/recipes/${r.id}`);
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : t("Failed") });
      setBusy(false);
    }
  }

  const H = (k: keyof typeof head) => ({ value: head[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setHead({ ...head, [k]: e.target.value }) });
  const c = preview?.cost;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <Card title={`1 · ${t("Recipe")}`}>
          <div className="grid gap-3 md:grid-cols-4">
            <div><Label htmlFor="w-type">{t("Recipe type")}</Label><Select id="w-type" {...H("type")}>{types.map((x) => <option key={x} value={x}>{t(x)}</option>)}</Select></div>
            <div><Label htmlFor="w-code">{t("Code (optional)")}</Label><Input id="w-code" {...H("code")} placeholder={t("automatic")} /></div>
            <div className="md:col-span-2"><Label htmlFor="w-name">{t("Menu / product name")}</Label><Input id="w-name" {...H("name")} required /></div>
            <div><Label htmlFor="w-dept">{t("Department")}</Label><Select id="w-dept" {...H("departmentId")}>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
            <div><Label htmlFor="w-pos">{t("POS code (optional)")}</Label><Input id="w-pos" {...H("posCode")} /></div>
            {batch ? (
              <>
                <div><Label htmlFor="w-by">{t("Quantity made")}</Label><Input id="w-by" inputMode="decimal" {...H("batchYieldQty")} /></div>
                <div><Label htmlFor="w-yu">{t("Unit")}</Label><Select id="w-yu" {...H("yieldUnit")}>{["kg", "l", "pc"].map((u) => <option key={u} value={u}>{t(u)}</option>)}</Select></div>
              </>
            ) : (
              <>
                <div><Label htmlFor="w-por">{t("Portions")}</Label><Input id="w-por" inputMode="decimal" {...H("portions")} /></div>
                <div><Label htmlFor="w-sp">{t("Selling price (net)")}</Label><Input id="w-sp" inputMode="decimal" {...H("sellingPrice")} /></div>
              </>
            )}
          </div>
          {batch && <p className="mt-2 text-xs text-ink-500">{t("A sauce, dough or other preparation: enter how much one batch makes, so other recipes can use it as a sub-recipe.")}</p>}
        </Card>
        <Card title={`2 · ${t("Ingredients")}`}>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={l.key} className="grid items-end gap-2 rounded-lg border border-ink-100 p-2 md:grid-cols-12">
                <div className="md:col-span-2"><Label htmlFor={`k-${l.key}`}>{t("Line {n}", { n: i + 1 })}</Label><Select id={`k-${l.key}`} value={l.kind} onChange={(e) => set(l.key, { kind: e.target.value as Line["kind"], product: null, subRecipeId: "", unit: "" })}><option value="product">{t("Ingredient")}</option><option value="sub">{t("Sub-recipe")}</option></Select></div>
                <div className="md:col-span-4">
                  <Label htmlFor={`i-${l.key}`}>{l.kind === "product" ? t("Search ingredient") : t("Sub-recipe")}</Label>
                  {l.kind === "product" ? <ProductPicker id={`i-${l.key}`} value={l.product} onChange={(p) => set(l.key, { product: p, unit: p?.recipeUnit ?? "" })} /> : (
                    <Select id={`i-${l.key}`} value={l.subRecipeId} onChange={(e) => set(l.key, { subRecipeId: e.target.value, unit: subRecipes.find((s) => s.id === e.target.value)?.unit === "kg" ? "g" : (subRecipes.find((s) => s.id === e.target.value)?.unit ?? "") })}><option value="">{t("Select…")}</option>{subRecipes.map((s) => <option key={s.id} value={s.id}>{titleTr(s.name, locale)}</option>)}</Select>
                  )}
                </div>
                <div className="md:col-span-3"><Label htmlFor={`q-${l.key}`}>{t("Quantity used")}</Label><Input id={`q-${l.key}`} inputMode="decimal" value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} /></div>
                <div className="md:col-span-2"><Label htmlFor={`u-${l.key}`}>{t("UOM")}</Label><Select id={`u-${l.key}`} value={l.unit} onChange={(e) => set(l.key, { unit: e.target.value })}>{(l.kind === "product" ? unitsFor(l.product) : ["g", "kg", "ml", "l", "portion", "pc"]).map((u) => <option key={u}>{u}</option>)}</Select></div>
                <div className="md:col-span-1"><Button type="button" variant="ghost" aria-label={t("Remove")} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}><Trash2 className="h-4 w-4" /></Button></div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-500">{t("Write the raw quantity the kitchen uses for the dish (e.g. 105 g raw octopus for 70 g on the plate); no yield or waste is added on top. Sauces and seasonings that vary per guest (ketchup, mayonnaise, spices) are optional.")}</p>
          <Button type="button" variant="secondary" className="mt-3" onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="h-4 w-4" /> {t("Add ingredient")}</Button>
        </Card>
      </div>
      <div className="space-y-4">
        <Card title={`3 · ${t("Review cost")}`}>
          {!c ? <p className="text-sm text-ink-500">{t("Add ingredients to see the live cost.")}</p> : (
            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-2 gap-y-1">
                <dt className="font-medium">{t("Food cost")}</dt><dd className="text-right font-medium tabular-nums">{money(c.foodCost, currency)}</dd>
                <dt className="font-semibold">{batch ? t("Cost per unit made") : t("Cost per portion")}</dt><dd className="text-right font-semibold tabular-nums">{money(c.portionCost, currency)}</dd>
                <dt className="text-ink-500">{t("Food cost %")}</dt><dd className="text-right tabular-nums">{pct(c.foodCostPct)}</dd>
                <dt className="text-ink-500">{t("Margin %")}</dt><dd className="text-right tabular-nums">{pct(c.grossMarginPct)}</dd>
              </dl>
              <Table>
                <thead><tr><Th>{t("Line")}</Th><Th align="right">{t("Quantity")}</Th><Th align="right">{t("Cost")}</Th></tr></thead>
                <tbody className="divide-y divide-ink-100">{c.lines.map((l, i) => <tr key={i}><Td><Title>{l.name}</Title> {l.issues.map((x) => <Badge key={x} tone="red">{t(x)}</Badge>)}</Td><Td align="right">{qty(l.apQty, l.baseUnit)}</Td><Td align="right">{money(l.lineCost, currency)}</Td></tr>)}</tbody>
              </Table>
            </div>
          )}
          {preview && preview.issues.length > 0 && <div className="mt-3"><Alert tone="amber"><p className="font-medium">{t("Validation")}</p><ul className="list-disc pl-4">{preview.issues.map((i, k) => <li key={k}>{translateMessage(locale, i.message)}</li>)}</ul></Alert></div>}
        </Card>
        <Card title={`4 · ${t("Save")}`}>
          {msg && <div className="mb-2"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
          {edit ? (
            <>
              <p className="mb-3 text-xs text-ink-500">{t("Saved as the recipe's new version and in force at once: cost and stock deduction use it from now on. The previous version stays in the version history.")}</p>
              <div className="mb-3"><Label htmlFor="w-reason">{t("Reason for the change (optional)")}</Label><Input id="w-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></div>
              <Button onClick={save} disabled={!head.name || busy}>{t("Save changes")}</Button>
            </>
          ) : (
            <>
              <p className="mb-3 text-xs text-ink-500">{t("Saved as a")} <strong>{t("draft version")}</strong>. {t("A user with recipe approval rights must approve it before it is used for theoretical cost. Incomplete drafts are allowed; approval is blocked until validation passes.")}</p>
              <Button onClick={save} disabled={!head.name || busy}>{t("Save draft")}</Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
