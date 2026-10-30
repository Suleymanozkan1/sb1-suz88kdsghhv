/**
 * PERF-03 interim: the bot's sales of a business day are written per outlet (one transaction each), in bulk, with
 * every number as before: all outlets' lines are valued with the costs from before the delivery posted anything.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postMovement } from "@/server/services/ledger";
import { ingest } from "@/server/integrations/ingest";
import { periodFor } from "@/server/services/period";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let admin: Actor;
let beef: Awaited<ReturnType<typeof makeProduct>>;

beforeAll(async () => {
  h = await makeHotel("FIXD-BULK");
  await prisma.hotel.update({ where: { id: h.hotel.id }, data: { autoDeductSales: true } });
  admin = await h.actor("admin");
  beef = await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "BEEF", name: "Beef", costingMethod: "WEIGHTED_AVERAGE" });
  // the two outlets' stores hold the same product at very different costs
  await postMovement(prisma, admin, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: beef.id, type: "OPENING", quantity: "10", unitCost: "100", txDate: day("2026-10-01"), sourceType: "OPENING" });
  await postMovement(prisma, admin, { hotelId: h.hotel.id, warehouseId: h.wh.pastryStore.id, productId: beef.id, type: "OPENING", quantity: "10", unitCost: "300", txDate: day("2026-10-01"), sourceType: "OPENING" });
  const r = await prisma.recipe.create({ data: { hotelId: h.hotel.id, code: "BRG", name: "Burger", type: "RESTAURANT", posCode: "BRG" } });
  await prisma.recipeVersion.create({ data: { recipeId: r.id, version: 1, status: "APPROVED", effectiveFrom: day("2026-01-01"), batchYieldQty: "1", yieldUnit: "portion", portions: "1", createdById: admin.userId, costSnapshot: { portions: "1", requirements: { [beef.id]: "0.5" } } } });
});

const checks = (outlets: string[], n: number) =>
  Array.from({ length: n }, (_, i) => ({ checkNo: String(1000 + i), outlet: outlets[i % outlets.length]!, lines: [{ itemCode: "BRG", itemName: "Burger", qty: 1 + (i % 3), amount: 100 }] }));

describe("bot sales ingest per outlet", () => {
  it("one import per outlet, every line valued with the day's costs from before the delivery", async () => {
    const r = await ingest(prisma, admin, h.hotel.id, { kind: "checks", source: "MICROS", businessDay: "2026-10-10", runId: "bulk-1", items: checks(["Restaurant", "Pastry"], 40) });
    expect(r).toMatchObject({ received: 40, accepted: 40, errors: [] });
    const imports = await prisma.salesImport.findMany({ where: { hotelId: h.hotel.id }, orderBy: { fileName: "asc" } });
    expect(imports.map((i) => i.fileName)).toEqual(["MICROS 2026-10-10 PAST (bulk-1)", "MICROS 2026-10-10 REST (bulk-1)"]);
    const lines = await prisma.saleLine.findMany({ where: { hotelId: h.hotel.id } });
    expect(lines).toHaveLength(40);
    // hotel-wide cost before any consumption: 20 kg worth 4 000 → 200 / kg; half a kilo per burger = 100
    expect(new Set(lines.map((l) => l.theoreticalUnitCost!.toString()))).toEqual(new Set(["100"]));
    // consumption per outlet store: 0.5 kg × burgers sold there
    const sold = (dept: string) => lines.filter((l) => l.departmentId === dept).reduce((a, l) => a + Number(l.quantity), 0);
    const moved = await prisma.stockTransaction.findMany({ where: { hotelId: h.hotel.id, type: "CONSUMPTION" } });
    expect(moved.map((m) => [m.warehouseId, Number(m.quantity)]).sort()).toEqual(
      [[h.wh.restStore.id, -0.5 * sold(h.depts.restaurant.id)], [h.wh.pastryStore.id, -0.5 * sold(h.depts.pastry.id)]].sort(),
    );
    expect(lines.every((l) => l.consumptionPosted)).toBe(true);
    // sending the day again writes nothing twice
    const again = await ingest(prisma, admin, h.hotel.id, { kind: "checks", source: "MICROS", businessDay: "2026-10-10", runId: "bulk-2", items: checks(["Restaurant", "Pastry"], 40) });
    expect(again).toMatchObject({ accepted: 0, duplicates: 40 });
    expect(await prisma.saleLine.count({ where: { hotelId: h.hotel.id } })).toBe(40);
  });

  it("a refused day still reports every check as not accepted, with the reason", async () => {
    const p = await periodFor(prisma, h.hotel.id, day("2026-09-10"));
    await prisma.costPeriod.update({ where: { id: p.id }, data: { status: "CLOSED" } });
    const r = await ingest(prisma, admin, h.hotel.id, { kind: "checks", source: "MICROS", businessDay: "2026-09-10", runId: "bulk-closed", items: checks(["Restaurant", "Pastry"], 4) });
    expect(r.accepted).toBe(0);
    expect(r.errors.map((e) => e.message)).toEqual([expect.stringMatching(/^REST: .*CLOSED/), expect.stringMatching(/^PAST: .*CLOSED/)]);
  });
});
