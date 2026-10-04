import { pageContext } from "@/server/page";
import { authorize } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Badge, Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { SalesImporter } from "./importer";

export const metadata = { title: "Sales Import" };

export default async function SalesPage() {
  const { actor, hotelId } = await pageContext();
  authorize(actor, "sales:import", { hotelId });
  const imports = await prisma.salesImport.findMany({ where: { hotelId }, orderBy: { createdAt: "desc" }, take: 20 });
  return (
    <>
      <PageHeader title="Sales import (cost input)" subtitle="POS sales drive theoretical consumption. Preview → validate → commit. Duplicate files and POS lines are rejected." />
      <Card title="Import CSV" className="mb-4"><SalesImporter /></Card>
      <Card title="Import history" padded={false}>
        <Table>
          <thead><tr><Th>Date</Th><Th>File</Th><Th>Source</Th><Th align="right">Rows</Th><Th align="right">Valid</Th><Th align="right">Invalid</Th><Th align="right">Duplicates</Th><Th>Status</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {imports.map((i) => (
              <tr key={i.id}><Td>{dateTime(i.createdAt)}</Td><Td>{i.fileName ?? "—"}</Td><Td>{i.source}</Td><Td align="right">{i.rowCount}</Td><Td align="right">{i.validCount}</Td><Td align="right">{i.invalidCount}</Td><Td align="right">{i.duplicateCount}</Td><Td><Badge tone={i.status === "POSTED" ? "green" : "gray"}>{i.status}</Badge></Td></tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
