/**
 * Administration: users & access, hotel settings, and the master structure the cost engine posts to
 * (departments + their cost centers, warehouses, product categories). Permission `admin:users`.
 * Everything is organization- and hotel-scoped and audited; nothing is hard-deleted (deactivate instead),
 * because ledgers reference these rows.
 */
import { z } from "zod";
import bcrypt from "bcryptjs";
import { DomainError } from "@/domain/errors";
import { toStorage } from "@/domain/money";
import { inTx, type Db, type Tx } from "../db";
import { type Actor, authorize } from "../auth/actor";
import { ROLE_TEMPLATES } from "../auth/permissions";
import { audit } from "./audit";

export const CATEGORY_GROUPS = ["FOOD", "BEVERAGE", "PACKAGING", "HOUSEKEEPING", "ENGINEERING", "LINEN"] as const;
const code = z.string().trim().min(1).max(20).regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Use capitals, digits, - or _");
const password = z.string().min(10, "At least 10 characters").max(200);
/** number typed in a form: accepts a decimal comma ("8,5") */
const num = () => z.preprocess((v) => (typeof v === "string" ? v.trim().replace(",", ".") : v), z.coerce.number());

/** IANA time zone the runtime can format with (an unknown one makes every date on the page throw) */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
/** ISO 4217-shaped code that Intl can format money with */
export function isCurrencyCode(c: string): boolean {
  if (!/^[A-Z]{3}$/.test(c)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: c });
    return true;
  } catch {
    return false;
  }
}
export const currencyCode = z.string().trim().toUpperCase().refine(isCurrencyCode, "Unknown currency code (use ISO 4217, e.g. TRY, EUR)");
export const timeZone = z.string().trim().max(64).refine(isTimeZone, "Unknown time zone (use an IANA name, e.g. Europe/Istanbul)");

function guard(actor: Actor, hotelId: string) {
  authorize(actor, "admin:users", { hotelId });
}

export async function adminOverview(db: Db, actor: Actor, hotelId: string) {
  guard(actor, hotelId);
  const [hotel, roles, users, departments, warehouses, categories, hotels] = await Promise.all([
    db.hotel.findUniqueOrThrow({ where: { id: hotelId } }),
    db.role.findMany({ where: { organizationId: actor.organizationId }, orderBy: { name: "asc" }, select: { id: true, key: true, name: true, allDepartments: true } }),
    db.user.findMany({
      where: { organizationId: actor.organizationId, hotelAccess: { some: { hotelId } } },
      orderBy: { name: "asc" },
      select: { id: true, email: true, name: true, active: true, createdAt: true, role: { select: { key: true, name: true, allDepartments: true } }, deptAccess: { select: { departmentId: true } }, hotelAccess: { select: { hotelId: true } } },
    }),
    db.department.findMany({ where: { hotelId }, orderBy: { code: "asc" } }),
    db.warehouse.findMany({ where: { hotelId }, orderBy: { code: "asc" }, include: { department: { select: { name: true } } } }),
    db.productCategory.findMany({ where: { hotelId }, orderBy: [{ group: "asc" }, { name: "asc" }] }),
    db.hotel.findMany({ where: { id: { in: [...actor.hotelIds] } }, select: { id: true, code: true, name: true } }),
  ]);
  return { hotel, roles, users, departments, warehouses, categories, hotels };
}

// ── users ──

const userCreate = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(2).max(120),
  password,
  roleKey: z.string().min(1),
  departmentIds: z.array(z.string()).max(200).default([]),
  hotelIds: z.array(z.string()).max(50).default([]),
});

async function checkDepartments(db: Db | Tx, hotelIds: string[], ids: string[]) {
  if (!ids.length) return;
  const n = await db.department.count({ where: { id: { in: ids }, hotelId: { in: hotelIds } } });
  if (n !== new Set(ids).size) throw new DomainError("VALIDATION", "Unknown department for the selected hotels");
}

export async function createUser(db: Db, actor: Actor, hotelId: string, input: unknown) {
  guard(actor, hotelId);
  const p = userCreate.parse(input);
  const hotels = [...new Set([hotelId, ...p.hotelIds])];
  if (hotels.some((h) => !actor.hotelIds.includes(h))) throw new DomainError("FORBIDDEN", "You can only grant access to hotels you administer");
  const role = await db.role.findUnique({ where: { organizationId_key: { organizationId: actor.organizationId, key: p.roleKey } } });
  if (!role) throw new DomainError("VALIDATION", "Unknown role");
  if (!role.allDepartments && p.departmentIds.length === 0) throw new DomainError("VALIDATION", `${role.name} works on selected departments - choose at least one`);
  // generic message: does not reveal whether the address is used by another organization
  if (await db.user.findUnique({ where: { email: p.email } })) throw new DomainError("DUPLICATE", "This e-mail address cannot be used");
  const hash = await bcrypt.hash(p.password, 10);
  return inTx(db, async (tx) => {
    await checkDepartments(tx, hotels, p.departmentIds);
    const u = await tx.user.create({ data: { organizationId: actor.organizationId, email: p.email, name: p.name, passwordHash: hash, roleId: role.id } });
    await tx.userHotelAccess.createMany({ data: hotels.map((h) => ({ userId: u.id, hotelId: h })) });
    if (!role.allDepartments && p.departmentIds.length) await tx.userDepartmentAccess.createMany({ data: p.departmentIds.map((d) => ({ userId: u.id, departmentId: d })) });
    await audit(tx, actor, { hotelId, action: "USER_CREATE", entityType: "User", entityId: u.id, after: { email: u.email, name: u.name, role: role.key, hotels, departments: p.departmentIds } });
    return { id: u.id, email: u.email, name: u.name };
  });
}

const userUpdate = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2).max(120).optional(),
  roleKey: z.string().min(1).optional(),
  active: z.boolean().optional(),
  departmentIds: z.array(z.string()).max(200).optional(),
  hotelIds: z.array(z.string()).min(1).max(50).optional(),
  password: password.optional(),
});

export async function updateUser(db: Db, actor: Actor, hotelId: string, input: unknown) {
  guard(actor, hotelId);
  const p = userUpdate.parse(input);
  const u = await db.user.findFirst({ where: { id: p.id, organizationId: actor.organizationId, hotelAccess: { some: { hotelId } } }, include: { role: true, deptAccess: { include: { department: { select: { hotelId: true } } } }, hotelAccess: { include: { hotel: { select: { active: true } } } } } });
  if (!u) throw new DomainError("NOT_FOUND", "User not found");
  // an administrator may only manage users whose every hotel they administer: otherwise resetting a
  // password or role would let them act inside a hotel they cannot see (privilege escalation).
  // A suspended hotel the administrator also holds access to does not count (nobody can act inside it, and its
  // access is kept untouched below); one they never administered still blocks the edit.
  const suspended = u.hotelAccess.filter((h) => !h.hotel.active).map((h) => h.hotelId);
  const ownSuspended = new Set((await db.userHotelAccess.findMany({ where: { userId: actor.userId, hotelId: { in: suspended } }, select: { hotelId: true } })).map((a) => a.hotelId));
  if (u.hotelAccess.some((h) => !actor.hotelIds.includes(h.hotelId) && !ownSuspended.has(h.hotelId))) throw new DomainError("FORBIDDEN", "This user also works in hotels you do not administer");
  if (u.id === actor.userId && (p.active === false || (p.roleKey && p.roleKey !== u.role.key))) throw new DomainError("CONFLICT", "You cannot deactivate yourself or change your own role");
  const role = p.roleKey ? await db.role.findUnique({ where: { organizationId_key: { organizationId: actor.organizationId, key: p.roleKey } } }) : u.role;
  if (!role) throw new DomainError("VALIDATION", "Unknown role");
  if (u.role.key === "admin" && (role.key !== "admin" || p.active === false)) {
    const admins = await db.user.count({ where: { organizationId: actor.organizationId, active: true, role: { key: "admin" } } });
    if (admins <= 1) throw new DomainError("CONFLICT", "The organization must keep at least one active administrator");
  }
  // hotel assignment: only hotels of this organization that the administrator administers (spec 32–33);
  // access to a suspended hotel is neither shown nor changed here, so it survives the save
  const currentHotels = u.hotelAccess.map((h) => h.hotelId);
  const newHotels = p.hotelIds ? [...new Set([...p.hotelIds, ...suspended])] : undefined;
  if (newHotels) {
    const touched = [...new Set([...newHotels, ...currentHotels])].filter((h) => newHotels.includes(h) !== currentHotels.includes(h));
    if (touched.some((h) => !actor.hotelIds.includes(h))) throw new DomainError("FORBIDDEN", "You can only grant or remove access to hotels you administer");
    const own = await db.hotel.count({ where: { id: { in: newHotels }, organizationId: actor.organizationId } });
    if (own !== newHotels.length) throw new DomainError("FORBIDDEN", "Hotel outside your organization");
  }
  const hotelsAfter = newHotels ?? currentHotels;
  // the department picker shows this hotel only: departments the user has in their other (kept) hotels stay
  const depts = p.departmentIds
    ? [...new Set([...u.deptAccess.filter((d) => d.department.hotelId !== hotelId && hotelsAfter.includes(d.department.hotelId)).map((d) => d.departmentId), ...p.departmentIds])]
    : u.deptAccess.filter((d) => hotelsAfter.includes(d.department.hotelId)).map((d) => d.departmentId);
  if (!role.allDepartments && depts.length === 0) throw new DomainError("VALIDATION", `${role.name} works on selected departments - choose at least one`);
  const hash = p.password ? await bcrypt.hash(p.password, 10) : undefined;
  return inTx(db, async (tx) => {
    if (newHotels) {
      await tx.userHotelAccess.deleteMany({ where: { userId: u.id, hotelId: { notIn: newHotels } } });
      await tx.userHotelAccess.createMany({ data: newHotels.map((h) => ({ userId: u.id, hotelId: h })), skipDuplicates: true });
      // department rights never outlive the hotel they belong to
      await tx.userDepartmentAccess.deleteMany({ where: { userId: u.id, department: { hotelId: { notIn: newHotels } } } });
    }
    if (p.departmentIds) {
      // new department rights only in hotels the administrator can act in (never in a suspended one)
      await checkDepartments(tx, hotelsAfter.filter((h) => actor.hotelIds.includes(h)), p.departmentIds);
      // replace only this hotel's departments (and any re-sent ones); other hotels' rights are kept
      await tx.userDepartmentAccess.deleteMany({ where: { userId: u.id, OR: [{ department: { hotelId } }, { departmentId: { in: p.departmentIds } }] } });
      if (p.departmentIds.length) await tx.userDepartmentAccess.createMany({ data: [...new Set(p.departmentIds)].map((d) => ({ userId: u.id, departmentId: d })) });
    }
    await tx.user.update({ where: { id: u.id }, data: { name: p.name, roleId: role.id, active: p.active, passwordHash: hash } });
    // deactivation, role change and password reset end every open session and API token immediately
    if (p.active === false || hash || role.id !== u.roleId || newHotels) await tx.session.deleteMany({ where: { userId: u.id } });
    await audit(tx, actor, {
      hotelId,
      action: "USER_UPDATE",
      entityType: "User",
      entityId: u.id,
      before: { name: u.name, role: u.role.key, active: u.active, departments: u.deptAccess.map((d) => d.departmentId), hotels: currentHotels },
      after: { name: p.name ?? u.name, role: role.key, active: p.active ?? u.active, departments: depts, hotels: hotelsAfter, passwordReset: Boolean(hash) },
    });
    return { id: u.id };
  });
}

// ── hotel settings ──

const hotelSettings = z.object({
  name: z.string().trim().min(2).max(120),
  totalRooms: num().pipe(z.number().int().min(0).max(100_000)),
  baseCurrency: currencyCode,
  timezone: timeZone,
  priceAlertPct: num().pipe(z.number().min(0).max(1000)),
  wasteApprovalValue: num().pipe(z.number().min(0)),
  adjustmentApprovalValue: num().pipe(z.number().min(0)),
  marginTargetPct: num().pipe(z.number().min(0).max(100)),
  /** night audit: the business day ends here (HH:MM local), default 03:30 */
  businessDayCutoff: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").optional(),
  /** sold dishes' recipe ingredients leave the stock automatically (default on) */
  autoDeductSales: z.boolean().optional(),
});

export async function updateHotel(db: Db, actor: Actor, hotelId: string, input: unknown) {
  guard(actor, hotelId);
  const p = hotelSettings.parse(input);
  const before = await db.hotel.findUniqueOrThrow({ where: { id: hotelId } });
  if (p.baseCurrency !== before.baseCurrency && (await db.stockTransaction.count({ where: { hotelId }, take: 1 }))) throw new DomainError("CONFLICT", "The base currency cannot change once stock has been posted");
  return inTx(db, async (tx) => {
    await tx.currency.upsert({ where: { code: p.baseCurrency }, create: { code: p.baseCurrency, organizationId: actor.organizationId, name: p.baseCurrency }, update: {} });
    const h = await tx.hotel.update({
      where: { id: hotelId },
      data: { name: p.name, totalRooms: p.totalRooms, baseCurrency: p.baseCurrency, timezone: p.timezone, priceAlertPct: toStorage(p.priceAlertPct), wasteApprovalValue: toStorage(p.wasteApprovalValue), adjustmentApprovalValue: toStorage(p.adjustmentApprovalValue), marginTargetPct: toStorage(p.marginTargetPct), ...(p.businessDayCutoff ? { businessDayCutoff: p.businessDayCutoff } : {}), ...(p.autoDeductSales !== undefined ? { autoDeductSales: p.autoDeductSales } : {}) },
    });
    await audit(tx, actor, { hotelId, action: "HOTEL_SETTINGS", entityType: "Hotel", entityId: hotelId, before, after: h });
    return h;
  });
}

// ── master structure ──

const deptInput = z.object({ code, name: z.string().trim().min(2).max(80), isOutlet: z.boolean().default(false), parentId: z.string().nullish(), sqm: num().pipe(z.number().min(0)).nullish(), headcount: num().pipe(z.number().int().min(0)).nullish() });

export async function createDepartment(db: Db, actor: Actor, hotelId: string, input: unknown) {
  guard(actor, hotelId);
  const p = deptInput.parse(input);
  if (p.parentId && !(await db.department.findFirst({ where: { id: p.parentId, hotelId } }))) throw new DomainError("VALIDATION", "Unknown parent department");
  if (await db.department.findUnique({ where: { hotelId_code: { hotelId, code: p.code } } })) throw new DomainError("DUPLICATE", `Department ${p.code} already exists`);
  return inTx(db, async (tx) => {
    const d = await tx.department.create({ data: { hotelId, code: p.code, name: p.name, isOutlet: p.isOutlet, parentId: p.parentId ?? null, sqm: p.sqm == null ? null : toStorage(p.sqm), headcount: p.headcount ?? null } });
    // every department gets its cost center so expenses and allocations have somewhere to land
    if (!(await tx.costCenter.findUnique({ where: { hotelId_code: { hotelId, code: `CC-${p.code}` } } }))) await tx.costCenter.create({ data: { hotelId, departmentId: d.id, code: `CC-${p.code}`, name: p.name, kind: "DEPARTMENT" } });
    await audit(tx, actor, { hotelId, action: "DEPARTMENT_CREATE", entityType: "Department", entityId: d.id, after: d });
    return d;
  });
}

const deptUpdate = z.object({ id: z.string(), name: z.string().trim().min(2).max(80).optional(), isOutlet: z.boolean().optional(), active: z.boolean().optional(), sqm: num().pipe(z.number().min(0)).nullish(), headcount: num().pipe(z.number().int().min(0)).nullish() });

export async function updateDepartment(db: Db, actor: Actor, hotelId: string, input: unknown) {
  guard(actor, hotelId);
  const p = deptUpdate.parse(input);
  const before = await db.department.findFirst({ where: { id: p.id, hotelId } });
  if (!before) throw new DomainError("NOT_FOUND", "Department not found");
  return inTx(db, async (tx) => {
    const d = await tx.department.update({ where: { id: p.id }, data: { name: p.name, isOutlet: p.isOutlet, active: p.active, sqm: p.sqm === undefined ? undefined : p.sqm === null ? null : toStorage(p.sqm), headcount: p.headcount === undefined ? undefined : p.headcount } });
    await audit(tx, actor, { hotelId, action: "DEPARTMENT_UPDATE", entityType: "Department", entityId: d.id, before, after: d });
    return d;
  });
}

const whInput = z.object({ code, name: z.string().trim().min(2).max(80), departmentId: z.string().nullish() });

export async function createWarehouse(db: Db, actor: Actor, hotelId: string, input: unknown) {
  guard(actor, hotelId);
  const p = whInput.parse(input);
  if (p.departmentId && !(await db.department.findFirst({ where: { id: p.departmentId, hotelId } }))) throw new DomainError("VALIDATION", "Unknown department");
  if (await db.warehouse.findUnique({ where: { hotelId_code: { hotelId, code: p.code } } })) throw new DomainError("DUPLICATE", `Warehouse ${p.code} already exists`);
  return inTx(db, async (tx) => {
    const w = await tx.warehouse.create({ data: { hotelId, code: p.code, name: p.name, departmentId: p.departmentId ?? null } });
    await audit(tx, actor, { hotelId, action: "WAREHOUSE_CREATE", entityType: "Warehouse", entityId: w.id, after: w });
    return w;
  });
}

export async function setWarehouseActive(db: Db, actor: Actor, hotelId: string, id: string, active: boolean) {
  guard(actor, hotelId);
  const w = await db.warehouse.findFirst({ where: { id, hotelId } });
  if (!w) throw new DomainError("NOT_FOUND", "Warehouse not found");
  if (!active) {
    const stock = await db.stockBalance.count({ where: { warehouseId: id, NOT: { quantity: 0 } } });
    if (stock) throw new DomainError("CONFLICT", `${w.name} still holds stock on ${stock} product(s) - transfer or count it out first`);
  }
  return inTx(db, async (tx) => {
    const r = await tx.warehouse.update({ where: { id }, data: { active } });
    await audit(tx, actor, { hotelId, action: active ? "WAREHOUSE_ACTIVATE" : "WAREHOUSE_DEACTIVATE", entityType: "Warehouse", entityId: id });
    return r;
  });
}

const catInput = z.object({ code, name: z.string().trim().min(2).max(80), group: z.enum(CATEGORY_GROUPS), parentId: z.string().nullish() });

export async function createCategory(db: Db, actor: Actor, hotelId: string, input: unknown) {
  guard(actor, hotelId);
  const p = catInput.parse(input);
  if (p.parentId) {
    const parent = await db.productCategory.findFirst({ where: { id: p.parentId, hotelId } });
    if (!parent) throw new DomainError("VALIDATION", "Unknown parent category");
    if (parent.group !== p.group) throw new DomainError("VALIDATION", `A sub-category must stay in its parent's group (${parent.group})`);
  }
  if (await db.productCategory.findUnique({ where: { hotelId_code: { hotelId, code: p.code } } })) throw new DomainError("DUPLICATE", `Category ${p.code} already exists`);
  return inTx(db, async (tx) => {
    const c = await tx.productCategory.create({ data: { hotelId, code: p.code, name: p.name, group: p.group, parentId: p.parentId ?? null } });
    await audit(tx, actor, { hotelId, action: "CATEGORY_CREATE", entityType: "ProductCategory", entityId: c.id, after: c });
    return c;
  });
}

// ── clean installation ──

export const DEFAULT_DEPARTMENTS: Array<[string, string, boolean, string | null]> = [
  ["FB", "Food & Beverage", false, null],
  ["REST", "Restaurant", true, "FB"],
  ["BAR", "Bar", true, "FB"],
  ["BRKF", "Breakfast", true, "FB"],
  ["BANQ", "Banquet", true, "FB"],
  ["KITCH", "Main Kitchen", false, "FB"],
  ["PAST", "Pastry", true, "FB"],
  ["ROOMS", "Rooms", false, null],
  ["HK", "Housekeeping", false, "ROOMS"],
  ["LAUN", "Laundry", false, "ROOMS"],
  ["ENG", "Engineering", false, null],
  ["ADM", "Administration", false, null],
  ["SM", "Sales & Marketing", false, null],
];
export const DEFAULT_WAREHOUSES: Array<[string, string, string | null]> = [
  ["MAIN", "Main Store", null],
  ["KITCH", "Kitchen Store", "KITCH"],
  ["REST", "Restaurant Store", "REST"],
  ["BAR", "Bar Store", "BAR"],
  ["BRKF", "Breakfast Store", "BRKF"],
  ["PAST", "Pastry Store", "PAST"],
  ["HK", "Housekeeping Store", "HK"],
  ["LINEN", "Linen Room", "LAUN"],
  ["ENG", "Engineering Store", "ENG"],
];
export const DEFAULT_CATEGORIES: Record<(typeof CATEGORY_GROUPS)[number], string[]> = {
  FOOD: ["Meat", "Chicken", "Fish", "Seafood", "Vegetables", "Fruits", "Dairy", "Cheese", "Eggs", "Dry goods", "Bakery", "Frozen products", "Sauces", "Spices", "Oils", "Legumes", "Nuts", "Chocolate", "Pastry materials", "Breakfast products"],
  BEVERAGE: ["Soft drinks", "Juices", "Coffee", "Tea", "Syrups", "Water", "Beer", "Wine", "Spirits", "Garnishes"],
  PACKAGING: ["Boxes", "Cups", "Bags", "Napkins", "Containers"],
  HOUSEKEEPING: ["Chemicals", "Amenities", "Cleaning supplies", "Guest supplies"],
  ENGINEERING: ["Spare parts", "Consumables"],
  LINEN: ["Bed linen", "Towels", "Bathrobes"],
};

/** Turkish names for the defaults above, used when the company is set up in Turkish. Codes stay the same. */
const DEFAULT_NAMES_TR: Record<string, string> = {
  "Food & Beverage": "Yiyecek & İçecek", Restaurant: "Restoran", Bar: "Bar", Breakfast: "Kahvaltı", Banquet: "Banket", "Main Kitchen": "Ana Mutfak", Pastry: "Pastane",
  Rooms: "Odalar", Housekeeping: "Kat Hizmetleri", Laundry: "Çamaşırhane", Engineering: "Teknik Servis", Administration: "İdari İşler", "Sales & Marketing": "Satış & Pazarlama",
  "Main Store": "Ana Depo", "Kitchen Store": "Mutfak Deposu", "Restaurant Store": "Restoran Deposu", "Bar Store": "Bar Deposu", "Breakfast Store": "Kahvaltı Deposu", "Pastry Store": "Pastane Deposu",
  "Housekeeping Store": "Kat Hizmetleri Deposu", "Linen Room": "Çamaşır Odası", "Engineering Store": "Teknik Depo",
  Food: "Yiyecek", Beverage: "İçecek", Packaging: "Ambalaj", Linen: "Tekstil",
  Meat: "Et", Chicken: "Tavuk", Fish: "Balık", Seafood: "Deniz ürünleri", Vegetables: "Sebze", Fruits: "Meyve", Dairy: "Süt ürünleri", Cheese: "Peynir", Eggs: "Yumurta",
  "Dry goods": "Kuru gıda", Bakery: "Unlu mamul", "Frozen products": "Dondurulmuş ürünler", Sauces: "Soslar", Spices: "Baharatlar", Oils: "Yağlar", Legumes: "Bakliyat", Nuts: "Kuruyemiş",
  Chocolate: "Çikolata", "Pastry materials": "Pastane malzemeleri", "Breakfast products": "Kahvaltılık ürünler",
  "Soft drinks": "Meşrubat", Juices: "Meyve suları", Coffee: "Kahve", Tea: "Çay", Syrups: "Şuruplar", Water: "Su", Beer: "Bira", Wine: "Şarap", Spirits: "Alkollü içkiler", Garnishes: "Garnitürler",
  Boxes: "Kutular", Cups: "Bardaklar", Bags: "Poşetler", Napkins: "Peçeteler", Containers: "Saklama kapları",
  Chemicals: "Kimyasallar", Amenities: "Buklet ürünleri", "Cleaning supplies": "Temizlik malzemeleri", "Guest supplies": "Misafir malzemeleri",
  "Spare parts": "Yedek parçalar", Consumables: "Sarf malzemeleri", "Bed linen": "Yatak tekstili", Towels: "Havlular", Bathrobes: "Bornozlar",
};

/** Standard departments (with cost centers), warehouses and category tree for a new hotel (spec 146). */
export async function applyHotelDefaults(tx: Tx, hotelId: string, locale: "tr" | "en" = "en") {
  const nm = (n: string) => (locale === "tr" ? (DEFAULT_NAMES_TR[n] ?? n) : n);
  const dept: Record<string, string> = {};
  for (const [c, en, outlet, parent] of DEFAULT_DEPARTMENTS) {
    const name = nm(en);
    const d = await tx.department.create({ data: { hotelId, code: c, name, isOutlet: outlet, parentId: parent ? dept[parent]! : null } });
    dept[c] = d.id;
    await tx.costCenter.create({ data: { hotelId, departmentId: d.id, code: `CC-${c}`, name, kind: "DEPARTMENT" } });
  }
  for (const [c, name, d] of DEFAULT_WAREHOUSES) await tx.warehouse.create({ data: { hotelId, code: c, name: nm(name), departmentId: d ? dept[d]! : null } });
  for (const [group, children] of Object.entries(DEFAULT_CATEGORIES)) {
    const parent = await tx.productCategory.create({ data: { hotelId, code: group, name: nm(group[0] + group.slice(1).toLowerCase()), group } });
    for (const c of children) await tx.productCategory.create({ data: { hotelId, code: `${group}-${c.toUpperCase().replace(/[^A-Z]/g, "")}`, name: nm(c), group, parentId: parent.id } });
  }
  return dept;
}

/** Every tenant gets the full set of role templates (customizable afterwards). */
export async function createTenantRoles(tx: Tx, organizationId: string) {
  const roleId: Record<string, string> = {};
  for (const t of ROLE_TEMPLATES) roleId[t.key] = (await tx.role.create({ data: { organizationId, key: t.key, name: t.name, allDepartments: t.allDepartments, permissions: t.permissions } })).id;
  return roleId;
}

const bootstrapInput = z.object({
  organizationName: z.string().trim().min(2).max(120),
  hotelCode: code,
  hotelName: z.string().trim().min(2).max(120),
  totalRooms: z.coerce.number().int().min(0).max(100_000).default(0),
  baseCurrency: currencyCode.default("TRY"),
  adminEmail: z.string().trim().toLowerCase().email(),
  adminName: z.string().trim().min(2).max(120),
  adminPassword: password,
  /** language of the default department / warehouse / category names */
  locale: z.enum(["tr", "en"]).default("en"),
});

/**
 * First start of a clean single-company installation: organization, hotel, standard USALI-style
 * departments with cost centers, warehouses, category tree, all role templates and the first administrator.
 * Refuses to run when any organization exists (never mixes with existing data).
 */
export async function bootstrapInstallation(db: Db, input: unknown) {
  const p = bootstrapInput.parse(input);
  if (await db.organization.count()) throw new DomainError("CONFLICT", "This database is already set up");
  const hash = await bcrypt.hash(p.adminPassword, 10);
  return inTx(
    db,
    async (tx) => {
      const org = await tx.organization.create({ data: { name: p.organizationName } });
      for (const c of new Set([p.baseCurrency, "TRY", "EUR", "USD"])) await tx.currency.upsert({ where: { code: c }, create: { code: c, organizationId: org.id, name: c }, update: {} });
      const hotel = await tx.hotel.create({ data: { organizationId: org.id, code: p.hotelCode, name: p.hotelName, totalRooms: p.totalRooms, baseCurrency: p.baseCurrency } });
      await applyHotelDefaults(tx, hotel.id, p.locale);
      const roleId = await createTenantRoles(tx, org.id);
      const admin = await tx.user.create({ data: { organizationId: org.id, email: p.adminEmail, name: p.adminName, passwordHash: hash, roleId: roleId.admin! } });
      await tx.userHotelAccess.create({ data: { userId: admin.id, hotelId: hotel.id } });
      await tx.auditLog.create({ data: { hotelId: hotel.id, userId: admin.id, action: "INSTALLATION_BOOTSTRAP", entityType: "Organization", entityId: org.id, source: "SETUP" } });
      return { organizationId: org.id, hotelId: hotel.id, adminId: admin.id };
    },
    { timeout: 60_000 },
  );
}
