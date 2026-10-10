"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Alert, Button, Input, Label, Select, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";
import { money, parseNum, pct, titleTr } from "@/lib/format";
import { useT, useLocale } from "@/i18n/client";
import { Title } from "@/components/title";

export function ApproveButton({ versionId }: { versionId: string }) {
  const router = useRouter();
  const t = useT();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Button size="sm" disabled={busy} onClick={async () => {
        setErr(null);
        setBusy(true);
        try { await call("POST", `/api/recipe-versions/${versionId}/approve`, {}); router.refresh(); } catch (e) { setErr(e instanceof Error ? e.message : t("Failed")); } finally { setBusy(false); }
      }}>{t("Approve")}</Button>
      {err && <p className="mt-1 max-w-xs whitespace-normal text-xs text-red-700">{err}</p>}
    </div>
  );
}

/** "Sil": soft delete after a confirmation; the recipe leaves every list (sales history keeps it). */
export function DeleteRecipeButton({ recipeId, name }: { recipeId: string; name: string }) {
  const router = useRouter();
  const t = useT();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Button variant="danger" disabled={busy} onClick={async () => {
        if (!window.confirm(t("Delete the recipe {name}? It disappears from the recipe list, the sales matching and the pickers; its sales history is kept.", { name }))) return;
        setErr(null);
        setBusy(true);
        try {
          await call("DELETE", `/api/recipes/${recipeId}`);
          router.push("/recipes");
          router.refresh();
        } catch (e) {
          setErr(e instanceof Error ? e.message : t("Failed"));
          setBusy(false);
        }
      }}><Trash2 className="h-4 w-4" /> {t("Delete")}</Button>
      {err && <p className="mt-1 max-w-xs whitespace-normal text-xs text-red-700">{err}</p>}
    </div>
  );
}

interface Impact { recipes: { recipeId: string; name: string; oldPortionCost: string | null; newPortionCost: string | null; costChangePct: string | null; oldMarginPct: string | null; newMarginPct: string | null; belowTarget: boolean }[] }

export function PriceImpact({ products, currency }: { products: { id: string; name: string; unitCost: string | null; unit: string }[]; currency: string }) {
  const t = useT();
  const locale = useLocale();
  const [pid, setPid] = useState(products[0]?.id ?? "");
  const [change, setChange] = useState("20");
  const [res, setRes] = useState<Impact | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const p = products.find((x) => x.id === pid);
  async function run() {
    if (!p?.unitCost) return setErr(t("Selected ingredient has no current cost"));
    const ch = parseNum(change);
    if (!Number.isFinite(ch) || ch < -100) return setErr(t("Price change % must be a number (e.g. 7,5 or -10)"));
    setErr(null);
    const newCost = (Number(p.unitCost) * (1 + ch / 100)).toFixed(6);
    try { setRes(await call<Impact>("GET", `/api/price-impact?productId=${pid}&newCost=${newCost}`)); } catch (e) { setErr(e instanceof Error ? e.message : t("Failed")); }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div><Label htmlFor="pi-p">{t("Ingredient")}</Label><Select id="pi-p" value={pid} onChange={(e) => setPid(e.target.value)} className="w-52">{products.map((x) => <option key={x.id} value={x.id}>{titleTr(x.name, locale)}</option>)}</Select></div>
        <div><Label htmlFor="pi-c">{t("Price change %")}</Label><Input id="pi-c" value={change} onChange={(e) => setChange(e.target.value)} className="w-24" inputMode="decimal" /></div>
        <Button variant="secondary" onClick={run}>{t("Simulate")}</Button>
      </div>
      {err && <Alert>{err}</Alert>}
      {res && (
        <Table>
          <thead><tr><Th>{t("Affected recipe")}</Th><Th align="right">{t("Old")}</Th><Th align="right">{t("New")}</Th><Th align="right">Δ%</Th><Th align="right">{t("Margin")}</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {res.recipes.map((r) => (
              <tr key={r.recipeId}><Td><Title>{r.name}</Title></Td><Td align="right">{money(r.oldPortionCost, currency)}</Td><Td align="right">{money(r.newPortionCost, currency)}</Td><Td align="right">{pct(r.costChangePct)}</Td><Td align="right" className={r.belowTarget ? "font-semibold text-red-700" : ""}>{pct(r.oldMarginPct)} → {pct(r.newMarginPct)}</Td></tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
