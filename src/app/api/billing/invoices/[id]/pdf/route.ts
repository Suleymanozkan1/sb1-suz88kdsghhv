import { NextResponse } from "next/server";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { billingInvoicePdf } from "@/server/services/billing-pdf";

export const dynamic = "force-dynamic";

/** The payment notice as PDF (the company's own; the platform operator: any). */
export const GET = api(async ({ actor, params }) => {
  const { fileName, pdf } = await billingInvoicePdf(prisma, actor, params.id!);
  return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${fileName}"`, "cache-control": "no-store" } });
});
