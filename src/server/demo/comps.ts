/**
 * Demo Ödenmez / İkram records for the seeded "Grand Anatolia Resort" (prisma/seed.ts): checks closed as comps in
 * Micros, the chain's welcome drinks from Opera and a few manual entries, spread over the seeded days, so the page and
 * the "ödenmez / ikram" line of theoretical vs actual are not empty. Everything goes through the comps service (stock
 * really leaves the stores). Re-running skips what is there (the Micros / Opera checks are idempotent by check number).
 */
import type { Db } from "../db";
import type { Actor } from "../auth/actor";
import { createComp, ingestComps, listReasons, type CompDelivery } from "../services/comps";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

type Event = { source: "MICROS" | "OPERA" | "MANUAL"; outlet: string; kind: CompDelivery["kind"]; reason: string; person?: string; note?: string; items: Array<[code: string, qty: number]> };

/** One per pattern slot; the days cycle through them. Item codes are recipe POS codes (Micros menu item numbers); quantities stay within the seeded stores' stock. */
const EVENTS: Event[] = [
  { source: "MICROS", outlet: "REST", kind: "ON_HOUSE", reason: "Yatırımcı", person: "Mehmet Aydın (yatırımcı)", items: [["CHKSALAD", 2]] },
  { source: "OPERA", outlet: "BAR", kind: "HOSPITALITY", reason: "Zincir standardı (zincire faturalanır)", person: "Yeni giriş misafirleri", items: [["COLA", 2]] },
  { source: "MICROS", outlet: "CAFE", kind: "ON_HOUSE", reason: "Genel müdür", person: "Genel Müdür", items: [["CAPPU", 2], ["LATTE", 1]] },
  { source: "MICROS", outlet: "CAFE", kind: "HOSPITALITY", reason: "Satış görüşmesi", person: "ABC Turizm", note: "Kontrat görüşmesi, 4 kişi", items: [["LATTE", 4]] },
  { source: "MICROS", outlet: "REST", kind: "ON_HOUSE", reason: "Direktör", person: "Satış Direktörü", note: "Acente ile iş yemeği", items: [["SALMON", 1], ["CHKSALAD", 1]] },
  { source: "MANUAL", outlet: "PAST", kind: "HOSPITALITY", reason: "Diğer", person: "Oda 412", note: "Evlilik yıl dönümü sürprizi", items: [["TIRAMISU", 2]] },
  { source: "MICROS", outlet: "BAR", kind: "ON_HOUSE", reason: "Diğer yetkili", person: "Ön büro müdürü", note: "Şikâyetçi VIP misafirle ilgilenme", items: [["GINTONIC", 1], ["COLA", 1]] },
  { source: "MICROS", outlet: "BAR", kind: "HOSPITALITY", reason: "Karşılama içeceği", person: "Grup girişi (24 kişi)", items: [["COLA", 3]] },
];

/** Every `every`-th day gets the next event; returns how many records were written. */
export async function seedDemoComps(db: Db, actor: Actor, hotelId: string, days: Date[], every = 3): Promise<number> {
  const reasons = await listReasons(db, actor, hotelId);
  const [departments, recipes] = await Promise.all([db.department.findMany({ where: { hotelId }, select: { id: true, code: true } }), db.recipe.findMany({ where: { hotelId, deletedAt: null, posCode: { not: null } }, select: { id: true, posCode: true, name: true } })]);
  const dept = (code: string) => departments.find((d) => d.code === code) ?? null;
  let n = 0;
  for (const [i, d] of days.filter((_, k) => k % every === 1).entries()) {
    const e = EVENTS[i % EVENTS.length]!;
    const checkNo = `${e.source === "OPERA" ? "OP" : "C"}${ymd(d).replace(/-/g, "").slice(2)}${String(i).padStart(2, "0")}`;
    if (e.source === "MANUAL") {
      const dp = dept(e.outlet);
      const reasonId = reasons.find((r) => r.kind === e.kind && r.name === e.reason)?.id;
      const lines = e.items.flatMap(([code, quantity]) => {
        const r = recipes.find((x) => x.posCode === code);
        return r ? [{ recipeId: r.id, quantity }] : [];
      });
      if (!dp || !reasonId || !lines.length) continue;
      // a manual entry has no check number: the same day, outlet and note mean it is already there
      if (await db.compRecord.findFirst({ where: { hotelId, source: "MANUAL", businessDate: new Date(`${ymd(d)}T00:00:00Z`), departmentId: dp.id, note: e.note ?? null } })) continue;
      await createComp(db, actor, hotelId, { kind: e.kind, businessDate: ymd(d), departmentId: dp.id, reasonId, person: e.person, note: e.note, lines });
      n++;
      continue;
    }
    const res = await ingestComps(db, actor, hotelId, e.source, ymd(d), [{ checkNo, outlet: e.outlet, kind: e.kind, reason: e.reason, person: e.person, note: e.note, lines: e.items.map(([code, qty]) => ({ itemCode: code, itemName: recipes.find((r) => r.posCode === code)?.name ?? code, qty })) }], (o) => dept(o));
    n += res.accepted;
  }
  return n;
}
