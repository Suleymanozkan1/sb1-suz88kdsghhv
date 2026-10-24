/**
 * Append-only guarantees enforced by the database itself (migration 20261023091000_integrity_hardening):
 * they must hold even for code that bypasses the services, and even if the demo-purge flag is set.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postMovement } from "@/server/services/ledger";
import { purgeDemoOrganizations } from "@/server/demo/reset";
import { periodFor } from "@/server/services/period";

const asPurge = <T>(fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('hotelcost.demo_purge', 'on', true)`;
    return fn(tx);
  });

describe("database-enforced immutability", () => {
  let real: Awaited<ReturnType<typeof makeHotel>>;
  let stockTxId: string;
  beforeAll(async () => {
    real = await makeHotel("INTEG");
    const cc = await real.actor("cost_controller");
    const beef = await makeProduct(real.hotel.id, real.cats.meat.id, { sku: "B", name: "Beef" });
    const tx = await postMovement(prisma, cc, { hotelId: real.hotel.id, warehouseId: real.wh.main.id, productId: beef.id, type: "PURCHASE", quantity: 5, unitCost: 100, txDate: day("2026-09-10"), sourceType: "MANUAL" });
    stockTxId = tx.id;
  });

  it("a real tenant's ledger rows cannot be deleted, even with the demo-purge flag set", async () => {
    // a delete of zero rows proves nothing: create a row in each table first
    const period = await periodFor(prisma, real.hotel.id, day("2026-09-10"));
    const cost = await prisma.costTransaction.create({ data: { hotelId: real.hotel.id, periodId: period.id, txDate: day("2026-09-10"), categoryGroup: "FOOD", kind: "TEST", amount: "1", sourceType: "MANUAL", userId: (await real.actor("cost_controller")).userId } });
    const audit = await prisma.auditLog.create({ data: { organizationId: real.org.id, hotelId: real.hotel.id, action: "TEST", entityType: "Test", entityId: "x" } });
    await expect(asPurge((tx) => tx.stockTransaction.delete({ where: { id: stockTxId } }))).rejects.toThrow(/LEDGER_IMMUTABLE/);
    await expect(asPurge((tx) => tx.costTransaction.delete({ where: { id: cost.id } }))).rejects.toThrow(/LEDGER_IMMUTABLE/);
    expect(await prisma.costTransaction.count({ where: { id: cost.id } })).toBe(1);
    await expect(asPurge((tx) => tx.auditLog.delete({ where: { id: audit.id } }))).rejects.toThrow(/LEDGER_IMMUTABLE/);
    expect(await prisma.stockTransaction.count({ where: { id: stockTxId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { id: audit.id } })).toBe(1);
  });

  it("TRUNCATE is refused on the append-only tables", async () => {
    for (const t of ["StockTransaction", "CostTransaction", "AuditLog", "Expense", "BillingInvoice"]) {
      await expect(prisma.$executeRawUnsafe(`TRUNCATE "${t}" CASCADE`)).rejects.toThrow(/LEDGER_IMMUTABLE/);
    }
  });

  it("a real organization can never be flagged demo or platform, nor deleted", async () => {
    await expect(prisma.organization.update({ where: { id: real.org.id }, data: { isDemo: true } })).rejects.toThrow(/ORG_IMMUTABLE/);
    await expect(prisma.organization.update({ where: { id: real.org.id }, data: { isPlatform: true } })).rejects.toThrow(/ORG_IMMUTABLE/);
    await expect(prisma.$executeRaw`DELETE FROM "Organization" WHERE id = ${real.org.id}`).rejects.toThrow(/ORG_IMMUTABLE/);
  });

  it("a hotel cannot be moved into another organization (e.g. a demo one, to purge it)", async () => {
    const demo = await prisma.organization.create({ data: { name: "Demo for move test", isDemo: true } });
    await expect(prisma.hotel.update({ where: { id: real.hotel.id }, data: { organizationId: demo.id } })).rejects.toThrow(/TENANT_MISMATCH/);
    await purgeDemoOrganizations(prisma, [demo.id], true);
  });

  it("a demo tenant is still purged completely, without suspending any trigger", async () => {
    const demo = await makeHotel("INTEG-DEMO");
    // fixtures create real tenants; this one is created as demo from the start (the flag is fixed at creation)
    const org = await prisma.organization.create({ data: { name: "Demo purge", isDemo: true } });
    const hotel = await prisma.hotel.create({ data: { organizationId: org.id, code: "DP", name: "Demo purge hotel" } });
    const wh = await prisma.warehouse.create({ data: { hotelId: hotel.id, code: "MAIN", name: "Main" } });
    const cat = await prisma.productCategory.create({ data: { hotelId: hotel.id, code: "F", name: "Food", group: "FOOD" } });
    const p = await makeProduct(hotel.id, cat.id, { sku: "X", name: "X" });
    await periodFor(prisma, hotel.id, day("2026-09-10"));
    const cc = await demo.actor("cost_controller");
    const actor = { ...cc, organizationId: org.id, hotelIds: [hotel.id] };
    await postMovement(prisma, actor, { hotelId: hotel.id, warehouseId: wh.id, productId: p.id, type: "PURCHASE", quantity: 2, unitCost: 10, txDate: day("2026-09-10"), sourceType: "MANUAL" });
    // without the transaction flag even a demo tenant's ledger is append-only (no accidental deletes in normal code)
    await expect(prisma.stockTransaction.deleteMany({ where: { hotelId: hotel.id } })).rejects.toThrow(/LEDGER_IMMUTABLE/);
    const rows = await purgeDemoOrganizations(prisma, [org.id], true);
    expect(rows.StockTransaction).toBe(1);
    expect(await prisma.organization.count({ where: { id: org.id } })).toBe(0);
    // the real tenant's row created in beforeAll is untouched
    expect(await prisma.stockTransaction.count({ where: { id: stockTxId } })).toBe(1);
  });
});
