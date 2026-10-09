import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { DashboardAlert, PriceChange, PriceSummaryData } from "@/server/services/insights";
import { Badge, Empty, severityTone } from "@/components/ui";
import { money, pct, dateTime } from "@/lib/format";
import { getT } from "@/i18n/server";

/** Dashboard panels shared by the full and the basic home page (feedback r2 §2). */
/** Last vs previous purchase price per product: biggest increases, then the biggest decreases. */
export async function PriceSummary({ p, cur }: { p: PriceSummaryData; cur: string }) {
  const t = await getT();
  if (!p.increaseCount && !p.decreaseCount) return <Empty title={t("No price changes")} />;
  const line = (c: PriceChange) => (
    <li key={c.productId} className="py-1.5">
      <div className="flex justify-between gap-2"><span className="font-medium">{c.product}</span><Badge tone={c.change.gt(0) ? "red" : "green"}>{c.change.gt(0) ? "+" : ""}{pct(c.changePct)}</Badge></div>
      <p className="text-xs text-ink-500">{c.supplier}: {money(c.previous, cur)} → {money(c.current, cur)} / {c.unit}</p>
    </li>
  );
  return (
    <>
      <p className="mb-1 text-xs text-ink-500">{t("{up} increases · {down} decreases (last vs previous purchase)", { up: p.increaseCount, down: p.decreaseCount })}</p>
      <ul className="divide-y divide-ink-100 text-sm">{p.increases.map(line)}</ul>
      {p.decreases.length > 0 && <><h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-ink-500">{t("Decreases")}</h3><ul className="divide-y divide-ink-100 text-sm">{p.decreases.map(line)}</ul></>}
    </>
  );
}

/** Alert list: supplier price increases above the hotel threshold, critical stock and other open alerts. */
export async function AlertList({ alerts, timezone }: { alerts: DashboardAlert[]; timezone: string }) {
  const t = await getT();
  if (alerts.length === 0) return <Empty title={t("No open alerts")} />;
  return (
    <ul className="max-h-96 space-y-2 overflow-y-auto text-sm">
      {alerts.map((a) => (
        <li key={a.id} className="flex gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
          <div>
            <div className="flex items-center gap-2">{a.href ? <Link href={a.href} className="font-medium hover:underline">{t(a.title, a.vars)}</Link> : <span className="font-medium">{t(a.title, a.vars)}</span>}<Badge tone={severityTone[a.severity]}>{t(a.severity)}</Badge></div>
            <p className="text-xs text-ink-500">{t(a.message, a.vars)}</p>
            <p className="text-[11px] text-ink-400">{dateTime(a.createdAt, timezone)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
