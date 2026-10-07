import { prisma } from "../../db";
import { listRules, listRuns, previewPeriodAllocation } from "../../services/allocation";
import { periodFor } from "../../services/period";
import { DRIVER_LABEL } from "@/domain/allocation";
import { dateTime } from "@/lib/format";
import { isDomainError } from "@/domain/errors";
import { translateMessage, type T } from "@/i18n/core";
import type { ReportDef, XTable } from "../types";

/** Driver basis text from the allocation service; the sub-meter variant carries the utility name. */
function tBasis(t: T, s: string): string {
  const m = /^(\w+) meter consumption$/.exec(s);
  return m ? t("{utility} meter consumption", { utility: t(m[1]!.toUpperCase()) }) : t(s);
}

/** /allocation — rules, the preview of the chosen period (?periodId) and the posted runs. */
export const allocation: ReportDef = {
  async load({ actor, hotelId, hotel, locale, t, q }) {
    const rules = await listRules(prisma, actor, hotelId);
    const [departments, periods, runs] = await Promise.all([
      prisma.department.findMany({ where: { hotelId, active: true }, orderBy: { name: "asc" } }),
      prisma.costPeriod.findMany({ where: { hotelId }, orderBy: { startDate: "desc" }, take: 18 }),
      listRuns(prisma, actor, hotelId),
    ]);
    const periodId = q.get("periodId");
    const current = periodId ? periods.find((p) => p.id === periodId) : (periods.find((p) => p.startDate <= new Date() && p.endDate >= new Date()) ?? (await periodFor(prisma, hotelId, new Date())));
    const deptName = new Map(departments.map((d) => [d.id, d.name]));

    const tables: XTable[] = [{
      title: t("Rules ({n})", { n: rules.length }),
      columns: [{ key: "rule", header: t("Rule") }, { key: "source", header: t("Source") }, { key: "driver", header: t("Driver") }, { key: "targets", header: t("Destinations") }, { key: "priority", header: t("Priority"), type: "int" }, { key: "status", header: t("Status") }],
      rows: rules.map((r) => ({
        rule: r.name,
        source: `${t(r.sourceCategoryGroup)}${r.sourceSubCategory ? ` / ${t(r.sourceSubCategory)}` : ""} ${t("from {source}", { source: r.sourceDepartmentId ? deptName.get(r.sourceDepartmentId) : t("hotel level") })}`,
        driver: t(DRIVER_LABEL[r.driver as keyof typeof DRIVER_LABEL] ?? r.driver),
        targets: (r.targets as Array<{ departmentId: string; weight: string | null }>).map((x) => `${deptName.get(x.departmentId) ?? "?"}${x.weight ? ` (${x.weight})` : ""}`).join(", "),
        priority: r.priority,
        status: r.active ? t("active") : t("disabled"),
      })),
    }];

    const filters: Array<[string, string]> = [];
    const previewCols: XTable["columns"] = [
      { key: "rule", header: t("Rule") }, { key: "source", header: t("Source") }, { key: "sourceCost", header: t("Source cost"), type: "money" }, { key: "driver", header: t("Driver") },
      { key: "destination", header: t("Destination") }, { key: "driverQty", header: t("Driver qty"), type: "qty" }, { key: "share", header: t("Share"), type: "pct" }, { key: "amount", header: t("Allocated"), type: "money" },
    ];
    if (!current) {
      tables.push({ title: t("Preview"), columns: [{ key: "msg", header: t("Preview") }], rows: [{ msg: t("No period") }] });
    } else {
      try {
        const pv = await previewPeriodAllocation(prisma, actor, hotelId, current.id);
        filters.push([t("Period"), `${pv.period.code} (${t(pv.period.status)})`]);
        if (pv.postedRun) filters.push([t("Status"), t("posted {when}", { when: dateTime(pv.postedRun.createdAt, hotel.timezone) })]);
        const problems = pv.preview.rules.filter((r) => r.problem || r.skipped.length);
        tables.push({
          title: `${t("Preview")} · ${pv.period.code}`,
          columns: previewCols,
          rows: pv.preview.lines.map((l) => ({
            rule: l.rule,
            source: `${l.sourceCategory.split("/").map((c) => t(c)).join("/")} · ${l.sourceDepartment === "Hotel (unassigned)" ? t(l.sourceDepartment) : l.sourceDepartment}`,
            sourceCost: l.sourceCost, driver: tBasis(t, l.basis), destination: l.destination, driverQty: l.driverQty, share: l.share.times(100), amount: l.amount,
          })),
          totals: { rule: t("to allocate"), amount: pv.preview.total },
        });
        if (problems.length) {
          tables.push({
            title: t("Warnings"),
            columns: [{ key: "rule", header: t("Rule") }, { key: "problem", header: t("Warnings") }],
            rows: problems.map((r) => ({ rule: r.rule, problem: r.problem ?? t("no driver quantity for {names} (left out)", { names: r.skipped.join(", ") }) })),
          });
        }
      } catch (e) {
        if (!isDomainError(e)) throw e;
        tables.push({ title: t("Preview"), columns: [{ key: "msg", header: t("Preview") }], rows: [{ msg: translateMessage(locale, e.message) }] });
      }
    }

    tables.push({
      title: t("Posted runs"),
      columns: [{ key: "period", header: t("Period") }, { key: "posted", header: t("Posted"), type: "datetime" }, { key: "amount", header: t("Allocated"), type: "money" }, { key: "status", header: t("Status") }],
      rows: runs.map((r) => ({ period: r.periodCode, posted: r.createdAt, amount: r.totalAllocated, status: r.status === "POSTED" ? t("POSTED") : `${t("REVERSED")}${r.reverseReason ? ` · ${r.reverseReason}` : ""}` })),
    });

    return { title: t("Cost allocation"), fileName: "maliyet-dagitimi", filters, tables };
  },
};
