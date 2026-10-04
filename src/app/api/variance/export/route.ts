import { NextResponse } from "next/server";
import { api, dateParam } from "@/server/http/handler";
import { theoreticalVsActual, serializeVariance } from "@/server/services/variance";
import { authorize } from "@/server/auth/actor";
import { csvSafe } from "@/server/util/csv";
import { audit } from "@/server/services/audit";
import { prisma } from "@/server/db";

/** Export is a separate permission from viewing (spec §243). */
export const GET = api(async ({ actor, hotelId, query }) => {
  authorize(actor, "report:export", { hotelId });
  const now = new Date();
  const from = dateParam(query, "from", new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const to = dateParam(query, "to", now);
  const r = serializeVariance(await theoreticalVsActual(prisma, actor, hotelId, { from, to, departmentId: query.get("departmentId") || null }));
  const header = ["SKU", "Product", "Unit", "Group", "Opening Qty", "Purchases Qty", "Transfer In", "Transfer Out", "Closing Qty", "Actual Qty", "Actual Value", "Theoretical Qty", "Theoretical Value", "Waste Qty", "Waste Value", "Variance Qty", "Variance Value", "Unexplained Qty", "Unexplained Value"];
  const lines = r.products.map((p) => [p.sku, p.name, p.unit, p.categoryGroup, p.opening.qty, p.purchases.qty, p.transfersIn.qty, p.transfersOut.qty, p.closing.qty, p.actual.qty, p.actual.value, p.theoreticalQty, p.theoreticalValue, p.waste.qty, p.waste.value, p.varianceQty, p.varianceValue, p.unexplainedQty, p.unexplainedValue].map((v) => csvSafe(String(v ?? ""))).join(","));
  await audit(prisma, actor, { hotelId, action: "REPORT_EXPORT", entityType: "Report", entityId: "variance", after: { from, to, rows: lines.length } });
  return new NextResponse([header.join(","), ...lines].join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="variance-${from.toISOString().slice(0, 10)}.csv"` } });
});
