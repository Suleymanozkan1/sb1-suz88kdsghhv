import { pageContext } from "@/server/page";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { Importer } from "./importer";
import { ReverseButton } from "../operations/forms";

export const metadata = { title: "Imports" };

export default async function ImportsPage() {
  const { actor, hotelId } = await pageContext();
  const allowed = [...(can(actor, "opex:manage") ? (["expenses"] as const) : []), ...(can(actor, "pms:import") ? (["occupancy", "reservations"] as const) : [])];
  if (!allowed.length) return <Alert>You have no import permission.</Alert>;
  const batches = await prisma.importBatch.findMany({ where: { hotelId }, orderBy: { createdAt: "desc" }, take: 50 });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(batches.map((b) => b.createdById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return (
    <>
      <PageHeader title="Imports" subtitle="Accounting expenses, payroll, utility bills and PMS data as cost inputs (spec 143–144, 245–249). Every file is previewed, imported all-or-nothing, protected against re-import and reversible. POS sales are imported under Sales Import." />
      <Card title="Import a file" className="mb-4"><Importer allowed={[...allowed]} /></Card>
      <Card title="Import history" padded={false}>
        {batches.length === 0 ? <div className="p-4"><Empty title="Nothing imported yet" /></div> : (
          <Table>
            <thead><tr><Th>When</Th><Th>Data</Th><Th>File</Th><Th align="right">Rows</Th><Th align="right">Imported</Th><Th>By</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {batches.map((b) => (
                <tr key={b.id} className={b.status === "ROLLED_BACK" ? "text-ink-400" : ""}>
                  <Td>{dateTime(b.createdAt)}</Td><Td className="font-medium">{b.kind}</Td><Td className="text-xs">{b.fileName} <span className="text-ink-400">#{b.fileHash.slice(0, 8)}</span></Td>
                  <Td align="right">{b.rowCount}</Td><Td align="right">{b.postedCount}</Td><Td>{users.get(b.createdById) ?? "—"}</Td>
                  <Td>{b.status === "POSTED" ? <Badge tone="green">POSTED</Badge> : <Badge tone="red">ROLLED BACK {b.rolledBackAt ? dateTime(b.rolledBackAt) : ""}</Badge>}</Td>
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
