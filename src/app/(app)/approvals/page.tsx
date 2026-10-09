import { pageContext, requirePageAccess } from "@/server/page";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { getT } from "@/i18n/server";
import { approvalsOverview } from "@/server/services/approvals";
import { approvalDetails } from "@/server/table-export/reports/approvals";
import { Decide } from "./decide";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  requirePageAccess(actor, "dashboard:view", hotelId);
  // department-scoped approvers see (and can decide) only their departments' requests
  const { pending, history } = await approvalsOverview(prisma, actor, hotelId);
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...pending, ...history].flatMap((a) => [a.requestedById, a.decidedById ?? ""]) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const canDecide = can(actor, "approval:decide");
  return (
    <>
      <PageHeader title={t("Approvals")} subtitle={t("Delete requests, high-value waste, stock adjustments. You can never approve your own request.")} exportKey="approvals" />
      <Card title={t("Pending ({n})", { n: pending.length })} padded={false}>
        {pending.length === 0 ? <div className="p-4"><Empty title={t("Nothing waiting")} /></div> : (
          <Table>
            <thead><tr><Th>{t("Requested")}</Th><Th>{t("Action")}</Th><Th>{t("Requested by")}</Th><Th>{t("Reason")}</Th><Th>{t("Details")}</Th><Th /></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {pending.map((a) => (
                <tr key={a.id} className="align-top">
                  <Td>{dateTime(a.requestedAt, hotel.timezone)}</Td><Td><Badge tone="amber">{t(a.action.replace(/_/g, " "))}</Badge></Td><Td>{users.get(a.requestedById)}</Td>
                  <Td className="whitespace-normal">{a.reason}</Td><Td className="whitespace-normal text-xs text-ink-500">{approvalDetails(a.payload, t, hotel.baseCurrency)}</Td>
                  <Td>{canDecide && a.requestedById !== actor.userId ? <Decide id={a.id} /> : <span className="text-xs text-ink-400">{a.requestedById === actor.userId ? t("your request") : t("no permission")}</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card title={t("Recent decisions")} className="mt-4" padded={false}>
        <Table>
          <thead><tr><Th>{t("Decided")}</Th><Th>{t("Action")}</Th><Th>{t("Status")}</Th><Th>{t("Requested by")}</Th><Th>{t("Decided by")}</Th><Th>{t("Note")}</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {history.map((a) => (
              <tr key={a.id}><Td>{dateTime(a.decidedAt, hotel.timezone)}</Td><Td>{t(a.action.replace(/_/g, " "))}</Td><Td><Badge tone={a.status === "APPROVED" ? "green" : "red"}>{t(a.status)}</Badge></Td><Td>{users.get(a.requestedById)}</Td><Td>{users.get(a.decidedById ?? "")}</Td><Td className="whitespace-normal text-xs">{a.decisionNote}</Td></tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
