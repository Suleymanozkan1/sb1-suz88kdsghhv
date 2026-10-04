/**
 * The demo bulk-ledger engine must write exactly what the real posting services write.
 * One scenario covers opening, purchase (exact landed total), transfers, issues at average,
 * emptying issue (no rounding residue), allowed negative stock, receipt into negative stock,
 * waste, staff meal, adjustments and count adjustments.
 */
import { describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postMovement, transferStock } from "@/server/services/ledger";
import { periodFor } from "@/server/services/period";
import { BulkLedger, type EngineMovement } from "@/server/demo/engine";
import { D } from "@/domain/money";

type Op = { kind: "mv"; m: Omit<EngineMovement, "warehouseId" | "productId"> & { wh: "main" | "rest"; p: "beef" | "milk" } } | { kind: "tr"; from: "main" | "rest"; to: "main" | "rest"; p: "beef" | "milk"; q: string; d: Date };

const SCENARIO: Op[] = [
  { kind: "mv", m: { wh: "main", p: "beef", type: "OPENING", quantity: "40", unitCost: "512.3333", txDate: day("2026-09-01"), sourceType: "MANUAL" } },
  { kind: "mv", m: { wh: "main", p: "milk", type: "OPENING", quantity: "12", unitCost: "31.5", txDate: day("2026-09-01"), sourceType: "MANUAL" } },
  { kind: "mv", m: { wh: "main", p: "beef", type: "PURCHASE", quantity: "30", exactTotal: "16123.456789", txDate: day("2026-09-02"), sourceType: "GOODS_RECEIPT" } },
  { kind: "tr", from: "main", to: "rest", p: "beef", q: "17.333", d: day("2026-09-03") },
  { kind: "mv", m: { wh: "rest", p: "beef", type: "CONSUMPTION", quantity: "-9.125", txDate: day("2026-09-03"), sourceType: "MANUAL" } },
  { kind: "mv", m: { wh: "rest", p: "beef", type: "WASTE", quantity: "-0.75", txDate: day("2026-09-04"), sourceType: "WASTE" } },
  { kind: "mv", m: { wh: "rest", p: "beef", type: "STAFF_MEAL", quantity: "-1.2", txDate: day("2026-09-04"), sourceType: "MANUAL" } },
  { kind: "mv", m: { wh: "rest", p: "beef", type: "CONSUMPTION", quantity: "-6.258", txDate: day("2026-09-05"), sourceType: "MANUAL" } }, // empties the store exactly
  { kind: "tr", from: "main", to: "rest", p: "milk", q: "5", d: day("2026-09-05") },
  { kind: "mv", m: { wh: "rest", p: "milk", type: "CONSUMPTION", quantity: "-7", txDate: day("2026-09-06"), sourceType: "MANUAL", allowNegative: true } }, // into negative
  { kind: "mv", m: { wh: "main", p: "milk", type: "PURCHASE", quantity: "24", unitCost: "33.75", txDate: day("2026-09-07"), sourceType: "GOODS_RECEIPT" } },
  { kind: "tr", from: "main", to: "rest", p: "milk", q: "10", d: day("2026-09-07") }, // receipt into negative stock
  { kind: "mv", m: { wh: "rest", p: "milk", type: "ADJUSTMENT", quantity: "0.5", txDate: day("2026-09-08"), sourceType: "MANUAL", reason: "found" } },
  { kind: "mv", m: { wh: "main", p: "beef", type: "COUNT_ADJUSTMENT", quantity: "-0.411", txDate: day("2026-09-30"), sourceType: "COUNT" } },
  { kind: "mv", m: { wh: "main", p: "beef", type: "PURCHASE", quantity: "12.5", unitCost: "548.12", txDate: day("2026-09-30"), sourceType: "GOODS_RECEIPT" } },
];

async function setup(label: string) {
  const h = await makeHotel(label);
  const cc = await h.actor("cost_controller");
  const beef = await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "BEEF", name: "Beef" });
  const milk = await makeProduct(h.hotel.id, h.cats.bev.id, { sku: "MILK", name: "Milk", stockUnit: "l" });
  return { h, cc, P: { beef: beef.id, milk: milk.id }, W: { main: h.wh.main.id, rest: h.wh.restStore.id } };
}

const norm = (rows: Array<Record<string, unknown>>, map: Map<string, string>) =>
  rows.map((r) => ({
    type: r.type,
    wh: map.get(String(r.warehouseId)),
    p: map.get(String(r.productId)),
    dept: r.departmentId ? map.get(String(r.departmentId)) : null,
    quantity: String(r.quantity),
    unitCost: String(r.unitCost),
    totalCost: String(r.totalCost),
    balanceQtyAfter: String(r.balanceQtyAfter),
    balanceValueAfter: String(r.balanceValueAfter),
    avgCostAfter: String(r.avgCostAfter),
  }));

describe("demo bulk ledger = real posting services", () => {
  it("writes identical stock rows, cost-ledger rows and balances for the same scenario", async () => {
    const real = await setup("ENG-REAL");
    for (const op of SCENARIO) {
      if (op.kind === "tr") await transferStock(prisma, real.cc, { hotelId: real.h.hotel.id, fromWarehouseId: real.W[op.from], toWarehouseId: real.W[op.to], productId: real.P[op.p], quantity: op.q, txDate: op.d });
      else {
        const { wh, p, ...m } = op.m;
        await postMovement(prisma, real.cc, { hotelId: real.h.hotel.id, warehouseId: real.W[wh], productId: real.P[p], ...m, quantity: D(m.quantity), unitCost: m.unitCost === undefined ? undefined : D(m.unitCost!), exactTotal: m.exactTotal === undefined ? undefined : D(m.exactTotal) });
      }
    }

    const sim = await setup("ENG-SIM");
    const products = await prisma.product.findMany({ where: { hotelId: sim.h.hotel.id }, include: { category: true } });
    const whs = await prisma.warehouse.findMany({ where: { hotelId: sim.h.hotel.id } });
    const periods = new Map<string, string>();
    const periodOf = (d: Date) => periods.get(d.toISOString().slice(0, 7))!;
    for (const op of SCENARIO) {
      const d = op.kind === "tr" ? op.d : op.m.txDate;
      const key = d.toISOString().slice(0, 7);
      if (!periods.has(key)) periods.set(key, (await periodFor(prisma, sim.h.hotel.id, d)).id);
    }
    const eng = new BulkLedger(sim.h.hotel.id, sim.cc.userId, new Map(products.map((p) => [p.id, { id: p.id, categoryId: p.categoryId, group: p.category.group }])), new Map(whs.map((w) => [w.id, w.departmentId])), periodOf);
    for (const op of SCENARIO) {
      if (op.kind === "tr") eng.transfer(sim.W[op.from], sim.W[op.to], sim.P[op.p], op.q, op.d);
      else {
        const { wh, p, ...m } = op.m;
        eng.post({ warehouseId: sim.W[wh], productId: sim.P[p], ...m });
      }
    }
    await eng.flush(prisma);

    const mapOf = (s: typeof real) => new Map<string, string>([[s.W.main, "main"], [s.W.rest, "rest"], [s.P.beef, "beef"], [s.P.milk, "milk"], [s.h.depts.restaurant.id, "REST"], [s.h.depts.pastry.id, "PAST"], [s.h.depts.kitchen.id, "KITCH"]]);
    const rows = async (s: typeof real) => norm((await prisma.stockTransaction.findMany({ where: { hotelId: s.h.hotel.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })) as never, mapOf(s));
    const a = await rows(real);
    const b = await rows(sim);
    expect(a.length).toBe(SCENARIO.length + SCENARIO.filter((o) => o.kind === "tr").length);
    expect(b).toEqual(a);

    const costs = async (s: typeof real) =>
      (await prisma.costTransaction.findMany({ where: { hotelId: s.h.hotel.id }, orderBy: { createdAt: "asc" }, include: { stockTx: true } })).map((c) => ({ kind: c.kind, amount: c.amount.toString(), quantity: c.quantity?.toString(), group: c.categoryGroup, dept: c.departmentId ? mapOf(s).get(c.departmentId) : null, nature: c.nature, costType: c.costType, type: c.stockTx?.type }));
    expect(await costs(sim)).toEqual(await costs(real));

    const bal = async (s: typeof real) => (await prisma.stockBalance.findMany({ where: { hotelId: s.h.hotel.id } })).map((x) => `${mapOf(s).get(x.warehouseId)}/${mapOf(s).get(x.productId)} ${x.quantity} ${x.value} ${x.avgCost}`).sort();
    expect(await bal(sim)).toEqual(await bal(real));
  });
});
