/**
 * Packages (Temel / Orta / Üst): every feature is switched on per plan here, nowhere else. Prices come later;
 * this is only the switch. A self-hosted installation can set PLAN_OVERRIDE=PREMIUM (or STANDARD / BASIC).
 */
import type { Plan } from "@prisma/client";
import { DomainError } from "@/domain/errors";
import type { Db } from "./db";

export const PLANS: Plan[] = ["BASIC", "STANDARD", "PREMIUM"];

/** feature → lowest plan that includes it */
export const FEATURES = {
  /** list of products at their reorder point (all plans) */
  reorderAlerts: "BASIC",
  /** Micros / Opera automation (import API, nightly runs, run log) */
  integrations: "BASIC",
  /** orders e-mailed to suppliers automatically when stock reaches the reorder point */
  autoOrderEmail: "PREMIUM",
} as const satisfies Record<string, Plan>;
export type Feature = keyof typeof FEATURES;

const rank = (p: Plan) => PLANS.indexOf(p);

export function effectivePlan(orgPlan: Plan): Plan {
  const o = process.env.PLAN_OVERRIDE as Plan | undefined;
  return o && PLANS.includes(o) ? o : orgPlan;
}

export const planHas = (plan: Plan, f: Feature) => rank(effectivePlan(plan)) >= rank(FEATURES[f]);

export async function hotelPlan(db: Db, hotelId: string): Promise<Plan> {
  const h = await db.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { organization: { select: { plan: true } } } });
  return effectivePlan(h.organization.plan);
}

export async function hasFeature(db: Db, hotelId: string, f: Feature): Promise<boolean> {
  return planHas(await hotelPlan(db, hotelId), f);
}

export async function requireFeature(db: Db, hotelId: string, f: Feature): Promise<void> {
  if (!(await hasFeature(db, hotelId, f))) throw new DomainError("FORBIDDEN", `This feature is part of the ${FEATURES[f]} plan`);
}
