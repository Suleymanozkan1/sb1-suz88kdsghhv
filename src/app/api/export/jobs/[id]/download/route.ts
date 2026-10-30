import { NextResponse } from "next/server";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { downloadExportJob } from "@/server/services/export-jobs";
import { assertResponseSize } from "@/server/export-limits";

export const dynamic = "force-dynamic";
export const GET = api(async ({ actor, hotelId, params }) => {
  const r = await downloadExportJob(prisma, actor, hotelId, params.id!);
  assertResponseSize(r.file.length);
  return new NextResponse(new Uint8Array(r.file), {
    headers: {
      "content-type": "application/vnd.ms-excel.sheet.macroEnabled.12",
      "content-disposition": `attachment; filename="${r.fileName}"`,
      "cache-control": "no-store",
      ...(r.exportId ? { "x-export-id": r.exportId } : {}),
      ...(r.reconciliation ? { "x-reconciliation": r.reconciliation } : {}),
    },
  });
});
