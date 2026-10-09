/**
 * What the automation (Micros / Opera bot) sends is written here: checks → sales (and, through the recipes, stock
 * consumption), invoices → goods receipts, covers → buffet covers, minibar charges → minibar consumption,
 * occupancy → night-audit statistics. Every kind is idempotent (see contract.ts): sending a business day again
 * reports the known records as duplicates and writes nothing twice. One bad item never stops the others; it is
 * listed in the result and in the run log.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { D, Decimal, ZERO, toStorage } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { defaultConverter } from "@/domain/uom";
import type { Db } from "../db";
import { type Actor, authorize } from "../auth/actor";
import type { Permission } from "../auth/permissions";
import { audit } from "../services/audit";
import { commitSales } from "../services/sales";
import { postGoodsReceipt } from "../services/purchasing";
import { addSupplier, runAutoOrders } from "../services/auto-order";
import { createProduct } from "../services/products";
import { recordMovement } from "../services/minibar";
import { lastClosedBusinessDay } from "@/domain/business-day";
import { ingestSchema, runStatusSchema, type IngestInput, type IngestResult } from "./contract";

// ───────── keys ─────────

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const KEY_PREFIX = "hck_";

/** New key for the automation of a hotel; the plain key is returned once and only its hash is stored. */
export async function createIntegrationKey(db: Db, actor: Actor, hotelId: string, name: string) {
  authorize(actor, "admin:hotels", { hotelId });
  const n = name.trim().slice(0, 80) || "Micros / Opera";
  const plain = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  const k = await db.integrationKey.create({ data: { hotelId, name: n, prefix: plain.slice(0, 10), keyHash: sha(plain), createdById: actor.userId } });
  await audit(db, actor, { hotelId, action: "INTEGRATION_KEY_CREATE", entityType: "IntegrationKey", entityId: k.id, after: { name: n, prefix: k.prefix } });
  return { id: k.id, name: n, prefix: k.prefix, key: plain };
}

export async function revokeIntegrationKey(db: Db, actor: Actor, hotelId: string, id: string) {
  authorize(actor, "admin:hotels", { hotelId });
  const k = await db.integrationKey.findFirst({ where: { id, hotelId } });
  if (!k) throw new DomainError("NOT_FOUND", "Key not found");
  await db.integrationKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(db, actor, { hotelId, action: "INTEGRATION_KEY_REVOKE", entityType: "IntegrationKey", entityId: id, before: { name: k.name, prefix: k.prefix } });
  return { ok: true };
}

/** What the automation may do: post sales, receipts, covers, minibar and occupancy — nothing else. */
const BOT_PERMISSIONS: Permission[] = ["sales:import", "inventory:receive", "inventory:post", "supplier:view", "supplier:manage", "product:view", "product:manage", "minibar:view", "minibar:manage", "buffet:view", "pms:import", "purchase:view"];

/** `Authorization: Bearer hck_…` → the hotel and an actor for it (audited as the key's creator, "Automation"). */
export async function integrationActor(db: Db, header: string | null): Promise<{ hotelId: string; actor: Actor; keyId: string } | null> {
  const plain = header?.replace(/^Bearer\s+/i, "").trim();
  if (!plain?.startsWith(KEY_PREFIX)) return null;
  const k = await db.integrationKey.findUnique({ where: { keyHash: sha(plain) } });
  if (!k || k.revokedAt || !timingSafeEqual(Buffer.from(k.keyHash), Buffer.from(sha(plain)))) return null;
  const hotel = await db.hotel.findUnique({ where: { id: k.hotelId }, select: { id: true, active: true, organizationId: true, organization: { select: { active: true } } } });
  if (!hotel?.active || !hotel.organization.active) return null;
  const user = await db.user.findUnique({ where: { id: k.createdById }, select: { id: true, email: true } });
  if (!user) return null;
  await db.integrationKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } });
  return {
    hotelId: hotel.id,
    keyId: k.id,
    actor: { userId: user.id, organizationId: hotel.organizationId, name: `Automation (${k.name})`, email: user.email, roleKey: "integration", roleName: "Automation", permissions: new Set(BOT_PERMISSIONS), hotelIds: [hotel.id], departmentIds: "ALL" },
  };
}

// ───────── matching helpers ─────────

const low = (s: string) => s.trim().toLocaleLowerCase("tr");
/** Units as purchasing screens print them → HotelCost unit codes. */
const UNIT_ALIASES: Record<string, string> = { kg: "kg", kilo: "kg", kilogram: "kg", gr: "g", g: "g", gram: "g", lt: "l", l: "l", litre: "l", liter: "l", ml: "ml", cl: "cl", ad: "pc", adet: "pc", pc: "pc", pcs: "pc", ea: "pc", each: "pc", piece: "pc" };
export function normalizeUnit(u: string): string | null {
  const v = UNIT_ALIASES[low(u).replace(/\.$/, "")] ?? low(u);
  return defaultConverter.has(v) ? v : null;
}
const MEALS: Record<string, string> = { breakfast: "BREAKFAST", kahvaltı: "BREAKFAST", kahvalti: "BREAKFAST", lunch: "LUNCH", "öğle": "LUNCH", "öğle yemeği": "LUNCH", ogle: "LUNCH", dinner: "DINNER", "akşam": "DINNER", "akşam yemeği": "DINNER", aksam: "DINNER" };
export const normalizeMeal = (m: string) => MEALS[low(m)] ?? m.trim().toUpperCase().replace(/\s+/g, "_");

async function departmentMatcher(db: Db, hotelId: string) {
  const ds = await db.department.findMany({ where: { hotelId }, select: { id: true, code: true, name: true } });
  return (outlet: string) => {
    const o = low(outlet);
    const exact = ds.find((d) => low(d.code) === o || low(d.name) === o);
    if (exact) return exact;
    // Micros names outlets its own way ("Ana Restoran", "Lobby Bar"): a department whose name is part of the
    // outlet's name (or the other way round) is used when it is the only one
    const near = ds.filter((d) => d.name.length >= 3 && (o.includes(low(d.name)) || low(d.name).includes(o)));
    return near.length === 1 ? near[0]! : null;
  };
}

/** counts (covers, rooms, guests) are whole numbers */
const int = (n: number) => D(n).toDecimalPlaces(0).toNumber();
const dayDate = (day: string) => new Date(`${day}T12:00:00.000Z`);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ───────── per kind ─────────

type Out = Omit<IngestResult, "runId" | "kind">;

async function ingestChecks(db: Db, actor: Actor, hotelId: string, p: Extract<IngestInput, { kind: "checks" }>, runId: string): Promise<Out> {
  const dept = await departmentMatcher(db, hotelId);
  const errors: Out["errors"] = [];
  type Row = { externalId: string; saleDate: Date; department: string; posCode: string; name: string; quantity: string; netRevenue: string; check: number };
  const rows: Row[] = [];
  p.items.forEach((c, i) => {
    const d = dept(c.outlet);
    if (!d) return errors.push({ item: i, message: `Check ${c.checkNo}: unknown outlet '${c.outlet}'` });
    // one row per menu item of the check; voids / corrections within the check net out
    const byItem = new Map<string, { name: string; qty: Decimal; amount: Decimal }>();
    for (const l of c.lines) {
      const code = (l.itemCode?.trim() || l.itemName).slice(0, 64);
      const g = byItem.get(code) ?? { name: l.itemName, qty: ZERO, amount: ZERO };
      byItem.set(code, { name: g.name, qty: g.qty.plus(D(l.qty)), amount: g.amount.plus(D(l.amount)) });
    }
    for (const [code, g] of byItem) {
      if (g.qty.lte(0)) continue;
      // outlets can reuse check numbers on the same day: the outlet is part of the key
      rows.push({ externalId: `${p.source}:${p.businessDay}:${d.code}:${c.checkNo}:${code}`, saleDate: dayDate(p.businessDay), department: d.code, posCode: code, name: g.name, quantity: toStorage(g.qty).toString(), netRevenue: toStorage(Decimal.max(g.amount, ZERO)).toString(), check: i });
    }
  });
  const known = new Set((await db.saleLine.findMany({ where: { hotelId, externalId: { in: rows.map((r) => r.externalId) } }, select: { externalId: true } })).map((s) => s.externalId));
  const fresh = rows.filter((r) => !known.has(r.externalId));
  const checksWithRows = new Set(rows.map((r) => r.check));
  const dupChecks = [...checksWithRows].filter((i) => !fresh.some((r) => r.check === i)).length;
  if (!fresh.length) return { received: p.items.length, accepted: 0, duplicates: dupChecks, errors };
  try {
    const res = await commitSales(db, actor, hotelId, { rows: fresh.map(({ check: _c, ...r }) => r), source: "API", fileName: `${p.source} ${p.businessDay} (${runId})`, mappingVersion: "micros-bot-v1" });
    for (const r of res.rows) if (r.status === "INVALID") errors.push({ item: fresh[r.row - 1]!.check, message: `${fresh[r.row - 1]!.name}: ${r.messages.join("; ")}` });
    const bad = new Set(res.rows.filter((r) => r.status === "INVALID").map((r) => fresh[r.row - 1]!.check));
    const accepted = new Set(fresh.map((r) => r.check).filter((i) => !bad.has(i))).size;
    return { received: p.items.length, accepted, duplicates: dupChecks, errors };
  } catch (e) {
    errors.push({ item: -1, message: msg(e) });
    return { received: p.items.length, accepted: 0, duplicates: dupChecks, errors };
  }
}

async function unsortedCategory(db: Db, hotelId: string) {
  return (await db.productCategory.findFirst({ where: { hotelId, code: "MICROS-NEW" } })) ?? db.productCategory.create({ data: { hotelId, code: "MICROS-NEW", name: "Micros'tan yeni ürünler (sınıflandırılacak)", group: "FOOD" } });
}

async function ingestInvoices(db: Db, actor: Actor, hotelId: string, p: Extract<IngestInput, { kind: "invoices" }>): Promise<Out> {
  const errors: Out["errors"] = [];
  let accepted = 0;
  let duplicates = 0;
  const [suppliers, warehouses] = await Promise.all([db.supplier.findMany({ where: { hotelId } }), db.warehouse.findMany({ where: { hotelId, active: true }, orderBy: { code: "asc" } })]);
  const main = warehouses.find((w) => !w.departmentId && /main|ana|central|merkez/i.test(`${w.code} ${w.name}`)) ?? warehouses.find((w) => !w.departmentId) ?? warehouses[0];
  for (const [i, inv] of p.items.entries()) {
    try {
      let s = suppliers.find((x) => low(x.name) === low(inv.supplierName));
      if (!s) {
        s = await addSupplier(db, actor, hotelId, { name: inv.supplierName });
        suppliers.push(s);
      }
      const key = `INV:${s.id}:${inv.invoiceNo}`;
      if (await db.goodsReceipt.findFirst({ where: { hotelId, OR: [{ idempotencyKey: key }, { supplierId: s.id, invoiceNo: inv.invoiceNo }] } })) {
        duplicates++;
        continue;
      }
      const wh = inv.warehouse ? warehouses.find((w) => low(w.code) === low(inv.warehouse!) || low(w.name) === low(inv.warehouse!)) : main;
      if (!wh) throw new DomainError("VALIDATION", `Unknown warehouse '${inv.warehouse}'`);
      const items = [];
      for (const l of inv.lines) {
        const unit = normalizeUnit(l.unit);
        let prod = (l.itemCode ? await db.product.findFirst({ where: { hotelId, sku: l.itemCode } }) : null) ?? (await db.product.findFirst({ where: { hotelId, name: { equals: l.itemName.trim(), mode: "insensitive" } } }));
        if (!prod) {
          // a product the hotel has not set up yet: created with the invoice's unit in a "to classify" category
          if (!unit) throw new DomainError("VALIDATION", `${l.itemName}: unknown unit '${l.unit}' — create the product card first`);
          const cat = await unsortedCategory(db, hotelId);
          prod = await createProduct(db, actor, hotelId, { name: l.itemName.trim(), categoryId: cat.id, defaultSupplierId: s.id, purchaseUnit: unit, stockUnit: unit, recipeUnit: unit === "kg" ? "g" : unit === "l" ? "ml" : unit, taxRatePct: l.taxRatePct ?? undefined });
        }
        items.push({ productId: prod.id, quantity: l.qty, unit: unit ?? l.unit, unitPrice: l.unitPrice, taxRatePct: l.taxRatePct ?? Number(prod.taxRatePct) });
      }
      // a line missed on a paged screen or misread would post a wrong invoice: the printed total must match the
      // lines as they will be posted (a line without a VAT rate takes its product's rate, as the receipt does)
      if (inv.total !== null && inv.total !== undefined) {
        const lines = items.reduce((a, l) => a + l.quantity * l.unitPrice * (1 + l.taxRatePct / 100), 0);
        if (Math.abs(lines - inv.total) > Math.max(1, Math.abs(inv.total) * 0.005)) throw new DomainError("VALIDATION", `invoice total ${inv.total.toFixed(2)} does not match its lines ${lines.toFixed(2)} (incl. VAT) — check that every line was read`);
      }
      await postGoodsReceipt(db, actor, hotelId, { supplierId: s.id, warehouseId: wh.id, receiptDate: dayDate(inv.invoiceDate), invoiceNo: inv.invoiceNo, idempotencyKey: key, source: p.source === "MICROS" ? "MICROS" : "IMPORT", items });
      accepted++;
    } catch (e) {
      errors.push({ item: i, message: `${inv.supplierName} ${inv.invoiceNo}: ${msg(e)}` });
    }
  }
  return { received: p.items.length, accepted, duplicates, errors };
}

async function ingestCovers(db: Db, hotelId: string, p: Extract<IngestInput, { kind: "covers" }>): Promise<Out> {
  const dept = await departmentMatcher(db, hotelId);
  const errors: Out["errors"] = [];
  let accepted = 0;
  for (const [i, c] of p.items.entries()) {
    const d = dept(c.outlet);
    if (!d) {
      errors.push({ item: i, message: `Unknown outlet '${c.outlet}'` });
      continue;
    }
    const where = { hotelId_businessDate_departmentId_meal: { hotelId, businessDate: new Date(`${p.businessDay}T00:00:00Z`), departmentId: d.id, meal: normalizeMeal(c.meal) } };
    await db.coverCount.upsert({ where, create: { ...where.hotelId_businessDate_departmentId_meal, covers: int(c.covers), source: p.source }, update: { covers: int(c.covers), source: p.source } });
    accepted++;
  }
  // a re-sent day overwrites the same numbers: nothing is counted twice, so there are no duplicates to report
  return { received: p.items.length, accepted, duplicates: 0, errors };
}

async function ingestMinibar(db: Db, actor: Actor, hotelId: string, p: Extract<IngestInput, { kind: "minibar" }>): Promise<Out> {
  const errors: Out["errors"] = [];
  let accepted = 0;
  let duplicates = 0;
  for (const [i, m] of p.items.entries()) {
    try {
      const key = `MB:${m.reference}`;
      if (await db.minibarMovement.findFirst({ where: { hotelId, idempotencyKey: { startsWith: `${key}:` } } })) {
        duplicates++;
        continue;
      }
      const room = await db.room.findFirst({ where: { hotelId, number: m.room } });
      if (!room) throw new DomainError("VALIDATION", `Unknown room ${m.room}`);
      const prod = (m.itemCode ? await db.product.findFirst({ where: { hotelId, sku: m.itemCode } }) : null) ?? (await db.product.findFirst({ where: { hotelId, name: { equals: m.itemName.trim(), mode: "insensitive" } } }));
      if (!prod) throw new DomainError("VALIDATION", `Unknown minibar product '${m.itemName}'`);
      // a charge posted after midnight but before night audit belongs to that business day, as the sales do
      await recordMovement(db, actor, hotelId, { roomId: room.id, type: "CONSUMED", movedAt: dayDate(p.businessDay), items: [{ productId: prod.id, quantity: m.qty }], folioRef: m.reference, idempotencyKey: key });
      accepted++;
    } catch (e) {
      errors.push({ item: i, message: `${m.room} ${m.itemName}: ${msg(e)}` });
    }
  }
  return { received: p.items.length, accepted, duplicates, errors };
}

async function ingestOccupancy(db: Db, hotelId: string, p: Extract<IngestInput, { kind: "occupancy" }>): Promise<Out> {
  const o = p.items[0]!;
  const businessDate = new Date(`${p.businessDay}T00:00:00Z`);
  // the sold rooms are kept for the minibar board (only those rooms are checked); a delivery without them keeps the stored list
  const data = { availableRooms: int(o.availableRooms), occupiedRooms: int(o.occupiedRooms), guests: int(o.guests), roomRevenue: String(o.roomRevenue ?? 0), outOfOrder: int(o.outOfOrder ?? 0), source: p.source, ...(o.occupiedRoomNumbers ? { occupiedRoomNumbers: o.occupiedRoomNumbers } : {}) };
  await db.occupancyImport.upsert({ where: { hotelId_businessDate: { hotelId, businessDate } }, create: { hotelId, businessDate, ...data }, update: data });
  return { received: 1, accepted: 1, duplicates: 0, errors: [] };
}

/** Writes one delivery and adds its numbers to the run's log entry. */
export async function ingest(db: Db, actor: Actor, hotelId: string, raw: unknown): Promise<IngestResult> {
  const p = ingestSchema.parse(raw);
  const runId = p.runId ?? `${p.source.toLowerCase()}-${p.businessDay}-${Date.now().toString(36)}`;
  const out =
    p.kind === "checks" ? await ingestChecks(db, actor, hotelId, p, runId)
    : p.kind === "invoices" ? await ingestInvoices(db, actor, hotelId, p)
    : p.kind === "covers" ? await ingestCovers(db, hotelId, p)
    : p.kind === "minibar" ? await ingestMinibar(db, actor, hotelId, p)
    : await ingestOccupancy(db, hotelId, p);
  const result: IngestResult = { runId, kind: p.kind, ...out, errors: out.errors.slice(0, 200) };
  const prev = await db.integrationRun.findUnique({ where: { hotelId_runId: { hotelId, runId } } });
  const stats = { ...((prev?.stats as Record<string, unknown> | null) ?? {}), [p.kind]: { received: result.received, accepted: result.accepted, duplicates: result.duplicates, errors: result.errors } };
  await db.integrationRun.upsert({
    where: { hotelId_runId: { hotelId, runId } },
    // a delivery without a run report is a run of its own: finished when it is written
    create: { hotelId, runId, source: p.source, businessDay: p.businessDay, status: result.errors.length ? "FAILED" : "SUCCEEDED", message: result.errors.length ? `${result.errors.length} error(s)` : null, stats: stats as Prisma.InputJsonValue, finishedAt: p.runId ? null : new Date() },
    update: { stats: stats as Prisma.InputJsonValue, businessDay: prev?.businessDay ?? p.businessDay },
  });
  return result;
}

/**
 * STARTED / SUCCEEDED / FAILED from the bot (login failed, screen changed …). A successful Micros run has posted
 * the day's consumption, so the automatic orders are checked right then (the cron is only the fallback; self-hosted
 * installs have no cron at all). An auto-order problem never fails the bot's report.
 */
export async function reportRun(db: Db, hotelId: string, raw: unknown) {
  const r = runStatusSchema.parse(raw);
  const done = r.status !== "STARTED";
  const data = { source: r.source, status: r.status, message: r.message ?? null, businessDay: r.businessDay ?? null, requestId: r.requestId ?? null, finishedAt: done ? new Date() : null };
  const run = await db.integrationRun.upsert({ where: { hotelId_runId: { hotelId, runId: r.runId } }, create: { hotelId, runId: r.runId, ...data }, update: { ...data, businessDay: data.businessDay ?? undefined } });
  if (r.source === "MICROS" && r.status === "SUCCEEDED") {
    try {
      await runAutoOrders(db, hotelId);
    } catch (e) {
      console.error("[integrations] auto-order run after Micros import failed", hotelId, e);
    }
  }
  return run;
}

/** The bot asks whether someone pressed "run now"; the oldest open request is handed out once. */
export async function nextRequest(db: Db, hotelId: string, source?: string) {
  // the hotel's own night-audit cut-off travels with every poll, so the automation follows the admin setting
  const hotel = await db.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { businessDayCutoff: true, timezone: true } });
  const settings = { businessDayCutoff: hotel.businessDayCutoff, timezone: hotel.timezone };
  const req = await db.integrationRequest.findFirst({ where: { hotelId, pickedAt: null, ...(source ? { source } : {}) }, orderBy: { createdAt: "asc" } });
  if (!req) return { request: null, settings };
  // two polls can see the same open request: only the one that flips pickedAt gets it
  const claimed = await db.integrationRequest.updateMany({ where: { id: req.id, pickedAt: null }, data: { pickedAt: new Date() } });
  if (claimed.count !== 1) return { request: null, settings };
  return { request: { id: req.id, source: req.source, businessDay: req.businessDay }, settings };
}

// ───────── screen ─────────

export async function requestRun(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "sales:import", { hotelId });
  const b = (raw ?? {}) as { source?: string; businessDay?: string };
  const source = b.source === "OPERA" ? "OPERA" : "MICROS";
  const businessDay = typeof b.businessDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.businessDay) ? b.businessDay : null;
  const open = await db.integrationRequest.findFirst({ where: { hotelId, source, pickedAt: null } });
  if (open) return { id: open.id, alreadyWaiting: true };
  const r = await db.integrationRequest.create({ data: { hotelId, source, businessDay, requestedById: actor.userId } });
  await audit(db, actor, { hotelId, action: "INTEGRATION_RUN_REQUEST", entityType: "IntegrationRequest", entityId: r.id, after: { source, businessDay } });
  return { id: r.id, alreadyWaiting: false };
}

/** The bot runs ~45 min after the cut-off: the day just closed is expected only after this margin, not at the cut-off. */
const DELIVERY_GRACE_MINUTES = 90;
/** A source that has not delivered for this long is no longer expected (switched off or never really used). */
const SOURCE_ACTIVE_DAYS = 14;
const DAY_MS = 86_400_000;
const SEVERITY = { OK: 0, PARTIAL: 1, MISSING: 2, FAILED: 3 } as const;
type HealthStatus = keyof typeof SEVERITY;

/**
 * Is the automation healthy? Every source it uses (Micros, Opera … — any source that ever reported a run) is
 * expected to deliver the last closed business day (D-1 after the night audit); the worst source is the status, so a
 * failed Micros run is not hidden by a good Opera run after it. Nothing to say when there is no key (not used).
 */
export async function integrationHealth(db: Db, hotelId: string, now = new Date()) {
  const [keys, hotel] = await Promise.all([db.integrationKey.count({ where: { hotelId, revokedAt: null } }), db.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { timezone: true, businessDayCutoff: true } })]);
  if (!keys) return { status: "OFF" as const, expectedDay: null, lastRun: null, rejected: 0, sources: [] };
  const expectedDay = lastClosedBusinessDay(new Date(now.getTime() - DELIVERY_GRACE_MINUTES * 60_000), hotel.timezone, hotel.businessDayCutoff);
  // a source is in use when it delivered recently: a one-off "run now" of a source the hotel does not use (or one that
  // was switched off) must not keep a banner up for ever; with no recent success at all, every recent source counts
  const since = new Date(now.getTime() - SOURCE_ACTIVE_DAYS * DAY_MS);
  const recent = async (status?: "SUCCEEDED") => (await db.integrationRun.findMany({ where: { hotelId, startedAt: { gte: since }, ...(status ? { status } : {}) }, distinct: ["source"], select: { source: true }, orderBy: { source: "asc" } })).map((r) => r.source);
  const delivering = await recent("SUCCEEDED");
  const used = delivering.length ? delivering : await recent();
  const sources = await Promise.all(
    used.map(async (source) => {
      const [lastRun, okForDay] = await Promise.all([
        db.integrationRun.findFirst({ where: { hotelId, source }, orderBy: { startedAt: "desc" } }),
        db.integrationRun.findFirst({ where: { hotelId, source, businessDay: expectedDay, status: "SUCCEEDED" } }),
      ]);
      const rejected = Object.values((lastRun?.stats ?? {}) as Record<string, { errors?: unknown[] }>).reduce((a, v) => a + (v.errors?.length ?? 0), 0);
      const status: HealthStatus = lastRun?.status === "FAILED" ? "FAILED" : !okForDay ? "MISSING" : rejected ? "PARTIAL" : "OK";
      return { source, status, lastRun, rejected };
    }),
  );
  // a key but no run yet: nothing delivered
  if (!sources.length) return { status: "MISSING" as const, expectedDay, lastRun: null, rejected: 0, sources };
  const worst = sources.reduce((a, b) => (SEVERITY[b.status] > SEVERITY[a.status] ? b : a));
  return { status: worst.status, expectedDay, lastRun: worst.lastRun, rejected: sources.reduce((a, x) => a + x.rejected, 0), sources };
}

export async function integrationOverview(db: Db, actor: Actor, hotelId: string, take = 50) {
  authorize(actor, "sales:import", { hotelId });
  const [runs, keys, waiting, health] = await Promise.all([
    db.integrationRun.findMany({ where: { hotelId }, orderBy: { startedAt: "desc" }, take }),
    db.integrationKey.findMany({ where: { hotelId }, orderBy: { createdAt: "desc" } }),
    db.integrationRequest.findMany({ where: { hotelId, pickedAt: null }, orderBy: { createdAt: "asc" } }),
    integrationHealth(db, hotelId),
  ]);
  return { runs, keys: keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt })), waiting, health };
}

