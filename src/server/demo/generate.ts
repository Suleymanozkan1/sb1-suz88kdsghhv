/**
 * Multi-tenant demo / QA / staging data generator (spec 37–90, 116–127).
 *
 * Builds organizations → hotels → departments (+ cost centers) → warehouses → categories → suppliers →
 * products → recipes (nested, versioned) → a day-by-day simulated operation (purchases, transfers, sales,
 * consumption, waste, staff meals, counts) → buffets, minibar, PMS, payroll, energy and other expenses,
 * allocation, budgets, targets, saving actions → closed past periods. Every figure is derived from the
 * same chain (purchase → stock → recipe → sale → consumption → waste → closing stock), so the reports
 * reconcile; deliberate scenarios and intentional errors are recorded in `DemoScenario`.
 *
 * High-volume ledger rows are written by `BulkLedger` (proven identical to the posting services);
 * workflows with richer rules (recipes, buffets, minibar, PMS, allocation, budgets) go through the real
 * services. Development / QA / staging only - refuses to run in production.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, WasteType } from "@prisma/client";
import bcrypt from "bcryptjs";
import { D, Decimal, ZERO, toStorage } from "@/domain/money";
import { computeLandedCost } from "@/domain/landed-cost";
import { priceChange } from "@/domain/purchasing";
import { ROLE_TEMPLATES, SUPER_ADMIN_TEMPLATE } from "../auth/permissions";
import type { Actor } from "../auth/actor";
import { actorForUser } from "../auth/actors";
import { createRecipe, approveVersion, createVersion } from "../services/recipes";
import { createSession, addLine, closeSession } from "../services/buffet";
import { setPar, recordMovement, restockToParLevels, countRoom, roomQty } from "../services/minibar";
import { commitOccupancy, commitReservations } from "../services/pms";
import { createRule, postAllocation } from "../services/allocation";
import { createBudget, setBudgetLines, approveBudget, createTarget } from "../services/planning";
import { createAction, updateAction } from "../services/savings";
import { ensureDefaultTasks } from "../services/calendar";
import { CATALOG, DEMO_DEPARTMENTS, DEMO_WAREHOUSES, DISH_WORDS, FIRST_NAMES, LAST_NAMES, POSITIONS, ROOM_TYPES, SEMI_FINISHED, SUPPLIER_WORDS, type CatalogCategory, type CatalogItem } from "./catalog";
import { demoNames, type DemoLocale, type DemoNames } from "./catalog-tr";
import { BulkLedger } from "./engine";
import type { DemoProfile } from "./profiles";

// ───────────────────────── helpers ─────────────────────────

/** `ownerConsent`: the installation's owner asked for demo data from the first-run setup of an empty database. */
export function assertDemoAllowed(ownerConsent = false) {
  if (ownerConsent) return;
  const env = (process.env.HOTELCOST_ENV ?? process.env.APP_ENV ?? "").toLowerCase();
  if (env === "production" || (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_DATA !== "1")) {
    throw new Error("Demo data is disabled in production (spec 124, 126). Set ALLOW_DEMO_DATA=1 only on a non-production server.");
  }
}

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashSeed = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const DAY = 86_400_000;
const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const at = (d: Date, h: number, m = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m));
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const ym = (d: Date) => d.toISOString().slice(0, 7);
const r3 = (x: Decimal) => x.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
/** integer helpers for counts and units (not money: money goes through domain/money) */
const rint = (x: number) => (x < 0 ? -Math.trunc(-x + 0.5) : Math.trunc(x + 0.5));
const cint = (x: number) => (Math.trunc(x) === x ? x : x > 0 ? Math.trunc(x) + 1 : Math.trunc(x));
const ceilTo = (x: number, step: number) => cint(x / step - 1e-9) * step;

export interface DemoSummary {
  profile: string;
  organizations: number;
  hotels: number;
  users: number;
  counts: Record<string, number>;
  seconds: number;
}

interface ProductMeta {
  id: string;
  sku: string;
  name: string;
  cat: CatalogCategory;
  item: CatalogItem;
  categoryId: string;
  stockUnit: string;
  purchaseUnit: string;
  caseSize: number | null;
  price: number;
  taxRatePct: number;
  suppliers: number[];
}

interface VersionInfo {
  id: string;
  from: Date;
  to: Date | null;
  portions: Decimal;
  req: Array<[string, Decimal]>;
}

interface RecipeInfo {
  id: string;
  code: string;
  outlet: string;
  type: string;
  price: number;
  weight: number;
  versions: VersionInfo[];
}

interface HotelDef {
  code: string;
  name: string;
  city: string;
  resort: boolean;
  rooms: number;
}

interface Ctx {
  db: PrismaClient;
  profile: DemoProfile;
  rnd: () => number;
  orgId: string;
  orgKey: string;
  hotelId: string;
  hotel: HotelDef;
  admin: Actor;
  start: Date;
  end: Date;
  days: Date[];
  dept: Record<string, string>;
  wh: Record<string, string>;
  products: ProductMeta[];
  byCat: Map<string, ProductMeta[]>;
  suppliers: Array<{ id: string; name: string; kind: string }>;
  rooms: Array<{ id: string; number: string; roomType: string }>;
  periods: Map<string, string>;
  scenarios: string[];
  isQa: boolean;
  /** display names in the dataset language (codes never change) */
  n: DemoNames;
  log: (s: string) => void;
}

const SUPPLIER_PLAN: Array<{ kind: string; cats: string[]; schedule: "daily" | "twice" | "weekly" | "none" }> = [
  { kind: "Et ve Tavuk", cats: ["MEAT", "CHICKEN"], schedule: "daily" },
  { kind: "Su Ürünleri", cats: ["FISH", "SEAFOOD"], schedule: "daily" },
  { kind: "Sebze Hal", cats: ["VEG"], schedule: "daily" },
  { kind: "Meyve Sebze", cats: ["FRUIT", "VEG"], schedule: "daily" },
  { kind: "Süt Ürünleri", cats: ["DAIRY", "CHEESE"], schedule: "daily" },
  { kind: "Kuru Gıda Toptan", cats: ["DRY", "OIL", "SPICE", "SAUCE"], schedule: "twice" },
  { kind: "Pastane ve Kahvaltılık", cats: ["PASTRY", "BRKF", "DRY"], schedule: "twice" },
  { kind: "İçecek Dağıtım", cats: ["BEV", "BAR", "COFFEE", "TEA"], schedule: "twice" },
  { kind: "Temizlik Kimya Amenity", cats: ["CLEAN", "CHEM", "AMEN", "PACK"], schedule: "twice" },
  { kind: "Teknik ve Tekstil", cats: ["TECH", "SPARE", "LINEN"], schedule: "weekly" },
  { kind: "Enerji Dağıtım", cats: [], schedule: "none" },
  { kind: "Teknik Servis", cats: [], schedule: "none" },
];
// breakfast is issued from the kitchen store (there is no breakfast store)
const STORE_OF_OUTLET: Record<string, string> = { REST: "KITCH", CAFE: "KITCH", BANQ: "KITCH", ROOMSVC: "KITCH", BAR: "BAR", BRKF: "KITCH", PAST: "PAST" };
const MARKUP: Record<string, number> = { RESTAURANT: 3.3, CAFE: 4.2, BAR: 4.6, BREAKFAST: 3.0, PASTRY: 3.6, BANQUET: 2.8, ROOM_SERVICE: 3.8, MINIBAR: 3.5 };
const WASTE_TYPES: Array<[WasteType, string]> = [["SPOILED", "Spoiled in storage"], ["EXPIRED", "Past expiry date"], ["PREPARATION", "Preparation loss"], ["TRIMMING", "Trimming above standard"], ["BURNED", "Burned on grill"], ["OVERCOOKED", "Overcooked, not served"], ["DROPPED", "Dropped during service"], ["PLATE_WASTE", "Returned plate waste"], ["RETURNED_FOOD", "Guest complaint, returned"], ["QUALITY_REJECTION", "Rejected at quality check"], ["OVERPRODUCTION", "Over-produced for service"], ["TEMPERATURE_LOSS", "Cold chain break"]];

// ───────────────────────── entry point ─────────────────────────

export type DemoStep = { kind: "orgs" } | { kind: "hotel" | "buffet" | "services"; code: string } | { kind: "users" };
export interface DemoRunOptions {
  /** plain password for the demo users, or an existing bcrypt hash (the installation owner's) */
  password?: string;
  passwordHash?: string;
  log?: (s: string) => void;
  /** the run's reference time: every step of one run must use the same value */
  now?: Date;
  ownerConsent?: boolean;
  platformAdmin?: boolean;
  locale?: DemoLocale;
  /** the `carry` the previous step returned (a hotel's later steps continue from its earlier ones) */
  carry?: unknown;
}

/** The steps of a run, each small enough for one serverless request: companies, three per hotel, users. */
export function demoSteps(profile: DemoProfile): DemoStep[] {
  const perHotel = profile.orgs.flatMap((o) => o.hotels.flatMap((h) => (["hotel", "buffet", "services"] as const).map((kind) => ({ kind, code: h.code }))));
  return [{ kind: "orgs" }, ...perHotel, { kind: "users" }];
}

export const demoStepId = (s: DemoStep) => ("code" in s ? `${s.kind}:${s.code}` : s.kind);

/**
 * What the later steps of a hotel need from its earlier ones, as plain JSON (the two may run in different
 * serverless requests). Only the master-data ids and the simulation plan: everything else is in the database.
 */
interface Carry {
  dept: Record<string, string>;
  wh: Record<string, string>;
  products: ProductMeta[];
  suppliers: Ctx["suppliers"];
  rooms: Ctx["rooms"];
  periods: Array<[string, string]>;
  scenarios: string[];
  recipes: Array<Pick<RecipeInfo, "id" | "code" | "outlet">>;
  pms: { nightly: Array<[string, { occ: number; guests: number; rev: number }]>; reservations: Pms["reservations"] };
  sim: Omit<SimResult, "buffetPlan"> & { buffetPlan: Array<Omit<SimResult["buffetPlan"][number], "day"> & { day: string }> };
}

function toCarry(ctx: Ctx, recipes: RecipeInfo[], pms: Pms, sim: SimResult): Carry {
  return {
    dept: ctx.dept,
    wh: ctx.wh,
    products: ctx.products,
    suppliers: ctx.suppliers,
    rooms: ctx.rooms,
    periods: [...ctx.periods.entries()],
    scenarios: ctx.scenarios,
    recipes: recipes.map((r) => ({ id: r.id, code: r.code, outlet: r.outlet })),
    pms: { nightly: [...pms.nightly.entries()], reservations: pms.reservations },
    sim: { ...sim, buffetPlan: sim.buffetPlan.map((b) => ({ ...b, day: b.day.toISOString() })) },
  };
}

function runWindow(profile: DemoProfile, now: Date) {
  const end = new Date(dayOf(now).getTime() - DAY); // yesterday
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - profile.months, 1));
  const days: Date[] = [];
  for (let d = start; d <= end; d = new Date(d.getTime() + DAY)) days.push(d);
  return { start, end, days };
}

const hashOf = async (opts: DemoRunOptions) => opts.passwordHash ?? (await bcrypt.hash(opts.password ?? "", 10));

async function demoOrgOf(db: PrismaClient, o: DemoProfile["orgs"][number]) {
  // the company is found through its first hotel code (the name depends on the dataset language)
  const h = await db.hotel.findFirstOrThrow({ where: { code: o.hotels[0]!.code, organization: { isDemo: true } }, select: { organizationId: true } });
  return h.organizationId;
}

/** Runs one step. Steps must run in demoSteps() order; each is idempotent only in the sense that it refuses to run twice. */
export async function runDemoStep(db: PrismaClient, profile: DemoProfile, step: DemoStep, opts: DemoRunOptions): Promise<{ users: number; hotels: number; carry?: unknown }> {
  assertDemoAllowed(opts.ownerConsent);
  const log = opts.log ?? (() => undefined);
  const n = demoNames(opts.locale ?? "en");
  const { start, end, days } = runWindow(profile, opts.now ?? new Date());
  if (step.kind === "orgs") {
    if (await db.organization.findFirst({ where: { isDemo: true, name: { in: profile.orgs.flatMap((o) => [o.name, demoNames("tr").org(o.name)]) } } })) throw new Error("Demo tenants already exist - run the demo reset first");
    log(`profile ${profile.name}: ${days.length} days ${ymd(start)} → ${ymd(end)}`);
    const hash = await hashOf(opts);
    // never on a public installation: its password would be the documented demo password
    if (opts.platformAdmin !== false) await ensurePlatformAdmin(db, hash);
    let users = 0;
    for (const o of profile.orgs) {
      // the first demo company shows every feature (automatic e-mail orders: premium plan)
      const org = await db.organization.create({ data: { name: n.org(o.name), isDemo: true, plan: o.key === "A" ? "PREMIUM" : "BASIC" } });
      for (const c of ["TRY", "EUR", "USD"]) await db.currency.upsert({ where: { code: c }, create: { code: c, organizationId: org.id, name: c }, update: {} });
      const roleId: Record<string, string> = {};
      for (const t of ROLE_TEMPLATES) roleId[t.key] = (await db.role.create({ data: { organizationId: org.id, key: t.key, name: t.name, allDepartments: t.allDepartments, permissions: t.permissions } })).id;
      const hotelIds: string[] = [];
      for (const hd of o.hotels) hotelIds.push((await db.hotel.create({ data: { organizationId: org.id, code: hd.code, name: n.hotel(hd.name), totalRooms: hd.rooms, priceAlertPct: 10, wasteApprovalValue: 2500, adjustmentApprovalValue: 15000, marginTargetPct: 65 } })).id);
      const admin = await db.user.create({ data: { organizationId: org.id, email: emailFor(o, "companyadmin"), name: n.locale === "tr" ? `${n.org(o.name)} Yöneticisi` : `${o.name} Admin`, passwordHash: hash, roleId: roleId.admin! } });
      await db.userHotelAccess.createMany({ data: hotelIds.map((hotelId) => ({ userId: admin.id, hotelId })) });
      users++;
    }
    return { users, hotels: 0 };
  }
  if (step.kind === "hotel" || step.kind === "buffet" || step.kind === "services") {
    const o = profile.orgs.find((x) => x.hotels.some((h) => h.code === step.code))!;
    const i = o.hotels.findIndex((h) => h.code === step.code);
    const def = o.hotels[i]!;
    const hotel = await db.hotel.findFirstOrThrow({ where: { code: def.code, organization: { isDemo: true } } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: emailFor(o, "companyadmin") } });
    const ctx: Ctx = { db, profile, rnd: prng(hashSeed(`${profile.name}:${def.code}`)), orgId: hotel.organizationId, orgKey: o.key, hotelId: hotel.id, hotel: def, admin: (await actorForUser(admin.id))!, start, end, days, dept: {}, wh: {}, products: [], byCat: new Map(), suppliers: [], rooms: [], periods: new Map(), scenarios: [], isQa: o.key === "E", n, log: (s) => log(`  [${def.code}] ${s}`) };
    if (step.kind === "hotel") {
      if (await db.department.count({ where: { hotelId: hotel.id } })) throw new Error(`Demo hotel ${def.code} is already built`);
      return { users: 0, hotels: 1, carry: JSON.parse(JSON.stringify(await buildHotelData(ctx, i))) as unknown };
    }
    const c = opts.carry as Carry | undefined;
    if (!c?.dept) throw new Error(`Demo hotel ${def.code}: the previous step's data is missing`);
    if (step.kind === "buffet" ? await db.buffetSession.count({ where: { hotelId: hotel.id } }) : await db.budget.count({ where: { hotelId: hotel.id } })) throw new Error(`Demo step ${demoStepId(step)} has already run`);
    Object.assign(ctx, { dept: c.dept, wh: c.wh, products: c.products, suppliers: c.suppliers, rooms: c.rooms, periods: new Map(c.periods), scenarios: c.scenarios, rnd: prng(hashSeed(`${profile.name}:${def.code}:${step.kind}`)) });
    for (const p of c.products) ctx.byCat.set(p.cat.code, [...(ctx.byCat.get(p.cat.code) ?? []), p]);
    const pms: Pms = { nightly: new Map(c.pms.nightly), reservations: c.pms.reservations };
    const sim: SimResult = { ...c.sim, buffetPlan: c.sim.buffetPlan.map((b) => ({ ...b, day: new Date(b.day) })) };
    if (step.kind === "buffet") {
      await buffetPhase(ctx, pms, sim);
      return { users: 0, hotels: 0, carry: { ...c, scenarios: ctx.scenarios } satisfies Carry };
    }
    await buildHotelServices(ctx, c.recipes, pms, sim);
    return { users: 0, hotels: 0 };
  }
  const hash = await hashOf(opts);
  let users = 0;
  for (const o of profile.orgs) {
    const orgId = await demoOrgOf(db, o);
    const roles = await db.role.findMany({ where: { organizationId: orgId }, select: { id: true, key: true } });
    const roleId = Object.fromEntries(roles.map((r) => [r.key, r.id]));
    const hotels = await db.hotel.findMany({ where: { organizationId: orgId }, select: { id: true, code: true } });
    const hotelIds = o.hotels.map((h) => hotels.find((x) => x.code === h.code)!.id);
    users += await createOrgUsers(db, o, orgId, roleId, hotelIds, hash, n);
  }
  await db.$executeRawUnsafe("ANALYZE");
  return { users, hotels: 0 };
}

export async function generateDemo(db: PrismaClient, profile: DemoProfile, opts: DemoRunOptions): Promise<DemoSummary> {
  const t0 = Date.now();
  const run = { ...opts, now: opts.now ?? new Date(), passwordHash: await hashOf(opts) };
  let users = 0;
  let hotels = 0;
  let carry: unknown;
  for (const step of demoSteps(profile)) {
    const r = await runDemoStep(db, profile, step, { ...run, carry });
    carry = r.carry;
    users += r.users;
    hotels += r.hotels;
  }
  const counts = await demoCounts(db);
  return { profile: profile.name, organizations: profile.orgs.length, hotels, users, counts, seconds: Math.trunc((Date.now() - t0) / 1000 + 0.5) };
}

const emailFor = (o: DemoProfile["orgs"][number], role: string) => (o.key === "A" && o.slug === "demo-hotel-group" ? `${role}@test.local` : `${role}@${o.slug}.test.local`);

async function ensurePlatformAdmin(db: PrismaClient, hash: string) {
  if (await db.user.findUnique({ where: { email: "superadmin@test.local" } })) return;
  const org = (await db.organization.findFirst({ where: { isPlatform: true } })) ?? (await db.organization.create({ data: { name: "HotelCost Platform", isPlatform: true } }));
  const role = (await db.role.findFirst({ where: { organizationId: org.id, key: SUPER_ADMIN_TEMPLATE.key } })) ?? (await db.role.create({ data: { organizationId: org.id, key: SUPER_ADMIN_TEMPLATE.key, name: SUPER_ADMIN_TEMPLATE.name, allDepartments: true, permissions: SUPER_ADMIN_TEMPLATE.permissions } }));
  await db.user.create({ data: { organizationId: org.id, email: "superadmin@test.local", name: "Platform Super Admin", passwordHash: hash, roleId: role.id } });
}

/** Role users (spec 116, 118) + bulk users per company (spec 150). */
async function createOrgUsers(db: PrismaClient, o: DemoProfile["orgs"][number], orgId: string, roleId: Record<string, string>, hotelIds: string[], hash: string, N: DemoNames) {
  const first = hotelIds[0]!;
  const dept = async (codes: string[], hotelId = first) => (await db.department.findMany({ where: { hotelId, code: { in: codes } }, select: { id: true } })).map((d) => d.id);
  const defs: Array<[string, string, string, string[], string[]]> = [
    ["controller", "Cost Controller", "cost_controller", hotelIds, []],
    ["fbm", "F&B Manager", "fb_manager", [first], await dept(["FB", "REST", "CAFE", "BAR", "BRKF", "KITCH", "PAST", "BANQ"])],
    ["chef", "Executive Chef", "chef", [first], await dept(["KITCH", "REST", "BANQ"])],
    ["breakfast", "Breakfast Chef", "breakfast_chef", [first], await dept(["BRKF", "KITCH"])],
    ["pastry", "Pastry Chef", "pastry_chef", [first], await dept(["PAST"])],
    ["purchasing", "Purchasing Manager", "purchasing_manager", hotelIds, []],
    ["accounting", "Accounting Manager", "accounting_manager", hotelIds, []],
    ["warehouse", "Storekeeper", "warehouse", [first], []],
    ["rooms", "Rooms Division Manager", "rooms_division", [first], await dept(["ROOMS", "HK", "LAUN", "FO"])],
    ["viewer", "Viewer", "viewer", [first], []],
  ];
  let n = 0;
  for (const [key, title, role, hotels, depts] of defs) {
    const u = await db.user.create({ data: { organizationId: orgId, email: emailFor(o, key), name: `${N.position(title)} (${N.org(o.name)})`, passwordHash: hash, roleId: roleId[role]! } });
    await db.userHotelAccess.createMany({ data: hotels.map((h) => ({ userId: u.id, hotelId: h })) });
    if (depts.length) await db.userDepartmentAccess.createMany({ data: depts.map((d) => ({ userId: u.id, departmentId: d })) });
    n++;
  }
  // bulk staff accounts: viewers and storekeepers spread over the hotels
  const bulk: Prisma.UserCreateManyInput[] = [];
  for (let i = 0; i < o.extraUsers; i++) bulk.push({ id: randomUUID(), organizationId: orgId, email: `user${String(i + 1).padStart(3, "0")}@${o.slug}.test.local`, name: `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[(i * 7) % LAST_NAMES.length]}`, passwordHash: hash, roleId: roleId[i % 4 === 0 ? "warehouse" : "viewer"]! });
  if (bulk.length) {
    await db.user.createMany({ data: bulk });
    await db.userHotelAccess.createMany({ data: bulk.map((u, i) => ({ userId: u.id!, hotelId: hotelIds[i % hotelIds.length]! })) });
  }
  return n + bulk.length;
}

// ───────────────────────── one hotel ─────────────────────────

/** First half of a hotel: master data, recipes and the day-by-day simulation. */
async function buildHotelData(ctx: Ctx, index: number): Promise<Carry> {
  const t = Date.now();
  await masterData(ctx, index);
  ctx.log(`master data: ${ctx.products.length} products, ${ctx.rooms.length} rooms (${Date.now() - t} ms)`);
  const recipes = await buildRecipes(ctx);
  ctx.log(`recipes: ${recipes.length} (${Date.now() - t} ms)`);
  const pms = planOccupancy(ctx);
  const sim = await simulate(ctx, recipes, pms);
  ctx.log(`simulation: ${sim.stock} stock rows, ${sim.sales} sale lines, ${sim.waste} waste (${Date.now() - t} ms)`);
  return toCarry(ctx, recipes, pms, sim);
}

/** Last part: minibar, expenses, allocation, budget, targets, period close. */
async function buildHotelServices(ctx: Ctx, recipes: Carry["recipes"], pms: Pms, sim: SimResult) {
  const t = Date.now();
  await servicesPhase(ctx, pms, sim);
  ctx.log(`services phase done (${Date.now() - t} ms)`);
  if (ctx.isQa) await intentionalErrors(ctx, recipes);
  await closePastPeriods(ctx);
  await ctx.db.demoScenario.createMany({ data: ctx.scenarios.map((s) => JSON.parse(s) as Prisma.DemoScenarioCreateManyInput) });
  ctx.log(`done (${Date.now() - t} ms)`);
}

function scenario(ctx: Ctx, key: string, title: string, status: "NORMAL" | "EDGE_CASE" | "INTENTIONAL_ERROR", expectedDetection: string, entityType: string | null, entityIds: string[]) {
  ctx.scenarios.push(JSON.stringify({ organizationId: ctx.orgId, hotelId: ctx.hotelId, key, title, status, expectedDetection, entityType, entityIds }));
}

async function masterData(ctx: Ctx, index: number) {
  const { db, hotelId: H, rnd, n: N } = ctx;
  // departments (parents first) with their cost centers, sized by realistic area / headcount
  for (const d of [...DEMO_DEPARTMENTS].sort((a, b) => Number(!!a.parent) - Number(!!b.parent))) {
    ctx.dept[d.code] = (await db.department.create({ data: { hotelId: H, code: d.code, name: N.dept(d.code, d.name), isOutlet: d.outlet, parentId: d.parent ? ctx.dept[d.parent]! : null } })).id;
  }
  await db.costCenter.createMany({ data: DEMO_DEPARTMENTS.map((d) => ({ hotelId: H, departmentId: ctx.dept[d.code]!, code: `CC-${d.code}`, name: N.dept(d.code, d.name), kind: d.outlet ? "OUTLET" : "DEPARTMENT" })) });
  for (const [code, name, d] of DEMO_WAREHOUSES) ctx.wh[code] = (await db.warehouse.create({ data: { hotelId: H, code, name: N.warehouse(code, name), departmentId: d ? ctx.dept[d]! : null } })).id;
  // periods
  for (let m = new Date(ctx.start); m <= ctx.end; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    const p = await db.costPeriod.create({ data: { hotelId: H, code: ym(m), startDate: m, endDate: new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)) } });
    ctx.periods.set(ym(m), p.id);
  }
  // categories: group parents + catalogue children
  const parents = new Map<string, string>();
  for (const g of [...new Set(CATALOG.map((c) => c.group))]) parents.set(g, (await db.productCategory.create({ data: { hotelId: H, code: g, name: N.group(g, g[0] + g.slice(1).toLowerCase()), group: g } })).id);
  const catId = new Map<string, string>();
  for (const c of CATALOG) catId.set(c.code, (await db.productCategory.create({ data: { hotelId: H, code: `${c.group}-${c.code}`, name: N.category(c.code, c.name), group: c.group, parentId: parents.get(c.group)! } })).id);
  // suppliers (spec 47-48)
  for (const [k, sp] of SUPPLIER_PLAN.entries()) {
    const word = N.t(SUPPLIER_WORDS[(index * 3 + k) % SUPPLIER_WORDS.length]!);
    ctx.suppliers.push({ id: (await db.supplier.create({ data: { hotelId: H, code: `SUP-${String(k + 1).padStart(2, "0")}`, name: `${word} ${sp.kind}`, email: `siparis${index + 1}-${k + 1}@tedarikci.test.local`, address: `Organize Sanayi Bölgesi ${k + 1}. Cadde No: ${10 + k}, İstanbul`, leadTimeDays: sp.schedule === "daily" ? 1 : sp.schedule === "twice" ? 2 : 5, taxNumber: String(1000000000 + Math.trunc(rnd() * 8999999999)) } })).id, name: `${word} ${sp.kind}`, kind: sp.kind });
  }
  // products: the catalogue (one item left out per hotel), hotel-specific price level
  const all = CATALOG.flatMap((c) => c.items.map((it) => ({ c, it })));
  // drop random items down to the profile size, but every category keeps at least two products
  const skip = new Set<number>();
  const left = new Map(CATALOG.map((c) => [c.code, c.items.length]));
  for (let guard = 0; all.length - skip.size > ctx.profile.productsPerHotel && guard < 100_000; guard++) {
    const k = Math.trunc(rnd() * all.length);
    if (skip.has(k) || (left.get(all[k]!.c.code) ?? 0) <= 2) continue;
    skip.add(k);
    left.set(all[k]!.c.code, left.get(all[k]!.c.code)! - 1);
  }
  const level = 0.94 + rnd() * 0.12;
  const rows: Prisma.ProductCreateManyInput[] = [];
  const convs: Prisma.UnitConversionCreateManyInput[] = [];
  let seq = 0;
  for (const [i, { c, it }] of all.entries()) {
    if (skip.has(i)) continue;
    const [name, stockUnit, pu, size, price] = it;
    const id = randomUUID();
    const sku = `${c.code}-${String(++seq).padStart(3, "0")}`;
    const suppliers = SUPPLIER_PLAN.flatMap((sp, k) => (sp.cats.includes(c.code) ? [k] : []));
    const p = +(price * level).toFixed(4);
    const purchaseUnit = pu ?? stockUnit;
    rows.push({ id, hotelId: H, sku, name: N.product(name), categoryId: catId.get(c.code)!, defaultSupplierId: ctx.suppliers[suppliers[0] ?? 0]!.id, purchaseUnit, stockUnit, recipeUnit: stockUnit === "kg" ? "g" : stockUnit === "l" ? "ml" : "pc", taxRatePct: c.group === "FOOD" ? "1" : "20", standardCost: p.toFixed(4), barcode: `869${String(hashSeed(sku + H) % 1e9).padStart(9, "0")}${String(seq % 10)}` });
    if (pu && size) convs.push({ productId: id, fromUnit: pu, toUnit: stockUnit, factor: String(size) });
    const meta: ProductMeta = { id, sku, name, cat: c, item: it, categoryId: catId.get(c.code)!, stockUnit, purchaseUnit, caseSize: size, price: p, taxRatePct: c.group === "FOOD" ? 1 : 20, suppliers };
    ctx.products.push(meta);
    ctx.byCat.set(c.code, [...(ctx.byCat.get(c.code) ?? []), meta]);
  }
  await db.product.createMany({ data: rows });
  await db.unitConversion.createMany({ data: convs });
  // rooms (spec 72-73)
  const roomRows: Prisma.RoomCreateManyInput[] = [];
  const roomTypeEn: string[] = [];
  let n = 0;
  for (const rt of ROOM_TYPES) {
    const count = Math.max(1, rint(ctx.hotel.rooms * rt.share));
    for (let k = 0; k < count; k++) {
      n++;
      const floor = rt.type === "Villa" ? "V" : String(1 + Math.trunc((n - 1) / 20));
      roomTypeEn.push(rt.type);
      roomRows.push({ id: randomUUID(), hotelId: H, number: rt.type === "Villa" ? `V${String(k + 1).padStart(2, "0")}` : `${floor}${String(((n - 1) % 20) + 1).padStart(2, "0")}`, roomType: N.roomType(rt.type), floor, area: N.t(rt.type === "Villa" ? "Villas" : "Main building"), sqm: String(rt.sqm) });
    }
  }
  await db.room.createMany({ data: roomRows });
  // ctx.rooms keeps the English room type: the generator's logic keys off it
  ctx.rooms = roomRows.map((r, k) => ({ id: r.id!, number: r.number, roomType: roomTypeEn[k]! }));
  await db.hotel.update({ where: { id: H }, data: { totalRooms: ctx.rooms.length } });
  // employees (spec 77) spread over departments by realistic staffing ratios
  const ratio: Record<string, number> = { FO: 0.08, ROOMS: 0.01, HK: 0.2, LAUN: 0.05, FB: 0.01, REST: 0.12, CAFE: 0.04, BAR: 0.05, BRKF: 0.05, KITCH: 0.16, PAST: 0.04, BANQ: 0.04, MINI: 0.01, ENG: 0.07, FIN: 0.03, HR: 0.02, SM: 0.02 };
  const salary: Record<string, number> = { FO: 34000, ROOMS: 95000, HK: 28000, LAUN: 27500, FB: 110000, REST: 30000, CAFE: 29000, BAR: 31000, BRKF: 30000, KITCH: 36000, PAST: 35000, BANQ: 30000, MINI: 27000, ENG: 38000, FIN: 48000, HR: 45000, SM: 52000 };
  const emps: Prisma.EmployeeCreateManyInput[] = [];
  const headcount: Record<string, number> = {};
  for (let i = 0; i < ctx.profile.employeesPerHotel; i++) {
    let x = rnd();
    let code = "HK";
    for (const [c, r] of Object.entries(ratio)) if ((x -= r) <= 0) { code = c; break; }
    headcount[code] = (headcount[code] ?? 0) + 1;
    const pos = POSITIONS[code] ?? ["Staff"];
    const startDate = new Date(ctx.start.getTime() - Math.trunc(rnd() * 2000) * DAY);
    emps.push({ hotelId: H, departmentId: ctx.dept[code]!, code: `E${String(i + 1).padStart(5, "0")}`, name: `${FIRST_NAMES[Math.trunc(rnd() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.trunc(rnd() * LAST_NAMES.length)]}`, position: N.position(pos[Math.trunc(rnd() * pos.length)]!), monthlyCost: (salary[code]! * (0.85 + rnd() * 0.35)).toFixed(2), startDate });
  }
  for (let i = 0; i < emps.length; i += 2000) await db.employee.createMany({ data: emps.slice(i, i + 2000) });
  const area: Record<string, number> = { ROOMS: 26 * ctx.rooms.length, HK: 180, LAUN: 320, REST: 650, CAFE: 180, BAR: 160, BRKF: 420, KITCH: 520, PAST: 90, BANQ: 900, ENG: 280, FIN: 120, HR: 60, SM: 80, FO: 220, MINI: 20, FB: 40 };
  for (const [code, id] of Object.entries(ctx.dept)) await db.department.update({ where: { id }, data: { headcount: headcount[code] ?? 0, sqm: area[code] ?? null } });
}

// ───────────────────────── recipes ─────────────────────────

function pickN<T>(rnd: () => number, list: T[], n: number): T[] {
  const a = [...list];
  const out: T[] = [];
  while (a.length && out.length < n) out.push(a.splice(Math.trunc(rnd() * a.length), 1)[0]!);
  return out;
}

async function buildRecipes(ctx: Ctx): Promise<RecipeInfo[]> {
  const { rnd, db, hotelId: H, admin, n: N } = ctx;
  const P = (cat: string) => ctx.byCat.get(cat) ?? [];
  const recipeUnit = (p: ProductMeta) => (p.stockUnit === "kg" ? "g" : p.stockUnit === "l" ? "ml" : "pc");
  const line = (p: ProductMeta, qtyStock: number) => ({ productId: p.id, quantity: p.stockUnit === "pc" ? String(Math.max(1, rint(qtyStock))) : String(Math.max(1, rint(qtyStock * 1000))), unit: recipeUnit(p), ...(p.cat.group === "FOOD" && p.item[5] < 100 && rnd() < 0.3 ? { wastePct: String(2 + Math.trunc(rnd() * 4)) } : {}) });
  const costOf = (lines: Array<{ productId?: string; quantity: string; unit: string }>) =>
    lines.reduce((s, l) => {
      const p = ctx.products.find((x) => x.id === l.productId);
      if (!p) return s;
      const q = p.stockUnit === "pc" ? Number(l.quantity) : Number(l.quantity) / 1000;
      return s + (q * p.price * 100) / p.item[5];
    }, 0);
  const v1From = new Date(ctx.start.getTime() - DAY);
  const created: Array<{ id: string; code: string; outlet: string; type: string; price: number; weight: number; versionId: string; base: ReturnType<typeof line>[]; batch: number }> = [];

  // semi-finished, including a 4-level chain: Spice Mix → Special Mix → Burger Sauce → Hamburger (spec 54-55)
  const semi: Record<string, string> = {};
  // the nested chain first, so each level exists before the next one uses it
  const chain = ["Spice Mix", "Special Mix", "Burger Sauce"];
  const semiNames = [...chain, ...SEMI_FINISHED.filter((n) => !chain.includes(n))].slice(0, Math.max(ctx.profile.recipes.semi, 3));
  for (const [i, name] of semiNames.entries()) {
    const code = `SF-${String(i + 1).padStart(3, "0")}`;
    let lines: Array<Record<string, string>>;
    if (name === "Spice Mix") lines = pickN(rnd, P("SPICE"), 4).map((p) => line(p, 0.2 + rnd() * 0.15));
    else if (name === "Special Mix" && semi["Spice Mix"]) lines = [{ subRecipeId: semi["Spice Mix"]!, quantity: "150", unit: "g" }, ...pickN(rnd, P("SAUCE"), 2).map((p) => line(p, 0.3)), ...pickN(rnd, P("VEG"), 1).map((p) => line(p, 0.2))];
    else if (name === "Burger Sauce" && semi["Special Mix"]) lines = [{ subRecipeId: semi["Special Mix"]!, quantity: "200", unit: "g" }, ...P("SAUCE").slice(0, 2).map((p) => line(p, 0.35)), ...pickN(rnd, P("DAIRY"), 1).map((p) => line(p, 0.1))];
    else lines = [...pickN(rnd, [...P("VEG"), ...P("DAIRY"), ...P("PASTRY"), ...P("DRY")], 3 + Math.trunc(rnd() * 4)).map((p) => line(p, 0.1 + rnd() * 0.4)), ...pickN(rnd, P("SPICE"), 1).map((p) => line(p, 0.01))];
    const r = await createRecipe(db, admin, H, { code, name: N.semi(name), type: "SEMI_FINISHED", departmentId: ctx.dept.KITCH, version: { batchYieldQty: 1, yieldUnit: "kg", portions: 1, reason: N.t("Standard batch"), lines } });
    await approveVersion(db, admin, H, r.versions[0]!.id, { effectiveFrom: v1From });
    semi[name] = r.id;
  }
  const semiIds = Object.values(semi);

  // finished recipes per outlet (spec 51-53)
  const share: Array<[string, string, string, number]> = [["RESTAURANT", "REST", "RST", 0.3], ["CAFE", "CAFE", "CAF", 0.16], ["BAR", "BAR", "BAR", 0.12], ["BREAKFAST", "BRKF", "BRK", 0.16], ["PASTRY", "PAST", "PST", 0.14], ["BANQUET", "BANQ", "BNQ", 0.06], ["MINIBAR", "MINI", "MNB", 0.04], ["ROOM_SERVICE", "REST", "RSV", 0.02]];
  let made = 0;
  for (const [type, deptCode, prefix, frac] of share) {
    const n = Math.max(1, rint(ctx.profile.recipes.finished * frac));
    const words = DISH_WORDS[type === "ROOM_SERVICE" ? "RESTAURANT" : type]!;
    for (let k = 0; k < n && made < ctx.profile.recipes.finished; k++, made++) {
      const main = words.mains[k % words.mains.length]!;
      const style = words.styles[Math.trunc(k / words.mains.length) % words.styles.length]!;
      const name = `${main}${style}`;
      let lines: Array<Record<string, string>> = [];
      let batch = 1;
      if (type === "RESTAURANT" || type === "ROOM_SERVICE") {
        const protein = pickN(rnd, [...P("MEAT"), ...P("CHICKEN"), ...P("FISH"), ...P("SEAFOOD")], 1);
        lines = [...protein.map((p) => line(p, 0.16 + rnd() * 0.1)), ...pickN(rnd, P("VEG"), 3 + Math.trunc(rnd() * 4)).map((p) => line(p, 0.03 + rnd() * 0.08)), ...pickN(rnd, P("DRY"), rnd() < 0.5 ? 1 : 0).map((p) => line(p, 0.08)), ...pickN(rnd, P("OIL"), 1).map((p) => line(p, 0.015)), ...pickN(rnd, P("SPICE"), 1 + Math.trunc(rnd() * 3)).map((p) => line(p, 0.002)), ...pickN(rnd, [...P("CHEESE"), ...P("DAIRY")], Math.trunc(rnd() * 2)).map((p) => line(p, 0.03))];
        if (semiIds.length && rnd() < 0.5) lines.push({ subRecipeId: name.includes("Burger") && semi["Burger Sauce"] ? semi["Burger Sauce"]! : semiIds[Math.trunc(rnd() * semiIds.length)]!, quantity: String(30 + Math.trunc(rnd() * 40)), unit: "g" });
      } else if (type === "CAFE") {
        lines = rnd() < 0.6 ? [...pickN(rnd, [...P("COFFEE"), ...P("TEA")], 1).map((p) => line(p, p.stockUnit === "pc" ? 1 : 0.018)), ...P("DAIRY").slice(0, 1).map((p) => line(p, 0.18)), ...pickN(rnd, P("PACK"), 1).map((p) => line(p, 1))] : [...pickN(rnd, P("BRKF"), 1).map((p) => line(p, p.stockUnit === "pc" ? 1 : 0.06)), ...pickN(rnd, P("CHEESE"), 1).map((p) => line(p, 0.04)), ...pickN(rnd, P("VEG"), 2).map((p) => line(p, 0.03))];
      } else if (type === "BAR") {
        lines = [...pickN(rnd, P("BAR"), 1).map((p) => line(p, 0.05)), ...pickN(rnd, P("BEV"), 1).map((p) => line(p, p.stockUnit === "pc" ? 1 : 0.15)), ...pickN(rnd, P("FRUIT"), rnd() < 0.7 ? 1 : 0).map((p) => line(p, p.stockUnit === "pc" ? 1 : 0.02))];
      } else if (type === "BREAKFAST") {
        lines = [...P("DAIRY").filter((p) => p.name === "Eggs").map((p) => line(p, 2 + Math.trunc(rnd() * 2))), ...pickN(rnd, P("CHEESE"), 1).map((p) => line(p, 0.04)), ...pickN(rnd, P("VEG"), 2).map((p) => line(p, 0.05)), ...pickN(rnd, P("BRKF"), 2).map((p) => line(p, p.stockUnit === "pc" ? 1 : 0.03)), ...pickN(rnd, P("OIL"), 1).map((p) => line(p, 0.01))];
      } else if (type === "PASTRY") {
        batch = 8 + Math.trunc(rnd() * 5);
        lines = [...pickN(rnd, P("PASTRY"), 2 + Math.trunc(rnd() * 2)).map((p) => line(p, 0.15 + rnd() * 0.3)), ...P("DRY").filter((p) => p.name === "Flour" || p.name === "Sugar").map((p) => line(p, 0.3)), ...P("DAIRY").filter((p) => p.name === "Butter" || p.name === "Eggs").map((p) => line(p, p.stockUnit === "pc" ? 6 : 0.25))];
      } else if (type === "BANQUET") {
        batch = 10;
        lines = [...pickN(rnd, [...P("MEAT"), ...P("CHICKEN"), ...P("FISH")], 2).map((p) => line(p, 1.5)), ...pickN(rnd, P("VEG"), 6 + Math.trunc(rnd() * 6)).map((p) => line(p, 0.4)), ...pickN(rnd, P("DRY"), 2).map((p) => line(p, 0.8)), ...pickN(rnd, P("SPICE"), 3).map((p) => line(p, 0.02)), ...pickN(rnd, P("SAUCE"), 2).map((p) => line(p, 0.2)), ...pickN(rnd, P("CHEESE"), 2).map((p) => line(p, 0.3)), ...pickN(rnd, P("FRUIT"), 3).map((p) => line(p, p.stockUnit === "pc" ? 2 : 0.6)), ...pickN(rnd, P("PASTRY"), 2).map((p) => line(p, 0.2)), ...pickN(rnd, P("OIL"), 1).map((p) => line(p, 0.15))];
        if (semiIds.length) lines.push({ subRecipeId: semiIds[Math.trunc(rnd() * semiIds.length)]!, quantity: "500", unit: "g" });
      } else {
        lines = pickN(rnd, P("BEV").filter((p) => p.stockUnit === "pc"), 1).map((p) => line(p, 1));
      }
      lines = lines.filter((l) => l.productId || l.subRecipeId);
      if (!lines.length) continue;
      const portionCost = costOf(lines as never) / batch + (lines.some((l) => l.subRecipeId) ? 6 : 0);
      const price = Math.max(20, rint((portionCost * (MARKUP[type] ?? 3)) / 5) * 5);
      const code = `${prefix}-${String(k + 1).padStart(3, "0")}`;
      const r = await createRecipe(db, admin, H, { code, name: N.dish(main, style), type, departmentId: ctx.dept[deptCode], posCode: type === "MINIBAR" ? null : code, version: { batchYieldQty: batch, yieldUnit: "portion", portions: batch, sellingPrice: price, reason: N.t("Initial standard"), lines } });
      await approveVersion(db, admin, H, r.versions[0]!.id, { effectiveFrom: v1From });
      const weight = type === "BANQUET" || type === "MINIBAR" ? 0 : 0.3 + rnd() * rnd() * 3;
      created.push({ id: r.id, code, outlet: type === "ROOM_SERVICE" ? "ROOMSVC" : deptCode, type, price, weight, versionId: r.versions[0]!.id, base: lines as never, batch });
    }
  }

  // versions (spec 56-57): portion or price changes during the history; old sales keep the old version
  const span = ctx.end.getTime() - ctx.start.getTime();
  const versioned = pickN(rnd, created.filter((c) => c.type !== "MINIBAR" && c.weight > 0), ctx.profile.recipes.versioned);
  const versionIds: string[] = [];
  for (const c of versioned) {
    const extra = 1 + Math.trunc(rnd() * 3);
    for (let v = 1; v <= extra; v++) {
      const from = new Date(ctx.start.getTime() + Math.trunc((span * v) / (extra + 1) / DAY) * DAY);
      const factor = 0.88 + rnd() * 0.24;
      const lines = c.base.map((l) => ({ ...l, quantity: l.unit === "pc" ? l.quantity : String(Math.max(1, rint(Number(l.quantity) * factor))) }));
      const nv = await createVersion(db, admin, H, c.id, { batchYieldQty: c.batch, yieldUnit: "portion", portions: c.batch, sellingPrice: rint((c.price * (1 + 0.04 * v)) / 5) * 5, reason: N.t(v % 2 ? "Portion adjusted after tasting" : "Supplier change, recipe re-engineered"), lines });
      await approveVersion(db, admin, H, nv.id, { effectiveFrom: from });
      versionIds.push(nv.id);
    }
  }
  scenario(ctx, "RECIPE_VERSIONS", "Historical recipe versions: older sales keep their own version and cost", "NORMAL", "Sale lines reference the version effective on the sale date", "RecipeVersion", versionIds);

  // load all approved / superseded versions with their frozen requirement snapshots
  const recs = await db.recipe.findMany({ where: { hotelId: H, id: { in: created.map((c) => c.id) } }, include: { versions: { where: { status: { in: ["APPROVED", "SUPERSEDED"] } }, orderBy: { version: "asc" } } } });
  return created.map((c) => {
    const r = recs.find((x) => x.id === c.id)!;
    return {
      id: c.id,
      code: c.code,
      outlet: c.outlet,
      type: c.type,
      price: c.price,
      weight: c.weight,
      versions: r.versions.map((v) => {
        const snap = v.costSnapshot as { portions: string; requirements: Record<string, string> };
        return { id: v.id, from: v.effectiveFrom ?? v1From, to: v.effectiveTo, portions: D(snap.portions), req: Object.entries(snap.requirements).map(([k, q]) => [k, D(q)] as [string, Decimal]) };
      }),
    };
  });
}

// ───────────────────────── occupancy (PMS) ─────────────────────────

interface Pms {
  nightly: Map<string, { occ: number; guests: number; rev: number }>;
  reservations: Array<Record<string, string>>;
}

function seasonFactor(resort: boolean, d: Date) {
  const m = d.getUTCMonth();
  const resortCurve = [0.32, 0.35, 0.45, 0.62, 0.78, 0.92, 0.97, 0.98, 0.88, 0.7, 0.45, 0.36];
  const cityCurve = [0.66, 0.7, 0.75, 0.8, 0.82, 0.76, 0.7, 0.72, 0.84, 0.86, 0.8, 0.72];
  return (resort ? resortCurve : cityCurve)[m]!;
}

function planOccupancy(ctx: Ctx): Pms {
  const { rnd } = ctx;
  const nightly = new Map<string, { occ: number; guests: number; rev: number }>();
  const reservations: Array<Record<string, string>> = [];
  const rate = Object.fromEntries(ROOM_TYPES.map((r) => [r.type, r.rate * (ctx.hotel.resort ? 1 : 0.85)]));
  const channels: Array<[string, number, number, number]> = [["DIRECT", 0.24, 0, 0.015], ["OTA", 0.38, 0.17, 0.015], ["AGENCY", 0.1, 0.1, 0], ["CORPORATE", ctx.hotel.resort ? 0.05 : 0.18, 0, 0.01], ["TOUR_OPERATOR", ctx.hotel.resort ? 0.23 : 0.1, 0.2, 0]];
  const pick = () => {
    let x = rnd() * channels.reduce((s, c) => s + c[1], 0);
    for (const c of channels) if ((x -= c[1]) <= 0) return c;
    return channels[0]!;
  };
  const windowEnd = new Date(ctx.end.getTime() + DAY);
  let no = 1000;
  for (const r of ctx.rooms) {
    let cursor = new Date(ctx.start.getTime() + Math.trunc(rnd() * 3) * DAY);
    while (cursor < windowEnd) {
      const occTarget = seasonFactor(ctx.hotel.resort, cursor);
      if (rnd() > occTarget) {
        cursor = new Date(cursor.getTime() + (1 + Math.trunc(rnd() * 3)) * DAY);
        continue;
      }
      const nights = ctx.hotel.resort ? 3 + Math.trunc(rnd() * (r.roomType === "Villa" ? 8 : 6)) : 1 + Math.trunc(rnd() * 3);
      const dep = new Date(Math.min(cursor.getTime() + nights * DAY, windowEnd.getTime() + 2 * DAY));
      const n = rint((dep.getTime() - cursor.getTime()) / DAY);
      const guests = r.roomType === "Villa" ? 3 + Math.trunc(rnd() * 3) : r.roomType === "Family" ? 3 + Math.trunc(rnd() * 2) : r.roomType === "Suite" ? 2 : 1 + Math.trunc(rnd() * 2);
      const [ch, , comm, fee] = pick();
      const weekendBoost = !ctx.hotel.resort && (cursor.getUTCDay() === 5 || cursor.getUTCDay() === 6) ? 0.92 : 1;
      const adr = rate[r.roomType]! * (0.85 + rnd() * 0.3) * (0.7 + occTarget * 0.5) * weekendBoost * (ch === "TOUR_OPERATOR" ? 0.78 : ch === "CORPORATE" ? 0.9 : 1);
      const gross = rint(adr * n);
      reservations.push({ external_id: `RES-${++no}`, room: r.number, room_type: ctx.n.roomType(r.roomType), arrival: ymd(cursor), departure: ymd(dep), guests: String(guests), channel: ch, board_basis: ctx.hotel.resort ? (rnd() < 0.6 ? "AI" : "HB") : rnd() < 0.7 ? "BB" : "RO", status: dep <= windowEnd ? "CHECKED_OUT" : "IN_HOUSE", gross_room_revenue: String(gross), commission: (gross * comm).toFixed(2), payment_fee: (gross * fee).toFixed(2), other_distribution: "0" });
      for (let k = 0; k < n; k++) {
        const key = ymd(new Date(cursor.getTime() + k * DAY));
        const cur = nightly.get(key) ?? { occ: 0, guests: 0, rev: 0 };
        nightly.set(key, { occ: cur.occ + 1, guests: cur.guests + guests, rev: cur.rev + gross / n });
      }
      cursor = new Date(dep.getTime() + (rnd() < 0.6 ? 0 : Math.trunc(rnd() * 2)) * DAY);
    }
  }
  return { nightly, reservations };
}

// ───────────────────────── day-by-day simulation ─────────────────────────

interface SimResult {
  stock: number;
  sales: number;
  waste: number;
  buffetPlan: Array<{ day: Date; covers: number; expected: number; items: Array<{ productId: string; unit: string; perCover: number }>; level: number }>;
  minibarProducts: string[];
}

async function simulate(ctx: Ctx, recipes: RecipeInfo[], pms: Pms): Promise<SimResult> {
  const { db, rnd, hotelId: H, n: N } = ctx;
  const userId = ctx.admin.userId;
  const productMap = new Map(ctx.products.map((p) => [p.id, { id: p.id, categoryId: p.categoryId, group: p.cat.group, standardCost: D(p.price) }]));
  const whDept = new Map(Object.entries(ctx.wh).map(([code, id]) => [id, DEMO_WAREHOUSES.find((w) => w[0] === code)![2] ? ctx.dept[DEMO_WAREHOUSES.find((w) => w[0] === code)![2]!]! : null]));
  const L = new BulkLedger(H, userId, productMap, whDept, (d) => ctx.periods.get(ym(d))!);
  const pm = new Map(ctx.products.map((p) => [p.id, p]));
  const isQa = ctx.isQa;

  // ── scenario choices (deterministic per hotel) ──
  const food = ctx.products.filter((p) => p.cat.group === "FOOD");
  const priceJumps = new Map<string, Array<{ from: Date; pct: number }>>();
  const jumpPcts = [3, 5, 10, 15, 20, 30];
  const jumpProducts = pickN(rnd, food, Math.min(food.length, 12));
  for (const [i, p] of jumpProducts.entries()) {
    const when = new Date(ctx.start.getTime() + Math.trunc(((i + 1) / (jumpProducts.length + 1)) * ctx.days.length) * DAY);
    priceJumps.set(p.id, [{ from: when, pct: jumpPcts[i % jumpPcts.length]! }]);
  }
  scenario(ctx, "S01_SUPPLIER_PRICE_INCREASE", "Supplier price increases of 3/5/10/15/20/30 %", "NORMAL", "Price-change alerts at ≥ 10 %; recipe cost impact; purchase price variance", "Product", jumpProducts.map((p) => p.id));
  const deadStock = pickN(rnd, ctx.products.filter((p) => ["SEAFOOD", "PASTRY", "BAR", "SPARE"].includes(p.cat.code)), 4);
  const lastMonthStart = new Date(Date.UTC(ctx.end.getUTCFullYear(), ctx.end.getUTCMonth() - 1, 1));
  const lastMonthEnd = new Date(Date.UTC(ctx.end.getUTCFullYear(), ctx.end.getUTCMonth(), 1));
  const inLastMonth = (d: Date) => d >= lastMonthStart && d < lastMonthEnd;
  const overPortion = rnd() < 0.5 || isQa; // scenario 4
  const highWaste = rnd() < 0.5 || isQa; // scenario 2
  const shrinkBar = rnd() < 0.5 || isQa; // scenario 14
  const criticalSkip = pickN(rnd, food.filter((p) => !deadStock.includes(p)), 5);

  // ── sales plan from occupancy and seasonality (spec 59-61) ──
  const outletShare: Record<string, number> = { REST: 0.32, CAFE: 0.38, BAR: ctx.hotel.resort ? 0.55 : 0.3, BRKF: 0.15, PAST: 0.12, ROOMSVC: 0.04 };
  const byOutlet = new Map<string, RecipeInfo[]>();
  for (const r of recipes) if (r.weight > 0) byOutlet.set(r.outlet, [...(byOutlet.get(r.outlet) ?? []), r]);
  const banquet = recipes.filter((r) => r.type === "BANQUET");
  const versionAt = (r: RecipeInfo, d: Date) => r.versions.filter((v) => v.from <= d && (!v.to || v.to > d)).sort((a, b) => b.from.getTime() - a.from.getTime())[0] ?? null;
  type Sale = { r: RecipeInfo; qty: number; slot: number };
  const plan: Sale[][] = ctx.days.map((d) => {
    const n = pms.nightly.get(ymd(d)) ?? { occ: 0, guests: 0, rev: 0 };
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const out: Sale[] = [];
    for (const [outlet, list] of byOutlet) {
      const totalW = list.reduce((s, r) => s + r.weight, 0);
      const covers = n.guests * (outletShare[outlet] ?? 0.1) * (weekend ? 1.15 : 1) * (0.9 + rnd() * 0.2) + (outlet === "CAFE" || outlet === "BAR" ? 15 : 4);
      for (const r of list) {
        const q = rint((covers * r.weight) / totalW);
        if (q <= 0) continue;
        const slots = Math.min(ctx.profile.posSlots, q);
        let left = q;
        for (let s = 0; s < slots; s++) {
          const part = s === slots - 1 ? left : Math.max(1, rint(q / slots));
          left -= part;
          if (part > 0) out.push({ r, qty: part, slot: s });
        }
      }
    }
    // events: weddings / conferences (spec 61)
    if (banquet.length && rnd() < (ctx.hotel.resort ? 0.18 : 0.14)) {
      const covers = 60 + Math.trunc(rnd() * 190);
      for (const r of pickN(rnd, banquet, Math.min(2, banquet.length))) out.push({ r, qty: covers, slot: 2 });
    }
    return out;
  });

  // per-day raw requirement by store (stock units), incl. over-use factors (scenarios 4, 7)
  const OVERUSE_SKUS = new Set(food.filter((p) => p.name === "Tomato" || p.name === "Cheddar" || p.name === "Kaşar").map((p) => p.id));
  const need: Array<Map<string, Map<string, Decimal>>> = plan.map((sales, i) => {
    const d = ctx.days[i]!;
    const m = new Map<string, Map<string, Decimal>>();
    for (const s of sales) {
      const v = versionAt(s.r, d);
      if (!v) continue;
      const store = STORE_OF_OUTLET[s.r.outlet] ?? "KITCH";
      const sm = m.get(store) ?? new Map<string, Decimal>();
      for (const [pid, q] of v.req) {
        if (deadStock.some((x) => x.id === pid)) continue;
        let f = OVERUSE_SKUS.has(pid) ? 1.04 + rnd() * 0.06 : 1 + rnd() * 0.02;
        if (overPortion && s.r.outlet === "REST" && inLastMonth(d) && pm.get(pid)?.cat.code && ["MEAT", "CHICKEN", "FISH"].includes(pm.get(pid)!.cat.code)) f *= 1.25;
        sm.set(pid, (sm.get(pid) ?? ZERO).plus(q.div(v.portions).times(s.qty).times(f)));
      }
      m.set(`${store}|${s.r.outlet}`, sm);
    }
    return m;
  });
  if (overPortion) scenario(ctx, "S04_OVER_PORTIONING", "Restaurant proteins over-portioned by 25 % in the last full month", "EDGE_CASE", "Theoretical vs actual: unexplained usage on meat / chicken / fish", "Department", [ctx.dept.REST!]);
  scenario(ctx, "S07_THEORETICAL_VS_ACTUAL", "Tomato and cheese used 4-10 % above recipe", "NORMAL", "Variance report: unexplained usage gap", "Product", [...OVERUSE_SKUS]);

  // housekeeping, engineering and buffet requirements
  const amen = ctx.byCat.get("AMEN") ?? [];
  const clean = [...(ctx.byCat.get("CLEAN") ?? []), ...(ctx.byCat.get("CHEM") ?? [])];
  const buffetItems = [...ctx.products.filter((p) => ["Eggs", "White Cheese", "Kaşar", "Tomato", "Cucumber", "Black Olives", "Green Olives", "Honey", "Strawberry Jam", "Butter", "Simit", "Watermelon", "Whole Milk"].includes(p.name))];
  const buffetDays = new Set<string>();
  const buffetPlan: SimResult["buffetPlan"] = [];
  for (let i = 0; i < ctx.profile.buffetSessions && ctx.days.length > 2; i++) {
    const d = ctx.days[1 + Math.trunc(((i + 0.5) / ctx.profile.buffetSessions) * (ctx.days.length - 2))]!;
    if (buffetDays.has(ymd(d))) continue;
    buffetDays.add(ymd(d));
    const n = pms.nightly.get(ymd(d)) ?? { occ: 0, guests: 0, rev: 0 };
    const expected = Math.max(40, rint(n.guests * 0.85));
    const level = [0.02, 0.05, 0.1, 0.16][i % 4]!; // normal / medium / high / critical (spec 70)
    buffetPlan.push({ day: d, covers: Math.max(30, rint(expected * (0.85 + rnd() * 0.25))), expected, level, items: buffetItems.map((p) => ({ productId: p.id, unit: p.stockUnit, perCover: p.stockUnit === "pc" ? (p.name === "Eggs" ? 1.2 : 0.3) : p.name === "Whole Milk" ? 0.08 : 0.03 + rnd() * 0.02 })) });
  }
  const buffetNeed = new Map<string, Map<string, Decimal>>();
  for (const b of buffetPlan) {
    const prev = ymd(new Date(b.day.getTime() - DAY));
    const m = buffetNeed.get(prev) ?? new Map<string, Decimal>();
    for (const it of b.items) m.set(it.productId, (m.get(it.productId) ?? ZERO).plus(D(b.expected * it.perCover * 1.35)));
    buffetNeed.set(prev, m);
  }
  const minibarProducts = (ctx.byCat.get("BEV") ?? []).filter((p) => p.stockUnit === "pc").slice(0, 5).map((p) => p.id);

  const mainNeed = (i: number) => {
    const out = new Map<string, Decimal>();
    for (const sm of need[i]?.values() ?? []) for (const [p, q] of sm) out.set(p, (out.get(p) ?? ZERO).plus(q));
    const day = ctx.days[i];
    if (day) {
      const n = pms.nightly.get(ymd(day));
      const g = n?.guests ?? 0;
      const o = n?.occ ?? 0;
      for (const a of amen) out.set(a.id, (out.get(a.id) ?? ZERO).plus(D(g * (a.name.includes("Slippers") ? 0.35 : a.name.includes("Kit") || a.name.includes("Cap") ? 0.2 : 0.9))));
      for (const c of clean) out.set(c.id, (out.get(c.id) ?? ZERO).plus(D(o * (c.stockUnit === "pc" ? 0.6 : 0.04))));
      for (const [p, q] of buffetNeed.get(ymd(day)) ?? []) out.set(p, (out.get(p) ?? ZERO).plus(q));
    }
    return out;
  };

  // ── buffers for bulk rows ──
  const receipts: Prisma.GoodsReceiptCreateManyInput[] = [];
  const items: Prisma.GoodsReceiptItemCreateManyInput[] = [];
  const prices: Prisma.SupplierPriceCreateManyInput[] = [];
  const invoices: Prisma.InvoiceCreateManyInput[] = [];
  const invoiceItems: Prisma.InvoiceItemCreateManyInput[] = [];
  const alerts: Prisma.AlertCreateManyInput[] = [];
  const wasteRows: Prisma.WasteRecordCreateManyInput[] = [];
  const saleRows: Prisma.SaleLineCreateManyInput[] = [];
  const imports: Prisma.SalesImportCreateManyInput[] = [];
  const counts: Prisma.StockCountCreateManyInput[] = [];
  const countLines: Prisma.StockCountLineCreateManyInput[] = [];
  const lastUnitPrice = new Map<string, Decimal>();
  let grn = 0;
  let cnt = 0;
  const priceOn = (p: ProductMeta, d: Date) => {
    const months = (d.getTime() - ctx.start.getTime()) / (30 * DAY);
    let x = p.price * (1 + 0.012 * months) * (0.98 + rnd() * 0.05); // ~1.2 % monthly food inflation + noise
    for (const j of priceJumps.get(p.id) ?? []) if (d >= j.from) x *= 1 + j.pct / 100;
    return x;
  };

  const receive = (d: Date, supplierIdx: number, lines: Array<{ p: ProductMeta; stockQty: number }>) => {
    if (!lines.length) return;
    const s = ctx.suppliers[supplierIdx]!;
    const receiptId = randomUUID();
    const number = `GRN-${String(++grn).padStart(6, "0")}`;
    const invoiceNo = `${s.name.split(" ")[0]!.toUpperCase().slice(0, 4)}-${ymd(d).replace(/-/g, "")}-${grn}`;
    const freight = supplierIdx <= 1 && rnd() < 0.3 ? 250 : 0;
    const FRESH = new Set(["VEG", "FRUIT", "MEAT", "CHICKEN", "FISH", "SEAFOOD", "DAIRY", "CHEESE"]);
    // fresh goods arrive in lots with their own expiry date: one receipt line per lot (traceability, spec 79)
    const lotted = lines.flatMap(({ p, stockQty }) => {
      // food, drinks, amenities and chemicals carry batch / best-before dates: they arrive in several lots
      const lots = ctx.profile.freshByWeight && (FRESH.has(p.cat.code) || ["FOOD", "BEVERAGE", "HOUSEKEEPING"].includes(p.cat.group)) && stockQty >= 1 ? 2 + (stockQty >= 6 ? 1 : 0) : 1;
      return Array.from({ length: lots }, (_, k) => ({ p, stockQty: stockQty / lots, lot: lots > 1 ? k + 1 : 0 }));
    });
    const prepared = lotted.map(({ p, stockQty, lot }) => {
      // produce, meat and fish are weighed on delivery (kg / l) when the profile says so; packed goods come in cases
      const weighed = ctx.profile.freshByWeight && FRESH.has(p.cat.code) && p.stockUnit !== "pc";
      const pack = weighed ? null : p.caseSize;
      const units = pack ? Math.max(1, cint(stockQty / pack - 1e-9)) : p.stockUnit === "pc" ? Math.max(1, cint(stockQty)) : ceilTo(Math.max(stockQty, 0.5), 0.5);
      const stock = pack ? D(units).times(pack) : D(units);
      const unitPrice = toStorage(D(priceOn(p, d)).times(pack ?? 1));
      return { p, units, stock, unitPrice, unit: pack ? p.purchaseUnit : p.stockUnit, lot };
    });
    const landed = computeLandedCost(prepared.map((x) => ({ quantity: x.units, stockQty: x.stock, unitPrice: x.unitPrice, taxRatePct: x.p.taxRatePct })), { freight }, "BY_VALUE", 1);
    receipts.push({ id: receiptId, hotelId: H, number, supplierId: s.id, warehouseId: ctx.wh.MAIN!, receiptDate: at(d, 6), invoiceNo, freight: String(freight), netTotal: toStorage(landed.netTotal).toString(), taxTotal: toStorage(landed.taxTotal).toString(), landedTotal: toStorage(landed.landedTotal).toString(), postedAt: at(d, 6), postedById: userId });
    const invId = randomUUID();
    invoices.push({ id: invId, hotelId: H, supplierId: s.id, number: invoiceNo, invoiceDate: at(d, 6), netTotal: toStorage(landed.netTotal).toString(), taxTotal: toStorage(landed.taxTotal).toString(), grossTotal: toStorage(landed.netTotal.plus(landed.taxTotal)).toString(), receiptIds: [receiptId] });
    for (const [i, x] of prepared.entries()) {
      const l = landed.lines[i]!;
      const itemId = randomUUID();
      items.push({ id: itemId, receiptId, productId: x.p.id, quantity: String(x.units), unit: x.unit, ...(x.lot ? { lotNo: `${ymd(d).replace(/-/g, "")}-${x.lot}`, expiryDate: new Date(d.getTime() + (x.p.cat.code === "FISH" || x.p.cat.code === "SEAFOOD" ? 2 + x.lot : 4 + 2 * x.lot) * DAY) } : {}), stockQty: toStorage(x.stock).toString(), unitPrice: x.unitPrice.toString(), taxRatePct: String(x.p.taxRatePct), netAmount: toStorage(l.netAmount).toString(), taxAmount: toStorage(l.taxAmount).toString(), landedExtra: toStorage(l.landedExtra).toString(), landedAmount: toStorage(l.landedAmount).toString(), landedUnitCost: toStorage(l.landedUnitCost).toString() });
      invoiceItems.push({ invoiceId: invId, productId: x.p.id, description: N.product(x.p.name), quantity: String(x.units), unit: x.unit, unitPrice: x.unitPrice.toString(), taxRatePct: String(x.p.taxRatePct), netAmount: toStorage(l.netAmount).toString() });
      L.post({ warehouseId: ctx.wh.MAIN!, productId: x.p.id, type: "PURCHASE", quantity: x.stock, exactTotal: toStorage(l.landedAmount), txDate: at(d, 6), sourceType: "GOODS_RECEIPT", sourceId: itemId, reason: `${number} / ${invoiceNo}` });
      const unitPrice = l.netAmount.div(x.stock);
      const prev = lastUnitPrice.get(x.p.id) ?? null;
      const ch = priceChange(prev, unitPrice, "10");
      prices.push({ hotelId: H, supplierId: s.id, productId: x.p.id, priceDate: at(d, 6), purchaseUnit: x.unit, packPrice: toStorage(l.netAmount.div(D(x.units))).toString(), unitPrice: toStorage(unitPrice).toString(), previousUnitPrice: prev ? toStorage(prev).toString() : null, changePct: ch.changePct ? toStorage(ch.changePct).toString() : null, quantity: toStorage(x.stock).toString(), source: "RECEIPT", sourceId: itemId, invoiceNo });
      const pn = N.product(x.p.name);
      if (ch.isAlert && ch.changePct) alerts.push({ hotelId: H, type: "PRICE_INCREASE", severity: ch.changePct.gte(20) ? "HIGH" : "WARNING", title: N.locale === "tr" ? `Fiyat artışı: ${pn}` : `Price increase: ${pn}`, message: N.locale === "tr" ? `${pn}: ${toStorage(prev!).toFixed(2)} → ${toStorage(unitPrice).toFixed(2)} TRY/${x.p.stockUnit} (+%${ch.changePct.toFixed(2)}), tedarikçi: ${s.name}` : `${pn}: ${toStorage(prev!).toFixed(2)} → ${toStorage(unitPrice).toFixed(2)} ${"TRY"}/${x.p.stockUnit} (+${ch.changePct.toFixed(2)}%) from ${s.name}`, entityType: "Product", entityId: x.p.id, data: { productId: x.p.id, changePct: ch.changePct.toFixed(2) }, createdAt: at(d, 6) });
      lastUnitPrice.set(x.p.id, unitPrice);
      L.notePrice(x.p.id, toStorage(unitPrice));
    }
  };

  // ── day 0: opening stock in the main store ──
  const d0 = ctx.days[0]!;
  const firstWeek = new Map<string, Decimal>();
  for (let i = 0; i < Math.min(5, ctx.days.length); i++) for (const [p, q] of mainNeed(i)) firstWeek.set(p, (firstWeek.get(p) ?? ZERO).plus(q));
  for (const p of ctx.products) {
    const q = r3((firstWeek.get(p.id) ?? ZERO).times(1.2).plus(p.stockUnit === "pc" ? 12 : 2));
    L.post({ warehouseId: ctx.wh.MAIN!, productId: p.id, type: "OPENING", quantity: q, unitCost: D(p.price).toDecimalPlaces(4), txDate: at(d0, 5), sourceType: "MANUAL", reason: N.t("Opening balance (go-live)") });
  }
  scenario(ctx, "S06_DEAD_STOCK", "Products bought at go-live and never used", "EDGE_CASE", "Stock aging: dead stock; carrying cost in savings", "Product", deadStock.map((p) => p.id));

  // ── daily loop ──
  // dry / pastry / beverage suppliers: twice a week, or Mon-Wed-Fri for large operations (staging profile)
  const busy = ctx.profile.freshByWeight;
  const deliveryDay = (schedule: string, d: Date) => schedule === "daily" || (schedule === "twice" && (busy ? [1, 3, 5].includes(d.getUTCDay()) : d.getUTCDay() === 1 || d.getUTCDay() === 4)) || (schedule === "weekly" && d.getUTCDay() === 1);
  const nextDelivery = (schedule: string, i: number) => {
    for (let k = i + 1; k < ctx.days.length + 7; k++) {
      const d = new Date(ctx.start.getTime() + k * DAY);
      if (deliveryDay(schedule, d)) return k;
    }
    return i + 7;
  };
  let saleNo = 0;
  let weekImport: { id: string; rows: number } | null = null;
  let wasteCount = 0;
  // buffet reserve held in the kitchen store until the buffet sessions are posted (buffet phase): the kitchen's
  // own top-ups, usage and waste leave it alone
  const buffetReserve = new Map<string, Decimal>();
  const kitchenFree = (p: string) => L.position(ctx.wh.KITCH!, p).quantity.minus(buffetReserve.get(p) ?? ZERO);
  for (const [i, d] of ctx.days.entries()) {
    // 06:00 deliveries for the need until the next delivery (+ 10 % and one day of safety)
    for (const [k, sp] of SUPPLIER_PLAN.entries()) {
      if (sp.schedule === "none" || !deliveryDay(sp.schedule, d)) continue;
      const until = nextDelivery(sp.schedule, i);
      const lines: Array<{ p: ProductMeta; stockQty: number }> = [];
      for (const p of ctx.products) {
        // alternating suppliers for shared categories (same product from several suppliers, spec 48)
        const choice = p.suppliers.length > 1 ? p.suppliers[(Math.trunc(i / 7) + p.sku.length) % p.suppliers.length] : p.suppliers[0];
        if (choice !== k || deadStock.includes(p)) continue;
        if (criticalSkip.includes(p) && i >= ctx.days.length - 8) continue; // scenario 5: no delivery in the last week
        let horizon = ZERO;
        for (let j = i; j <= Math.min(until, ctx.days.length - 1); j++) horizon = horizon.plus(mainNeed(j).get(p.id) ?? ZERO);
        const have = L.position(ctx.wh.MAIN!, p.id).quantity;
        const want = horizon.times(1.1).plus(mainNeed(i).get(p.id) ?? ZERO).minus(have);
        if (want.gt(0.01)) lines.push({ p, stockQty: Number(want.toString()) });
      }
      receive(d, k, lines);
    }

    // 08:00 issues to the outlet stores, 22:00 consumption by department
    const dayNeed = need[i]!;
    const perStore = new Map<string, Map<string, Decimal>>();
    for (const [key, sm] of dayNeed) {
      const store = key.split("|")[0]!;
      const m = perStore.get(store) ?? new Map<string, Decimal>();
      for (const [p, q] of sm) m.set(p, (m.get(p) ?? ZERO).plus(q));
      perStore.set(store, m);
    }
    // tomorrow's buffet reserve goes to the kitchen store at 08:00 (sessions are posted by the buffet service)
    for (const [p, q] of buffetNeed.get(ymd(d)) ?? []) {
      const qty = r3(Decimal.min(q, L.position(ctx.wh.MAIN!, p).quantity));
      if (qty.lte(0)) continue;
      L.transfer(ctx.wh.MAIN!, ctx.wh.KITCH!, p, qty, at(d, 8));
      buffetReserve.set(p, (buffetReserve.get(p) ?? ZERO).plus(qty));
    }
    // the day runs in `issueSlots` shifts (morning / afternoon): top up the store, then post that shift's usage
    const slots = ctx.profile.issueSlots;
    for (let k = 0; k < slots; k++) {
      const share = D(1).div(slots);
      for (const [store, m] of perStore) {
        for (const [p, q] of m) {
          // outlet stores are topped up to the shift's need (the kitchen's buffet reserve does not count)
          const part = q.times(share);
          const inStore = store === "KITCH" ? kitchenFree(p) : L.position(ctx.wh[store]!, p).quantity;
          const want = r3(part.times(1.03).minus(inStore));
          const avail = L.position(ctx.wh.MAIN!, p).quantity;
          const qty = r3(Decimal.min(want, avail));
          if (qty.gt(0)) L.transfer(ctx.wh.MAIN!, ctx.wh[store]!, p, qty, at(d, 8 + k * 6));
        }
      }
      for (const [key, sm] of dayNeed) {
        const [store, outlet] = key.split("|") as [string, string];
        const deptId = ctx.dept[outlet === "ROOMSVC" ? "REST" : outlet]!;
        for (const [p, q] of sm) {
          const qty = r3(Decimal.min(q.times(share), store === "KITCH" ? kitchenFree(p) : L.position(ctx.wh[store]!, p).quantity));
          if (qty.gt(0)) L.post({ warehouseId: ctx.wh[store]!, productId: p, type: "CONSUMPTION", quantity: qty.neg(), txDate: at(d, 13 + k * 9), departmentId: deptId, sourceType: "MANUAL", reason: N.t(k === 0 ? "Kitchen issue (lunch shift)" : "Kitchen issue (dinner shift)") });
        }
      }
    }
    // housekeeping amenities & cleaning (issued straight from the main store to housekeeping)
    for (const [p, q] of mainNeed(i)) {
      const meta = pm.get(p)!;
      if (!["AMEN", "CLEAN", "CHEM"].includes(meta.cat.code)) continue;
      const qty = r3(Decimal.min(q, L.position(ctx.wh.MAIN!, p).quantity));
      if (qty.gt(0)) L.post({ warehouseId: ctx.wh.MAIN!, productId: p, type: "CONSUMPTION", quantity: qty.neg(), txDate: at(d, 14), departmentId: ctx.dept.HK!, sourceType: "MANUAL", reason: N.t("Daily housekeeping issue") });
    }
    // engineering spare parts / technical supplies used on jobs (weekly)
    if (d.getUTCDay() === 3) {
      for (const p of pickN(rnd, [...(ctx.byCat.get("TECH") ?? []), ...(ctx.byCat.get("SPARE") ?? [])].filter((x) => !deadStock.includes(x)), 2)) {
        const have = L.position(ctx.wh.MAIN!, p.id).quantity;
        const qty = r3(Decimal.min(have, D(1)));
        if (qty.gt(0)) L.post({ warehouseId: ctx.wh.MAIN!, productId: p.id, type: "CONSUMPTION", quantity: qty.neg(), txDate: at(d, 11), departmentId: ctx.dept.ENG!, sourceType: "MANUAL", reason: N.t("Maintenance job") });
      }
    }

    // waste (spec 64): realistic reasons, quantities from what is on hand
    const wasteN = Math.max(0, rint(ctx.profile.wastePerDay * (0.6 + rnd() * 0.8)));
    for (let w = 0, tries = 0; w < wasteN && tries < wasteN * 4; tries++) {
      const outlet = ["KITCH", "KITCH", "BAR", "BRKF", "PAST"][Math.trunc(rnd() * 5)]!;
      // breakfast waste comes out of the kitchen store (booked to the breakfast department)
      const store = outlet === "BRKF" ? "KITCH" : outlet;
      const onHand = (pid: string) => (store === "KITCH" ? kitchenFree(pid) : L.position(ctx.wh[store]!, pid).quantity);
      // something must be physically there to be wasted (at least one piece for counted items)
      const candidates = ctx.products.filter((p) => onHand(p.id).gte(p.stockUnit === "pc" ? 1 : 0.05) && p.cat.group !== "HOUSEKEEPING");
      if (!candidates.length) continue;
      const p = candidates[Math.trunc(rnd() * candidates.length)]!;
      const have = onHand(p.id);
      const heavy = highWaste && inLastMonth(d) && outlet === "KITCH";
      let qty = r3(have.times(heavy ? 0.12 + rnd() * 0.15 : 0.01 + rnd() * 0.04));
      if (p.stockUnit === "pc") qty = D(Math.max(1, Math.trunc(Number(qty.toString()))));
      if (qty.lte(0) || qty.gt(have)) continue;
      const [wt, reasonEn] = WASTE_TYPES[Math.trunc(rnd() * WASTE_TYPES.length)]!;
      const reason = N.t(reasonEn);
      const id = randomUUID();
      const deptId = ctx.dept[outlet === "KITCH" ? (rnd() < 0.7 ? "REST" : "KITCH") : outlet]!;
      const stx = L.post({ warehouseId: ctx.wh[store]!, productId: p.id, type: "WASTE", quantity: qty.neg(), txDate: at(d, 15), departmentId: deptId, sourceType: "WASTE", sourceId: id, reason: N.locale === "tr" ? `Fire: ${reason}` : `${wt}: ${reason}`, idempotencyKey: `waste:${id}` });
      w++;
      wasteRows.push({ id, hotelId: H, departmentId: deptId, warehouseId: ctx.wh[store]!, productId: p.id, wasteType: wt, wasteDate: at(d, 15), quantity: qty.toString(), unit: p.stockUnit, stockQty: qty.toString(), unitCost: stx.unitCost.toString(), costValue: stx.totalCost.neg().toString(), reason, status: "APPROVED", userId, stockTxId: stx.id, createdAt: at(d, 15) });
      wasteCount++;
    }
    // staff meals (daily) and complimentary drinks
    for (const p of pickN(rnd, (ctx.byCat.get("DRY") ?? []).concat(ctx.byCat.get("CHICKEN") ?? []), 2)) {
      const have = L.position(ctx.wh.MAIN!, p.id).quantity;
      const qty = r3(Decimal.min(have, D(1.5 + rnd() * 3)));
      if (qty.gt(0)) L.post({ warehouseId: ctx.wh.MAIN!, productId: p.id, type: "STAFF_MEAL", quantity: qty.neg(), txDate: at(d, 13), departmentId: ctx.dept.KITCH!, sourceType: "MANUAL", reason: N.t("Staff canteen") });
    }
    if (rnd() < 0.5) {
      const p = (ctx.byCat.get("BEV") ?? []).find((x) => L.position(ctx.wh.BAR!, x.id).quantity.gte(2));
      if (p) L.post({ warehouseId: ctx.wh.BAR!, productId: p.id, type: "COMPLIMENTARY", quantity: -2, txDate: at(d, 19), departmentId: ctx.dept.BAR!, sourceType: "MANUAL", reason: N.t("VIP welcome") });
    }

    // POS sales (weekly import file), theoretical cost at the end of the sale day (= costTableAsOf)
    if (!weekImport || d.getUTCDay() === 1) {
      weekImport = { id: randomUUID(), rows: 0 };
      imports.push({ id: weekImport.id, hotelId: H, source: "API", fileName: `pos-${ctx.hotel.code}-${ymd(d)}.json`, fileHash: createHash("sha256").update(`${H}|${ymd(d)}`).digest("hex"), mappingVersion: "v1", importedById: userId, status: "POSTED", createdAt: at(d, 23) });
    }
    for (const s of plan[i]!) {
      const v = versionAt(s.r, d);
      const saleDate = at(d, [9, 13, 20, 23][s.slot] ?? 20);
      let unit: Decimal | null = null;
      if (v) {
        let sum = ZERO;
        for (const [p, q] of v.req) sum = sum.plus(q.times(L.costNow(p) ?? ZERO));
        unit = sum.div(v.portions);
      }
      const qty = D(s.qty);
      const price = s.r.price * (v ? 1 + 0.04 * (s.r.versions.indexOf(v)) : 1);
      weekImport.rows++;
      saleRows.push({ hotelId: H, importId: weekImport.id, sourceRow: weekImport.rows, externalId: `POS-${ctx.hotel.code}-${ymd(d)}-${++saleNo}`, saleDate, departmentId: ctx.dept[s.r.outlet === "ROOMSVC" ? "REST" : s.r.outlet]!, recipeId: s.r.id, recipeVersionId: v?.id ?? null, posCode: s.r.code, quantity: qty.toString(), netRevenue: toStorage(D(price).times(qty).times(0.97 + rnd() * 0.04)).toString(), theoreticalUnitCost: unit ? toStorage(unit).toString() : null, theoreticalCost: unit ? toStorage(qty.times(unit)).toString() : null });
    }

    // month-end physical counts for kitchen, bar and pastry stores (spec 179-182; scenario 14 shrinkage)
    const tomorrow = new Date(d.getTime() + DAY);
    if (tomorrow.getUTCDate() === 1) {
      for (const store of ["KITCH", "BAR", "PAST"]) {
        const countId = randomUUID();
        const number = `CNT-${String(++cnt).padStart(6, "0")}`;
        const cd = at(d, 23, 30);
        counts.push({ id: countId, hotelId: H, warehouseId: ctx.wh[store]!, number, countDate: cd, status: "POSTED", countedById: userId, postedAt: cd, note: N.t("Month-end count") });
        for (const p of ctx.products) {
          const pos = L.position(ctx.wh[store]!, p.id);
          if (pos.quantity.lte(0)) continue;
          let counted = pos.quantity;
          if (store === "BAR" && shrinkBar && p.cat.code === "BAR") counted = r3(pos.quantity.times(0.94 + rnd() * 0.03));
          else if (rnd() < 0.12) counted = r3(pos.quantity.times(0.97 + rnd() * 0.04));
          if (p.stockUnit === "pc") counted = D(Math.trunc(Number(counted.toString())));
          const variance = counted.minus(pos.quantity);
          if (variance.isZero()) {
            countLines.push({ countId, productId: p.id, systemQty: pos.quantity.toString(), countedQty: counted.toString(), varianceQty: "0", unitCost: pos.avgCost.toString(), varianceValue: "0" });
            continue;
          }
          const stx = L.post({ warehouseId: ctx.wh[store]!, productId: p.id, type: "COUNT_ADJUSTMENT", quantity: variance, txDate: cd, sourceType: "COUNT", sourceId: countId, reason: N.locale === "tr" ? `Sayım ${number}` : `Count ${number}`, idempotencyKey: `count:${countId}:${p.id}` });
          countLines.push({ countId, productId: p.id, systemQty: pos.quantity.toString(), countedQty: counted.toString(), varianceQty: toStorage(variance).toString(), unitCost: stx.unitCost.toString(), varianceValue: stx.totalCost.toString() });
        }
      }
    }
  }
  if (highWaste) scenario(ctx, "S02_HIGH_WASTE", "Kitchen waste 12-27 % of stock on hand during the last full month", "EDGE_CASE", "Waste % above target; waste report top items", "Warehouse", [ctx.wh.KITCH!]);
  if (shrinkBar) scenario(ctx, "S14_UNEXPLAINED_SHRINKAGE", "Bar spirits 3-6 % short at every month-end count", "EDGE_CASE", "Count variance / unexplained variance on spirits", "Warehouse", [ctx.wh.BAR!]);
  scenario(ctx, "S05_CRITICAL_STOCK", "No deliveries in the last week for selected products", "EDGE_CASE", "Inventory status CRITICAL / OUT_OF_STOCK; order recommendations", "Product", criticalSkip.map((p) => p.id));

  // minibar store stock (monthly delivery, issued by the minibar service phase)
  for (const [i, d] of ctx.days.entries()) {
    if (d.getUTCDate() !== 1 && i !== 0) continue;
    const lines = minibarProducts.map((id) => ({ p: pm.get(id)!, stockQty: ctx.rooms.length * 1.2 + 24 }));
    const before = L.stock.length;
    receive(d, 7, lines);
    // the minibar delivery goes to the minibar store: move it there right away
    for (const row of L.stock.slice(before)) if (row.type === "PURCHASE") L.transfer(ctx.wh.MAIN!, ctx.wh.MINIBAR!, row.productId, row.quantity as string, at(d, 7));
  }

  // ── write everything ──
  const flushed = await L.flush(db);
  const chunk = async <T,>(rows: T[], fn: (c: T[]) => Promise<unknown>, n = 5000) => {
    for (let i = 0; i < rows.length; i += n) await fn(rows.slice(i, i + n));
  };
  await chunk(receipts, (c) => db.goodsReceipt.createMany({ data: c }));
  await chunk(items, (c) => db.goodsReceiptItem.createMany({ data: c }));
  await chunk(invoices, (c) => db.invoice.createMany({ data: c }));
  await chunk(invoiceItems, (c) => db.invoiceItem.createMany({ data: c }));
  await chunk(prices, (c) => db.supplierPrice.createMany({ data: c }));
  await chunk(alerts, (c) => db.alert.createMany({ data: c }));
  await chunk(wasteRows, (c) => db.wasteRecord.createMany({ data: c }));
  const byImport = new Map<string, number>();
  for (const s of saleRows) byImport.set(s.importId!, (byImport.get(s.importId!) ?? 0) + 1);
  await chunk(imports.map((x) => ({ ...x, rowCount: byImport.get(x.id!) ?? 0, validCount: byImport.get(x.id!) ?? 0 })), (c) => db.salesImport.createMany({ data: c }));
  await chunk(saleRows, (c) => db.saleLine.createMany({ data: c }));
  await chunk(counts, (c) => db.stockCount.createMany({ data: c }));
  await chunk(countLines, (c) => db.stockCountLine.createMany({ data: c }));
  // reorder levels from the observed usage (spec: critical stock needs a reorder point). Reorder point and safety
  // stock live on the automatic-ordering rules ("Otomatik sipariş"): paused rules, so nothing is ever e-mailed
  // from demo data, while stock status and order recommendations read their thresholds
  const usage = await db.$queryRaw<Array<{ productId: string; q: Prisma.Decimal }>>`SELECT "productId", -SUM(quantity) q FROM "StockTransaction" WHERE "hotelId" = ${H} AND type IN ('CONSUMPTION','WASTE','STAFF_MEAL') GROUP BY 1`;
  const supplierOf = new Map((await db.product.findMany({ where: { hotelId: H }, select: { id: true, defaultSupplierId: true } })).map((p) => [p.id, p.defaultSupplierId]));
  const rules: Prisma.AutoOrderRuleCreateManyInput[] = [];
  for (const u of usage) {
    const perDay = Number(u.q.toString()) / ctx.days.length;
    if (perDay <= 0) continue;
    await db.product.update({ where: { id: u.productId }, data: { minStock: (perDay * 2).toFixed(3), maxStock: (perDay * 14).toFixed(3), leadTimeDays: 2 } });
    const supplierId = supplierOf.get(u.productId);
    if (supplierId) rules.push({ hotelId: H, productId: u.productId, supplierId, reorderPoint: (perDay * 3).toFixed(3), safetyStock: (perDay * 1.5).toFixed(3), orderQty: Math.max(perDay * 11, 0.001).toFixed(3), active: false });
  }
  await chunk(rules, (c) => db.autoOrderRule.createMany({ data: c, skipDuplicates: true }));
  return { stock: flushed.stock, sales: saleRows.length, waste: wasteCount, buffetPlan, minibarProducts };
}

// ───────────────────────── services phase ─────────────────────────

/** PMS driver data and the buffets (the slow part of a hotel: every line goes through the real services). */
async function buffetPhase(ctx: Ctx, pms: Pms, sim: SimResult) {
  const { db, rnd, hotelId: H, admin } = ctx;
  const t0 = Date.now();
  const lap = (what: string) => ctx.log(`${what} (${Date.now() - t0} ms)`);
  // PMS (spec 72-75 driver data)
  await commitReservations(db, admin, H, `pms-reservations-${ctx.hotel.code}.csv`, pms.reservations);
  await commitOccupancy(db, admin, H, `pms-daily-${ctx.hotel.code}.csv`, ctx.days.map((d) => {
    const v = pms.nightly.get(ymd(d)) ?? { occ: 0, guests: 0, rev: 0 };
    return { business_date: ymd(d), available_rooms: String(ctx.rooms.length), occupied_rooms: String(Math.min(v.occ, ctx.rooms.length)), out_of_order: "0", guests: String(v.guests), room_revenue: v.rev.toFixed(2) };
  }));

  lap("pms");
  // buffets through the real service (spec 68-70): production + refill, leftovers by severity level
  let buffets = 0;
  const overproduction: string[] = [];
  for (const b of sim.buffetPlan) {
    const stocked = await db.stockBalance.count({ where: { warehouseId: ctx.wh.KITCH!, productId: { in: b.items.map((x) => x.productId) }, quantity: { gt: 1 } } });
    if (!stocked) continue;
    const s = await createSession(db, admin, H, { departmentId: ctx.dept.BRKF, warehouseId: ctx.wh.KITCH, type: "BREAKFAST", serviceDate: b.day, expectedCovers: b.expected, occupiedRooms: rint(b.covers / 1.9), inHouseGuests: rint(b.covers * 1.1), boardBasis: ctx.hotel.resort ? "AI" : "BB" });
    const leftovers: Array<{ key: string; quantity: string; class: string }> = [];
    for (const it of b.items) {
      const pos = await db.stockBalance.findUnique({ where: { warehouseId_productId: { warehouseId: ctx.wh.KITCH!, productId: it.productId } } });
      const have = Number(pos?.quantity.toString() ?? 0);
      const planned = b.expected * it.perCover;
      const first = Math.min(have * 0.6, planned * 0.8);
      const refill = Math.min(have * 0.35, planned * (0.25 + rnd() * 0.15));
      const round = (x: number) => (it.unit === "pc" ? Math.trunc(x) : +x.toFixed(3));
      if (round(first) <= 0) continue;
      await addLine(db, admin, H, s.id, { kind: "PRODUCTION", productId: it.productId, quantity: round(first), unit: it.unit });
      if (round(refill) > 0) await addLine(db, admin, H, s.id, { kind: "REFILL", productId: it.productId, quantity: round(refill), unit: it.unit });
      const produced = round(first) + (round(refill) > 0 ? round(refill) : 0);
      const left = produced * (b.level + rnd() * 0.02);
      const waste = round(left * 0.6);
      const staff = round(left * 0.15);
      if (waste > 0) leftovers.push({ key: it.productId, quantity: String(waste), class: "WASTE" });
      if (staff > 0) leftovers.push({ key: it.productId, quantity: String(staff), class: "STAFF_MEAL" });
    }
    if (!(await db.buffetLine.count({ where: { sessionId: s.id } }))) continue;
    await closeSession(db, admin, H, s.id, { actualCovers: b.covers, leftovers });
    if (b.level >= 0.1) overproduction.push(s.id);
    buffets++;
  }
  scenario(ctx, "S08_BUFFET_OVERPRODUCTION", "Buffets with 10-18 % leftovers (high / critical waste levels)", "EDGE_CASE", "Buffet waste % HIGH / CRITICAL; cost per cover", "BuffetSession", overproduction);

  lap(`buffets ${buffets}`);
}

async function servicesPhase(ctx: Ctx, pms: Pms, sim: SimResult) {
  const { db, admin, hotelId: H, n: N } = ctx;
  const t0 = Date.now();
  const lap = (what: string) => ctx.log(`${what} (${Date.now() - t0} ms)`);
  // minibar through the real service (spec 71; scenario 9 discrepancies)
  const mbRooms = await minibarPhase(ctx, sim);

  // operating expenses (spec 76-78): payroll from employees, utilities with a spike, contracts, repairs, daily small costs
  lap("minibar");
  await operatingCosts(ctx, pms);
  await roomCostItemsPhase(ctx, pms);
  lap("operating costs");

  // allocation (spec 145) for every full month
  const opDepts = ["ROOMS", "HK", "LAUN", "REST", "CAFE", "BAR", "BRKF", "BANQ", "KITCH", "PAST"];
  await createRule(db, admin, H, { name: N.t("Electricity by sub-meter"), sourceCategoryGroup: "ENERGY", sourceSubCategory: "ELECTRICITY", sourceDepartmentId: null, driver: "METER", targets: ["ROOMS", "KITCH", "LAUN", "REST"].map((c) => ({ departmentId: ctx.dept[c]! })) });
  await createRule(db, admin, H, { name: N.t("Water by sub-meter"), sourceCategoryGroup: "ENERGY", sourceSubCategory: "WATER", sourceDepartmentId: null, driver: "METER", targets: ["ROOMS", "LAUN", "KITCH"].map((c) => ({ departmentId: ctx.dept[c]! })) });
  await createRule(db, admin, H, { name: N.t("Natural gas by sub-meter"), sourceCategoryGroup: "ENERGY", sourceSubCategory: "GAS", sourceDepartmentId: null, driver: "METER", targets: ["KITCH", "LAUN"].map((c) => ({ departmentId: ctx.dept[c]! })) });
  await createRule(db, admin, H, { name: N.t("Engineering department by m²"), sourceCategoryGroup: "ALL", sourceDepartmentId: ctx.dept.ENG, driver: "SQM", targets: opDepts.map((c) => ({ departmentId: ctx.dept[c]! })) });
  const fullMonths = [...ctx.periods.entries()].filter(([code]) => code < ym(ctx.end) || new Date(Date.UTC(ctx.end.getUTCFullYear(), ctx.end.getUTCMonth() + 1, 0)).getTime() === ctx.end.getTime());
  for (const [, pid] of fullMonths) await postAllocation(db, admin, H, pid);

  lap("allocation");
  // budget (spec 81): from the first full month's run rate, seasonality-weighted; scenario 13 overrun
  const first = fullMonths[0];
  if (first) {
    const p = await db.costPeriod.findUniqueOrThrow({ where: { id: first[1] } });
    const fmFrom = p.startDate;
    const fmTo = new Date(p.endDate.getTime() + DAY);
    const byDeptCat = await db.costTransaction.groupBy({ by: ["departmentId", "categoryGroup"], where: { hotelId: H, txDate: { gte: fmFrom, lt: fmTo } }, _sum: { amount: true } });
    const rev = await db.saleLine.groupBy({ by: ["departmentId"], where: { hotelId: H, saleDate: { gte: fmFrom, lt: fmTo } }, _sum: { netRevenue: true } });
    const year = ctx.end.getUTCFullYear();
    const base = seasonFactor(ctx.hotel.resort, fmFrom);
    const overrun = ctx.rnd() < 0.5 || ctx.isQa;
    const lines = new Map<string, { month: number; departmentId: string | null; categoryGroup: string; amount: number; targetPct: string | null }>();
    for (let m = 1; m <= 12; m++) {
      const f = seasonFactor(ctx.hotel.resort, new Date(Date.UTC(year, m - 1, 15))) / base;
      for (const x of byDeptCat) {
        const amt = Number(x._sum.amount?.toString() ?? 0);
        if (amt <= 0 || x.categoryGroup === "ALL") continue;
        const fixed = ["LABOR", "RENT", "INSURANCE", "DEPRECIATION", "ADMINISTRATION", "SALES_MARKETING"].includes(x.categoryGroup);
        const squeeze = overrun && (x.categoryGroup === "FOOD" || x.categoryGroup === "BEVERAGE") ? 0.82 : 0.97;
        const k = `${m}|${x.departmentId ?? ""}|${x.categoryGroup}`;
        const cur = lines.get(k);
        const add = amt * (fixed ? 1 : f) * squeeze;
        lines.set(k, { month: m, departmentId: x.departmentId, categoryGroup: x.categoryGroup, amount: (cur?.amount ?? 0) + add, targetPct: x.categoryGroup === "FOOD" ? "0.28" : x.categoryGroup === "BEVERAGE" ? "0.14" : null });
      }
      for (const r of rev) lines.set(`${m}|${r.departmentId}|REVENUE`, { month: m, departmentId: r.departmentId, categoryGroup: "REVENUE", amount: Number(r._sum.netRevenue?.toString() ?? 0) * f * 1.03, targetPct: null });
    }
    const bud = await createBudget(db, admin, H, { year, name: N.locale === "tr" ? `Bütçe ${year}` : `Budget ${year}`, notes: N.t(overrun ? "F&B cost budget set 18 % below run rate (scenario 13: overrun)" : "Seasonality-weighted run rate, 3 % efficiency") });
    await setBudgetLines(db, admin, H, bud.id, [...lines.values()].filter((l) => l.amount > 0).map((l) => ({ ...l, amount: l.amount.toFixed(2) })));
    await approveBudget(db, admin, H, bud.id);
    if (overrun) scenario(ctx, "S13_BUDGET_OVERRUN", "Food & beverage cost budget below the actual run rate", "EDGE_CASE", "Budget vs actual: unfavourable variance on FOOD / BEVERAGE", "Budget", [bud.id]);
  }
  for (const [metric, target, warnAt] of [["FOOD_COST_PCT", "0.32", "0.30"], ["BEVERAGE_COST_PCT", "0.16", "0.14"], ["WASTE_PCT", "0.02", "0.015"], ["UNEXPLAINED_VARIANCE_PCT", "0.03", "0.02"], ["LABOR_COST_PCT", "0.32", "0.30"], ["ENERGY_PER_OCCUPIED_ROOM", "320", "300"], ["COST_PER_OCCUPIED_ROOM", "3200", "3000"], ["BUFFET_COST_PER_COVER", "140", "125"], ["MINIBAR_SHRINKAGE_PCT", "0.03", "0.02"]] as const) await createTarget(db, admin, H, { metric, target, warnAt });
  const sa = await createAction(db, admin, H, { driver: "WASTE", problem: N.t("Buffet leftovers above 10 % on low-occupancy days"), rootCause: N.t("Production not linked to expected covers"), action: N.t("Cook in waves from the cover forecast; smaller refill trays"), ownerName: N.position("Breakfast Chef"), targetSaving: "15000", dueDate: new Date(ctx.end.getTime() + 20 * DAY), departmentId: ctx.dept.BRKF });
  await updateAction(db, admin, H, sa.id, { status: "IN_PROGRESS" });
  const sb = await createAction(db, admin, H, { driver: "SUPPLIER_PRICE", problem: N.t("Protein prices up 15-30 % at the main supplier"), rootCause: N.t("Single-source contract"), action: N.t("Tender with two alternative suppliers"), ownerName: N.position("Purchasing Manager"), targetSaving: "25000", dueDate: new Date(ctx.end.getTime() - 10 * DAY) });
  await updateAction(db, admin, H, sb.id, { status: "DONE", actualSaving: "19800" });
  await ensureDefaultTasks(db, H);
  ctx.log(`minibar rooms ${mbRooms.length}`);
}

/** Minibar through the real service (spec 71; scenario 9 discrepancies). */
async function minibarPhase(ctx: Ctx, sim: SimResult) {
  const { db, rnd, hotelId: H, admin } = ctx;
  if (!sim.minibarProducts.length) return [];
  const parPrice = [90, 60, 75, 70, 140];
  for (const rt of ROOM_TYPES) for (const [k, pid] of sim.minibarProducts.entries()) await setPar(db, admin, H, { roomType: ctx.n.roomType(rt.type), productId: pid, parQty: rt.type === "Standard" ? 2 : 3, sellingPrice: parPrice[k % parPrice.length] });
  const mbRooms = pickN(rnd, ctx.rooms, Math.min(ctx.rooms.length, Math.max(4, ctx.profile.minibarRoomsPerDay * 6)));
  for (const r of mbRooms) await restockToParLevels(db, admin, H, r.id, at(ctx.days[0]!, 9));
  const discrepancy: string[] = [];
  for (const [i, d] of ctx.days.entries()) {
    for (const r of pickN(rnd, mbRooms, ctx.profile.minibarRoomsPerDay)) {
      const items: Array<{ productId: string; quantity: string }> = [];
      for (const pid of sim.minibarProducts) {
        if (rnd() > 0.4) continue;
        const have = Number(await roomQty(db, H, r.id, pid));
        if (have > 0) items.push({ productId: pid, quantity: String(Math.min(have, 1 + Math.trunc(rnd() * 2))) });
      }
      if (items.length) await recordMovement(db, admin, H, { roomId: r.id, type: "CONSUMED", movedAt: at(d, 10), folioRef: `F-${r.number}-${i}`, items });
      await restockToParLevels(db, admin, H, r.id, at(d, 11));
    }
    if (i % 14 === 13) {
      for (const r of pickN(rnd, mbRooms, 2)) {
        const lines = [];
        for (const pid of sim.minibarProducts) {
          const have = Number(await roomQty(db, H, r.id, pid));
          const short = rnd() < 0.25 && have > 0;
          lines.push({ productId: pid, countedQty: String(short ? have - 1 : have) });
          if (short) discrepancy.push(r.id);
        }
        await countRoom(db, admin, H, { roomId: r.id, countedAt: at(d, 15), lines });
      }
    }
  }
  scenario(ctx, "S09_MINIBAR_DISCREPANCY", "Minibar counts short against the room sub-ledger", "EDGE_CASE", "Minibar shrinkage per room", "Room", [...new Set(discrepancy)]);
  return mbRooms;
}

/**
 * Monthly room cost expenses as entered on the Room cost expenses screen (not in the ledger): HK staff meals,
 * uniforms / laundry and room supplies (water: 2 bottles per guest night). HK salaries are already in the
 * payroll postings, so the demo does not enter them again.
 */
async function roomCostItemsPhase(ctx: Ctx, pms: Pms) {
  const { db, hotelId: H, n: N } = ctx;
  const hk = await db.employee.count({ where: { hotelId: H, departmentId: ctx.dept.HK } });
  const names = N.locale === "tr"
    ? ["Kat hizmetleri personel yemek gideri", "Personel kıyafet / yıkama gideri (tahmini)", "Oda giderleri (tahmini: kâğıt ürünleri, su, deterjan vb.)"]
    : ["Housekeeping staff meals", "Staff uniforms / laundry (estimate)", "Room supplies (estimate: paper products, water, detergent…)"];
  const guests = new Map<string, number>();
  for (const d of ctx.days) guests.set(ymd(d).slice(0, 7), (guests.get(ymd(d).slice(0, 7)) ?? 0) + (pms.nightly.get(ymd(d))?.guests ?? 0));
  const data = [...guests].flatMap(([month, g]) => [hk * 26 * 140, hk * 450, g * (2 * 8 + 6)].map((amount, i) => ({ hotelId: H, month, name: names[i]!, amount: amount.toFixed(2), sortOrder: i })));
  if (data.length) await db.roomCostItem.createMany({ data });
}

async function operatingCosts(ctx: Ctx, pms: Pms) {
  const { db, rnd, hotelId: H, n: N } = ctx;
  // "Payroll ROOMS 2026-10" in English; "Maaş - Odalar 2026-10" in Turkish
  const forDept = (what: string, code: string | null, m: string) => (N.locale === "tr" ? `${N.t(what)} - ${code ? N.dept(code, code) : "Otel geneli"} ${m}` : `${what} ${code} ${m}`);
  const cc = new Map((await db.costCenter.findMany({ where: { hotelId: H } })).map((c) => [c.departmentId, c.id]));
  const emps = await db.employee.groupBy({ by: ["departmentId"], where: { hotelId: H }, _sum: { monthlyCost: true }, _count: true });
  const expenses: Prisma.ExpenseCreateManyInput[] = [];
  const costs: Prisma.CostTransactionCreateManyInput[] = [];
  const invoices: Prisma.InvoiceCreateManyInput[] = [];
  const energySupplier = ctx.suppliers[10]!;
  const serviceSupplier = ctx.suppliers[11]!;
  let seq = 0;
  const LABOR_FIXED = new Set(["SALARY", "EMPLOYER_COST", "BENEFITS"]);
  const post = (date: Date, deptCode: string | null, category: string, sub: string | null, description: string, amount: number, extra: { quantity?: number; unit?: string; supplier?: { id: string; name: string }; roomId?: string; assetId?: string } = {}) => {
    if (amount <= 0) return;
    const id = randomUUID();
    const ctId = randomUUID();
    const departmentId = deptCode ? ctx.dept[deptCode]! : null;
    const costType = category === "LABOR" && sub && LABOR_FIXED.has(sub) ? "FIXED" : category === "DEPRECIATION" ? "NON_OPERATING" : "OPEX";
    const amt = toStorage(D(amount));
    const periodId = ctx.periods.get(ym(date))!;
    const invoiceNo = extra.supplier ? `${extra.supplier.name.split(" ")[0]!.toUpperCase().slice(0, 4)}-E${++seq}` : null;
    expenses.push({ id, hotelId: H, expenseDate: date, periodId, departmentId, costCenterId: departmentId ? (cc.get(departmentId) ?? null) : null, categoryGroup: category, subCategory: sub, description, amount: amt.toString(), taxAmount: toStorage(amt.times(0.2)).toString(), quantity: extra.quantity ? String(extra.quantity) : null, unit: extra.unit ?? null, costType, supplierName: extra.supplier?.name ?? null, invoiceNo, roomId: extra.roomId ?? null, assetId: extra.assetId ?? null, source: "ACCOUNTING", externalId: `GL-${ctx.hotel.code}-${++seq}`, costTxId: ctId, createdById: ctx.admin.userId });
    costs.push({ id: ctId, hotelId: H, periodId, txDate: date, departmentId, costCenterId: departmentId ? (cc.get(departmentId) ?? null) : null, categoryGroup: category, costType, nature: "DIRECT", kind: "EXPENSE", amount: amt.toString(), quantity: extra.quantity ? String(extra.quantity) : null, sourceType: "EXPENSE", sourceId: id, userId: ctx.admin.userId, origin: "IMPORTED" });
    if (extra.supplier && invoiceNo) invoices.push({ hotelId: H, supplierId: extra.supplier.id, number: invoiceNo, invoiceDate: date, netTotal: amt.toString(), taxTotal: toStorage(amt.times(0.2)).toString(), grossTotal: toStorage(amt.times(1.2)).toString(), receiptIds: [] });
  };
  // assets & meters (master data)
  const assetDefs: Array<[string, string, string, string]> = [["HVAC-CH1", "Central chiller 1", "HVAC", "ENG"], ["KIT-OVEN1", "Combi oven", "OVEN", "KITCH"], ["KIT-DW1", "Flight dishwasher", "DISHWASHER", "KITCH"], ["KIT-CR1", "Cold room", "REFRIGERATOR", "KITCH"], ["LAU-WM1", "Washer extractor", "LAUNDRY", "LAUN"], ["ELV-1", "Guest elevator", "ELEVATOR", "ENG"], ["POOL-1", "Pool filtration", "POOL", "ENG"]];
  const assets = assetDefs.map(([code, name, kind, d]) => ({ id: randomUUID(), hotelId: H, code, name: N.t(name), kind, departmentId: ctx.dept[d]! }));
  await db.asset.createMany({ data: assets });
  const meterDefs: Array<[string, string, string, string, string, number]> = [["E-ROOMS", "Electricity rooms", "ELECTRICITY", "kWh", "ROOMS", 18], ["E-KITCH", "Electricity kitchen", "ELECTRICITY", "kWh", "KITCH", 900], ["E-LAUN", "Electricity laundry", "ELECTRICITY", "kWh", "LAUN", 650], ["E-REST", "Electricity restaurant", "ELECTRICITY", "kWh", "REST", 420], ["W-ROOMS", "Water rooms", "WATER", "m3", "ROOMS", 0.35], ["W-LAUN", "Water laundry", "WATER", "m3", "LAUN", 13], ["W-KITCH", "Water kitchen", "WATER", "m3", "KITCH", 8], ["G-KITCH", "Gas kitchen", "GAS", "m3", "KITCH", 150], ["G-LAUN", "Gas laundry", "GAS", "m3", "LAUN", 110]];
  const readings: Prisma.MeterReadingCreateManyInput[] = [];
  const monthUse = new Map<string, number>();
  for (const [code, name, utility, unit, d, daily] of meterDefs) {
    const id = randomUUID();
    await db.meter.create({ data: { id, hotelId: H, code, name: N.t(name), utility, unit, departmentId: ctx.dept[d]! } });
    let value = 100000 + Math.trunc(rnd() * 40000);
    readings.push({ meterId: id, readingDate: new Date(ctx.start.getTime() - DAY), value: String(value), createdById: ctx.admin.userId });
    for (const day of ctx.days) {
      const occ = pms.nightly.get(ymd(day))?.occ ?? 0;
      const use = (d === "ROOMS" ? daily * occ : daily * (d === "LAUN" ? 0.4 + (0.6 * occ) / ctx.rooms.length : 1)) * (0.9 + rnd() * 0.2);
      value += use;
      monthUse.set(`${ym(day)}|${utility}`, (monthUse.get(`${ym(day)}|${utility}`) ?? 0) + use);
      readings.push({ meterId: id, readingDate: day, value: value.toFixed(1), createdById: ctx.admin.userId });
    }
  }
  for (let i = 0; i < readings.length; i += 5000) await db.meterReading.createMany({ data: readings.slice(i, i + 5000) });
  await db.laundryLog.createMany({ data: ctx.days.flatMap((day) => { const occ = pms.nightly.get(ymd(day))?.occ ?? 0; return [{ hotelId: H, logDate: day, source: "ROOMS", kg: (occ * 3.4 * (0.9 + rnd() * 0.2)).toFixed(1), pieces: rint(occ * 9.5) }, { hotelId: H, logDate: day, source: "F_AND_B", kg: (30 + rnd() * 25).toFixed(1), pieces: rint(200 + rnd() * 140) }]; }) });

  const energySpikeMonth = ym(new Date(Date.UTC(ctx.end.getUTCFullYear(), ctx.end.getUTCMonth() - 1, 1)));
  const raiseMonth = Math.max(0, Math.trunc(ctx.profile.months / 2));
  const roomSpikeMonth = energySpikeMonth;
  const months = [...ctx.periods.keys()];
  for (const [mi, m] of months.entries()) {
    const mStart = new Date(`${m}-01T00:00:00Z`);
    const mEnd = new Date(Date.UTC(mStart.getUTCFullYear(), mStart.getUTCMonth() + 1, 0, 12));
    if (mEnd > ctx.end && mi < months.length - 1) continue;
    const closeDate = mEnd > ctx.end ? at(ctx.end, 12) : mEnd;
    const part = mEnd > ctx.end ? (ctx.end.getUTCDate() / mEnd.getUTCDate()) : 1;
    // payroll (spec 77): salary + employer share + overtime; scenario 12 raise mid-history and overtime spike
    const raise = mi >= raiseMonth ? 1.25 : 1;
    for (const e of emps) {
      const code = Object.entries(ctx.dept).find(([, id]) => id === e.departmentId)?.[0] ?? null;
      const base = Number(e._sum.monthlyCost?.toString() ?? 0) * raise * part;
      post(closeDate, code, "LABOR", "SALARY", forDept("Payroll", code, m), base, { quantity: e._count, unit: "headcount" });
      post(closeDate, code, "LABOR", "EMPLOYER_COST", forDept("SGK employer share", code, m), base * 0.2275);
      if (["KITCH", "REST", "HK", "BANQ"].includes(code ?? "")) post(closeDate, code, "LABOR", "OVERTIME", forDept("Overtime", code, m), base * (mi === raiseMonth ? 0.14 : 0.04 + rnd() * 0.03));
    }
    // utilities from metered use + common areas (scenario 11 spike)
    const spike = m === energySpikeMonth ? 1.45 : 1;
    const kwh = (monthUse.get(`${m}|ELECTRICITY`) ?? 0) * 1.2;
    post(closeDate, null, "ENERGY", "ELECTRICITY", `${N.t("Electricity")} ${m}`, kwh * 3.1 * spike, { quantity: rint(kwh), unit: "kWh", supplier: energySupplier });
    const water = (monthUse.get(`${m}|WATER`) ?? 0) * 1.25;
    post(closeDate, null, "ENERGY", "WATER", `${N.t("Water")} ${m}`, water * 46, { quantity: rint(water), unit: "m3", supplier: energySupplier });
    const gas = (monthUse.get(`${m}|GAS`) ?? 0) * 1.05;
    post(closeDate, null, "ENERGY", "GAS", `${N.t("Natural gas")} ${m}`, gas * 14.2 * spike, { quantity: rint(gas), unit: "m3", supplier: energySupplier });
    if (ctx.hotel.resort) post(closeDate, "KITCH", "ENERGY", "LPG", `${N.t("LPG")} ${m}`, (9000 + rnd() * 4000) * part, { supplier: energySupplier });
    post(closeDate, "ENG", "ENERGY", "FUEL", `${N.t("Generator diesel")} ${m}`, (3000 + rnd() * 3000) * part, { supplier: energySupplier });
    // contracts and fixed costs
    for (const [d, cat, sub, desc, amt] of [["HK", "HOUSEKEEPING", "OUTSOURCED", "Facade & window cleaning contract", 18500], ["LAUN", "LAUNDRY", "CHEMICALS", "Laundry chemicals contract", 15800], ["ADM", "ADMINISTRATION", "IT", "PMS / POS licences", 26000], ["FIN", "ADMINISTRATION", "AUDIT", "External audit fee", 15000], ["SM", "SALES_MARKETING", "ADVERTISING", "Online advertising", 42000], ["ENG", "ENGINEERING", "PREVENTIVE_MAINTENANCE", "Elevator maintenance contract", 9500], [null, "RENT", "RENT", "Land lease", 250000], [null, "INSURANCE", "INSURANCE", "Property insurance", 31000], [null, "DEPRECIATION", "DEPRECIATION", "Depreciation", 185000]] as const) {
      post(closeDate, d === "ADM" ? "FIN" : d, cat, sub, `${N.t(desc)} ${m}`, amt * part, { supplier: serviceSupplier });
    }
    // room repairs (scenario 10 spike) and engineering jobs on assets
    const repairs = rint((m === roomSpikeMonth ? 14 : 4) * part);
    for (let k = 0; k < repairs; k++) {
      const r = ctx.rooms[Math.trunc(rnd() * ctx.rooms.length)]!;
      post(new Date(mStart.getTime() + Math.trunc(rnd() * Math.max(1, (closeDate.getTime() - mStart.getTime()) / DAY)) * DAY + 13 * 3600_000), "ROOMS", "ENGINEERING", "EMERGENCY_REPAIR", `${N.t("Room")} ${r.number}: ${N.t(rnd() < 0.5 ? "AC failure" : "water leak")}`, 900 + rnd() * (m === roomSpikeMonth ? 9000 : 3300), { roomId: r.id, supplier: serviceSupplier });
    }
  }
  scenario(ctx, "S10_ROOM_COST_SPIKE", "Emergency room repairs x3 in the last full month", "EDGE_CASE", "Room cost per night up; engineering cost per room", "Hotel", [H]);
  scenario(ctx, "S11_ENERGY_SPIKE", "Electricity and gas +45 % in the last full month", "EDGE_CASE", "Energy cost per occupied room above target", "Hotel", [H]);
  scenario(ctx, "S12_LABOR_INCREASE", "25 % payroll increase mid-history and an overtime spike", "NORMAL", "Labor cost % trend; forecast picks up the new level", "Hotel", [H]);
  // daily small expenses (market purchases, transport, small repairs...) to realistic volume
  const small: Array<[string, string, string, string, number]> = [["KITCH", "OTHER", "MARKET", "Local market purchase", 900], ["ENG", "ENGINEERING", "SPARE_PARTS", "Small spare parts", 1400], ["HK", "HOUSEKEEPING", "SUPPLIES", "Housekeeping small supplies", 650], ["FO", "ROOMS_OTHER", "FRONT_OFFICE", "Front office supplies", 380], ["SM", "SALES_MARKETING", "PRINT", "Printed material", 1200], ["FIN", "ADMINISTRATION", "BANK", "Bank & POS charges", 520], ["HR", "ADMINISTRATION", "TRAINING", "Staff training", 1800], ["LAUN", "LAUNDRY", "OUTSOURCING", "Dry cleaning (guest)", 760]];
  for (const day of ctx.days) {
    const n = rint(ctx.profile.dailyExpenses * (0.7 + rnd() * 0.6));
    for (let k = 0; k < n; k++) {
      const [d, cat, sub, desc, amt] = small[Math.trunc(rnd() * small.length)]!;
      post(at(day, 10 + (k % 8)), d, cat, sub, N.t(desc), amt * (0.5 + rnd()), rnd() < 0.45 ? { supplier: serviceSupplier, assetId: d === "ENG" ? assets[Math.trunc(rnd() * assets.length)]!.id : undefined } : {});
    }
  }
  for (let i = 0; i < expenses.length; i += 5000) await db.expense.createMany({ data: expenses.slice(i, i + 5000) });
  for (let i = 0; i < costs.length; i += 5000) await db.costTransaction.createMany({ data: costs.slice(i, i + 5000) });
  for (let i = 0; i < invoices.length; i += 5000) await db.invoice.createMany({ data: invoices.slice(i, i + 5000) });
}

// ───────────────────────── intentional errors (QA tenant) ─────────────────────────

async function intentionalErrors(ctx: Ctx, recipes: Carry["recipes"]) {
  const { db, hotelId: H, n: N } = ctx;
  const userId = ctx.admin.userId;
  const today = ymd(ctx.end);
  const monthStart = new Date(Date.UTC(ctx.end.getUTCFullYear(), ctx.end.getUTCMonth(), 1));
  const day = monthStart.getTime() > ctx.end.getTime() ? ctx.end : ctx.end;
  // 1) missing recipe / unmatched sales: POS codes without a recipe this month (spec 66, scenario 15)
  const imp = await db.salesImport.create({ data: { hotelId: H, source: "API", fileName: `pos-unmapped-${today}.json`, fileHash: createHash("sha256").update(`${H}|unmapped`).digest("hex"), importedById: userId, status: "POSTED", rowCount: 3, validCount: 3 } });
  const unmapped = [];
  for (const [i, code] of ["CHEF-SPECIAL", "SEASONAL-FISH", "HAPPY-HOUR-2X1"].entries()) unmapped.push((await db.saleLine.create({ data: { hotelId: H, importId: imp.id, sourceRow: i + 1, externalId: `POS-QA-UNMAPPED-${i}`, saleDate: at(day, 20), departmentId: ctx.dept[i === 2 ? "BAR" : "REST"]!, posCode: code, quantity: String(5 + i * 3), netRevenue: String(2400 + i * 900) } })).id);
  scenario(ctx, "E01_MISSING_RECIPE", "POS items sold without a recipe mapping", "INTENTIONAL_ERROR", "Data quality: unmapped sales; theoretical cost missing", "SaleLine", unmapped);
  // 2) product without any cost (no purchase, no price, no standard) used in a recipe → incomplete recipe
  const cat = ctx.products[0]!.categoryId;
  const noCost = await db.product.create({ data: { hotelId: H, sku: "QA-NOCOST", name: N.product("Saffron (no cost yet)"), categoryId: cat, purchaseUnit: "g", stockUnit: "g", recipeUnit: "g" } });
  const r = await db.recipe.create({ data: { hotelId: H, code: "QA-RISOTTO", name: N.dish("Saffron Risotto (incomplete)", ""), type: "RESTAURANT", departmentId: ctx.dept.REST!, posCode: "QA-RISOTTO" } });
  // approved through the back door (an old import): the version is frozen once approved, so lines first
  const v = await db.recipeVersion.create({ data: { recipeId: r.id, version: 1, status: "DRAFT", batchYieldQty: "1", yieldUnit: "portion", portions: "1", createdById: userId } });
  await db.recipeIngredient.create({ data: { versionId: v.id, productId: noCost.id, quantity: "0.5", unit: "g", sortOrder: 0 } });
  await db.recipeVersion.update({ where: { id: v.id }, data: { status: "APPROVED", effectiveFrom: ctx.start, costSnapshot: { portions: "1", requirements: {} } } });
  scenario(ctx, "E02_MISSING_COST", "Ingredient with no purchase, price or standard cost", "INTENTIONAL_ERROR", "Data quality: products without cost; recipe incomplete", "Product", [noCost.id]);
  // 3) missing unit conversion: bought per case, stocked per kg, but nobody defined the case size
  const noConv = await db.product.create({ data: { hotelId: H, sku: "QA-NOCONV", name: N.product("Frozen Fries (case size missing)"), categoryId: cat, purchaseUnit: "case", stockUnit: "kg", recipeUnit: "g", standardCost: "60", defaultSupplierId: ctx.suppliers[5]!.id } });
  scenario(ctx, "E03_MISSING_UNIT", "Purchase unit 'case' without a conversion to kg", "INTENTIONAL_ERROR", "Data quality: purchase unit without conversion", "Product", [noConv.id]);
  // 4) missing supplier
  const noSup = await db.product.create({ data: { hotelId: H, sku: "QA-NOSUP", name: N.product("Truffle Oil (no supplier)"), categoryId: cat, purchaseUnit: "l", stockUnit: "l", recipeUnit: "ml", standardCost: "2400" } });
  scenario(ctx, "E04_MISSING_SUPPLIER", "Stock product without a default supplier", "INTENTIONAL_ERROR", "Data quality: products without default supplier", "Product", [noSup.id]);
  // 6) negative stock: issued before the delivery was booked (allowed negative, as the ledger records it)
  const p = ctx.products.find((x) => x.cat.code === "VEG")!;
  const bal = await db.stockBalance.findUnique({ where: { warehouseId_productId: { warehouseId: ctx.wh.KITCH!, productId: p.id } } });
  const short = D(bal?.quantity.toString() ?? 0).plus(3);
  const { postMovement } = await import("../services/ledger");
  const neg = await postMovement(db, ctx.admin, { hotelId: H, warehouseId: ctx.wh.KITCH!, productId: p.id, type: "CONSUMPTION", quantity: short.neg(), txDate: at(day, 21), departmentId: ctx.dept.REST, sourceType: "MANUAL", reason: N.t("Issued before the delivery note was booked"), allowNegative: true });
  scenario(ctx, "E06_NEGATIVE_STOCK", "Issue booked before the delivery: negative kitchen stock", "INTENTIONAL_ERROR", "Data quality: negative inventory; integrity WARNING", "StockTransaction", [neg.id]);
  // 7) wrong date: a POS line dated 30 days in the future (bypassing the API, as a broken interface would)
  const future = await db.saleLine.create({ data: { hotelId: H, importId: imp.id, sourceRow: 4, externalId: "POS-QA-FUTURE", saleDate: new Date(ctx.end.getTime() + 30 * DAY), departmentId: ctx.dept.CAFE!, recipeId: recipes.find((x) => x.outlet === "CAFE")?.id ?? null, posCode: recipes.find((x) => x.outlet === "CAFE")?.code ?? "X", quantity: "2", netRevenue: "240" } });
  scenario(ctx, "E07_WRONG_DATE", "POS line dated 30 days in the future", "INTENTIONAL_ERROR", "Data quality: future-dated records", "SaleLine", [future.id]);
  // 8) high waste and excessive portions are also present in this tenant (scenarios S02 / S04 forced on)
  scenario(ctx, "E08_HIGH_WASTE_AND_OVERPORTION", "QA tenant has the high-waste and over-portion scenarios switched on", "INTENTIONAL_ERROR", "Variance and waste reports flag them; quality score drops", "Hotel", [H]);
}

async function closePastPeriods(ctx: Ctx) {
  const keepFrom = ym(new Date(Date.UTC(ctx.end.getUTCFullYear(), ctx.end.getUTCMonth() - 1, 1)));
  const old = [...ctx.periods.entries()].filter(([code]) => code < keepFrom);
  for (const [code, id] of old) {
    await ctx.db.costPeriod.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date(`${code}-28T18:00:00Z`), closedById: ctx.admin.userId } });
    await ctx.db.auditLog.create({ data: { hotelId: ctx.hotelId, userId: ctx.admin.userId, action: "PERIOD_CLOSED", entityType: "CostPeriod", entityId: id, source: "DEMO_SEED", reason: ctx.n.t("Historical month closed by the demo generator") } });
  }
}

export async function demoCounts(db: PrismaClient, where: { hotelIds?: string[] } = {}) {
  const h = where.hotelIds ? { hotelId: { in: where.hotelIds } } : { hotel: { organization: { isDemo: true } } };
  const [orgs, hotels, products, recipes, semi, versions, suppliers, sales, stock, consumption, waste, purchases, invoices, minibar, buffets, rooms, employees, expenses, budgets] = await Promise.all([
    db.organization.count({ where: { isDemo: true } }),
    db.hotel.count({ where: { organization: { isDemo: true } } }),
    db.product.count({ where: h }),
    db.recipe.count({ where: h }),
    db.recipe.count({ where: { ...h, type: "SEMI_FINISHED" } }),
    db.recipeVersion.count({ where: { recipe: h } }),
    db.supplier.count({ where: h }),
    db.saleLine.count({ where: h }),
    db.stockTransaction.count({ where: h }),
    db.stockTransaction.count({ where: { ...h, type: "CONSUMPTION" } }),
    db.wasteRecord.count({ where: h }),
    db.goodsReceiptItem.count({ where: { receipt: h } }),
    db.invoice.count({ where: h }),
    db.minibarMovement.count({ where: h }),
    db.buffetSession.count({ where: h }),
    db.room.count({ where: h }),
    db.employee.count({ where: h }),
    db.expense.count({ where: h }),
    db.budget.count({ where: h }),
  ]);
  return { organizations: orgs, hotels, products, recipes, semiFinished: semi, recipeVersions: versions, suppliers, saleLines: sales, stockTransactions: stock, consumptionRecords: consumption, wasteRecords: waste, purchaseLines: purchases, invoices, minibarTransactions: minibar, buffetSessions: buffets, rooms, employees, expenses, budgets };
}
