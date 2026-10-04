import { pageContext } from "@/server/page";
import { authorize, can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { Decide } from "./decide";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const { actor, hotelId } = await pageContext();
  authorize(actor, "dashboard:view", { hotelId });
  const [pending, history] = await Promise.all([
    prisma.approval.findMany({ where: { hotelId, status: "PENDING" }, orderBy: { requestedAt: "desc" } }),
    prisma.approval.findMany({ where: { hotelId, status: { not: "PENDING" } }, orderBy: { decidedAt: "desc" }, take: 30 }),
  ]);
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...pending, ...history].flatMap((a) => [a.requestedById, a.decidedById ?? ""]) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const canDecide = can(actor, "approval:decide");
  const fmt = (p: unknown) => (p && typeof p === "object" ? Object.entries(p as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join(" · ") : "");
  return (
    <>
      <PageHeader title="Approvals" subtitle="Delete requests, high-value waste, stock adjustments. You can never approve your own request." />
      <Card title={`Pending (${pending.length})`} padded={false}>
        {pending.length === 0 ? <div className="p-4"><Empty title="Nothing waiting" /></div> : (
          <Table>
            <thead><tr><Th>Requested</Th><Th>Action</Th><Th>Requested by</Th><Th>Reason</Th><Th>Details</Th><Th /></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {pending.map((a) => (
                <tr key={a.id} className="align-top">
                  <Td>{dateTime(a.requestedAt)}</Td><Td><Badge tone="amber">{a.action.replace(/_/g, " ")}</Badge></Td><Td>{users.get(a.requestedById)}</Td>
                  <Td className="whitespace-normal">{a.reason}</Td><Td className="whitespace-normal text-xs text-ink-500">{fmt(a.payload)}</Td>
                  <Td>{canDecide && a.requestedById !== actor.userId ? <Decide id={a.id} /> : <span className="text-xs text-ink-400">{a.requestedById === actor.userId ? "your request" : "no permission"}</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card title="Recent decisions" className="mt-4" padded={false}>
        <Table>
          <thead><tr><Th>Decided</Th><Th>Action</Th><Th>Status</Th><Th>Requested by</Th><Th>Decided by</Th><Th>Note</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {history.map((a) => (
              <tr key={a.id}><Td>{dateTime(a.decidedAt)}</Td><Td>{a.action.replace(/_/g, " ")}</Td><Td><Badge tone={a.status === "APPROVED" ? "green" : "red"}>{a.status}</Badge></Td><Td>{users.get(a.requestedById)}</Td><Td>{users.get(a.decidedById ?? "")}</Td><Td className="whitespace-normal text-xs">{a.decisionNote}</Td></tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
