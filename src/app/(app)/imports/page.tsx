import { pageContext } from "@/server/page";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { IMPORT_KINDS, IMPORT_PERMISSION } from "@/server/services/imports";
import { Alert, Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { getT } from "@/i18n/server";
import { Importer, type ImportKindKey } from "./importer";
import { Keys, RunNow } from "./automation";
import { IntegrationBanner, botMessage, runSummary } from "./integration-status";
import { integrationOverview } from "@/server/integrations/ingest";
import { ReverseButton } from "../operations/forms";

export const metadata = { title: "Imports" };

export default async function ImportsPage() {
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const allowed: ImportKindKey[] = [
    ...(can(actor, "opex:manage") ? (["expenses"] as const) : []),
    ...(can(actor, "pms:import") ? (["occupancy", "reservations"] as const) : []),
    ...(can(actor, "product:manage") ? (["products"] as const) : []),
    ...(can(actor, "purchase:prices") ? (["supplier-prices"] as const) : []),
    ...(can(actor, "inventory:adjust") ? (["opening-stock"] as const) : []),
  ];
  const auto = can(actor, "sales:import") ? await integrationOverview(prisma, actor, hotelId) : null;
  if (!allowed.length && !auto) return <Alert>{t("You have no import permission.")}</Alert>;
  const kinds = IMPORT_KINDS.filter((k) => can(actor, IMPORT_PERMISSION[k]));
  const batches = await prisma.importBatch.findMany({ where: { hotelId, kind: { in: [...kinds] } }, orderBy: { createdAt: "desc" }, take: 50 });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(batches.map((b) => b.createdById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return (
    <>
      <PageHeader exportKey="imports" title={t("Imports")} subtitle={t("Accounting expenses, payroll, utility bills, PMS data, product master, supplier price lists and go-live opening stock. CSV or Excel. Every file is previewed (valid / invalid / duplicate / warning), imported all-or-nothing with source row and mapping version, protected against re-import and reversible. POS sales are imported under Sales Import.")} />
      {auto && (
        <>
          <IntegrationBanner health={auto.health} />
          <Card title={t("Automation (Micros / Opera)")} className="mb-4">
            <p className="mb-3 text-sm text-ink-600">{t("Every night after the night audit ({cutoff}) the automation reads the previous business day from Micros (checks, purchase invoices, covers sold) and Opera (occupancy, minibar) and sends it here. A day sent twice is never counted twice (check no. / invoice no.).", { cutoff: hotel.businessDayCutoff })}</p>
            <RunNow waiting={auto.waiting.map((w) => w.source)} />
          </Card>
          <Card title={t("Automation log")} className="mb-4" padded={false}>
            {auto.runs.length === 0 ? <div className="p-4"><Empty title={t("The automation has not run yet")} /></div> : (
              <Table>
                <thead><tr><Th>{t("When")}</Th><Th>{t("Source")}</Th><Th>{t("Business day")}</Th><Th>{t("Status")}</Th><Th>{t("Records")}</Th><Th>{t("Message")}</Th></tr></thead>
                <tbody className="divide-y divide-ink-100">
                  {auto.runs.map((r) => (
                    <tr key={r.id} className="align-top">
                      <Td>{dateTime(r.startedAt, hotel.timezone)}</Td><Td>{r.source}</Td><Td>{r.businessDay ?? "—"}</Td>
                      <Td><Badge tone={r.status === "SUCCEEDED" ? "green" : r.status === "FAILED" ? "red" : "amber"}>{t(r.status)}</Badge></Td>
                      <Td className="text-xs" style={{ whiteSpace: "normal", minWidth: "22rem" }}>{runSummary(r.stats, t).map((l, i) => <div key={i}>{l}</div>)}</Td>
                      <Td className="text-xs text-ink-600" style={{ whiteSpace: "normal", minWidth: "16rem" }}>{r.message && (r.status !== "SUCCEEDED" || !r.stats) ? botMessage(r.message, t) : ""}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          {can(actor, "admin:hotels") && <Card title={t("Automation keys")} className="mb-4"><Keys tz={hotel.timezone} keys={auto.keys.map((k) => ({ ...k, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null }))} /></Card>}
        </>
      )}
      {allowed.length > 0 && <Card title={t("Import a file")} className="mb-4"><Importer allowed={[...allowed]} currency={hotel.baseCurrency} /></Card>}
      <Card title={t("Import history")} padded={false}>
        {batches.length === 0 ? <div className="p-4"><Empty title={t("Nothing imported yet")} /></div> : (
          <Table>
            <thead><tr><Th>{t("When")}</Th><Th>{t("Data")}</Th><Th>{t("File")}</Th><Th align="right">{t("Rows")}</Th><Th align="right">{t("Imported")}</Th><Th>{t("By")}</Th><Th>{t("Status")}</Th><Th /></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {batches.map((b) => (
                <tr key={b.id} className={b.status === "ROLLED_BACK" ? "text-ink-400" : ""}>
                  <Td>{dateTime(b.createdAt, hotel.timezone)}</Td><Td className="font-medium">{t(b.kind)}</Td><Td className="text-xs">{b.fileName} <span className="text-ink-400">#{b.fileHash.slice(0, 8)} · {b.sourceFormat} · {b.mappingVersion}</span></Td>
                  <Td align="right">{b.rowCount}</Td><Td align="right">{b.postedCount}</Td><Td>{users.get(b.createdById) ?? "—"}</Td>
                  <Td>{b.status === "POSTED" ? <Badge tone="green">{t("POSTED")}</Badge> : <Badge tone="red">{t("ROLLED BACK")} {b.rolledBackAt ? dateTime(b.rolledBackAt, hotel.timezone) : ""}</Badge>}</Td>
                  <Td>{b.status === "POSTED" && <ReverseButton url={`/api/imports/batches/${b.id}/rollback`} label="Roll back" />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
