import { pageContext, requirePageAccess } from "@/server/page";
import { prisma } from "@/server/db";
import { Badge, Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { getT } from "@/i18n/server";
import { SalesImporter } from "./importer";

export const metadata = { title: "Sales Import" };

export default async function SalesPage() {
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  requirePageAccess(actor, "sales:import", hotelId);
  const imports = await prisma.salesImport.findMany({ where: { hotelId }, orderBy: { createdAt: "desc" }, take: 20 });
  return (
    <>
      <PageHeader title={t("Sales import (cost input)")} subtitle={t("POS sales drive theoretical consumption. Preview → validate → commit. Duplicate files and POS lines are rejected.")} />
      <Card title={t("Import CSV")} className="mb-4"><SalesImporter /></Card>
      <Card title={t("Import history")} padded={false}>
        <Table>
          <thead><tr><Th>{t("Date")}</Th><Th>{t("File")}</Th><Th>{t("Source")}</Th><Th align="right">{t("Rows")}</Th><Th align="right">{t("Valid")}</Th><Th align="right">{t("Invalid")}</Th><Th align="right">{t("Duplicates")}</Th><Th>{t("Status")}</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {imports.map((i) => (
              <tr key={i.id}><Td>{dateTime(i.createdAt, hotel.timezone)}</Td><Td>{i.fileName ?? "—"}</Td><Td>{i.source}</Td><Td align="right">{i.rowCount}</Td><Td align="right">{i.validCount}</Td><Td align="right">{i.invalidCount}</Td><Td align="right">{i.duplicateCount}</Td><Td><Badge tone={i.status === "POSTED" ? "green" : "gray"}>{t(i.status)}</Badge></Td></tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
