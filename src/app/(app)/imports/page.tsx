import { pageContext } from "@/server/page";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { IMPORT_KINDS, IMPORT_PERMISSION } from "@/server/services/imports";
import { Alert, Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { Importer, type ImportKindKey } from "./importer";
import { ReverseButton } from "../operations/forms";

export const metadata = { title: "Imports" };

export default async function ImportsPage() {
  const { actor, hotelId, hotel } = await pageContext();
  const allowed: ImportKindKey[] = [
    ...(can(actor, "opex:manage") ? (["expenses"] as const) : []),
    ...(can(actor, "pms:import") ? (["occupancy", "reservations"] as const) : []),
    ...(can(actor, "product:manage") ? (["products"] as const) : []),
    ...(can(actor, "purchase:prices") ? (["supplier-prices"] as const) : []),
    ...(can(actor, "inventory:adjust") ? (["opening-stock"] as const) : []),
  ];
  if (!allowed.length) return <Alert>You have no import permission.</Alert>;
  const kinds = IMPORT_KINDS.filter((k) => can(actor, IMPORT_PERMISSION[k]));
  const batches = await prisma.importBatch.findMany({ where: { hotelId, kind: { in: [...kinds] } }, orderBy: { createdAt: "desc" }, take: 50 });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(batches.map((b) => b.createdById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return (
    <>
      <PageHeader title="Imports" subtitle="Accounting expenses, payroll, utility bills, PMS data, product master, supplier price lists and go-live opening stock (spec 143–144, 245–249). CSV or Excel. Every file is previewed (valid / invalid / duplicate / warning), imported all-or-nothing with source row and mapping version, protected against re-import and reversible. POS sales are imported under Sales Import." />
      <Card title="Import a file" className="mb-4"><Importer allowed={[...allowed]} /></Card>
      <Card title="Import history" padded={false}>
        {batches.length === 0 ? <div className="p-4"><Empty title="Nothing imported yet" /></div> : (
          <Table>
            <thead><tr><Th>When</Th><Th>Data</Th><Th>File</Th><Th align="right">Rows</Th><Th align="right">Imported</Th><Th>By</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {batches.map((b) => (
                <tr key={b.id} className={b.status === "ROLLED_BACK" ? "text-ink-400" : ""}>
                  <Td>{dateTime(b.createdAt, hotel.timezone)}</Td><Td className="font-medium">{b.kind}</Td><Td className="text-xs">{b.fileName} <span className="text-ink-400">#{b.fileHash.slice(0, 8)} · {b.sourceFormat} · {b.mappingVersion}</span></Td>
                  <Td align="right">{b.rowCount}</Td><Td align="right">{b.postedCount}</Td><Td>{users.get(b.createdById) ?? "—"}</Td>
                  <Td>{b.status === "POSTED" ? <Badge tone="green">POSTED</Badge> : <Badge tone="red">ROLLED BACK {b.rolledBackAt ? dateTime(b.rolledBackAt, hotel.timezone) : ""}</Badge>}</Td>
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
