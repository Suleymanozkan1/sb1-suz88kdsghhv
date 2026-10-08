import { prisma } from "../../db";
import { listRuns } from "../../services/integrity";
import type { ReportDef } from "../types";

/** /integrity — the calculation runs (checks, rebuilds, reprocessing). */
export const integrity: ReportDef = {
  async load({ actor, hotelId, t }) {
    const runs = await listRuns(prisma, actor, hotelId);
    return {
      title: t("Calculation integrity"),
      fileName: "hesaplama-butunlugu",
      tables: [{
        title: t("Calculation runs"),
        columns: [{ key: "started", header: t("Started"), type: "datetime" }, { key: "kind", header: t("Kind") }, { key: "status", header: t("Status") }, { key: "finished", header: t("Finished"), type: "datetime" }, { key: "detail", header: t("Detail") }],
        rows: runs.map((r) => {
          const d = (r.details ?? {}) as Record<string, unknown>;
          const detail = r.error ? t(r.error) : d.status ? t("result {status}", { status: t(String(d.status)) }) : d.corrected !== undefined ? t("{n} corrected — {reason}", { n: String(d.corrected), reason: String(d.reason ?? "") }) : d.mapped !== undefined ? t("{mapped} mapped, {unmapped} unmapped, {closed} closed-period lines kept", { mapped: String(d.mapped), unmapped: String(d.stillUnmapped), closed: String(d.skippedClosed) }) : "";
          return { started: r.startedAt, kind: t(r.kind), status: t(r.status), finished: r.finishedAt, detail };
        }),
      }],
    };
  },
};
