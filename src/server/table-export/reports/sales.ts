import { prisma } from "../../db";
import type { ReportDef } from "../types";

/** /sales — the last 20 POS sales imports. */
export const sales: ReportDef = {
  perm: "sales:import",
  async load({ hotelId, t }) {
    const imports = await prisma.salesImport.findMany({ where: { hotelId }, orderBy: { createdAt: "desc" }, take: 20 });
    return {
      title: t("Sales import (cost input)"),
      fileName: "satis-aktarimi",
      tables: [{
        title: t("Import history"),
        columns: [
          { key: "date", header: t("Date"), type: "datetime" }, { key: "file", header: t("File") }, { key: "source", header: t("Source") }, { key: "rows", header: t("Rows"), type: "int" },
          { key: "valid", header: t("Valid"), type: "int" }, { key: "invalid", header: t("Invalid"), type: "int" }, { key: "dup", header: t("Duplicates"), type: "int" }, { key: "status", header: t("Status") },
        ],
        rows: imports.map((i) => ({ date: i.createdAt, file: i.fileName ?? "—", source: i.source, rows: i.rowCount, valid: i.validCount, invalid: i.invalidCount, dup: i.duplicateCount, status: t(i.status) })),
      }],
    };
  },
};
