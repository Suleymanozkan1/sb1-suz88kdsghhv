import { pageContext, guarded } from "@/server/page";
import { listReports } from "@/server/services/reports";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { date, dateTime } from "@/lib/format";
import { getT } from "@/i18n/server";
import { PackForm, VerifyButton } from "./actions";

export const metadata = { title: "Reports" };

const LABEL: Record<string, string> = { FULL_COST_EXPORT: "Full cost export (Excel / API)", MANAGEMENT_PACK: "Management pack (PDF)", PERIOD_CLOSE: "Period close snapshot" };

export default async function ReportsPage() {
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => listReports(prisma, actor, hotelId));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const canExport = can(actor, "report:export");
  return (
    <>
      <PageHeader title={t("Reports")} subtitle={t("Every generated report is archived with period, parameters, author, data version and hashes. Closed months can be re-verified: the period hash must reproduce exactly unless the month was reopened.")} exportKey="reports" />
      {canExport && <Card title={t("Monthly management cost pack")} className="mb-4"><PackForm defaultMonth={lastMonth} /><p className="mt-2 text-xs text-ink-500">{t("Executive summary, F&B, rooms, labor, energy, laundry, housekeeping, engineering, purchasing & supplier changes, waste, stock, variance, top drivers, budget, recommended actions and the month-end checklist — from the same engine as the screens and Excel.")}</p></Card>}
      <Card title={t("Archive ({n})", { n: res.data.length })} padded={false}>
        {res.data.length === 0 ? <div className="p-4"><Empty title={t("No reports generated yet")} /></div> : (
          <Table>
            <thead><tr><Th>{t("Generated")}</Th><Th>{t("Report")}</Th><Th>{t("Period")}</Th><Th>{t("By")}</Th><Th>{t("Filters")}</Th><Th>{t("Period hash")}</Th><Th>v</Th>{canExport && <Th>{t("Reproducibility")}</Th>}</tr></thead>
            <tbody className="divide-y divide-ink-100">
              {res.data.map((r) => {
                const f = (r.params ?? {}) as Record<string, string | null>;
                const filters = Object.entries(f).filter(([, v]) => v).map(([k]) => k).join(", ");
                return (
                  <tr key={r.id}>
                    <Td>{dateTime(r.generatedAt, hotel.timezone)}</Td>
                    <Td className="font-medium">{t(LABEL[r.reportType] ?? r.reportType)}</Td>
                    <Td>{r.periodFrom ? `${date(r.periodFrom)} – ${date(new Date(r.periodTo!.getTime() - 86400000))}` : "—"}{r.period && <Badge tone={r.period.status === "CLOSED" ? "gray" : "green"}>{r.period.code} {t(r.period.status)}</Badge>}</Td>
                    <Td>{r.generatedBy}</Td>
                    <Td className="text-xs">{filters || t("none")}</Td>
                    <Td className="font-mono text-xs">{r.periodHash ? r.periodHash.slice(0, 12) : "—"}</Td>
                    <Td>{r.dataVersion}</Td>
                    {canExport && <Td>{r.periodHash && <VerifyButton id={r.id} />}</Td>}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
