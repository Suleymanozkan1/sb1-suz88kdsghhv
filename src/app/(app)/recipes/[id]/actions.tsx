"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";
import { money, pct } from "@/lib/format";
import { useT } from "@/i18n/client";

export function ApproveButton({ versionId }: { versionId: string }) {
  const router = useRouter();
  const t = useT();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <Button size="sm" onClick={async () => {
        setErr(null);
        try { await call("POST", `/api/recipe-versions/${versionId}/approve`, {}); router.refresh(); } catch (e) { setErr(e instanceof Error ? e.message : t("Failed")); }
      }}>{t("Approve")}</Button>
      {err && <p className="mt-1 max-w-xs whitespace-normal text-xs text-red-700">{err}</p>}
    </div>
  );
}

interface Impact { recipes: { recipeId: string; name: string; oldPortionCost: string | null; newPortionCost: string | null; costChangePct: string | null; oldMarginPct: string | null; newMarginPct: string | null; belowTarget: boolean }[] }

export function PriceImpact({ products, currency }: { products: { id: string; name: string; unitCost: string | null; unit: string }[]; currency: string }) {
  const t = useT();
  const [pid, setPid] = useState(products[0]?.id ?? "");
  const [change, setChange] = useState("20");
  const [res, setRes] = useState<Impact | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const p = products.find((x) => x.id === pid);
  async function run() {
    if (!p?.unitCost) return setErr(t("Selected ingredient has no current cost"));
    setErr(null);
    const newCost = (Number(p.unitCost) * (1 + Number(change) / 100)).toFixed(6);
    try { setRes(await call<Impact>("GET", `/api/price-impact?productId=${pid}&newCost=${newCost}`)); } catch (e) { setErr(e instanceof Error ? e.message : t("Failed")); }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div><Label htmlFor="pi-p">{t("Ingredient")}</Label><Select id="pi-p" value={pid} onChange={(e) => setPid(e.target.value)} className="w-52">{products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></div>
        <div><Label htmlFor="pi-c">{t("Price change %")}</Label><Input id="pi-c" value={change} onChange={(e) => setChange(e.target.value)} className="w-24" inputMode="decimal" /></div>
        <Button variant="secondary" onClick={run}>{t("Simulate")}</Button>
      </div>
      {err && <Alert>{err}</Alert>}
      {res && (
        <Table>
          <thead><tr><Th>{t("Affected recipe")}</Th><Th align="right">{t("Old")}</Th><Th align="right">{t("New")}</Th><Th align="right">Δ%</Th><Th align="right">{t("Margin")}</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {res.recipes.map((r) => (
              <tr key={r.recipeId}><Td>{r.name}</Td><Td align="right">{money(r.oldPortionCost, currency)}</Td><Td align="right">{money(r.newPortionCost, currency)}</Td><Td align="right">{pct(r.costChangePct)}</Td><Td align="right" className={r.belowTarget ? "font-semibold text-red-700" : ""}>{pct(r.oldMarginPct)} → {pct(r.newMarginPct)}</Td></tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
