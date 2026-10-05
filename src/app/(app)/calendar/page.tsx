import { pageContext, guarded } from "@/server/page";
import { calendarView, canCompleteTask } from "@/server/services/calendar";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { date } from "@/lib/format";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/core";
import { DoneButton, NewTask } from "./actions";

export const metadata = { title: "Cost Control Calendar" };

const TONE = { DONE: "green", OVERDUE: "red", DUE_TODAY: "amber", UPCOMING: "gray" } as const;

/** System evidence is "<n> <words>" or "<period> closed"; translate the words, keep numbers and codes. */
function evidenceText(t: T, s: string) {
  const n = /^(\d+) (.+)$/.exec(s);
  if (n) return t(`{n} ${n[2]}`, { n: n[1] });
  const closed = /^(\S+) closed$/.exec(s);
  if (closed) return t("{code} closed", { code: closed[1] });
  return t(s);
}

export default async function CalendarPage() {
  const t = await getT();
  const { actor, hotelId } = await pageContext();
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 28));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 15));
  const res = await guarded(() => calendarView(prisma, actor, hotelId, from, to));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const r = res.data;
  return (
    <>
      <PageHeader title={t("Cost control calendar")} subtitle={t("Recurring controls: weekly counts, month-end inventory, recipe, supplier price, waste and buffet reviews, cost closing and the management report. System evidence is shown next to each due date; completing a control is a recorded, audited action.")} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label={t("Overdue")} value={r.counts.overdue} tone={r.counts.overdue ? "bad" : "good"} />
        <Stat label={t("Done (last 4 weeks)")} value={r.counts.done} />
        <Stat label={t("Upcoming (2 weeks)")} value={r.counts.upcoming} />
      </div>
      <Card title={t("Due controls")} className="mt-4" padded={false}>
        <Table>
          <thead><tr><Th>{t("Due")}</Th><Th>{t("Control")}</Th><Th>{t("Owner")}</Th><Th>{t("Status")}</Th><Th>{t("System evidence")}</Th><Th>{t("Completed")}</Th><Th /></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {r.items.map((i) => (
              <tr key={`${i.taskId}-${i.dueDate.toISOString()}`} className={i.status === "UPCOMING" ? "text-ink-500" : ""}>
                <Td>{date(i.dueDate)}</Td><Td className="font-medium">{t(i.title)}</Td><Td className="text-xs">{i.ownerRole ? t(i.ownerRole) : "—"}</Td>
                <Td><Badge tone={TONE[i.status as keyof typeof TONE]}>{t(i.status.replace("_", " "))}</Badge></Td>
                <Td className="text-xs text-ink-500">{i.evidence ? evidenceText(t, i.evidence) : i.status === "UPCOMING" ? "" : t("no evidence found")}</Td>
                <Td className="text-xs">{i.completedBy ? `${i.completedBy}${i.note ? ` — ${i.note}` : ""}` : ""}</Td>
                <Td>{i.status !== "DONE" && i.status !== "UPCOMING" && canCompleteTask(actor, i.ownerRole) && <DoneButton taskId={i.taskId} dueDate={i.dueDate.toISOString().slice(0, 10)} />}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {can(actor, "period:manage") && <Card title={t("Add a control task")} className="mt-4"><NewTask /></Card>}
    </>
  );
}
