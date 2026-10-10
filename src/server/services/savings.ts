/**
 * Cost saving opportunities (spec 199–200) and saving actions (spec 255–256).
 * Opportunities are computed from posted data; every one states its formula and its assumption
 * (configurable, shown — never a hidden threshold). Managers turn an opportunity into an action
 * with owner, due date and target, then record the realized saving.
 */
import { z } from "zod";
import { D, Decimal, ZERO, sum, toStorage } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { saving, savingTracking } from "@/domain/planning";
import { inTx, type Db } from "../db";
import { type Actor, authorize, can } from "../auth/actor";
import { audit } from "./audit";
import { assertHotelRefs } from "../auth/scope";
import { theoreticalVsActual } from "./variance";
import { inventoryStatus } from "./insights";
import { energyReport, laborReport } from "./operations";
import { menuEngineeringReport } from "./planning";
import { OCCUPYING } from "./pms";
import { stayInPeriod } from "@/domain/rooms";
import { decimalText } from "@/lib/format";

export const SAVING_DRIVERS = ["SUPPLIER_PRICE", "WASTE", "YIELD", "PORTION", "RECIPE", "OVERSTOCK", "ENERGY", "LABOR", "CHANNEL", "OTHER"] as const;
export const ACTION_STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;

/** Assumptions behind the opportunity sizes. Defaults are shown on screen and can be overridden per request. */
export interface SavingAssumptions {
  wasteReduction: number; // share of current waste that can be avoided
  unexplainedCapture: number; // share of unexplained usage recoverable through portion control
  carryingCostAnnual: number; // inventory carrying cost per year (capital, storage, spoilage)
  energyReduction: number;
  otaShiftToDirect: number; // share of OTA room nights moved to direct booking
  laborEfficiency: number;
}
export const DEFAULT_ASSUMPTIONS: SavingAssumptions = { wasteReduction: 0.25, unexplainedCapture: 0.5, carryingCostAnnual: 0.2, energyReduction: 0.05, otaShiftToDirect: 0.1, laborEfficiency: 0.03 };

export interface Opportunity {
  key: string;
  driver: (typeof SAVING_DRIVERS)[number];
  title: string;
  current: Decimal;
  potential: Decimal;
  saving: Decimal;
  savingPct: Decimal | null;
  formula: string;
  assumption: string | null;
}

export async function opportunities(db: Db, actor: Actor, hotelId: string, r: { from: Date; to: Date }, a: Partial<SavingAssumptions> = {}) {
  authorize(actor, "budget:view", { hotelId });
  const A = { ...DEFAULT_ASSUMPTIONS, ...a };
  const out: Opportunity[] = [];
  const add = (o: Omit<Opportunity, "saving" | "savingPct">) => {
    const s = saving(o.current, o.potential);
    if (s.saving.gt(0.005)) out.push({ ...o, saving: s.saving, savingPct: s.savingPct });
  };
  const days = Math.max(1, Math.trunc((r.to.getTime() - r.from.getTime()) / 86_400_000 + 0.5));

  // 1. supplier price: paid average vs cheapest current supplier price (normalized per stock unit)
  if (can(actor, "purchase:prices")) {
    const items = await db.goodsReceiptItem.groupBy({ by: ["productId"], where: { receipt: { hotelId, receiptDate: { gte: r.from, lt: r.to } } }, _sum: { stockQty: true, landedAmount: true } });
    const latest = await db.$queryRaw<Array<{ productId: string; supplierId: string; unitPrice: { toString(): string } }>>`
      SELECT DISTINCT ON ("productId", "supplierId") "productId", "supplierId", "unitPrice" FROM "SupplierPrice"
      WHERE "hotelId" = ${hotelId} AND "priceDate" < ${r.to} ORDER BY "productId", "supplierId", "priceDate" DESC`;
    const products = new Map((await db.product.findMany({ where: { hotelId, id: { in: items.map((i) => i.productId) } }, select: { id: true, name: true, stockUnit: true } })).map((p) => [p.id, p]));
    for (const it of items) {
      const qty = D(it._sum.stockQty?.toString() ?? 0);
      if (!qty.gt(0)) continue;
      const prices = latest.filter((l) => l.productId === it.productId).map((l) => D(l.unitPrice.toString()));
      if (prices.length < 2) continue;
      const best = prices.reduce((m, p) => (p.lt(m) ? p : m));
      const paid = D(it._sum.landedAmount?.toString() ?? 0);
      const p = products.get(it.productId);
      add({ key: `SUPPLIER:${it.productId}`, driver: "SUPPLIER_PRICE", title: `${p?.name ?? "Product"}: buy at the cheapest supplier price`, current: paid, potential: best.times(qty), formula: `paid ${paid.div(qty).toFixed(2)} vs best ${best.toFixed(2)} per ${p?.stockUnit ?? "unit"} × ${qty.toFixed(1)}`, assumption: "Same quality and terms at the cheapest supplier" });
    }
  }

  if (can(actor, "variance:view")) {
    const v = await theoreticalVsActual(db, actor, hotelId, r);
    // 2. waste
    add({ key: "WASTE", driver: "WASTE", title: "Reduce recorded waste", current: v.totals.waste, potential: v.totals.waste.times(D(1).minus(A.wasteReduction)), formula: "recorded waste × (1 − reduction)", assumption: `${(A.wasteReduction * 100).toFixed(0)} % of waste avoidable` });
    // 3. portion control on unexplained usage (top products)
    for (const p of v.products.filter((x) => x.unexplainedValue.gt(0)).slice(0, 5)) {
      add({ key: `PORTION:${p.productId}`, driver: "PORTION", title: `${p.name}: portion control / unrecorded usage`, current: p.unexplainedValue, potential: p.unexplainedValue.times(D(1).minus(A.unexplainedCapture)), formula: "unexplained usage (actual − theoretical − waste − staff − comp − buffet − minibar) × (1 − capture)", assumption: `${(A.unexplainedCapture * 100).toFixed(0)} % recoverable` });
    }
  }

  // 4. yield: actual yield below standard
  const yields = await db.yieldRecord.findMany({ where: { hotelId, recordDate: { gte: r.from, lt: r.to } }, include: { product: true } });
  const yByProduct = new Map<string, { name: string; loss: Decimal }>();
  for (const y of yields) {
    const loss = D(y.varianceCost.toString());
    if (!loss.gt(0)) continue;
    const cur = yByProduct.get(y.productId) ?? { name: y.product.name, loss: ZERO };
    yByProduct.set(y.productId, { name: cur.name, loss: cur.loss.plus(loss) });
  }
  for (const [id, y] of yByProduct) add({ key: `YIELD:${id}`, driver: "YIELD", title: `${y.name}: bring yield back to standard`, current: y.loss, potential: ZERO, formula: "Σ yield tests: (expected − actual yield) × AP qty × unit cost", assumption: "Standard yield is achievable (training, supplier spec)" });

  // 5. recipe optimisation: sellers below the margin target
  if (can(actor, "recipe:view")) {
    const me = await menuEngineeringReport(db, actor, hotelId, r);
    for (const i of me.items.filter((x) => x.belowMarginTarget).slice(0, 8)) {
      const targetCost = i.revenue.times(D(1).minus(me.marginTarget));
      add({ key: `RECIPE:${i.id}`, driver: "RECIPE", title: `${i.name}: re-engineer to the ${me.marginTarget.times(100).toFixed(0)} % margin target`, current: i.cost, potential: targetCost, formula: "recipe cost of units sold vs revenue × (1 − margin target)", assumption: "Recipe / portion change without price change" });
    }
  }

  // 6. overstock: carrying cost of stock above max
  if (can(actor, "inventory:view")) {
    const inv = await inventoryStatus(db, actor, hotelId);
    const over = inv.rows.filter((x) => x.deadStock); // overstock is no longer a stock status (r2 §1); this screen is not reviewed yet
    const value = sum(over.map((x) => x.value));
    const monthlyCarry = value.times(A.carryingCostAnnual).times(days).div(365); // carrying cost for the period
    add({ key: "OVERSTOCK", driver: "OVERSTOCK", title: `Reduce overstock & dead stock (${over.length} items, ${value.toFixed(0)} in stock)`, current: monthlyCarry, potential: ZERO, formula: "stock value above max / idle > 60 days × carrying cost", assumption: `${(A.carryingCostAnnual * 100).toFixed(0)} % carrying cost per year` });
  }

  if (can(actor, "opex:view") && actor.departmentIds === "ALL") {
    const [en, lab] = await Promise.all([energyReport(db, actor, hotelId, r), laborReport(db, actor, hotelId, r)]);
    // 7. energy
    if (en.total.gt(0)) add({ key: "ENERGY", driver: "ENERGY", title: "Energy efficiency programme", current: en.total, potential: en.total.times(D(1).minus(A.energyReduction)), formula: "utility cost × (1 − reduction)", assumption: `${(A.energyReduction * 100).toFixed(0)} % reduction (set-points, timers, leaks)` });
    // 8. labor
    if (lab.total.gt(0)) {
      const tgt = await db.costTarget.findFirst({ where: { hotelId, metric: "LABOR_COST_PCT", active: true, departmentId: null } });
      const potential = tgt && lab.totalRevenue.gt(0) ? lab.totalRevenue.times(tgt.target.toString()) : lab.total.times(D(1).minus(A.laborEfficiency));
      add({ key: "LABOR", driver: "LABOR", title: tgt ? `Bring labor to the ${D(tgt.target.toString()).times(100).toFixed(1)} % target` : "Labor scheduling efficiency", current: lab.total, potential, formula: tgt ? "revenue × labor cost % target" : "labor × (1 − efficiency)", assumption: tgt ? "Configured target" : `${(A.laborEfficiency * 100).toFixed(0)} % efficiency` });
    }
  }

  // 9. channel: shift OTA nights to direct
  if (can(actor, "rooms:view") && actor.departmentIds === "ALL") {
    const stays = await db.reservation.findMany({ where: { hotelId, status: { in: OCCUPYING }, arrival: { lt: r.to }, departure: { gt: r.from } } });
    const ota = stays.filter((s) => s.channel === "OTA").map((s) => stayInPeriod({ ...s, grossRoomRevenue: s.grossRoomRevenue.toString(), commission: s.commission.toString(), paymentFee: s.paymentFee.toString(), otherDistribution: s.otherDistribution.toString() }, r.from, r.to));
    const direct = stays.filter((s) => s.channel === "DIRECT").map((s) => stayInPeriod({ ...s, grossRoomRevenue: s.grossRoomRevenue.toString(), commission: s.commission.toString(), paymentFee: s.paymentFee.toString(), otherDistribution: s.otherDistribution.toString() }, r.from, r.to));
    const otaCost = sum(ota.map((x) => x.distribution));
    const otaGross = sum(ota.map((x) => x.gross));
    const directRate = sum(direct.map((x) => x.gross)).gt(0) ? sum(direct.map((x) => x.distribution)).div(sum(direct.map((x) => x.gross))) : ZERO;
    if (otaGross.gt(0)) {
      const shifted = otaGross.times(A.otaShiftToDirect);
      const potential = otaCost.minus(otaCost.times(A.otaShiftToDirect)).plus(shifted.times(directRate));
      add({ key: "CHANNEL", driver: "CHANNEL", title: "Shift OTA bookings to direct", current: otaCost, potential, formula: "OTA commission & fees − shifted share + direct payment fees on the shifted revenue", assumption: `${(A.otaShiftToDirect * 100).toFixed(0)} % of OTA revenue moves to direct` });
    }
  }
  out.sort((x, y) => y.saving.comparedTo(x.saving));
  const actions = await db.savingAction.findMany({ where: { hotelId, opportunityKey: { in: out.map((o) => o.key) }, status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { opportunityKey: true, id: true } });
  return { assumptions: A, opportunities: out.map((o) => ({ ...o, actionId: actions.find((x) => x.opportunityKey === o.key)?.id ?? null })), total: sum(out.map((o) => o.saving)) };
}

// ── Saving actions ──
const dec = z.union([z.string(), z.number()]).transform(decimalText).refine((v) => v !== "" && Number.isFinite(Number(v)), "Must be a number");
export const actionInput = z.object({
  driver: z.enum(SAVING_DRIVERS),
  problem: z.string().trim().min(3).max(300),
  rootCause: z.string().trim().max(500).nullable().optional(),
  action: z.string().trim().min(3).max(500),
  departmentId: z.string().min(1).nullable().optional(),
  ownerName: z.string().trim().min(2).max(120),
  baselineCost: dec.nullable().optional(),
  targetSaving: dec.refine((v) => Number(v) > 0, "Target saving must be positive"),
  dueDate: z.coerce.date(),
  opportunityKey: z.string().max(120).nullable().optional(),
});
export const actionUpdate = z.object({ status: z.enum(ACTION_STATUSES).optional(), actualSaving: dec.nullable().optional(), rootCause: z.string().trim().max(500).nullable().optional(), action: z.string().trim().min(3).max(500).optional(), dueDate: z.coerce.date().optional() });

export async function createAction(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "savings:manage", { hotelId }); // permission first: unauthorised callers learn nothing about the payload
  const v = actionInput.parse(raw);
  authorize(actor, "savings:manage", { hotelId, ...(v.departmentId ? { departmentId: v.departmentId } : {}) });
  return inTx(db, async (tx) => {
    await assertHotelRefs(tx, hotelId, { departmentIds: [v.departmentId] });
    // one open action per opportunity (a double click or two managers at once must not create two): serialize per key, then check
    if (v.opportunityKey) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${hotelId}|saving|${v.opportunityKey}`}, 0))`;
    if (v.opportunityKey && (await tx.savingAction.findFirst({ where: { hotelId, opportunityKey: v.opportunityKey, status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { id: true } }))) throw new DomainError("CONFLICT", "An open saving action already exists for this opportunity");
    const a = await tx.savingAction.create({ data: { hotelId, driver: v.driver, problem: v.problem, rootCause: v.rootCause ?? null, action: v.action, departmentId: v.departmentId ?? null, ownerName: v.ownerName, baselineCost: v.baselineCost ? toStorage(D(v.baselineCost)).toString() : null, targetSaving: toStorage(D(v.targetSaving)).toString(), dueDate: v.dueDate, opportunityKey: v.opportunityKey ?? null, createdById: actor.userId } });
    await audit(tx, actor, { hotelId, action: "SAVING_ACTION_CREATE", entityType: "SavingAction", entityId: a.id, after: a });
    return a;
  });
}

export async function updateAction(db: Db, actor: Actor, hotelId: string, id: string, raw: unknown) {
  authorize(actor, "savings:manage", { hotelId });
  const v = actionUpdate.parse(raw);
  return inTx(db, async (tx) => {
    const a = await tx.savingAction.findFirst({ where: { id, hotelId } });
    if (!a) throw new DomainError("NOT_FOUND", "Action not found");
    if (a.departmentId) authorize(actor, "savings:manage", { hotelId, departmentId: a.departmentId });
    if (a.status === "DONE" || a.status === "CANCELLED") throw new DomainError("CONFLICT", "Closed actions cannot be changed");
    if (v.status === "DONE" && (v.actualSaving ?? a.actualSaving) === null) throw new DomainError("VALIDATION", "Record the realized saving before closing the action");
    const after = await tx.savingAction.update({ where: { id }, data: { ...(v.status ? { status: v.status } : {}), ...(v.actualSaving !== undefined ? { actualSaving: v.actualSaving === null ? null : toStorage(D(v.actualSaving)).toString() } : {}), ...(v.rootCause !== undefined ? { rootCause: v.rootCause } : {}), ...(v.action ? { action: v.action } : {}), ...(v.dueDate ? { dueDate: v.dueDate } : {}), ...(v.status === "DONE" || v.status === "CANCELLED" ? { closedAt: new Date() } : {}) } });
    await audit(tx, actor, { hotelId, action: "SAVING_ACTION_UPDATE", entityType: "SavingAction", entityId: id, before: { status: a.status, actualSaving: a.actualSaving?.toString() ?? null }, after: { status: after.status, actualSaving: after.actualSaving?.toString() ?? null } });
    return after;
  });
}

export async function listActions(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "budget:view", { hotelId });
  const rows = await db.savingAction.findMany({ where: { hotelId, ...(actor.departmentIds === "ALL" ? {} : { OR: [{ departmentId: null }, { departmentId: { in: [...actor.departmentIds] } }] }) }, orderBy: [{ status: "asc" }, { dueDate: "asc" }] });
  const now = Date.now();
  const items = rows.map((r) => ({ ...r, tracking: savingTracking(r.targetSaving.toString(), r.actualSaving?.toString() ?? null), overdue: (r.status === "OPEN" || r.status === "IN_PROGRESS") && r.dueDate.getTime() < now }));
  const live = items.filter((i) => i.status !== "CANCELLED");
  return { items, totals: { expected: sum(live.map((i) => i.tracking.expected)), realized: sum(live.map((i) => i.tracking.realized ?? ZERO)), open: items.filter((i) => i.status === "OPEN" || i.status === "IN_PROGRESS").length, overdue: items.filter((i) => i.overdue).length } };
}
