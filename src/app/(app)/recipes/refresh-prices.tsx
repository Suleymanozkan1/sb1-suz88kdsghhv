"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Alert, Button, Card, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";
import { money, pct } from "@/lib/format";
import { useT } from "@/i18n/client";
import { Title } from "@/components/title";

interface Row { recipeId: string; code: string; name: string; version: number; unit: string; oldPortionCost: string | null; newPortionCost: string | null; change: string | null; changePct: string | null; complete: boolean }
interface Result { refreshed: number; changed: number; failed: string[]; rows: Row[] }

/**
 * "Reçete fiyatlarını güncelle": re-costs every recipe at today's FIFO costs (oldest batch in stock, else the last
 * invoice price), refreshes the frozen costs and lists what changed, largest change first.
 */
export function RecipePriceRefresh({ currency }: { currency: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  async function run() {
    if (busy || !window.confirm(t("Re-cost every recipe at today's ingredient costs (FIFO: the oldest batch in stock, else the last invoice price) and refresh their frozen costs?"))) return;
    setBusy(true);
    setErr(null);
    try {
      setRes(await call<Result>("POST", "/api/recipes/refresh-prices", {}));
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("Failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {err && <span className="text-sm text-red-700">{err}</span>}
        <Button variant="secondary" disabled={busy} onClick={run}><RefreshCw className="h-4 w-4" /> {busy ? t("Updating…") : t("Update recipe prices")}</Button>
      </div>
      {res && (
        <Card padded={false} title={t("Recipe prices updated: {n} recipes, {changed} changed", { n: res.refreshed, changed: res.changed })} actions={<Button size="sm" variant="ghost" onClick={() => setRes(null)}>{t("Close")}</Button>}>
          {res.failed.length > 0 && <div className="p-3"><Alert tone="amber">{t("Not updated:")} {res.failed.join("; ")}</Alert></div>}
          {res.rows.length > 0 && (
            <Table>
              <thead><tr><Th>{t("Recipe")}</Th><Th align="right">{t("Old cost / portion")}</Th><Th align="right">{t("New cost / portion")}</Th><Th align="right">{t("Change")}</Th><Th align="right">{t("Change %")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {res.rows.map((r) => {
                  const n = Number(r.change ?? 0);
                  const tone = n > 0 ? "text-red-700" : n < 0 ? "text-green-700" : "";
                  return (
                    <tr key={r.recipeId}>
                      <Td><span className="font-medium"><Title>{r.name}</Title></span><span className="block text-xs text-ink-400">{r.code} · v{r.version}{r.unit !== "portion" ? ` · ${t("per {unit}", { unit: t(r.unit) })}` : ""}</span></Td>
                      <Td align="right">{money(r.oldPortionCost, currency)}</Td>
                      <Td align="right">{money(r.newPortionCost, currency)}</Td>
                      <Td align="right" className={tone}>{r.change === null ? "—" : `${n > 0 ? "+" : ""}${money(r.change, currency)}`}</Td>
                      <Td align="right" className={tone}>{r.changePct === null ? "—" : `${n > 0 ? "+" : ""}${pct(r.changePct)}`}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
