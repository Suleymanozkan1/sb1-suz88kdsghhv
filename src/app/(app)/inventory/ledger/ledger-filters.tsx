"use client";

import { useState } from "react";
import { Label, Select } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { ProductPicker, type PickedProduct } from "@/components/product-picker";
import { useT } from "@/i18n/client";

/**
 * Filter bar of the stock movements: the shared FilterBar (dates first, "Filter" at the end) plus warehouse, type and
 * product (searched — there can be thousands). The export buttons next to it take the filters from the URL.
 */
export function LedgerFilters({ view, warehouses, types, value, product }: { view: string; warehouses: { id: string; name: string }[]; types: string[]; value: { warehouseId?: string; type?: string; from?: string; to?: string }; product: PickedProduct | null }) {
  const t = useT();
  const [picked, setPicked] = useState<PickedProduct | null>(product);
  return (
    <FilterBar
      from={value.from}
      to={value.to}
      hidden={{ view }}
      after={(value.warehouseId || value.type || product) && <a href={`?view=${view}`} className="px-2 py-2 text-sm text-ink-500 hover:underline">{t("Clear")}</a>}
    >
      <input type="hidden" name="productId" value={picked?.id ?? ""} />
      <div><Label htmlFor="lf-wh">{t("Warehouse")}</Label><Select id="lf-wh" name="warehouseId" defaultValue={value.warehouseId ?? ""} className="w-44"><option value="">{t("All")}</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></div>
      <div><Label htmlFor="lf-type">{t("Type")}</Label><Select id="lf-type" name="type" defaultValue={value.type ?? ""} className="w-40"><option value="">{t("All")}</option>{types.slice(0, 2).map((x) => <option key={x} value={x}>{t(x)}</option>)}<optgroup label={t("Other")}>{types.slice(2).map((x) => <option key={x} value={x}>{t(x)}</option>)}</optgroup></Select></div>
      <div className="w-60"><Label htmlFor="lf-p">{t("Product")}</Label><ProductPicker id="lf-p" value={picked} onChange={setPicked} placeholder={t("All products — search…")} /></div>
    </FilterBar>
  );
}
