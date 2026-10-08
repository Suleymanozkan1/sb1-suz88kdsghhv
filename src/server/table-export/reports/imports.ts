import { prisma } from "../../db";
import { can } from "../../auth/actor";
import { IMPORT_KINDS, IMPORT_PERMISSION } from "../../services/imports";
import type { ReportDef } from "../types";

/** /imports — the automation log (Micros / Opera runs) and the file import history. */
export const imports: ReportDef = {
  async load({ actor, hotelId, t }) {
    const runs = can(actor, "sales:import") ? await prisma.integrationRun.findMany({ where: { hotelId }, orderBy: { startedAt: "desc" }, take: 500 }) : [];
    const kinds = IMPORT_KINDS.filter((k) => can(actor, IMPORT_PERMISSION[k]));
    const batches = await prisma.importBatch.findMany({ where: { hotelId, kind: { in: [...kinds] } }, orderBy: { createdAt: "desc" }, take: 500 });
    const stat = (s: unknown, f: "received" | "accepted" | "duplicates" | "errors") =>
      Object.values((s ?? {}) as Record<string, Record<string, unknown>>).reduce((a, v) => a + (f === "errors" ? ((v.errors as unknown[] | undefined)?.length ?? 0) : Number(v[f] ?? 0)), 0);
    return {
      title: t("Imports"),
      fileName: "ice-aktarma",
      tables: [
        {
          title: t("Automation log"),
          columns: [
            { key: "at", header: t("When"), type: "datetime" }, { key: "source", header: t("Source") }, { key: "day", header: t("Business day") }, { key: "status", header: t("Status") },
            { key: "kinds", header: t("Data") }, { key: "rec", header: t("Received"), type: "int" }, { key: "acc", header: t("New"), type: "int" }, { key: "dup", header: t("Already sent"), type: "int" }, { key: "err", header: t("Errors"), type: "int" }, { key: "msg", header: t("Message") },
          ],
          rows: runs.map((r) => ({ at: r.startedAt, source: r.source, day: r.businessDay, status: t(r.status), kinds: Object.keys((r.stats ?? {}) as object).map((k) => t(`ingest:${k}`)).join(", "), rec: stat(r.stats, "received"), acc: stat(r.stats, "accepted"), dup: stat(r.stats, "duplicates"), err: stat(r.stats, "errors"), msg: r.message ? t(r.message) : null })),
        },
        {
          title: t("Import history"),
          columns: [{ key: "at", header: t("When"), type: "datetime" }, { key: "kind", header: t("Data") }, { key: "file", header: t("File") }, { key: "rows", header: t("Rows"), type: "int" }, { key: "posted", header: t("Imported"), type: "int" }, { key: "status", header: t("Status") }],
          rows: batches.map((b) => ({ at: b.createdAt, kind: t(b.kind), file: b.fileName, rows: b.rowCount, posted: b.postedCount, status: b.status === "POSTED" ? t("POSTED") : t("ROLLED BACK") })),
        },
      ],
    };
  },
};
