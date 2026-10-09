import Link from "next/link";
import { pageContext, requirePageAccess } from "@/server/page";
import { prisma } from "@/server/db";
import { Badge, Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { getT } from "@/i18n/server";

export const metadata = { title: "Audit Trail" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  const { entity: raw } = await searchParams;
  // old links could carry "null" for rows without an entity id
  const entity = raw && raw !== "null" && raw !== "undefined" ? raw.slice(0, 100) : undefined;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  requirePageAccess(actor, "audit:view", hotelId);
  const logs = await prisma.auditLog.findMany({ where: { hotelId, ...(entity ? { entityId: entity } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: logs.map((l) => l.userId ?? "") } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const short = (v: unknown) => (v ? JSON.stringify(v).slice(0, 160) : "");
  return (
    <>
      <PageHeader title={t("Audit trail")} subtitle={t("Who · what · when · before · after · reason. Append-only — the database rejects edits and deletes.")} exportKey="audit" />
      {entity && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-ink-700">
          {t("Showing the history of one record")} <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs">{entity}</code>
          <Link href="/audit" className="font-medium text-brand-700 hover:underline">{t("Clear filter")}</Link>
        </p>
      )}
      <Card padded={false}>
        <Table>
          <thead><tr><Th>{t("When")}</Th><Th>{t("User")}</Th><Th>{t("Action")}</Th><Th>{t("Entity")}</Th><Th>{t("Before")}</Th><Th>{t("After")}</Th><Th>{t("Reason")}</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {logs.map((l) => (
              <tr key={l.id} className="align-top">
                <Td>{dateTime(l.createdAt, hotel.timezone)}</Td><Td>{users.get(l.userId ?? "") ?? t("system")}</Td><Td><Badge>{t(l.action)}</Badge></Td>
                <Td>{l.entityId ? <Link className="text-xs hover:underline" href={`/audit?entity=${encodeURIComponent(l.entityId)}`}>{l.entityType}</Link> : <span className="text-xs">{l.entityType}</span>}</Td>
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
