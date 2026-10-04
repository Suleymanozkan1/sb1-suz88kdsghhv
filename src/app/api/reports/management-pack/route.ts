import { NextResponse } from "next/server";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { managementPack } from "@/server/services/reports";
import { parseExportParams } from "@/server/excel";

export const maxDuration = 120;
export const GET = api(async ({ actor, hotelId, query }) => {
  const p = parseExportParams(query);
  const r = await managementPack(prisma, actor, hotelId, { from: p.from, to: p.to });
  return new NextResponse(new Uint8Array(r.pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${r.fileName}"`, "x-report-id": r.report.id, "x-reconciliation": r.reconciliation, "cache-control": "no-store" } });
});
