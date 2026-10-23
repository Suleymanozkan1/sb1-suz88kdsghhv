/**
 * Packages (Temel / Orta / Üst): every feature is switched on per plan here, nowhere else.
 *
 *   BASIC    core cost control: purchasing, stock, counts, recipes, waste, sales, theoretical vs actual, imports,
 *            reports & PDF pack, data quality, audit trail, reorder alerts
 *   STANDARD + the hotel-specific modules: breakfast/buffet, minibar, room cost, operating costs, on-house &
 *            hospitality, menu engineering, the Excel workbook, Micros / Opera automation
 *   PREMIUM  + planning: cost allocation, budget & targets, forecast & what-if, cost savings, e-mailed orders
 *
 * Which plan a tenant gets right now depends on its subscription (src/domain/billing.ts): the full package during
 * the trial, its own plan afterwards. Billing only applies on a SaaS installation, i.e. when a platform operator
 * organization exists; a self-hosted installation (no operator) keeps every feature, as before.
 *
 * Overrides (server environment): PLAN_OVERRIDE=BASIC|STANDARD|PREMIUM fixes the plan of every tenant (licensed
 * on-premise installs); TRIAL_ALL_FEATURES=1 opens every feature for everyone (QA, demos). TRIAL_ALL_FEATURES used
 * to default to ON; the per-tenant trial replaced it, so it is now OFF unless set.
 */
import type { Plan } from "@prisma/client";
import { DomainError } from "@/domain/errors";
import { accessState, featurePlan, type Access } from "@/domain/billing";
import { PLANS as DOMAIN_PLANS, planRank } from "@/domain/plan";
import type { Db } from "./db";
import { FEATURES, type Feature } from "@/lib/features";

export { FEATURES, FEATURE_LABEL, FEATURE_ROUTES, FEATURE_PAGES, featureForPath, featureForPage, type Feature } from "@/lib/features";

export const PLANS = DOMAIN_PLANS as Plan[];

const PLAN_OVERRIDE = () => {
  const o = process.env.PLAN_OVERRIDE as Plan | undefined;
  return o && PLANS.includes(o) ? o : null;
};

/** Explicit switch: every feature open for every tenant. Off unless set to 1 / true / on / yes. */
export function trialAllFeatures(): boolean {
  return ["1", "true", "on", "yes"].includes((process.env.TRIAL_ALL_FEATURES ?? "").trim().toLowerCase());
}

/** Environment overrides only (no subscription): kept for callers that hold just a stored plan. */
export function effectivePlan(orgPlan: Plan): Plan {
  const o = PLAN_OVERRIDE();
  if (o) return o;
  return trialAllFeatures() ? "PREMIUM" : orgPlan;
}

export const planHas = (plan: Plan, f: Feature) => planRank(effectivePlan(plan)) >= planRank(FEATURES[f]);

// ── subscription-aware plan of a tenant ──

export interface OrgBilling {
  id: string;
  plan: Plan;
  isDemo: boolean;
  isPlatform: boolean;
  trialEndsAt: Date | null;
  paidThrough: Date | null;
}

export interface TenantAccess {
  /** plan whose features are open right now */
  plan: Plan;
  /** the tenant's stored package */
  storedPlan: Plan;
  /** null: billing does not apply (self-hosted, demo, platform operator, or overridden by the environment) */
  access: Access | null;
  readOnly: boolean;
}

let billingCache: { at: number; on: boolean } | null = null;

/** Billing applies when a platform operator runs this installation (and BILLING_ENFORCEMENT is not "off"). */
export async function billingEnabled(db: Db): Promise<boolean> {
  if ((process.env.BILLING_ENFORCEMENT ?? "").toLowerCase() === "off") return false;
  if (billingCache && billingCache.at > Date.now() - 60_000) return billingCache.on;
  const on = (await db.organization.count({ where: { isPlatform: true } })) > 0;
  billingCache = { at: Date.now(), on };
  return on;
}
/** tests: forget the cached answer */
export const resetBillingCache = () => {
  billingCache = null;
};

export function tenantAccess(org: OrgBilling, billing: boolean, now: Date = new Date()): TenantAccess {
  const override = PLAN_OVERRIDE();
  if (override) return { plan: override, storedPlan: org.plan, access: null, readOnly: false };
  if (trialAllFeatures() || org.isPlatform) return { plan: "PREMIUM", storedPlan: org.plan, access: null, readOnly: false };
  // demo tenants exist to show the product; a self-hosted installation has no operator to take payments
  if (org.isDemo || !billing) return { plan: "PREMIUM", storedPlan: org.plan, access: null, readOnly: false };
  const access = accessState({ trialEndsAt: org.trialEndsAt, paidThrough: org.paidThrough }, now);
  return { plan: featurePlan(org.plan, access), storedPlan: org.plan, access, readOnly: access.readOnly };
}

const ORG_SELECT = { id: true, plan: true, isDemo: true, isPlatform: true, trialEndsAt: true, paidThrough: true } as const;

export async function organizationAccess(db: Db, organizationId: string): Promise<TenantAccess> {
  const [org, billing] = await Promise.all([db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: ORG_SELECT }), billingEnabled(db)]);
  return tenantAccess(org, billing);
}

export async function hotelAccess(db: Db, hotelId: string): Promise<TenantAccess> {
  const h = await db.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { organization: { select: ORG_SELECT } } });
  return tenantAccess(h.organization, await billingEnabled(db));
}

export async function hotelPlan(db: Db, hotelId: string): Promise<Plan> {
  return (await hotelAccess(db, hotelId)).plan;
}

export const accessHas = (a: TenantAccess, f: Feature) => planRank(a.plan) >= planRank(FEATURES[f]);

export async function hasFeature(db: Db, hotelId: string, f: Feature): Promise<boolean> {
  return accessHas(await hotelAccess(db, hotelId), f);
}

export async function requireFeature(db: Db, hotelId: string, f: Feature): Promise<void> {
  if (!(await hasFeature(db, hotelId, f))) throw new DomainError("PLAN_REQUIRED", `This feature is part of the ${FEATURES[f]} plan`, { feature: f, plan: FEATURES[f] });
}

