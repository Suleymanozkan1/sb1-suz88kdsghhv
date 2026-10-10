import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { createIntegrationKey, ingest, integrationActor } from "@/server/integrations/ingest";
import { listReceipts, postGoodsReceipt } from "@/server/services/purchasing";
import { reverseMovement } from "@/server/services/ledger";
import { monthRange } from "@/server/page";
import { purchasing } from "@/server/table-export/reports/purchasing";
import { makeT } from "@/i18n/core";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let admin: Actor;
let bot: Actor;

const invoice = (invoiceNo: string, invoiceDate: string, supplierName = "Akdeniz Sebze") => ({ supplierName, invoiceNo, invoiceDate, lines: [{ itemName: "Domates", qty: 10, unit: "kg", unitPrice: 25, taxRatePct: 1 }] });

beforeAll(async () => {
  h = await makeHotel("RECLIST");
  admin = await h.actor("admin");
  const k = await createIntegrationKey(prisma, admin, h.hotel.id, "Micros bot");
  bot = (await integrationActor(prisma, `Bearer ${k.key}`))!.actor;
  await makeProduct(h.hotel.id, h.cats.food.id, { sku: "TOM", name: "Domates" });
  // Micros sends the invoices of each business day; the receipt carries the invoice's date
  expect(await ingest(prisma, bot, h.hotel.id, { kind: "invoices", source: "MICROS", businessDay: "2026-09-14", items: [invoice("M-1", "2026-09-14"), invoice("M-2", "2026-09-14", "Ege Et")] })).toMatchObject({ accepted: 2, errors: [] });
  expect(await ingest(prisma, bot, h.hotel.id, { kind: "invoices", source: "MICROS", businessDay: "2026-09-15", items: [invoice("M-3", "2026-09-15")] })).toMatchObject({ accepted: 1, errors: [] });
  const tom = await prisma.product.findFirstOrThrow({ where: { hotelId: h.hotel.id, sku: "TOM" } });
  await postGoodsReceipt(prisma, admin, h.hotel.id, { supplierId: h.supplier.id, warehouseId: h.wh.main.id, receiptDate: day("2026-09-15"), invoiceNo: "EL-1", items: [{ productId: tom.id, quantity: 2, unit: "kg", unitPrice: 30 }] });
});

describe("goods receipts list (purchasing screen + export)", () => {
  it("Micros invoices land on their own date: the period filter shows them day by day", async () => {
    const d14 = await listReceipts(prisma, h.hotel.id, monthRange({ from: "2026-09-14", to: "2026-09-14" }), 100);
    expect(d14.map((r) => r.invoiceNo).sort()).toEqual(["M-1", "M-2"]);
    expect(d14.every((r) => r.source === "MICROS" && r.status === "POSTED")).toBe(true);
    const both = await listReceipts(prisma, h.hotel.id, monthRange({ from: "2026-09-14", to: "2026-09-15" }), 100);
    expect(both.map((r) => r.invoiceNo)).toEqual(["EL-1", "M-3", "M-2", "M-1"]); // newest first
    expect(await listReceipts(prisma, h.hotel.id, monthRange({ from: "2026-09-16", to: "2026-09-30" }), 100)).toEqual([]);
    // total = net + VAT (+ extra costs): 10 kg × 25 at 1 % VAT
    expect(Number(d14[0]!.total)).toBeCloseTo(252.5, 2);
  });

  it("supplier and source filters; a reversed receipt says so", async () => {
    const range = monthRange({ from: "2026-09-01", to: "2026-09-30" });
    const ege = await prisma.supplier.findFirstOrThrow({ where: { hotelId: h.hotel.id, name: "Ege Et" } });
    expect((await listReceipts(prisma, h.hotel.id, { ...range, supplierId: ege.id }, 100)).map((r) => r.invoiceNo)).toEqual(["M-2"]);
    expect((await listReceipts(prisma, h.hotel.id, { ...range, source: "MANUAL" }, 100)).map((r) => r.invoiceNo)).toEqual(["EL-1"]);
    expect(await listReceipts(prisma, h.hotel.id, { ...range, source: "BOGUS" }, 100)).toHaveLength(4); // unknown source = all

    const el = (await listReceipts(prisma, h.hotel.id, { ...range, source: "MANUAL" }, 100))[0]!;
    const tx = await prisma.stockTransaction.findFirstOrThrow({ where: { hotelId: h.hotel.id, sourceType: "GOODS_RECEIPT", sourceId: el.items[0]!.id } });
    await reverseMovement(prisma, admin, { hotelId: h.hotel.id, stockTxId: tx.id, reason: "duplicate delivery" });
    expect((await listReceipts(prisma, h.hotel.id, { ...range, source: "MANUAL" }, 100))[0]!.status).toBe("REVERSED");
  });

  it("the PDF / Excel / CSV export uses the same filters", async () => {
    const ege = await prisma.supplier.findFirstOrThrow({ where: { hotelId: h.hotel.id, name: "Ege Et" } });
    const q = new URLSearchParams({ from: "2026-09-14", to: "2026-09-15", supplierId: ege.id });
    const rep = await purchasing.load({ actor: admin, hotelId: h.hotel.id, hotel: { id: h.hotel.id, name: h.hotel.name, baseCurrency: "TRY", timezone: "Europe/Istanbul" }, locale: "en", t: makeT("en"), q });
    const t = rep.tables[0]!;
    expect(t.rows.map((r) => r.invoice)).toEqual(["M-2"]);
    expect(t.rows[0]).toMatchObject({ source: "Micros", status: "Posted", vatPct: "1" });
    expect(rep.filters).toContainEqual(["Supplier", "Ege Et"]);
    const micros = await purchasing.load({ actor: admin, hotelId: h.hotel.id, hotel: { id: h.hotel.id, name: h.hotel.name, baseCurrency: "TRY", timezone: "Europe/Istanbul" }, locale: "en", t: makeT("en"), q: new URLSearchParams({ from: "2026-09-14", to: "2026-09-15", source: "MICROS" }) });
    expect(micros.tables[0]!.rows.map((r) => r.invoice).sort()).toEqual(["M-1", "M-2", "M-3"]);
  });
});
