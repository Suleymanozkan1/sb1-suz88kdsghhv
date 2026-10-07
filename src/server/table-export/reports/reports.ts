import { prisma } from "../../db";
import { listReports } from "../../services/reports";
import type { ReportDef } from "../types";

const LABEL: Record<string, string> = { FULL_COST_EXPORT: "Full cost export (Excel / API)", MANAGEMENT_PACK: "Management pack (PDF)", PERIOD_CLOSE: "Period close snapshot" };

/** /reports — the archive of generated reports. */
export const reports: ReportDef = {
  async load({ actor, hotelId, t }) {
    const rows = await listReports(prisma, actor, hotelId);
    return {
      title: t("Reports"),
      fileName: "raporlar",
      tables: [{
        title: t("Archive ({n})", { n: rows.length }),
        columns: [
          { key: "generated", header: t("Generated"), type: "datetime" }, { key: "report", header: t("Report") }, { key: "from", header: t("From"), type: "date" }, { key: "to", header: t("To"), type: "date" },
          { key: "period", header: t("Period") }, { key: "by", header: t("By") }, { key: "filters", header: t("Filters") }, { key: "hash", header: t("Period hash") }, { key: "v", header: "v", type: "int" },
        ],
        rows: rows.map((r) => {
          const f = (r.params ?? {}) as Record<string, string | null>;
          return {
            generated: r.generatedAt,
            report: t(LABEL[r.reportType] ?? r.reportType),
            from: r.periodFrom,
            to: r.periodFrom && r.periodTo ? new Date(r.periodTo.getTime() - 86400000) : null,
            period: r.period ? `${r.period.code} ${t(r.period.status)}` : "",
            by: r.generatedBy,
            filters: Object.entries(f).filter(([, v]) => v).map(([k]) => k).join(", ") || t("none"),
            hash: r.periodHash ? r.periodHash.slice(0, 12) : "",
            v: r.dataVersion,
          };
        }),
      }],
    };
  },
};
