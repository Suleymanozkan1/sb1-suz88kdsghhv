import Link from "next/link";
import type { basicDashboard } from "@/server/services/insights";
import { Badge, Card, Empty, PageHeader, Stat, levelTone } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { money, qty } from "@/lib/format";
import { getT } from "@/i18n/server";
import { AlertList, PriceSummary } from "./dashboard-panels";

type D = Awaited<ReturnType<typeof basicDashboard>>;

/** Home page for roles without cost-variance rights: only the blocks their permissions allow. */
export async function BasicDashboard({ hotelName, currency, timezone, range, d }: { hotelName: string; currency: string; timezone: string; range: { fromStr: string; toStr: string }; d: D }) {
  const t = await getT();
  const qs = `from=${range.fromStr}&to=${range.toStr}`;
  return (
    <>
      <PageHeader exportKey="dashboard" title={t("Overview - {hotel}", { hotel: hotelName })} subtitle={t("Your role's view: stock, purchasing and alerts you are allowed to see.")} actions={<PeriodFilter from={range.fromStr} to={range.toStr} />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {d.stock && <Stat label={t("Stock value")} value={money(d.stock.value, currency, 0)} hint={t("{count} critical / out of stock", { count: d.stock.counts.CRITICAL + d.stock.counts.OUT_OF_STOCK })} />}
        {d.purchases && <Stat label={t("Purchases")} value={money(d.purchases.spend, currency, 0)} hint={t("{count} receipts", { count: d.purchases.receipts })} />}
      </div>
      {!d.stock && !d.purchases && d.alerts.length === 0 && <div className="mt-4"><Empty title={t("Nothing to show for your role on this page")}>{t("Use the menu to open the modules you work in.")}</Empty></div>}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {d.stock && (
          <Card title={t("Critical stock")} actions={<Link href="/inventory" className="text-xs font-medium text-brand-700 hover:underline">{t("Inventory")}</Link>}>
            {d.stock.critical.length === 0 ? <Empty title={t("No critical items")} /> : (
              <ul className="divide-y divide-ink-100 text-sm">{d.stock.critical.map((c) => <li key={c.productId} className="flex justify-between py-1.5"><span className="truncate">{c.name}</span><Badge tone={levelTone[c.level]}>{qty(c.quantity, c.unit)}</Badge></li>)}</ul>
            )}
          </Card>
        )}
        {d.prices && (
          <Card title={<Link href={`/insights/price-changes?${qs}`} className="hover:underline">{t("Supplier price increases / decreases")}</Link>} actions={<Link href={`/insights/price-changes?${qs}`} className="text-xs font-medium text-brand-700 hover:underline">{t("All changes")}</Link>}>
            <PriceSummary p={d.prices} cur={currency} />
          </Card>
        )}
        {d.alerts.length > 0 && (
          <Card title={`${t("Open alerts")} (${d.alerts.length})`}>
            <AlertList alerts={d.alerts} timezone={timezone} />
          </Card>
        )}
      </div>
    </>
  );
}
