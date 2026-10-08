import { pageContext, requirePageAccess } from "@/server/page";
import { prisma } from "@/server/db";
import { Badge, Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { getT } from "@/i18n/server";

export const metadata = { title: "Audit Trail" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  const { entity } = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  requirePageAccess(actor, "audit:view", hotelId);
  const logs = await prisma.auditLog.findMany({ where: { hotelId, ...(entity ? { entityId: entity } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: logs.map((l) => l.userId ?? "") } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const short = (v: unknown) => (v ? JSON.stringify(v).slice(0, 160) : "");
  return (
    <>
      <PageHeader title={t("Audit trail")} subtitle={t("Who · what · when · before · after · reason. Append-only — the database rejects edits and deletes.")} exportKey="audit" />
      <Card padded={false}>
        <Table>
          <thead><tr><Th>{t("When")}</Th><Th>{t("User")}</Th><Th>{t("Action")}</Th><Th>{t("Entity")}</Th><Th>{t("Before")}</Th><Th>{t("After")}</Th><Th>{t("Reason")}</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {logs.map((l) => (
              <tr key={l.id} className="align-top">
                <Td>{dateTime(l.createdAt, hotel.timezone)}</Td><Td>{users.get(l.userId ?? "") ?? t("system")}</Td><Td><Badge>{t(l.action)}</Badge></Td>
                <Td><a className="text-xs hover:underline" href={`?entity=${l.entityId}`}>{l.entityType}</a></Td>
                <Td className="max-w-xs whitespace-normal break-all font-mono text-[11px] text-ink-500">{short(l.before)}</Td>
                <Td className="max-w-xs whitespace-normal break-all font-mono text-[11px] text-ink-500">{short(l.after)}</Td>
                <Td className="whitespace-normal text-xs">{l.reason}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
