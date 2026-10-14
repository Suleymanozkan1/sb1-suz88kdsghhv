import { api } from "@/server/http/handler";
import { compSummary, createComp, listComps, type CompQuery } from "@/server/services/comps";
import { monthRange } from "@/server/page";
import { prisma } from "@/server/db";

/** The page's filters: from / to (default month-start … today), kind, reasonId, departmentId. */
function query(q: URLSearchParams): CompQuery {
  const range = monthRange({ from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
  const kind = q.get("kind");
  return { from: range.from, to: range.to, kind: kind === "ON_HOUSE" || kind === "HOSPITALITY" ? kind : null, reasonId: q.get("reasonId") || null, departmentId: q.get("departmentId") || null };
}

export const GET = api(async ({ actor, hotelId, query: q }) => {
  const f = query(q);
  const [records, summary] = await Promise.all([listComps(prisma, actor, hotelId, f), compSummary(prisma, actor, hotelId, f)]);
  return { summary, records };
}, { perm: "comp:view" });

export const POST = api(async ({ actor, hotelId, body }) => createComp(prisma, actor, hotelId, await body()), { perm: "comp:manage" });
