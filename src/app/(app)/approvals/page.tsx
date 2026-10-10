import { pageContext, requirePageAccess } from "@/server/page";
import { prisma } from "@/server/db";
import { Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { dateTime, money, qty, titleTr } from "@/lib/format";
import { getT, getLocale } from "@/i18n/server";
import { approvalsOverview } from "@/server/services/approvals";
import { actionLabel, approvalDetails } from "@/server/table-export/reports/approvals";
import { Decide } from "./decide";
import { Title } from "@/components/title";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const t = await getT();
  const locale = await getLocale();
  const { actor, hotelId, hotel } = await pageContext();
  requirePageAccess(actor, "dashboard:view", hotelId);
  // department-scoped approvers see (and can decide) only their departments' requests
  const { pending, history } = await approvalsOverview(prisma, actor, hotelId);
  // a count approval shows the count's differences, so the approver can decide without opening the count
  const countIds = pending.filter((a) => a.action === "STOCK_ADJUSTMENT").map((a) => a.entityId);
  const countLines = new Map(
    countIds.length
      ? (await prisma.stockCount.findMany({ where: { hotelId, id: { in: countIds } }, select: { id: true, lines: { where: { NOT: { varianceQty: 0 } }, select: { id: true, systemQty: true, countedQty: true, varianceQty: true, varianceValue: true, reason: true, product: { select: { name: true, stockUnit: true } } }, orderBy: { product: { name: "asc" } } } } })).map((c) => [c.id, c.lines])
      : [],
  );
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...pending, ...history].flatMap((a) => [a.requestedById, a.decidedById ?? ""]) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return (
    <>
      <PageHeader title={t("Approvals")} subtitle={t("Delete requests, high-value waste, stock counts. You can never approve your own request.")} exportKey="approvals" />
      <Card title={t("Pending ({n})", { n: pending.length })} padded={false}>
        {pending.length === 0 ? <div className="p-4"><Empty title={t("Nothing waiting")} /></div> : (
          <Table>
            <thead><tr><Th>{t("Requested")}</Th><Th>{t("Action")}</Th><Th>{t("Requested by")}</Th><Th>{t("Reason")}</Th><Th>{t("Details")}</Th><Th /></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {pending.map((a) => (
                <tr key={a.id} className="align-top">
                  <Td>{dateTime(a.requestedAt, hotel.timezone)}</Td><Td><Badge tone="amber">{t(actionLabel(a.action))}</Badge></Td><Td>{users.get(a.requestedById)}</Td>
                  <Td className="whitespace-normal">{a.reason}</Td><Td className="whitespace-normal text-xs text-ink-500">
                    {approvalDetails(a.payload, t, hotel.baseCurrency, (s) => titleTr(s, locale))}
                    {countLines.has(a.entityId) && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-brand-700">{t("{n} products with a difference", { n: countLines.get(a.entityId)!.length })}</summary>
                        <ul className="mt-1 space-y-0.5">
                          {countLines.get(a.entityId)!.map((l) => (
                            <li key={l.id}><Title>{l.product.name}</Title>: {qty(l.systemQty.toString(), l.product.stockUnit)} → {qty(l.countedQty.toString(), l.product.stockUnit)} ({money(l.varianceValue.toString(), hotel.baseCurrency)}){l.reason ? ` · ${l.reason}` : ""}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </Td>
                  <Td>{a.canDecide ? <Decide id={a.id} /> : <span className="text-xs text-ink-400">{a.requestedById === actor.userId ? t("your request") : t("no permission")}</span>}</Td>
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
              <tr key={a.id}><Td>{dateTime(a.decidedAt, hotel.timezone)}</Td><Td>{t(actionLabel(a.action))}</Td><Td><Badge tone={a.status === "APPROVED" ? "green" : a.status === "CANCELLED" ? "gray" : "red"}>{t(a.status)}</Badge></Td><Td>{users.get(a.requestedById)}</Td><Td>{users.get(a.decidedById ?? "")}</Td><Td className="whitespace-normal text-xs">{a.status === "CANCELLED" && a.decisionNote ? t(a.decisionNote) : a.decisionNote}</Td></tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
