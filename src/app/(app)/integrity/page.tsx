import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { pageContext, guarded } from "@/server/page";
import { integrityRun, listRuns, type FindingValue } from "@/server/services/integrity";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, PageHeader, Table, Td, Th, cn } from "@/components/ui";
import { dateTime, money, qty } from "@/lib/format";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/core";
import { IntegrityActions } from "./actions";

export const metadata = { title: "Calculation Integrity" };

const TONE = { COMPLETED: "green", RUNNING: "blue", PARTIAL: "amber", PENDING: "gray", FAILED: "red", PENDING_REPROCESS: "amber" } as const;
const RESULT_TONE: Record<string, "green" | "amber" | "red"> = { OK: "green", WARNINGS: "amber", ISSUES: "red" };

/** A compared value as the user reads it: numbers in the record's unit or the hotel currency, texts translated. */
function findingValue(v: FindingValue, which: "expected" | "found", t: T, currency: string): string {
  const x = v[which];
  if (v.kind === "text") return t(x);
  if (v.kind === "money") return money(x, currency);
  if (v.kind === "qty") return qty(x, v.unit);
  return x;
}

export default async function IntegrityPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const runs = await guarded(() => listRuns(prisma, actor, hotelId));
  if (!runs.ok) return <Alert>{runs.error}</Alert>;
  // the run picked in the log, else the last completed check
  const shown = await integrityRun(prisma, actor, hotelId, sp.run);
  const cur = hotel.baseCurrency;
  return (
    <>
      <PageHeader title={t("Calculation integrity")} subtitle={t("Cost engine safety: checks every ledger relationship (balances, FIFO layers, cost ledger, expenses, allocations, recipe snapshots, minibar). Ledgers are append-only and never recalculated; only derived balances can be rebuilt, and every run is logged with its corrections. Every finding opens the record where it is, with the expected and the found value.")} exportKey="integrity" exportParams={{ run: shown?.id }} />
      <Card title={t("Checks and safe recalculation")}><IntegrityActions canRebuild={can(actor, "period:close_override")} canReprocess={can(actor, "sales:import")} /></Card>

      <div id="run" className="scroll-mt-4">
        {shown && (
          <Card
            className="mt-4"
            padded={false}
            title={<span className="flex flex-wrap items-center gap-2">{t("Integrity check of {date}", { date: dateTime(shown.startedAt, hotel.timezone) })} {shown.result && <Badge tone={RESULT_TONE[shown.result] ?? "gray"}>{t(shown.result)}</Badge>} <span className="text-xs font-normal text-ink-500">{t("Findings: {n}", { n: shown.findings })}</span></span>}
          >
            {shown.error && <div className="p-4"><Alert>{t(shown.error)}</Alert></div>}
            <Table>
              <thead><tr><Th>{t("Check")}</Th><Th>{t("Result")}</Th><Th align="right">{t("Findings")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {shown.checks.map((c) => (
                  <CheckRows key={c.key} check={c} t={t} currency={cur} />
                ))}
              </tbody>
            </Table>
          </Card>
        )}
      </div>

      <Card title={t("Calculation runs")} className="mt-4" padded={false}>
        {runs.data.length === 0 ? <div className="p-4"><Empty title={t("No runs yet")} /></div> : (
          <Table>
            <thead><tr><Th>{t("Started")}</Th><Th>{t("Kind")}</Th><Th>{t("Status")}</Th><Th>{t("Finished")}</Th><Th>{t("Detail")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {runs.data.map((r) => {
                const d = (r.details ?? {}) as Record<string, unknown>;
                const detail = r.error ? t(r.error) : d.status ? t("result {status}", { status: t(String(d.status)) }) : d.corrected !== undefined ? t("{n} corrected: {reason}", { n: String(d.corrected), reason: String(d.reason ?? "") }) : d.mapped !== undefined ? t("{mapped} mapped, {unmapped} unmapped, {closed} closed-period lines kept", { mapped: String(d.mapped), unmapped: String(d.stillUnmapped), closed: String(d.skippedClosed) }) : "";
                const check = r.kind === "INTEGRITY_CHECK";
                return (
                  <tr key={r.id} className={cn(shown?.id === r.id && "bg-brand-50")}>
                    <Td>{check ? <Link href={`?run=${r.id}#run`} className="text-brand-700 hover:underline">{dateTime(r.startedAt, hotel.timezone)}</Link> : dateTime(r.startedAt, hotel.timezone)}</Td>
                    <Td className="font-medium">{t(r.kind)}</Td><Td><Badge tone={TONE[r.status]}>{t(r.status)}</Badge></Td><Td>{r.finishedAt ? dateTime(r.finishedAt, hotel.timezone) : "—"}</Td>
                    <Td className="text-xs text-ink-500">{check ? <Link href={`?run=${r.id}#run`} className="hover:text-brand-700 hover:underline">{detail} →</Link> : detail}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

/** A check and, when it failed, one row per finding: the record (a link to where it is) with expected vs found. */
function CheckRows({ check: c, t, currency }: { check: NonNullable<Awaited<ReturnType<typeof integrityRun>>>["checks"][number]; t: T; currency: string }) {
  const tone = c.ok ? "green" : c.severity === "CRITICAL" ? "red" : "amber";
  return (
    <>
      <tr>
        <Td className="whitespace-normal">{t(c.label)}</Td>
        <Td><Badge tone={tone}>{c.ok ? t("PASS") : c.severity === "CRITICAL" ? t("FAIL") : t("WARNING")}</Badge></Td>
        <Td align="right" className={cn(!c.ok && "font-semibold")}>{c.count}</Td>
      </tr>
      {!c.ok && (
        <tr>
          <Td colSpan={3} className="whitespace-normal bg-ink-50/60 pb-3 pl-6">
            {c.findings ? (
              <ul className="space-y-1.5">
                {c.findings.map((f, i) => {
                  const body = (
                    <>
                      <span className="font-medium text-ink-900">{f.record}</span>
                      {f.values.map((v) => (
                        <span key={v.label} className="block text-xs text-ink-600">
                          {t(v.label)}: {t("expected")} <strong className="text-ink-900">{findingValue(v, "expected", t, currency)}</strong> · {t("found")} <strong className={cn(v.expected !== v.found && "text-red-700")}>{findingValue(v, "found", t, currency)}</strong>
                        </span>
                      ))}
                    </>
                  );
                  return (
                    <li key={i}>
                      {f.href ? (
                        <Link href={f.href} className="group flex items-start justify-between gap-3 rounded-lg border border-ink-200 bg-white px-3 py-2 hover:border-brand-300 hover:shadow-sm">
                          <span className="min-w-0">{body}</span>
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-700 group-hover:underline">{t("Open")} <ArrowRight className="h-3.5 w-3.5" /></span>
                        </Link>
                      ) : <div className="rounded-lg border border-ink-200 bg-white px-3 py-2">{body}</div>}
                    </li>
                  );
                })}
                {c.count > c.findings.length && <li className="text-xs text-ink-500">{t("The first {n} of {total} are listed.", { n: c.findings.length, total: c.count })}</li>}
              </ul>
            ) : <span className="text-xs text-ink-500">{t("This check ran before findings were linked: run the check again to list them with their records.")}</span>}
          </Td>
        </tr>
      )}
    </>
  );
}
