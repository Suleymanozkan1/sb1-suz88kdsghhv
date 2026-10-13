import { prisma } from "../../db";
import { integrityRun, listRuns, type FindingValue } from "../../services/integrity";
import { money, qty } from "@/lib/format";
import type { T } from "@/i18n/core";
import type { ReportDef } from "../types";
import { NAV } from "@/components/nav";

const value = (v: FindingValue, x: string, t: T, currency: string) => (v.kind === "text" ? t(x) : v.kind === "money" ? money(x, currency) : v.kind === "qty" ? qty(x, v.unit) : x);

/** The page a finding opens, by its menu name (the longest menu path the link starts with). */
const pageOf = (href: string | null) => {
  const path = href?.split(/[?#]/)[0];
  return path ? NAV.filter((n) => n.href !== "/" && (path === n.href || path.startsWith(`${n.href}/`))).sort((a, b) => b.href.length - a.href.length)[0]?.label ?? path : "";
};

/** /integrity — the check on screen (`run`, else the last one) with every finding, and the calculation runs. */
export const integrity: ReportDef = {
  async load({ actor, hotelId, hotel, t, q }) {
    const [runs, shown] = await Promise.all([listRuns(prisma, actor, hotelId), integrityRun(prisma, actor, hotelId, q.get("run"))]);
    const result = (ok: boolean, severity: string) => (ok ? t("PASS") : severity === "CRITICAL" ? t("FAIL") : t("WARNING"));
    return {
      title: t("Calculation integrity"),
      fileName: "hesaplama-butunlugu",
      filters: shown ? [[t("Integrity check"), `${shown.startedAt.toISOString().slice(0, 16).replace("T", " ")} · ${shown.result ? t(shown.result) : "—"} · ${t("Findings: {n}", { n: shown.findings })}`]] : undefined,
      tables: [
        ...(shown ? [
          {
            title: t("Checks"),
            columns: [{ key: "check", header: t("Check") }, { key: "result", header: t("Result") }, { key: "count", header: t("Findings"), type: "int" as const }],
            rows: shown.checks.map((c) => ({ check: t(c.label), result: result(c.ok, c.severity), count: c.count })),
          },
          {
            title: t("Findings"),
            columns: [{ key: "check", header: t("Check") }, { key: "record", header: t("Record") }, { key: "value", header: t("Value") }, { key: "expected", header: t("Expected") }, { key: "found", header: t("Found") }, { key: "where", header: t("Where") }],
            rows: shown.checks.filter((c) => !c.ok).flatMap((c) => (c.findings ?? []).flatMap((f) => (f.values.length ? f.values : [null]).map((v) => ({
              check: t(c.label),
              record: f.record,
              value: v ? t(v.label) : "",
              expected: v ? value(v, v.expected, t, hotel.baseCurrency) : "",
              found: v ? value(v, v.found, t, hotel.baseCurrency) : "",
              where: pageOf(f.href) ? t(pageOf(f.href)) : "",
            })))),
          },
        ] : []),
        {
          title: t("Calculation runs"),
          columns: [{ key: "started", header: t("Started"), type: "datetime" }, { key: "kind", header: t("Kind") }, { key: "status", header: t("Status") }, { key: "finished", header: t("Finished"), type: "datetime" }, { key: "detail", header: t("Detail") }],
          rows: runs.map((r) => {
            const d = (r.details ?? {}) as Record<string, unknown>;
            const detail = r.error ? t(r.error) : d.status ? t("result {status}", { status: t(String(d.status)) }) : d.corrected !== undefined ? t("{n} corrected — {reason}", { n: String(d.corrected), reason: String(d.reason ?? "") }) : d.mapped !== undefined ? t("{mapped} mapped, {unmapped} unmapped, {closed} closed-period lines kept", { mapped: String(d.mapped), unmapped: String(d.stillUnmapped), closed: String(d.skippedClosed) }) : "";
            return { started: r.startedAt, kind: t(r.kind), status: t(r.status), finished: r.finishedAt, detail };
          }),
        },
      ],
    };
  },
};
