import { FileDown } from "lucide-react";
import { pageContext, guarded, requirePageAccess } from "@/server/page";
import { calendarMonth, canCompleteTask, parseMonth } from "@/server/services/calendar";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Input, Label, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { date } from "@/lib/format";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/core";
import { DoneButton, NewTask } from "./actions";

export const metadata = { title: "Cost Control Calendar" };

const TONE = { DONE: "green", OVERDUE: "red", DUE_TODAY: "amber", UPCOMING: "gray" } as const;
const STATUS_FILTERS = ["OVERDUE", "DONE", "OPEN"] as const;
const DAY = 86_400_000;

/** System evidence is "<n> <words>" or "<period> closed"; translate the words, keep numbers and codes. */
function evidenceText(t: T, s: string) {
  const n = /^(\d+) (.+)$/.exec(s);
  if (n) return t(`{n} ${n[2]}`, { n: n[1] });
  const closed = /^(\S+) closed$/.exec(s);
  if (closed) return t("{code} closed", { code: closed[1] });
  return t(s);
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; status?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  requirePageAccess(actor, "report:view", hotelId);
  const now = new Date();
  const m = parseMonth(sp.month) ?? { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  const monthStr = `${m.year}-${String(m.month).padStart(2, "0")}`;
  const status = STATUS_FILTERS.find((s) => s === sp.status) ?? null;
  const res = await guarded(() => calendarMonth(prisma, actor, hotelId, m.year, m.month));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const r = res.data;
  const roles = can(actor, "period:manage") ? await prisma.role.findMany({ where: { organizationId: actor.organizationId }, orderBy: { name: "asc" }, select: { key: true, name: true } }) : [];
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // completion moments are timestamps: shown in the hotel's time zone
  const at = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: hotel.timezone });
  const weekday = new Intl.DateTimeFormat("tr-TR", { weekday: "short", timeZone: "UTC" });
  const shown = (s: string) => !status || (status === "OPEN" ? s === "UPCOMING" || s === "DUE_TODAY" : s === status);
  const href = (s: string | null) => `?${new URLSearchParams({ month: monthStr, ...(s && s !== status ? { status: s } : {}) })}`;
  return (
    <>
      <PageHeader
        title={t("Cost control calendar")}
        subtitle={t("The month's recurring controls, week by week (week 1 = days 1–7, week 2 = days 8–14 …). System evidence is shown next to each control but never completes it: the owner marks it done, and a completed control stays in its week with the completion date. Each week can be printed as a checklist (PDF).")}
        exportKey="calendar"
        actions={
          <FilterBar dates={false} hidden={{ status: status ?? undefined }}>
            <div><Label htmlFor="cal-month">{t("Month")}</Label><Input id="cal-month" name="month" type="month" defaultValue={monthStr} className="w-44" /></div>
          </FilterBar>
        }
      />
      <div className="grid grid-cols-3 gap-3">
        <Stat label={t("Overdue")} value={r.counts.overdue} tone={r.counts.overdue ? "bad" : "good"} href={href("OVERDUE")} active={status === "OVERDUE"} />
        <Stat label={t("Done")} value={r.counts.done} tone="good" href={href("DONE")} active={status === "DONE"} />
        <Stat label={t("Open (today and later)")} value={r.counts.upcoming} href={href("OPEN")} active={status === "OPEN"} />
      </div>
      {status && <p className="mt-3 text-sm text-ink-600">{t("Showing: {what}", { what: t(status === "OPEN" ? "Open (today and later)" : status === "DONE" ? "Done" : "Overdue") })} · <a href={href(null)} className="text-brand-800 hover:underline">{t("Show all")}</a></p>}
      <div className="mt-4 space-y-4">
        {r.weeks.map((w) => {
          const items = w.items.filter((i) => shown(i.status));
          const last = new Date(w.to.getTime() - DAY);
          return (
            <Card
              key={w.week}
              padded={false}
              title={<span>{t("Week {n}", { n: w.week })} <span className="ml-1 font-normal text-ink-500">{date(w.from)} – {date(last)}</span></span>}
              actions={<a href={`/api/calendar/checklist?month=${monthStr}&week=${w.week}`} download className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"><FileDown className="h-3.5 w-3.5" /> {t("Checklist (PDF)")}</a>}
            >
              {items.length ? (
                <Table>
                  {/* the same column widths in every week */}
                  <colgroup><col className="w-[12%]" /><col className="w-[22%]" /><col className="w-[12%]" /><col className="w-[10%]" /><col className="w-[20%]" /><col className="w-[15%]" /><col className="w-[9%]" /></colgroup>
                  <thead><tr><Th>{t("Due")}</Th><Th>{t("Control")}</Th><Th>{t("Owner")}</Th><Th>{t("Status")}</Th><Th>{t("System evidence")}</Th><Th>{t("Completed on")}</Th><Th /></tr></thead>
                  <tbody className="divide-y divide-ink-100">
                    {items.map((i) => (
                      <tr key={`${i.taskId}-${i.dueDate.toISOString()}`} className={i.status === "UPCOMING" ? "text-ink-500" : ""}>
                        <Td className="whitespace-nowrap">{weekday.format(i.dueDate)} {date(i.dueDate)}</Td>
                        <Td className="font-medium">{t(i.title)}</Td>
                        <Td className="text-xs">{i.ownerRole ? t(i.ownerRole) : "—"}</Td>
                        <Td><Badge tone={TONE[i.status as keyof typeof TONE]}>{t(i.status.replace("_", " "))}</Badge></Td>
                        <Td className="text-xs text-ink-500">{i.evidence ? evidenceText(t, i.evidence) : i.status === "UPCOMING" ? "" : t("no evidence found")}</Td>
                        <Td className="text-xs">{i.completedAt ? <><span className="font-medium text-brand-800">{at.format(i.completedAt)}</span>{i.completedBy ? ` · ${i.completedBy}` : ""}{i.note ? <span className="block text-ink-500">{i.note}</span> : null}</> : ""}</Td>
                        {/* a control may be signed off from its due week on (done a day early counts) */}
                        <Td>{i.status !== "DONE" && i.dueDate.getTime() <= today.getTime() + 6 * DAY && canCompleteTask(actor, i.ownerRole) && <DoneButton taskId={i.taskId} dueDate={i.dueDate.toISOString().slice(0, 10)} />}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <p className="px-4 py-3 text-sm text-ink-500">{w.items.length ? t("No controls with this status this week.") : t("No controls are due this week.")}</p>
              )}
            </Card>
          );
        })}
      </div>
      {can(actor, "period:manage") && <Card title={t("Add a control task")} className="mt-4"><NewTask roles={roles} /></Card>}
    </>
  );
}
