/**
 * Packages (Temel / Orta / Üst): every feature is switched on per plan here, nowhere else. Prices come later;
 * this is only the switch. A self-hosted installation can set PLAN_OVERRIDE=PREMIUM (or STANDARD / BASIC).
 *
 * Trial: while the product is in its trial every tenant gets the full package (every feature open), whatever its
 * Organization.plan says. One switch, TRIAL_ALL_FEATURES (on unless set to 0 / false / off); the plans stay stored
 * and take effect the day it is turned off.
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

/** the trial switch: every feature open for every tenant (default on) */
export function trialAllFeatures(): boolean {
  return !["0", "false", "off", "no"].includes((process.env.TRIAL_ALL_FEATURES ?? "").trim().toLowerCase());
}

export function effectivePlan(orgPlan: Plan): Plan {
  const o = process.env.PLAN_OVERRIDE as Plan | undefined;
  if (o && PLANS.includes(o)) return o;
  return trialAllFeatures() ? "PREMIUM" : orgPlan;
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
