/**
 * Ödenmez ve İkram (round 3 §8): comps deduct their ingredients from stock (COMPLIMENTARY), never write revenue,
 * respect the note rule, department scope and closed periods, come in idempotently from Micros / Opera, and are the
 * "on-house / hospitality" line of the theoretical-vs-actual breakdown.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day, ledgerInvariant } from "./fixtures";
import type { Actor } from "@/server/auth/actor";
import { postGoodsReceipt } from "@/server/services/purchasing";
import { createRecipe, approveVersion } from "@/server/services/recipes";
import { compSummary, createComp, createReason, deleteComp, listComps, listReasons, updateReason } from "@/server/services/comps";
import { theoreticalVsActual } from "@/server/services/variance";
import { periodFor } from "@/server/services/period";
import { createIntegrationKey, ingest, integrationActor } from "@/server/integrations/ingest";

let h: Awaited<ReturnType<typeof makeHotel>>;
let cc: Actor;
let fbPastry: Actor;
let P: { beef: string; bun: string; cola: string };
let burger = "";
let reasons: Awaited<ReturnType<typeof listReasons>>;
const reason = (name: string) => reasons.find((r) => r.name === name)!.id;
const SEP = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") };

beforeAll(async () => {
  h = await makeHotel("COMPS");
  cc = await h.actor("cost_controller");
  fbPastry = await h.actor("fb_manager", [h.depts.pastry.id]);
  const beef = await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "BEEF", name: "Ground Beef", supplierId: h.supplier.id });
  const bun = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "BUN", name: "Burger Bun", stockUnit: "pc", supplierId: h.supplier.id });
  const cola = await makeProduct(h.hotel.id, h.cats.bev.id, { sku: "COLA", name: "Kola 330 ml", stockUnit: "pc", supplierId: h.supplier.id });
  P = { beef: beef.id, bun: bun.id, cola: cola.id };
  await postGoodsReceipt(prisma, cc, h.hotel.id, { supplierId: h.supplier.id, warehouseId: h.wh.restStore.id, receiptDate: day("2026-09-01"), invoiceNo: "SEP-1", items: [{ productId: beef.id, quantity: 10, unit: "kg", unitPrice: 600 }, { productId: bun.id, quantity: 100, unit: "pc", unitPrice: 5 }, { productId: cola.id, quantity: 48, unit: "pc", unitPrice: 20 }] });
  const r = await createRecipe(prisma, cc, h.hotel.id, { code: "BRG", name: "Burger", type: "RESTAURANT", departmentId: h.depts.restaurant.id, posCode: "BRG", version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, sellingPrice: 450, lines: [{ productId: beef.id, quantity: 150, unit: "g" }, { productId: bun.id, quantity: 1, unit: "pc" }] } });
  burger = r.id;
  await approveVersion(prisma, cc, h.hotel.id, r.versions[0]!.id, { effectiveFrom: day("2026-08-01") });
  reasons = await listReasons(prisma, cc, h.hotel.id);
});

describe("reasons", () => {
  it("every hotel starts with the default list; owner and GM need no explanation", () => {
    expect(reasons.filter((r) => r.kind === "ON_HOUSE").map((r) => [r.name, r.noteRequired])).toEqual([["Yatırımcı", false], ["Genel müdür", false], ["Direktör", true], ["Diğer yetkili", true]]);
    expect(reasons.filter((r) => r.kind === "HOSPITALITY").map((r) => r.name)).toEqual(["Satış görüşmesi", "Karşılama içeceği", "Diğer"]);
  });
  it("can be added, renamed, reordered and deactivated (comp:manage only)", async () => {
    await expect(createReason(prisma, cc, h.hotel.id, { kind: "ON_HOUSE", name: "yatırımcı" })).rejects.toMatchObject({ code: "DUPLICATE" });
    const r = await createReason(prisma, cc, h.hotel.id, { kind: "ON_HOUSE", name: "Yönetim kurulu", noteRequired: false });
    await updateReason(prisma, cc, h.hotel.id, r.id, { move: "up" });
    let list = await listReasons(prisma, cc, h.hotel.id);
    expect(list.filter((x) => x.kind === "ON_HOUSE").map((x) => x.name)).toEqual(["Yatırımcı", "Genel müdür", "Direktör", "Yönetim kurulu", "Diğer yetkili"]);
    await updateReason(prisma, cc, h.hotel.id, r.id, { active: false, name: "Yönetim kurulu üyesi" });
    list = await listReasons(prisma, cc, h.hotel.id);
    expect(list.some((x) => x.id === r.id)).toBe(false);
    expect((await listReasons(prisma, cc, h.hotel.id, { includeInactive: true })).find((x) => x.id === r.id)).toMatchObject({ name: "Yönetim kurulu üyesi", active: false });
    await expect(createComp(prisma, cc, h.hotel.id, { kind: "ON_HOUSE", businessDate: "2026-09-05", departmentId: h.depts.restaurant.id, reasonId: r.id, lines: [{ productId: P.cola, quantity: 1 }] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createReason(prisma, await h.actor("chef", [h.depts.restaurant.id]), h.hotel.id, { kind: "ON_HOUSE", name: "Şef" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("manual entry", () => {
  it("deducts recipes by their ingredients and products as they are, at ledger cost, and writes no revenue", async () => {
    const rec = await createComp(prisma, cc, h.hotel.id, {
      kind: "ON_HOUSE", businessDate: "2026-09-10", departmentId: h.depts.restaurant.id, reasonId: reason("Yatırımcı"), person: "Ahmet Bey",
      lines: [{ recipeId: burger, quantity: "2" }, { productId: P.cola, quantity: 3 }],
    });
    // 2 burgers = 0.3 kg beef (180) + 2 buns (10); 3 cola (60)
    expect(rec.totalCost.toString()).toBe("250");
    expect(rec.warehouseId).toBe(h.wh.restStore.id);
    expect(rec.lines.map((l) => [l.itemName, l.quantity.toString(), l.totalCost?.toString()])).toEqual([["Burger", "2", "190"], ["Kola 330 ml", "3", "60"]]);
    const moves = await prisma.stockTransaction.findMany({ where: { hotelId: h.hotel.id, sourceType: "COMP", sourceId: rec.id }, orderBy: { productId: "asc" } });
    expect(moves).toHaveLength(3);
    expect(moves.every((m) => m.type === "COMPLIMENTARY" && m.departmentId === h.depts.restaurant.id)).toBe(true);
    expect(moves.find((m) => m.productId === P.beef)!.quantity.toString()).toBe("-0.3");
    const costs = await prisma.costTransaction.aggregate({ where: { hotelId: h.hotel.id, sourceType: "COMP", sourceId: rec.id, kind: "COMPLIMENTARY" }, _sum: { amount: true } });
    expect(costs._sum.amount?.toString()).toBe("250");
    expect(await prisma.saleLine.count({ where: { hotelId: h.hotel.id } })).toBe(0);
    const inv = await ledgerInvariant(h.wh.restStore.id, P.beef);
    expect(inv.ledgerQty).toBe(inv.balanceQty);
    expect(inv.balanceQty).toBe("9.7");
  });

  it("asks for an explanation unless the reason says otherwise; the reason must match the kind", async () => {
    const base = { kind: "HOSPITALITY", businessDate: "2026-09-12", departmentId: h.depts.restaurant.id, reasonId: reason("Satış görüşmesi"), lines: [{ productId: P.cola, quantity: 2 }] };
    await expect(createComp(prisma, cc, h.hotel.id, base)).rejects.toThrow("An explanation is required for the reason 'Satış görüşmesi'");
    await expect(createComp(prisma, cc, h.hotel.id, { ...base, reasonId: reason("Genel müdür") })).rejects.toThrow("The reason does not belong to this kind");
    const ok = await createComp(prisma, cc, h.hotel.id, { ...base, person: "ABC Turizm", note: "Satış toplantısı, 2 kişi" });
    expect(ok.totalCost.toString()).toBe("40");
  });

  it("department scope: a pastry manager can neither record nor see the restaurant's comps; without comp:view nothing", async () => {
    await expect(createComp(prisma, fbPastry, h.hotel.id, { kind: "ON_HOUSE", businessDate: "2026-09-12", departmentId: h.depts.restaurant.id, reasonId: reason("Genel müdür"), lines: [{ productId: P.cola, quantity: 1 }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await listComps(prisma, fbPastry, h.hotel.id, SEP)).toHaveLength(0);
    await expect(listComps(prisma, fbPastry, h.hotel.id, { ...SEP, departmentId: h.depts.restaurant.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await compSummary(prisma, fbPastry, h.hotel.id, SEP)).total.cost.toString()).toBe("0");
    await expect(listComps(prisma, await h.actor("chef", [h.depts.restaurant.id]), h.hotel.id, SEP)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // a pastry comp from the pastry store is fine for them
    await postGoodsReceipt(prisma, cc, h.hotel.id, { supplierId: h.supplier.id, warehouseId: h.wh.pastryStore.id, receiptDate: day("2026-09-01"), invoiceNo: "SEP-P", items: [{ productId: P.cola, quantity: 10, unit: "pc", unitPrice: 20 }] });
    const own = await createComp(prisma, fbPastry, h.hotel.id, { kind: "HOSPITALITY", businessDate: "2026-09-14", departmentId: h.depts.pastry.id, reasonId: reason("Karşılama içeceği"), lines: [{ productId: P.cola, quantity: 1 }] });
    expect(own.warehouseId).toBe(h.wh.pastryStore.id);
    expect((await listComps(prisma, fbPastry, h.hotel.id, SEP)).map((r) => r.id)).toEqual([own.id]);
  });

  it("summary: totals by kind and by reason, same filters as the list", async () => {
    const s = await compSummary(prisma, cc, h.hotel.id, SEP);
    expect(s.onHouse).toMatchObject({ count: 1 });
    expect(s.onHouse.cost.toString()).toBe("250");
    expect(s.hospitality.cost.toString()).toBe("60");
    expect(s.total.cost.toString()).toBe("310");
    expect(s.byReason.map((r) => [r.kind, r.name, r.cost.toString()])).toEqual([["HOSPITALITY", "Satış görüşmesi", "40"], ["HOSPITALITY", "Karşılama içeceği", "20"], ["ON_HOUSE", "Yatırımcı", "250"]]);
    const onlyHosp = await listComps(prisma, cc, h.hotel.id, { ...SEP, kind: "HOSPITALITY" });
    expect(onlyHosp).toHaveLength(2);
    expect((await listComps(prisma, cc, h.hotel.id, { ...SEP, reasonId: reason("Yatırımcı") })).map((r) => r.person)).toEqual(["Ahmet Bey"]);
  });
});

describe("theoretical vs actual", () => {
  it("comps are the 'on-house / hospitality' line, not unexplained variance, and bring no revenue", async () => {
    const v = await theoreticalVsActual(prisma, cc, h.hotel.id, SEP);
    const s = await compSummary(prisma, cc, h.hotel.id, SEP);
    expect(v.totals.complimentary.toString()).toBe(s.total.cost.toString());
    expect(v.breakdown.components.find((c) => c.cause === "COMPLIMENTARY")!.amount.toString()).toBe("310");
    expect(v.totals.revenue.toString()).toBe("0");
    // nothing else left the stores: all of the actual usage is explained by the comps
    expect(v.totals.actualCost.toString()).toBe("310");
    expect(v.totals.unexplained.toString()).toBe("0");
    const rest = await theoreticalVsActual(prisma, cc, h.hotel.id, { ...SEP, departmentId: h.depts.restaurant.id });
    expect(rest.totals.complimentary.toString()).toBe((await compSummary(prisma, cc, h.hotel.id, { ...SEP, departmentId: h.depts.restaurant.id })).total.cost.toString());
  });
});

describe("delete", () => {
  it("gives the stock back on the record's own day and removes it from the line; closed periods are never changed", async () => {
    const rec = await createComp(prisma, cc, h.hotel.id, { kind: "ON_HOUSE", businessDate: "2026-09-20", departmentId: h.depts.restaurant.id, reasonId: reason("Genel müdür"), lines: [{ recipeId: burger, quantity: 1 }] });
    const before = await ledgerInvariant(h.wh.restStore.id, P.beef);
    await expect(deleteComp(prisma, cc, h.hotel.id, rec.id, "")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(deleteComp(prisma, fbPastry, h.hotel.id, rec.id, "yanlış giriş")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await deleteComp(prisma, cc, h.hotel.id, rec.id, "yanlış giriş")).toEqual({ deleted: true, reversed: 2 });
    expect(await prisma.compRecord.count({ where: { id: rec.id } })).toBe(0);
    const after = await ledgerInvariant(h.wh.restStore.id, P.beef);
    expect(Number(after.balanceQty)).toBeCloseTo(Number(before.balanceQty) + 0.15, 6);
    const rev = await prisma.stockTransaction.findMany({ where: { hotelId: h.hotel.id, type: "REVERSAL", reverses: { sourceId: rec.id } } });
    expect(rev.map((r) => r.txDate.toISOString())).toEqual(["2026-09-20T12:00:00.000Z", "2026-09-20T12:00:00.000Z"]);
    const v = await theoreticalVsActual(prisma, cc, h.hotel.id, SEP);
    expect(v.totals.complimentary.toString()).toBe("310");

    const aug = await periodFor(prisma, h.hotel.id, day("2026-08-15"));
    await prisma.costPeriod.update({ where: { id: aug.id }, data: { status: "CLOSED" } });
    await expect(createComp(prisma, cc, h.hotel.id, { kind: "ON_HOUSE", businessDate: "2026-08-20", departmentId: h.depts.restaurant.id, reasonId: reason("Genel müdür"), lines: [{ productId: P.cola, quantity: 1 }] })).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    const oct = await createComp(prisma, cc, h.hotel.id, { kind: "ON_HOUSE", businessDate: "2026-10-02", departmentId: h.depts.restaurant.id, reasonId: reason("Genel müdür"), lines: [{ productId: P.cola, quantity: 1 }] });
    const octP = await periodFor(prisma, h.hotel.id, day("2026-10-02"));
    await prisma.costPeriod.update({ where: { id: octP.id }, data: { status: "CLOSED" } });
    await expect(deleteComp(prisma, cc, h.hotel.id, oct.id, "kapalı dönem")).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    await prisma.costPeriod.update({ where: { id: octP.id }, data: { status: "OPEN" } });
  });
});

describe("Micros / Opera delivery (kind comps)", () => {
  let bot: Actor;
  const DAY = "2026-09-25";
  const payload = {
    kind: "comps", source: "MICROS", businessDay: DAY, runId: "comp-run-1",
    items: [
      { checkNo: "5001", outlet: "Restaurant", kind: "ON_HOUSE", reason: "genel müdür", person: "Genel Müdür", lines: [{ itemCode: "BRG", itemName: "Burger", qty: 2 }, { itemCode: "BRG", itemName: "Burger", qty: -1 }, { itemName: "kola 330 ml", qty: 2 }] },
      { checkNo: "5002", outlet: "REST", kind: "HOSPITALITY", reason: "Basın ziyareti", note: "Gazeteciler", lines: [{ itemName: "Türk Kahvesi", qty: 3 }] },
      { checkNo: "5003", outlet: "Pool Bar", kind: "HOSPITALITY", lines: [{ itemName: "Su", qty: 1 }] },
    ],
  };
  beforeAll(async () => {
    const k = await createIntegrationKey(prisma, await h.actor("admin"), h.hotel.id, "Micros bot");
    bot = (await integrationActor(prisma, `Bearer ${k.key}`))!.actor;
  });
  it("books each check as a record: recipes by POS code, products by name, unknown items without cost; never revenue", async () => {
    const r = await ingest(prisma, bot, h.hotel.id, payload);
    expect(r).toMatchObject({ kind: "comps", received: 3, accepted: 2, duplicates: 0 });
    expect(r.errors).toEqual([{ item: 2, message: "Check 5003: unknown outlet 'Pool Bar'" }]);
    const recs = await prisma.compRecord.findMany({ where: { hotelId: h.hotel.id, source: "MICROS" }, include: { lines: { orderBy: { itemName: "asc" } }, reason: true }, orderBy: { externalId: "asc" } });
    expect(recs.map((x) => x.externalId)).toEqual([`MICROS:${DAY}:REST:5001`, `MICROS:${DAY}:REST:5002`]);
    const [gm, press] = recs;
    expect(gm!.reason?.name).toBe("Genel müdür");
    // 1 burger after the void (90 + 5) + 2 cola (40)
    expect(gm!.lines.map((l) => [l.itemName, l.quantity.toString(), l.totalCost?.toString() ?? null])).toEqual([["Burger", "1", "95"], ["kola 330 ml", "2", "40"]]);
    expect(gm!.totalCost.toString()).toBe("135");
    // reason text not on the list → kept in the note; the unknown item stays on the record without cost
    expect(press!.reasonId).toBeNull();
    expect(press!.note).toBe("Gazeteciler · Basın ziyareti");
    expect(press!.lines.map((l) => [l.itemName, l.totalCost])).toEqual([["Türk Kahvesi", null]]);
    expect(press!.totalCost.toString()).toBe("0");
    expect(await prisma.saleLine.count({ where: { hotelId: h.hotel.id } })).toBe(0);
    const listed = await listComps(prisma, cc, h.hotel.id, { from: day("2026-09-25"), to: day("2026-09-26") });
    expect(listed.find((x) => x.id === press!.id)).toMatchObject({ unmappedLines: 1, noteMissing: false });
  });
  it("sending the day again writes nothing", async () => {
    const before = await prisma.stockTransaction.count({ where: { hotelId: h.hotel.id } });
    const r = await ingest(prisma, bot, h.hotel.id, { ...payload, runId: "comp-run-2" });
    expect(r).toMatchObject({ accepted: 0, duplicates: 2 });
    expect(await prisma.stockTransaction.count({ where: { hotelId: h.hotel.id } })).toBe(before);
    expect(await prisma.compRecord.count({ where: { hotelId: h.hotel.id, source: "MICROS" } })).toBe(2);
  });
  it("the contract rejects a bad kind and empty checks", async () => {
    await expect(ingest(prisma, bot, h.hotel.id, { ...payload, items: [{ checkNo: "1", outlet: "REST", kind: "FREE", lines: [{ itemName: "Su", qty: 1 }] }] })).rejects.toThrow();
    await expect(ingest(prisma, bot, h.hotel.id, { ...payload, items: [{ checkNo: "1", outlet: "REST", kind: "ON_HOUSE", lines: [] }] })).rejects.toThrow();
  });
});
