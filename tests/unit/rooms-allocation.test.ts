import { describe, expect, it } from "vitest";
import { allocate, previewRule, costStack } from "@/domain/allocation";
import { D, sum } from "@/domain/money";
import { roomCosts, rollup, roomRevenueKpis, prorateMonth, monthsInRange, roomKpis, meterConsumption, laundryUnitCosts, nightsInRange, stayInPeriod, emptyComponents, componentOfCategory, roomCostFormRows } from "@/domain/rooms";

const day = (s: string) => new Date(`${s}T00:00:00Z`);

describe("allocation (spec 145, 188–191)", () => {
  it("splits exactly — no rounding residue left in the source", () => {
    const parts = allocate("100", [{ key: "a", driver: 1 }, { key: "b", driver: 1 }, { key: "c", driver: 1 }]);
    expect(sum(parts.map((p) => p.amount)).toString()).toBe("100");
    expect(parts.map((p) => p.amount.toString())).toEqual(["33.333334", "33.333333", "33.333333"]);
  });

  it("weights by driver quantity (revenue %)", () => {
    const parts = allocate("12000", [{ key: "REST", driver: "600000" }, { key: "BAR", driver: "200000" }, { key: "ROOMS", driver: "1200000" }]);
    expect(Object.fromEntries(parts.map((p) => [p.key, p.amount.toString()]))).toEqual({ REST: "3600", BAR: "1200", ROOMS: "7200" });
    expect(parts[2]!.share.toString()).toBe("0.6");
  });

  it("negative amounts (credit notes) also sum exactly", () => {
    const parts = allocate("-0.01", [{ key: "a", driver: 1 }, { key: "b", driver: 2 }]);
    expect(sum(parts.map((p) => p.amount)).toString()).toBe("-0.01");
  });

  it("an amount with more decimals than the parts (a prorated 1/3) is split instead of looping for ever", () => {
    const third = D(100).div(3); // 33.333… - a monthly room expense prorated by days
    const parts = allocate(third, [{ key: "a", driver: 1 }, { key: "b", driver: 2 }]);
    expect(sum(parts.map((p) => p.amount)).toString()).toBe("33.333333");
  });

  it("rejects a zero or negative driver base", () => {
    expect(() => allocate("10", [{ key: "a", driver: 0 }])).toThrow(/zero/);
    expect(() => allocate("10", [{ key: "a", driver: -1 }, { key: "b", driver: 2 }])).toThrow(/negative/);
    expect(() => allocate("10", [])).toThrow(/no destinations/);
  });

  it("preview drops destinations without driver and explains them", () => {
    const rule = { id: "r1", name: "Electricity by meter", driver: "METER" as const, sourceCategory: "ENERGY/ELECTRICITY", sourceDepartmentId: null };
    const res = previewRule(rule, "50000", new Map([["KITCH", D(30000)], ["LAUN", D(20000)], ["BAR", D(0)]]));
    expect(res.skipped).toEqual(["BAR"]);
    expect(res.lines.map((l) => [l.destinationId, l.amount.toString()])).toEqual([["KITCH", "30000"], ["LAUN", "20000"]]);
  });

  it("cost stack keeps direct and allocated apart (spec 146–147)", () => {
    const s = costStack({ direct: 800, allocated: 200 });
    expect(s.full.toString()).toBe("1000");
    expect(s.allocatedShare!.toString()).toBe("0.2");
  });
});

describe("room costing (spec 100–106, scenario 330: 100 occupied rooms)", () => {
  const from = day("2026-09-01");
  const to = day("2026-10-01");
  const rooms = [
    { roomId: "r101", number: "101", roomType: "Standard", floor: "1", area: "Main", weight: D(25) },
    { roomId: "r102", number: "102", roomType: "Standard", floor: "1", area: "Main", weight: D(25) },
    { roomId: "r401", number: "401", roomType: "Suite", floor: "4", area: "Tower", weight: D(50) },
  ];
  const stay = (roomId: string | null, roomType: string, a: string, d: string, nights: number, gross: number, channel = "DIRECT", commission = 0) => ({ roomId, roomType, channel, arrival: day(a), departure: day(d), nights, guests: 2, grossRoomRevenue: gross, commission, paymentFee: 0, otherDistribution: 0 });
  const stays = [
    stay("r101", "Standard", "2026-09-01", "2026-09-11", 10, 30000),
    stay("r102", "Standard", "2026-09-05", "2026-09-15", 10, 32000, "OTA", 4800),
    stay("r401", "Suite", "2026-09-28", "2026-10-03", 5, 50000, "OTA", 7500), // 3 nights in September
  ];
  const pool = { ...emptyComponents(), housekeeping: D(9000), laundry: D(4600), energy: D(2300) };

  it("nights in range clip stays at period borders", () => {
    expect(nightsInRange(day("2026-09-28"), day("2026-10-03"), from, to)).toBe(3);
    const p = stayInPeriod(stays[2]!, from, to);
    expect(p.gross.toString()).toBe("30000");
    expect(p.distribution.toString()).toBe("4500");
  });

  it("distributes the pool by occupied nights × m² and adds distribution directly", () => {
    const res = roomCosts({ rooms, pool, stays, directByRoom: new Map([["r401", { maintenance: D(1000) }]]), from, to });
    const byNo = Object.fromEntries(res.lines.map((l) => [l.number, l]));
    // weights: 101 = 10×25 = 250, 102 = 250, 401 = 3×50 = 150 → 650
    expect(byNo["101"]!.components.housekeeping.toFixed(2)).toBe("3461.54");
    expect(byNo["401"]!.components.maintenance.toString()).toBe("1000");
    expect(byNo["102"]!.components.distribution.toString()).toBe("4800");
    const totalPool = sum(Object.values(pool));
    const allocated = sum(res.lines.map((l) => l.fullCost.minus(l.components.distribution)));
    expect(allocated.toString()).toBe(totalPool.plus(1000).toString()); // nothing lost, nothing double counted
    expect(res.basisNights).toBe(23);
    expect(byNo["401"]!.roomRevenue.toString()).toBe("30000");
    expect(byNo["101"]!.costPerNight!.toFixed(2)).toBe(byNo["101"]!.fullCost.div(10).toFixed(2));
  });

  it("rolls up by room type and floor", () => {
    const res = roomCosts({ rooms, pool, stays, directByRoom: new Map(), from, to });
    const types = rollup(res.lines, (l) => l.roomType);
    expect(types.map((t) => [t.key, t.rooms, t.occupiedNights])).toEqual([["Standard", 2, 20], ["Suite", 1, 3]]);
    expect(sum(types.map((t) => t.fullCost)).toString()).toBe(sum(res.lines.map((l) => l.fullCost)).toString());
  });

  it("without occupied nights the pool stays unassigned (never invented)", () => {
    const res = roomCosts({ rooms, pool, stays: [], directByRoom: new Map(), from, to });
    expect(res.unassigned.housekeeping.toString()).toBe("9000");
    expect(sum(res.lines.map((l) => l.fullCost)).toString()).toBe("0");
  });

  it("room revenue KPIs: ADR over sold nights, RevPAR over sellable nights, unsold rooms carry cost (feedback r2 §10)", () => {
    // 1,600 sellable room nights (OOO / OOS already taken out), 1,360 sold → 240 unsold
    const k = roomRevenueKpis({ roomRevenue: 4_080_000, soldRooms: 1360, sellableRooms: 1600, guests: 2720, fullCost: 800_000 });
    expect(k.adr!.toString()).toBe("3000"); // 4,080,000 / 1,360
    expect(k.revpar!.toString()).toBe("2550"); // 4,080,000 / 1,600
    expect(k.occupancy!.toString()).toBe("0.85");
    expect(k.revenuePerGuest!.toString()).toBe("1500"); // room revenue only / 2,720 guest nights
    expect(k.costPerSellableRoom!.toString()).toBe("500");
    expect(k.unsoldRooms).toBe(240);
    expect(k.unsoldCost!.toString()).toBe("120000"); // 240 × 500
    expect(k.unsoldRevenueAtAdr!.toString()).toBe("720000"); // 240 × ADR
    const none = roomRevenueKpis({ roomRevenue: 0, soldRooms: 0, sellableRooms: 0, guests: 0 });
    expect([none.adr, none.revpar, none.occupancy, none.revenuePerGuest, none.costPerSellableRoom, none.unsoldCost]).toEqual([null, null, null, null, null, null]);
  });

  it("monthly amounts prorate by the days of the period in each month", () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    expect(prorateMonth("2026-09", 30000, d("2026-09-01"), d("2026-10-01")).toString()).toBe("30000");
    expect(prorateMonth("2026-09", 30000, d("2026-09-16"), d("2026-10-16")).toString()).toBe("15000");
    expect(prorateMonth("2026-10", 31000, d("2026-09-16"), d("2026-10-16")).toString()).toBe("15000");
    expect(prorateMonth("2026-02", 28000, d("2026-02-01"), d("2026-02-08")).toString()).toBe("7000");
    expect(prorateMonth("2026-11", 1000, d("2026-09-01"), d("2026-10-01")).toString()).toBe("0");
    expect(monthsInRange(d("2026-09-16"), d("2026-10-16"))).toEqual(["2026-09", "2026-10"]);
    expect(monthsInRange(d("2026-12-01"), d("2027-01-01"))).toEqual(["2026-12"]);
  });

  it("hotel unit economics (spec 161–163)", () => {
    const k = roomKpis({ cost: 300000, occupiedRooms: 100 * 30, availableRooms: 120 * 30, guests: 6000 });
    expect(k.costPerOccupiedRoom!.toString()).toBe("100");
    expect(k.costPerAvailableRoom!.toFixed(4)).toBe("83.3333");
    expect(k.costPerGuest!.toString()).toBe("50");
    expect(roomKpis({ cost: 1, occupiedRooms: 0, availableRooms: 0, guests: 0 }).costPerOccupiedRoom).toBeNull();
  });

  it("component mapping", () => {
    expect(componentOfCategory("HOUSEKEEPING", "Amenities", "HK")).toBe("amenities");
    expect(componentOfCategory("HOUSEKEEPING", "Chemicals", "LAUN")).toBe("laundry");
    expect(componentOfCategory("ENGINEERING")).toBe("maintenance");
    expect(componentOfCategory("ADMINISTRATION")).toBe("other");
  });
});

describe("meters and laundry (spec 108, 110–111)", () => {
  it("consumption from cumulative readings; partial when no reading before the period", () => {
    const rs = [{ date: day("2026-08-31"), value: 1000 }, { date: day("2026-09-15"), value: 1600 }, { date: day("2026-09-30"), value: 2200 }];
    expect(meterConsumption(rs, day("2026-09-01"), day("2026-10-01"))).toEqual({ consumption: D(1200), partial: false, problem: null });
    expect(meterConsumption(rs.slice(1), day("2026-09-01"), day("2026-10-01")).partial).toBe(true);
    expect(meterConsumption([{ date: day("2026-09-01"), value: 5 }, { date: day("2026-09-02"), value: 3 }], day("2026-09-01"), day("2026-10-01")).problem).toMatch(/decreased/);
    expect(meterConsumption([], day("2026-09-01"), day("2026-10-01")).consumption).toBeNull();
  });

  it("laundry unit costs", () => {
    const u = laundryUnitCosts({ cost: 45000, kg: 9000, pieces: 30000, occupiedRooms: 3000 });
    expect([u.perKg!.toString(), u.perPiece!.toString(), u.perOccupiedRoom!.toString()]).toEqual(["5", "1.5", "15"]);
  });
});

describe("room expense form rows", () => {
  it("skips only fully empty rows; an amount without a name blocks the save", () => {
    expect(roomCostFormRows([{ name: " HK meals ", amount: " 3000 " }, { name: "", amount: "" }, { name: "Uniforms", amount: "" }, { name: "  ", amount: " " }])).toEqual({ items: [{ name: "HK meals", amount: "3000" }, { name: "Uniforms", amount: "0" }], unnamed: [] });
    expect(roomCostFormRows([{ name: "HK meals", amount: "1" }, { name: " ", amount: "250" }, { name: "", amount: "0" }]).unnamed).toEqual([2, 3]);
  });
});
