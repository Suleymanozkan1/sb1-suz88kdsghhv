"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

const UNITS = ["kg", "g", "l", "ml", "pc", "case", "box", "pack", "bottle", "can", "tray", "bag"];

export function ProductForm({ categories, suppliers }: { categories: { id: string; name: string }[]; suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const t = useT();
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    // stock code is optional (generated when empty); reorder point and safety stock live on the auto-order rules
    const body: Record<string, unknown> = { sku: f.sku || null, name: f.name, brand: f.brand || null, categoryId: f.categoryId, defaultSupplierId: f.defaultSupplierId || null, purchaseUnit: f.purchaseUnit, stockUnit: f.stockUnit, recipeUnit: f.recipeUnit, taxRatePct: f.taxRatePct || "0" };
    if (f.convFactor) body.conversions = [{ fromUnit: f.purchaseUnit, toUnit: f.stockUnit, factor: f.convFactor }];
    try {
      await call("POST", "/api/products", body);
      setMsg({ tone: "green", text: t("{name} created", { name: f.name }) });
      form.reset();
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof Error ? err.message : t("Failed") });
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-6">
      {msg && <div className="md:col-span-6"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="md:col-span-2"><Label htmlFor="pf-name">{t("Name")}</Label><Input id="pf-name" name="name" required /></div>
      <div><Label htmlFor="pf-brand">{t("Brand")}</Label><Input id="pf-brand" name="brand" /></div>
      <div><Label htmlFor="pf-cat">{t("Category")}</Label><Select id="pf-cat" name="categoryId">{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
      <div><Label htmlFor="pf-pu">{t("Purchase unit")}</Label><Select id="pf-pu" name="purchaseUnit" defaultValue="kg">{UNITS.map((u) => <option key={u}>{u}</option>)}</Select></div>
      <div><Label htmlFor="pf-conv" hint={t("1 purchase unit =")}>{t("Conversion")}</Label><Input id="pf-conv" name="convFactor" inputMode="decimal" placeholder={t("e.g. 10 (case→kg)")} /></div>
      <div><Label htmlFor="pf-su">{t("Stock unit")}</Label><Select id="pf-su" name="stockUnit" defaultValue="kg">{UNITS.slice(0, 5).map((u) => <option key={u}>{u}</option>)}</Select></div>
      <div><Label htmlFor="pf-ru">{t("Recipe unit")}</Label><Select id="pf-ru" name="recipeUnit" defaultValue="g">{UNITS.slice(0, 5).map((u) => <option key={u}>{u}</option>)}</Select></div>
      <div><Label htmlFor="pf-sup">{t("Default supplier")}</Label><Select id="pf-sup" name="defaultSupplierId"><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
      <div><Label htmlFor="pf-tax">{t("VAT %")}</Label><Input id="pf-tax" name="taxRatePct" inputMode="decimal" placeholder="0" /></div>
      <div><Label htmlFor="pf-sku" hint={t("optional — generated when empty")}>{t("Stock code")}</Label><Input id="pf-sku" name="sku" /></div>
      <div className="flex items-end"><Button type="submit">{t("Create product")}</Button></div>
    </form>
  );
}
