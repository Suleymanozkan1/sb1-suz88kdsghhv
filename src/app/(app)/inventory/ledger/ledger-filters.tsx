"use client";

import { useState } from "react";
import { Button, Input, Label, Select } from "@/components/ui";
import { ProductPicker, type PickedProduct } from "@/components/product-picker";
import { useT } from "@/i18n/client";

/** Filter bar of the stock movements: warehouse, date range, type, product (searched — there can be thousands). */
export function LedgerFilters({ view, warehouses, types, value, product }: { view: string; warehouses: { id: string; name: string }[]; types: string[]; value: { warehouseId?: string; type?: string; from?: string; to?: string }; product: PickedProduct | null }) {
  const t = useT();
  const [picked, setPicked] = useState<PickedProduct | null>(product);
  return (
    <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <input type="hidden" name="view" value={view} />
      <input type="hidden" name="productId" value={picked?.id ?? ""} />
      <div><Label htmlFor="lf-wh">{t("Warehouse")}</Label><Select id="lf-wh" name="warehouseId" defaultValue={value.warehouseId ?? ""}><option value="">{t("All")}</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></div>
      <div><Label htmlFor="lf-from">{t("From")}</Label><Input id="lf-from" type="date" name="from" defaultValue={value.from ?? ""} /></div>
      <div><Label htmlFor="lf-to">{t("To")}</Label><Input id="lf-to" type="date" name="to" defaultValue={value.to ?? ""} /></div>
      <div><Label htmlFor="lf-type">{t("Type")}</Label><Select id="lf-type" name="type" defaultValue={value.type ?? ""}><option value="">{t("All")}</option>{types.map((x) => <option key={x} value={x}>{t(x)}</option>)}</Select></div>
      <div><Label htmlFor="lf-p">{t("Product")}</Label><ProductPicker id="lf-p" value={picked} onChange={setPicked} placeholder={t("All products — search…")} /></div>
      <div className="flex items-end gap-2"><Button type="submit">{t("Filter")}</Button>{(value.warehouseId || value.type || value.from || value.to || picked) && <a href={`?view=${view}`} className="px-2 py-2 text-sm text-ink-500 hover:underline">{t("Clear")}</a>}</div>
    </form>
  );
}
