import { pageContext, guarded } from "@/server/page";
import { calendarView } from "@/server/services/calendar";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { date } from "@/lib/format";
import { DoneButton, NewTask } from "./actions";

export const metadata = { title: "Cost Control Calendar" };

const TONE = { DONE: "green", OVERDUE: "red", DUE_TODAY: "amber", UPCOMING: "gray" } as const;

export default async function CalendarPage() {
  const { actor, hotelId } = await pageContext();
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 28));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 15));
  const res = await guarded(() => calendarView(prisma, actor, hotelId, from, to));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const r = res.data;
  return (
    <>
      <PageHeader title="Cost control calendar" subtitle="Recurring controls (spec 257): weekly counts, month-end inventory, recipe, supplier price, waste and buffet reviews, cost closing and the management report. System evidence is shown next to each due date; completing a control is a recorded, audited action." />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Overdue" value={r.counts.overdue} tone={r.counts.overdue ? "bad" : "good"} />
        <Stat label="Done (last 4 weeks)" value={r.counts.done} />
        <Stat label="Upcoming (2 weeks)" value={r.counts.upcoming} />
      </div>
      <Card title="Due controls" className="mt-4" padded={false}>
        <Table>
          <thead><tr><Th>Due</Th><Th>Control</Th><Th>Owner</Th><Th>Status</Th><Th>System evidence</Th><Th>Completed</Th><Th /></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {r.items.map((i) => (
              <tr key={`${i.taskId}-${i.dueDate.toISOString()}`} className={i.status === "UPCOMING" ? "text-ink-500" : ""}>
                <Td>{date(i.dueDate)}</Td><Td className="font-medium">{i.title}</Td><Td className="text-xs">{i.ownerRole ?? "—"}</Td>
                <Td><Badge tone={TONE[i.status as keyof typeof TONE]}>{i.status.replace("_", " ")}</Badge></Td>
                <Td className="text-xs text-ink-500">{i.evidence ?? (i.status === "UPCOMING" ? "" : "no evidence found")}</Td>
                <Td className="text-xs">{i.completedBy ? `${i.completedBy}${i.note ? ` — ${i.note}` : ""}` : ""}</Td>
                <Td>{i.status !== "DONE" && i.status !== "UPCOMING" && <DoneButton taskId={i.taskId} dueDate={i.dueDate.toISOString().slice(0, 10)} />}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {can(actor, "period:manage") && <Card title="Add a control task" className="mt-4"><NewTask /></Card>}
    </>
  );
}
