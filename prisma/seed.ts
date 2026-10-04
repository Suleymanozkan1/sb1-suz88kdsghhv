/**
 * Demo / seed data (spec §308–§309). Everything is posted THROUGH THE SERVICES so the
 * ledger, cost postings, price history, approvals and audit trail are real.
 * Covers the previous month and the current month up to yesterday.
 *
 * Refuses to run twice (never duplicates data in an existing database).
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ROLE_TEMPLATES, SUPER_ADMIN_TEMPLATE } from "../src/server/auth/permissions";
import type { Actor } from "../src/server/auth/actor";
import { D, Decimal, ZERO } from "../src/domain/money";
import { costRecipe } from "../src/domain/recipe-cost";
import { postGoodsReceipt } from "../src/server/services/purchasing";
import { postMovement, transferStock } from "../src/server/services/ledger";
import { createRecipe, approveVersion, buildResolver, versionToDef } from "../src/server/services/recipes";
import { commitSales } from "../src/server/services/sales";
import { recordWaste } from "../src/server/services/waste";
import { startCount, enterCount, submitCount } from "../src/server/services/counts";
import { decideApproval } from "../src/server/services/approvals";
import { requestStockDelete } from "../src/server/services/approvals";
import { createSession, addLine, closeSession } from "../src/server/services/buffet";
import { minibarSetup, setPar, recordMovement, restockToParLevels, countRoom, roomQty } from "../src/server/services/minibar";
import { createAsset, createMeter, recordReading, recordLaundry, commitExpenseImport, createExpense } from "../src/server/services/opex";
import { commitOccupancy, commitReservations } from "../src/server/services/pms";
import { createRule, postAllocation } from "../src/server/services/allocation";
import { periodFor } from "../src/server/services/period";
import { createBudget, setBudgetLines, approveBudget, createTarget } from "../src/server/services/planning";
import { createAction, updateAction } from "../src/server/services/savings";
import { departmentRevenue } from "../src/server/services/revenue";

const prisma = new PrismaClient();
const PASSWORD = "HotelCost!2026";
const ORG = "Anatolia Hospitality Group (demo)";

// deterministic PRNG
let seed = 20261004;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a: number, b: number) => a + (b - a) * rnd();

const CATEGORY_TREE: Record<string, string[]> = {
  FOOD: ["Meat", "Chicken", "Fish", "Seafood", "Vegetables", "Fruits", "Dairy", "Cheese", "Milk", "Eggs", "Dry goods", "Bakery", "Frozen products", "Sauces", "Spices", "Oils", "Cereals", "Legumes", "Nuts", "Chocolate", "Pastry materials", "Breakfast products"],
  BEVERAGE: ["Soft drinks", "Juices", "Coffee", "Tea", "Syrups", "Water", "Bar products", "Beer", "Wine", "Spirits", "Garnishes"],
  PACKAGING: ["Boxes", "Cups", "Lids", "Bags", "Napkins", "Straws", "Containers", "Takeaway packaging"],
  HOUSEKEEPING: ["Chemicals", "Amenities", "Cleaning supplies", "Guest supplies"],
  ENGINEERING: ["Spare parts", "Consumables"],
  LINEN: ["Bed linen", "Towels", "Bathrobes"],
};

type P = { sku: string; name: string; cat: string; unit: string; purchaseUnit?: string; caseSize?: string; price: number; yieldPct?: number; supplier: number; reorder?: number; safety?: number; max?: number; fifo?: boolean };
const PRODUCTS: P[] = [
  { sku: "MEAT-BEEF-GR", name: "Ground Beef", cat: "Meat", unit: "kg", price: 640, yieldPct: 95, supplier: 0, reorder: 20, safety: 10, max: 120 },
  { sku: "CHK-BREAST", name: "Chicken Breast", cat: "Chicken", unit: "kg", purchaseUnit: "case", caseSize: "10", price: 190, yieldPct: 92, supplier: 0, reorder: 25, safety: 15, max: 150 },
  { sku: "CHK-WHOLE", name: "Whole Chicken", cat: "Chicken", unit: "kg", price: 120, yieldPct: 80, supplier: 0, reorder: 10, safety: 5 },
  { sku: "FISH-SALMON", name: "Salmon Fillet", cat: "Fish", unit: "kg", price: 820, yieldPct: 90, supplier: 1, reorder: 5, safety: 3, fifo: true },
  { sku: "VEG-TOMATO", name: "Tomato", cat: "Vegetables", unit: "kg", price: 38, yieldPct: 89, supplier: 2, reorder: 20, safety: 10 },
  { sku: "VEG-ONION", name: "Onion", cat: "Vegetables", unit: "kg", price: 22, yieldPct: 88, supplier: 2, reorder: 15, safety: 8 },
  { sku: "VEG-LETTUCE", name: "Iceberg Lettuce", cat: "Vegetables", unit: "kg", price: 45, yieldPct: 75, supplier: 2, reorder: 10, safety: 5 },
  { sku: "VEG-CUCUMBER", name: "Cucumber", cat: "Vegetables", unit: "kg", price: 30, yieldPct: 92, supplier: 2, reorder: 10, safety: 5 },
  { sku: "VEG-GARLIC", name: "Garlic", cat: "Vegetables", unit: "kg", price: 160, yieldPct: 85, supplier: 2 },
  { sku: "FRT-LEMON", name: "Lemon", cat: "Fruits", unit: "kg", price: 40, yieldPct: 95, supplier: 2 },
  { sku: "FRT-LIME", name: "Lime", cat: "Fruits", unit: "kg", price: 90, supplier: 2 },
  { sku: "FRT-STRAWB", name: "Strawberry", cat: "Fruits", unit: "kg", price: 140, yieldPct: 90, supplier: 2 },
  { sku: "DAIRY-BUTTER", name: "Butter", cat: "Dairy", unit: "kg", price: 420, supplier: 1, reorder: 8, safety: 4 },
  { sku: "DAIRY-CREAM", name: "Cooking Cream", cat: "Dairy", unit: "l", price: 110, supplier: 1, reorder: 10, safety: 5 },
  { sku: "MILK-WHOLE", name: "Whole Milk", cat: "Milk", unit: "l", price: 32, supplier: 1, reorder: 40, safety: 20 },
  { sku: "CHS-CHEDDAR", name: "Cheddar Slices", cat: "Cheese", unit: "kg", price: 380, supplier: 1, reorder: 5, safety: 3 },
  { sku: "CHS-PARMESAN", name: "Parmesan", cat: "Cheese", unit: "kg", price: 950, supplier: 1, reorder: 2, safety: 1 },
  { sku: "CHS-MASCARP", name: "Mascarpone", cat: "Cheese", unit: "kg", price: 420, supplier: 1 },
  { sku: "EGG-LARGE", name: "Egg (L)", cat: "Eggs", unit: "pc", purchaseUnit: "case", caseSize: "180", price: 4.2, supplier: 1, reorder: 360, safety: 180 },
  { sku: "DRY-PASTA", name: "Penne Pasta", cat: "Dry goods", unit: "kg", price: 55, supplier: 3, reorder: 10, safety: 5 },
  { sku: "DRY-FLOUR", name: "Flour T550", cat: "Dry goods", unit: "kg", price: 24, supplier: 3, reorder: 25, safety: 10 },
  { sku: "DRY-SUGAR", name: "Sugar", cat: "Dry goods", unit: "kg", price: 34, supplier: 3, reorder: 15, safety: 5 },
  { sku: "DRY-RICE", name: "Baldo Rice", cat: "Cereals", unit: "kg", price: 62, supplier: 3 },
  { sku: "BAK-BUN", name: "Brioche Burger Bun", cat: "Bakery", unit: "pc", price: 9, supplier: 3, reorder: 100, safety: 50 },
  { sku: "BAK-TORTILLA", name: "Tortilla Wrap", cat: "Bakery", unit: "pc", price: 6, supplier: 3, reorder: 60, safety: 30 },
  { sku: "BAK-LADYF", name: "Ladyfinger Biscuits", cat: "Pastry materials", unit: "kg", price: 180, supplier: 3 },
  { sku: "SAU-KETCHUP", name: "Ketchup", cat: "Sauces", unit: "kg", price: 85, supplier: 3 },
  { sku: "SAU-MUSTARD", name: "Dijon Mustard", cat: "Sauces", unit: "kg", price: 160, supplier: 3 },
  { sku: "SPC-PEPPER", name: "Black Pepper", cat: "Spices", unit: "kg", price: 520, supplier: 3 },
  { sku: "SPC-SALT", name: "Sea Salt", cat: "Spices", unit: "kg", price: 18, supplier: 3 },
  { sku: "OIL-SUNFL", name: "Sunflower Oil", cat: "Oils", unit: "l", purchaseUnit: "can", caseSize: "18", price: 72, supplier: 3, reorder: 18, safety: 10 },
  { sku: "OIL-OLIVE", name: "Extra Virgin Olive Oil", cat: "Oils", unit: "l", price: 360, supplier: 3 },
  { sku: "CHOC-DARK", name: "Dark Chocolate 70%", cat: "Chocolate", unit: "kg", price: 640, supplier: 3 },
  { sku: "COF-BEANS", name: "Espresso Beans", cat: "Coffee", unit: "kg", price: 1150, supplier: 4, reorder: 5, safety: 2 },
  { sku: "BEV-COLA", name: "Cola 330ml", cat: "Soft drinks", unit: "pc", purchaseUnit: "case", caseSize: "24", price: 22, supplier: 4, reorder: 48, safety: 24 },
  { sku: "BEV-TONIC", name: "Tonic Water 200ml", cat: "Soft drinks", unit: "pc", price: 28, supplier: 4 },
  { sku: "BEV-SODA", name: "Soda Water 200ml", cat: "Soft drinks", unit: "pc", price: 14, supplier: 4 },
  { sku: "SPR-GIN", name: "London Dry Gin", cat: "Spirits", unit: "l", purchaseUnit: "bottle", caseSize: "0.7", price: 1300, supplier: 4, fifo: true },
  { sku: "SPR-RUM", name: "White Rum", cat: "Spirits", unit: "l", purchaseUnit: "bottle", caseSize: "0.7", price: 1100, supplier: 4, fifo: true },
  { sku: "BAR-MINT", name: "Fresh Mint", cat: "Garnishes", unit: "kg", price: 150, yieldPct: 70, supplier: 2 },
  { sku: "SYR-SUGAR", name: "Sugar Syrup", cat: "Syrups", unit: "l", price: 95, supplier: 4 },
  { sku: "PKG-BOX", name: "Burger Takeaway Box", cat: "Boxes", unit: "pc", price: 3.5, supplier: 3 },
  { sku: "HK-SHAMPOO", name: "Guest Shampoo 30ml", cat: "Amenities", unit: "pc", price: 6.5, supplier: 3 },
];

/** Development-only platform operator (spec 11, 29): manages tenants, sees no tenant data. */
async function ensurePlatformAdmin() {
  if (process.env.NODE_ENV === "production") return;
  if (await prisma.user.findUnique({ where: { email: "superadmin@hotelcost.test" } })) return;
  const org = (await prisma.organization.findFirst({ where: { isPlatform: true } })) ?? (await prisma.organization.create({ data: { name: "HotelCost Platform", isPlatform: true } }));
  const role = (await prisma.role.findFirst({ where: { organizationId: org.id, key: SUPER_ADMIN_TEMPLATE.key } })) ?? (await prisma.role.create({ data: { organizationId: org.id, key: SUPER_ADMIN_TEMPLATE.key, name: SUPER_ADMIN_TEMPLATE.name, allDepartments: true, permissions: SUPER_ADMIN_TEMPLATE.permissions } }));
  await prisma.user.create({ data: { organizationId: org.id, email: "superadmin@hotelcost.test", name: "Platform Super Admin", passwordHash: await bcrypt.hash(PASSWORD, 10), roleId: role.id } });
  console.log("Platform super admin: superadmin@hotelcost.test");
}

async function main() {
  await ensurePlatformAdmin();
  if (await prisma.organization.findFirst({ where: { name: ORG } })) {
    console.log("Seed data already present — skipping (seed never duplicates data).");
    return;
  }
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const days: Date[] = [];
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) days.push(d);
  const at = (d: Date, h = 12) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h));
  console.log(`Seeding ${days.length} days: ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`);

  const org = await prisma.organization.create({ data: { name: ORG } });
  for (const c of ["TRY", "EUR", "USD"]) await prisma.currency.upsert({ where: { code: c }, create: { code: c, organizationId: org.id, name: c }, update: {} });
  const hotel = await prisma.hotel.create({ data: { organizationId: org.id, code: "GAR", name: "Grand Anatolia Resort", totalRooms: 320, priceAlertPct: 10, wasteApprovalValue: 400, adjustmentApprovalValue: 5000, marginTargetPct: 65 } });
  const hotel2 = await prisma.hotel.create({ data: { organizationId: org.id, code: "BCH", name: "Bosphorus City Hotel", totalRooms: 140 } });
  const H = hotel.id;

  // ── Departments / cost centers / warehouses ──
  const deptDefs = [
    ["FB", "Food & Beverage", false],
    ["REST", "Restaurant", true],
    ["CAFE", "Cafe", true],
    ["BAR", "Bar", true],
    ["BRKF", "Breakfast", true],
    ["BANQ", "Banquet", true],
    ["KITCH", "Main Kitchen", false],
    ["PAST", "Pastry", true],
    ["ROOMS", "Rooms", false],
    ["HK", "Housekeeping", false],
    ["LAUN", "Laundry", false],
    ["ENG", "Engineering", false],
    ["ADM", "Administration", false],
  ] as const;
  const dept: Record<string, string> = {};
  for (const [code, name, outlet] of deptDefs) dept[code] = (await prisma.department.create({ data: { hotelId: H, code, name, isOutlet: outlet } })).id;
  for (const c of ["REST", "CAFE", "BAR", "BRKF", "BANQ", "KITCH", "PAST"]) await prisma.department.update({ where: { id: dept[c] }, data: { parentId: dept.FB } });
  for (const c of ["HK", "LAUN"]) await prisma.department.update({ where: { id: dept[c] }, data: { parentId: dept.ROOMS } });
  for (const [code, name] of deptDefs) await prisma.costCenter.create({ data: { hotelId: H, departmentId: dept[code], code: `CC-${code}`, name, kind: "DEPARTMENT" } });
  await prisma.department.create({ data: { hotelId: hotel2.id, code: "REST", name: "Restaurant", isOutlet: true } });

  const wh: Record<string, string> = {};
  for (const [code, name, d] of [["MAIN", "Main Store", null], ["KITCH", "Kitchen Store", "KITCH"], ["REST", "Restaurant Store", "REST"], ["CAFE", "Cafe Store", "CAFE"], ["BAR", "Bar Store", "BAR"], ["BRKF", "Breakfast Store", "BRKF"], ["PAST", "Pastry Store", "PAST"]] as const) {
    wh[code] = (await prisma.warehouse.create({ data: { hotelId: H, code, name, departmentId: d ? dept[d] : null } })).id;
  }
  await prisma.warehouse.create({ data: { hotelId: hotel2.id, code: "MAIN", name: "Main Store" } });

  // ── Categories ──
  const cat: Record<string, string> = {};
  for (const [group, children] of Object.entries(CATEGORY_TREE)) {
    const parent = await prisma.productCategory.create({ data: { hotelId: H, code: group, name: group[0] + group.slice(1).toLowerCase(), group } });
    for (const c of children) cat[c] = (await prisma.productCategory.create({ data: { hotelId: H, code: `${group}-${c.toUpperCase().replace(/[^A-Z]/g, "")}`, name: c, group, parentId: parent.id } })).id;
  }
  await prisma.productCategory.create({ data: { hotelId: hotel2.id, code: "FOOD", name: "Food", group: "FOOD" } });

  // ── Roles & users ──
  const roleId: Record<string, string> = {};
  for (const t of ROLE_TEMPLATES) roleId[t.key] = (await prisma.role.create({ data: { organizationId: org.id, key: t.key, name: t.name, allDepartments: t.allDepartments, permissions: t.permissions } })).id;
  const hash = await bcrypt.hash(PASSWORD, 10);
  const userDefs: Array<[string, string, string, string[] | null, boolean]> = [
    ["admin", "System Admin", "admin", null, true],
    ["controller", "Selin Kaya (Cost Controller)", "cost_controller", null, true],
    ["fb", "Murat Demir (F&B Manager)", "fb_manager", ["FB", "REST", "CAFE", "BAR", "BRKF", "BANQ", "KITCH", "PAST"], false],
    ["chef", "Ahmet Yılmaz (Executive Chef)", "chef", ["KITCH", "REST", "BANQ"], false],
    ["breakfast", "Elif Şahin (Breakfast Chef)", "breakfast_chef", ["BRKF"], false],
    ["pastry", "Deniz Aydın (Pastry Chef)", "pastry_chef", ["PAST"], false],
    ["purchasing", "Burak Çelik (Purchasing)", "purchasing_manager", null, false],
    ["accounting", "Zeynep Arslan (Accounting)", "accounting_manager", null, true],
    ["warehouse", "Can Öztürk (Storekeeper)", "warehouse", null, false],
    ["rooms", "Ayşe Koç (Rooms Division)", "rooms_division", ["ROOMS", "HK", "LAUN"], false],
  ];
  const actors: Record<string, Actor> = {};
  for (const [key, name, role, depts, both] of userDefs) {
    const u = await prisma.user.create({ data: { organizationId: org.id, email: `${key}@grandanatolia.test`, name, passwordHash: hash, roleId: roleId[role]! } });
    await prisma.userHotelAccess.create({ data: { userId: u.id, hotelId: H } });
    if (both) await prisma.userHotelAccess.create({ data: { userId: u.id, hotelId: hotel2.id } });
    if (depts) for (const d of depts) await prisma.userDepartmentAccess.create({ data: { userId: u.id, departmentId: dept[d]! } });
    const t = ROLE_TEMPLATES.find((x) => x.key === role)!;
    actors[key] = { userId: u.id, organizationId: org.id, name, email: u.email, roleKey: role, roleName: t.name, permissions: new Set(t.permissions), hotelIds: both ? [H, hotel2.id] : [H], departmentIds: t.allDepartments ? "ALL" : (depts ?? []).map((d) => dept[d]!) };
  }
  const admin = actors.controller!;

  // ── Suppliers & products ──
  const supplierDefs = [["ANT-ET", "Anadolu Et ve Tavuk A.Ş.", 1], ["EGE-SUT", "Ege Süt Ürünleri", 1], ["HAL-SEBZE", "Antalya Hal Sebze Meyve", 0], ["MET-GIDA", "Metro Gıda Toptan", 2], ["IST-ICECEK", "İstanbul İçecek Dağıtım", 3]] as const;
  const suppliers: string[] = [];
  for (const [code, name, lead] of supplierDefs) suppliers.push((await prisma.supplier.create({ data: { hotelId: H, code, name, leadTimeDays: lead } })).id);
  const pid: Record<string, string> = {};
  for (const p of PRODUCTS) {
    const created = await prisma.product.create({
      data: {
        hotelId: H, sku: p.sku, name: p.name, categoryId: cat[p.cat]!, defaultSupplierId: suppliers[p.supplier], purchaseUnit: p.purchaseUnit ?? p.unit, stockUnit: p.unit,
        recipeUnit: p.unit === "kg" ? "g" : p.unit === "l" ? "ml" : p.unit, yieldPct: String(p.yieldPct ?? 100), costingMethod: p.fifo ? "FIFO" : "WEIGHTED_AVERAGE",
        reorderPoint: p.reorder != null ? String(p.reorder) : null, safetyStock: p.safety != null ? String(p.safety) : null, maxStock: p.max != null ? String(p.max) : null, minStock: p.safety != null ? String(p.safety) : null,
        taxRatePct: p.cat === "Spirits" ? "20" : "1", shelfLifeDays: ["Vegetables", "Fruits", "Fish", "Chicken", "Meat", "Milk"].includes(p.cat) ? 7 : 180,
        conversions: p.caseSize ? { create: [{ fromUnit: p.purchaseUnit!, toUnit: p.unit, factor: p.caseSize }] } : undefined,
      },
    });
    pid[p.sku] = created.id;
  }

  // ── Opening stock (first day) ──
  const openingDay = at(days[0]!, 6);
  for (const p of PRODUCTS) {
    const qty = p.unit === "pc" ? 120 : p.unit === "l" ? 12 : 15;
    await postMovement(prisma, admin, { hotelId: H, warehouseId: wh.MAIN!, productId: pid[p.sku]!, type: "OPENING", quantity: qty, unitCost: (p.price * 0.97).toFixed(4), txDate: openingDay, sourceType: "MANUAL", reason: "Opening balance" });
  }

  // ── Recipes (via the real service + approval workflow) ──
  const fb = actors.fb!;
  const mk = async (code: string, name: string, type: string, d: string, posCode: string | null, v: Record<string, unknown>, lines: Array<[string, number, string, number?, number?]>, sub: Array<[string, number, string]> = []) => {
    const r = await createRecipe(prisma, fb, H, {
      code, name, type, departmentId: dept[d], posCode,
      version: { ...v, reason: "Initial standard recipe", lines: [...lines.map(([sku, q, u, y, w]) => ({ productId: pid[sku], quantity: q, unit: u, yieldPct: y ?? null, wastePct: w ?? null })), ...sub.map(([rid, q, u]) => ({ subRecipeId: rid, quantity: q, unit: u }))] },
    });
    await approveVersion(prisma, admin, H, r.versions[0]!.id, { effectiveFrom: new Date(start.getTime() - 86400000) });
    return r.id;
  };
  const mayo = await mk("SR-MAYO", "House Mayonnaise", "SEMI_FINISHED", "KITCH", null, { batchYieldQty: 1, yieldUnit: "kg", portions: 1 }, [["OIL-SUNFL", 800, "ml"], ["EGG-LARGE", 4, "pc"], ["SAU-MUSTARD", 20, "g"], ["FRT-LEMON", 30, "g"], ["SPC-SALT", 8, "g"]]);
  const burgerSauce = await mk("SR-BSAUCE", "Burger Sauce", "SEMI_FINISHED", "KITCH", null, { batchYieldQty: 1, yieldUnit: "kg", portions: 1 }, [["SAU-KETCHUP", 300, "g"], ["SAU-MUSTARD", 80, "g"], ["SPC-PEPPER", 5, "g"]], [[mayo, 600, "g"]]);
  const tomatoSauce = await mk("SR-TOMSAUCE", "Tomato Sauce", "SEMI_FINISHED", "KITCH", null, { batchYieldQty: 5, yieldUnit: "kg", portions: 1, productionLossPct: 15 }, [["VEG-TOMATO", 5, "kg"], ["VEG-ONION", 600, "g"], ["VEG-GARLIC", 60, "g"], ["OIL-OLIVE", 150, "ml"], ["SPC-SALT", 40, "g"]]);
  const recipes: Array<{ id: string; pos: string; dept: string; base: number; price: number }> = [];
  const add = async (pos: string, dept_: string, base: number, price: number, id: Promise<string>) => recipes.push({ id: await id, pos, dept: dept_, base, price });
  await add("BURGER", "REST", 38, 420, mk("RC-BURGER", "Classic Burger", "RESTAURANT", "REST", "BURGER", { batchYieldQty: 10, yieldUnit: "portion", portions: 10, sellingPrice: 420, packagingCost: 0, portionSize: 150, portionUnit: "g" }, [["MEAT-BEEF-GR", 1.5, "kg", undefined, 2], ["BAK-BUN", 10, "pc"], ["CHS-CHEDDAR", 300, "g"], ["VEG-LETTUCE", 300, "g"], ["VEG-TOMATO", 500, "g"], ["VEG-ONION", 200, "g"]], [[burgerSauce, 400, "g"]]));
  await add("CHKPASTA", "REST", 24, 360, mk("RC-CHKPASTA", "Chicken Penne", "RESTAURANT", "REST", "CHKPASTA", { batchYieldQty: 10, yieldUnit: "portion", portions: 10, sellingPrice: 360 }, [["CHK-BREAST", 1.4, "kg"], ["DRY-PASTA", 1.2, "kg"], ["DAIRY-CREAM", 800, "ml"], ["CHS-PARMESAN", 150, "g"], ["VEG-GARLIC", 40, "g"]], [[tomatoSauce, 600, "g"]]));
  await add("CHKSALAD", "REST", 18, 310, mk("RC-CHKSALAD", "Grilled Chicken Salad", "RESTAURANT", "REST", "CHKSALAD", { batchYieldQty: 10, yieldUnit: "portion", portions: 10, sellingPrice: 310 }, [["CHK-BREAST", 1.2, "kg"], ["VEG-LETTUCE", 1.5, "kg", undefined, 3], ["VEG-TOMATO", 800, "g"], ["VEG-CUCUMBER", 600, "g"], ["OIL-OLIVE", 200, "ml"], ["FRT-LEMON", 150, "g"]]));
  await add("CHKWRAP", "CAFE", 20, 260, mk("RC-CHKWRAP", "Chicken Wrap", "CAFE", "CAFE", "CHKWRAP", { batchYieldQty: 10, yieldUnit: "portion", portions: 10, sellingPrice: 260, packagingCost: 35 }, [["CHK-BREAST", 1.0, "kg"], ["BAK-TORTILLA", 10, "pc"], ["VEG-LETTUCE", 500, "g"], ["VEG-TOMATO", 500, "g"]], [[mayo, 300, "g"]]));
  await add("SALMON", "REST", 9, 690, mk("RC-SALMON", "Grilled Salmon", "RESTAURANT", "REST", "SALMON", { batchYieldQty: 1, yieldUnit: "portion", portions: 1, sellingPrice: 690 }, [["FISH-SALMON", 180, "g"], ["DRY-RICE", 90, "g"], ["DAIRY-BUTTER", 20, "g"], ["FRT-LEMON", 30, "g"]]));
  await add("CAPPU", "CAFE", 70, 110, mk("RC-CAPPU", "Cappuccino", "CAFE", "CAFE", "CAPPU", { batchYieldQty: 1, yieldUnit: "portion", portions: 1, sellingPrice: 110 }, [["COF-BEANS", 18, "g"], ["MILK-WHOLE", 150, "ml"]]));
  await add("LATTE", "CAFE", 45, 120, mk("RC-LATTE", "Caffè Latte", "CAFE", "CAFE", "LATTE", { batchYieldQty: 1, yieldUnit: "portion", portions: 1, sellingPrice: 120 }, [["COF-BEANS", 18, "g"], ["MILK-WHOLE", 220, "ml"]]));
  await add("COLA", "BAR", 60, 90, mk("RC-COLA", "Cola", "BAR", "BAR", "COLA", { batchYieldQty: 1, yieldUnit: "portion", portions: 1, sellingPrice: 90 }, [["BEV-COLA", 1, "pc"]]));
  await add("GINTONIC", "BAR", 22, 420, mk("RC-GINTONIC", "Gin & Tonic", "BAR", "BAR", "GINTONIC", { batchYieldQty: 1, yieldUnit: "portion", portions: 1, sellingPrice: 420 }, [["SPR-GIN", 50, "ml"], ["BEV-TONIC", 1, "pc"], ["FRT-LIME", 15, "g"]]));
  await add("MOJITO", "BAR", 18, 390, mk("RC-MOJITO", "Mojito", "BAR", "BAR", "MOJITO", { batchYieldQty: 1, yieldUnit: "portion", portions: 1, sellingPrice: 390 }, [["SPR-RUM", 50, "ml"], ["BAR-MINT", 8, "g"], ["FRT-LIME", 30, "g"], ["SYR-SUGAR", 20, "ml"], ["BEV-SODA", 1, "pc"]]));
  await add("OMELETTE", "BRKF", 55, 180, mk("RC-OMELETTE", "Cheese Omelette", "BREAKFAST", "BRKF", "OMELETTE", { batchYieldQty: 1, yieldUnit: "portion", portions: 1, sellingPrice: 180 }, [["EGG-LARGE", 3, "pc"], ["CHS-CHEDDAR", 30, "g"], ["DAIRY-BUTTER", 10, "g"], ["MILK-WHOLE", 20, "ml"]]));
  await add("TIRAMISU", "PAST", 14, 240, mk("RC-TIRAMISU", "Tiramisu", "PASTRY", "PAST", "TIRAMISU", { batchYieldQty: 12, yieldUnit: "portion", portions: 12, sellingPrice: 240, productionLossPct: 5 }, [["CHS-MASCARP", 750, "g"], ["EGG-LARGE", 6, "pc"], ["DRY-SUGAR", 180, "g"], ["BAK-LADYF", 400, "g"], ["COF-BEANS", 30, "g"], ["CHOC-DARK", 60, "g"]]));

  // per-portion requirements (AP, stock unit) from the shared engine
  const resolver = await buildResolver(prisma, H);
  const reqPerPortion = new Map<string, Map<string, Decimal>>();
  for (const r of recipes) {
    const rec = await prisma.recipe.findUniqueOrThrow({ where: { id: r.id }, include: { versions: { include: { lines: true } } } });
    const c = costRecipe(versionToDef(rec, rec.versions[0]!), resolver);
    reqPerPortion.set(r.pos, new Map([...c.requirements].map(([k, v]) => [k, v.div(c.portions)])));
  }

  // ── Daily operations ──
  // Sales are planned first; purchases are received at the start of each week for that week's
  // need (+ buffer); outlets receive daily transfers and issue what they used that day (with some
  // real-world over-use on tomato and cheddar so the variance report has something to explain).
  const deptWh: Record<string, string> = { REST: wh.REST!, CAFE: wh.CAFE!, BAR: wh.BAR!, BRKF: wh.BRKF!, PAST: wh.PAST! };
  const priceBump = new Date(start.getTime() + 14 * 86400000);
  const plan = days.map((d) => {
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    return { d, lines: recipes.map((r) => ({ r, qty: Math.max(0, Math.round(r.base * (weekend ? 1.3 : 1) * between(0.75, 1.25))) })).filter((x) => x.qty > 0) };
  });
  const usageOf = (dayPlan: (typeof plan)[number]) => {
    const m = new Map<string, Map<string, Decimal>>();
    for (const { r, qty } of dayPlan.lines) {
      const dm = m.get(r.dept) ?? new Map<string, Decimal>();
      for (const [p, q] of reqPerPortion.get(r.pos)!) dm.set(p, (dm.get(p) ?? ZERO).plus(q.times(qty)));
      m.set(r.dept, dm);
    }
    return m;
  };
  let saleNo = 0;
  for (let w = 0; w < plan.length; w += 7) {
    const week = plan.slice(w, w + 7);
    const d0 = week[0]!.d;
    // weekly purchasing for the week's expected need
    const need = new Map<string, Decimal>();
    for (const dp of week) for (const dm of usageOf(dp).values()) for (const [p, q] of dm) need.set(p, (need.get(p) ?? ZERO).plus(q));
    const bySupplier = new Map<number, Array<{ productId: string; quantity: string; unit: string; unitPrice: string }>>();
    for (const [p, q] of need) {
      const def = PRODUCTS.find((x) => pid[x.sku] === p)!;
      const unitPrice = def.sku === "CHK-BREAST" && d0 >= priceBump ? def.price * 1.2 : def.price * between(0.98, 1.03);
      const factor = def.purchaseUnit ? Number(def.caseSize) : 1;
      const units = Math.ceil(Number(q.times(1.15).div(factor).toString()));
      const list = bySupplier.get(def.supplier) ?? [];
      list.push({ productId: p, quantity: String(units), unit: def.purchaseUnit ?? def.unit, unitPrice: (unitPrice * factor).toFixed(2) });
      bySupplier.set(def.supplier, list);
    }
    for (const [s, items] of bySupplier) {
      await postGoodsReceipt(prisma, actors.warehouse!, H, { supplierId: suppliers[s], warehouseId: wh.MAIN, receiptDate: at(d0, 7), invoiceNo: `${supplierDefs[s]![0]}-${d0.toISOString().slice(0, 10)}`, freight: s === 0 ? "250" : "0", items });
    }
    const rows: unknown[] = [];
    for (const dp of week) {
      for (const { r, qty } of dp.lines) rows.push({ externalId: `POS-${dp.d.toISOString().slice(0, 10)}-${++saleNo}`, saleDate: at(dp.d, 20).toISOString(), department: r.dept, posCode: r.pos, quantity: qty, netRevenue: (qty * r.price).toFixed(2) });
      if (dp.d.getUTCDate() % 9 === 0) rows.push({ externalId: `POS-${dp.d.toISOString().slice(0, 10)}-${++saleNo}`, saleDate: at(dp.d, 21).toISOString(), department: "BAR", posCode: "CHEFSPECIAL", quantity: 3, netRevenue: "1350" });
      for (const [dc, dm] of usageOf(dp)) {
        for (const [p, q] of dm) {
          const def = PRODUCTS.find((x) => pid[x.sku] === p)!;
          const over = def.sku === "VEG-TOMATO" || def.sku === "CHS-CHEDDAR" ? between(1.05, 1.1) : between(1.0, 1.02);
          const issue = q.times(over).toDecimalPlaces(3);
          await transferStock(prisma, admin, { hotelId: H, fromWarehouseId: wh.MAIN!, toWarehouseId: deptWh[dc]!, productId: p, quantity: issue.times(1.03).toDecimalPlaces(3), txDate: at(dp.d, 8) });
          await postMovement(prisma, admin, { hotelId: H, warehouseId: deptWh[dc]!, productId: p, type: "CONSUMPTION", quantity: issue.neg(), txDate: at(dp.d, 22), departmentId: dept[dc], sourceType: "MANUAL", reason: "Daily kitchen issue" });
        }
      }
    }
    await commitSales(prisma, fb, H, { rows, source: "API", fileName: `pos-week-${d0.toISOString().slice(0, 10)}.json` });
  }

  // ── Waste, staff meals, complimentary ──
  const wasteEvents: Array<[string, string, string, number, string, string]> = [
    ["REST", "VEG-TOMATO", "SPOILED", 3.5, "kg", "Overripe batch"],
    ["REST", "VEG-LETTUCE", "PREPARATION", 1.2, "kg", "Outer leaves"],
    ["BRKF", "EGG-LARGE", "BROKEN", 24, "pc", "Dropped tray"],
    ["CAFE", "MILK-WHOLE", "EXPIRED", 4, "l", "Past date"],
    ["BAR", "BAR-MINT", "SPOILED", 0.15, "kg", "Wilted"],
    ["PAST", "CHS-MASCARP", "TEMPERATURE_LOSS", 0.5, "kg", "Fridge door left open"],
    ["REST", "MEAT-BEEF-GR", "OVERCOOKED", 0.8, "kg", "Returned patties"],
    ["REST", "CHK-BREAST", "BURNED", 2.5, "kg", "Grill incident — large"],
  ];
  for (const [i, [dc, sku, type, q, u, reason]] of wasteEvents.entries()) {
    const d = days[Math.min(days.length - 1, 3 + i * 4)]!;
    const actor = dc === "PAST" ? actors.pastry! : dc === "BRKF" ? actors.breakfast! : fb;
    const res = await recordWaste(prisma, actor, H, { departmentId: dept[dc], warehouseId: deptWh[dc], productId: pid[sku], wasteType: type, wasteDate: at(d, 15), quantity: q, unit: u, reason }).catch((e) => {
      console.warn(`  waste skipped (${sku}): ${e.message}`);
      return null;
    });
    if (res?.approvalId && i % 2 === 0) await decideApproval(prisma, admin, H, { approvalId: res.approvalId, decision: "APPROVE", note: "Verified with outlet manager" });
  }
  for (const d of days.filter((_, i) => i % 7 === 2)) {
    await postMovement(prisma, admin, { hotelId: H, warehouseId: wh.MAIN!, productId: pid["DRY-RICE"]!, type: "STAFF_MEAL", quantity: -3, txDate: at(d, 13), departmentId: dept.KITCH, sourceType: "MANUAL", reason: "Staff canteen" });
    await postMovement(prisma, admin, { hotelId: H, warehouseId: wh.BAR!, productId: pid["BEV-COLA"]!, type: "COMPLIMENTARY", quantity: -6, txDate: at(d, 18), departmentId: dept.BAR, sourceType: "MANUAL", reason: "VIP welcome" }).catch(() => null);
  }

  // ── Month-end stock count for the restaurant store (previous month) ──
  const monthEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23));
  if (monthEnd <= end) {
    const cnt = await startCount(prisma, actors.warehouse!, H, { warehouseId: wh.REST!, countDate: monthEnd });
    const lines = cnt.lines.map((l) => {
      const sys = D(l.systemQty.toString());
      const sku = PRODUCTS.find((p) => pid[p.sku] === l.productId)?.sku;
      const physical = sku === "VEG-TOMATO" ? sys.times(0.7) : sku === "CHS-CHEDDAR" ? sys.times(0.85) : sys;
      return { productId: l.productId, countedQty: physical.toDecimalPlaces(3).toString(), reason: physical.eq(sys) ? null : "Physical count" };
    });
    await enterCount(prisma, actors.warehouse!, H, cnt.id, { lines });
    const sub = await submitCount(prisma, actors.warehouse!, H, cnt.id);
    if (sub.approvalId) await decideApproval(prisma, admin, H, { approvalId: sub.approvalId, decision: "APPROVE", note: "Recount confirmed" });
  }

  // ── Buffet (Phase 2): daily breakfast buffet + Saturday theme night ──
  const scrambled = await createRecipe(prisma, fb, H, {
    code: "BF-SCRAMBLED", name: "Scrambled Eggs (buffet)", type: "BREAKFAST", departmentId: dept.BRKF,
    version: { batchYieldQty: 1, yieldUnit: "kg", portions: 1, reason: "Buffet standard", lines: [{ productId: pid["EGG-LARGE"], quantity: 14, unit: "pc" }, { productId: pid["DAIRY-BUTTER"], quantity: 40, unit: "g" }, { productId: pid["MILK-WHOLE"], quantity: 50, unit: "ml" }] },
  });
  await approveVersion(prisma, admin, H, scrambled.versions[0]!.id, { effectiveFrom: new Date(start.getTime() - 86400000) });
  const breakfastItems: Array<{ key: string; recipe?: boolean; unit: string; perCover: number }> = [
    { key: scrambled.id, recipe: true, unit: "kg", perCover: 0.06 },
    { key: pid["CHS-CHEDDAR"]!, unit: "kg", perCover: 0.025 },
    { key: pid["VEG-TOMATO"]!, unit: "kg", perCover: 0.04 },
    { key: pid["VEG-CUCUMBER"]!, unit: "kg", perCover: 0.03 },
    { key: pid["FRT-STRAWB"]!, unit: "kg", perCover: 0.03 },
    { key: pid["DAIRY-BUTTER"]!, unit: "kg", perCover: 0.012 },
    { key: pid["MILK-WHOLE"]!, unit: "l", perCover: 0.08 },
  ];
  const themeItems: Array<{ key: string; unit: string; perCover: number }> = [
    { key: pid["FISH-SALMON"]!, unit: "kg", perCover: 0.12 },
    { key: pid["DRY-RICE"]!, unit: "kg", perCover: 0.08 },
    { key: pid["VEG-LETTUCE"]!, unit: "kg", perCover: 0.05 },
  ];
  const buffetPrice: Record<string, number> = { [pid["EGG-LARGE"]!]: 4.2 * 180, [pid["CHS-CHEDDAR"]!]: 380, [pid["VEG-TOMATO"]!]: 38, [pid["VEG-CUCUMBER"]!]: 30, [pid["FRT-STRAWB"]!]: 140, [pid["DAIRY-BUTTER"]!]: 420, [pid["MILK-WHOLE"]!]: 32, [pid["FISH-SALMON"]!]: 820, [pid["DRY-RICE"]!]: 62, [pid["VEG-LETTUCE"]!]: 45 };
  for (let w = 0; w < days.length; w += 7) {
    // weekly buffet purchasing into the main store (eggs in cases of 180)
    const items = [
      { productId: pid["EGG-LARGE"]!, quantity: "20", unit: "case", unitPrice: (buffetPrice[pid["EGG-LARGE"]!]! * between(0.98, 1.03)).toFixed(2) },
      ...[["CHS-CHEDDAR", 60], ["VEG-TOMATO", 90], ["VEG-CUCUMBER", 70], ["FRT-STRAWB", 70], ["DAIRY-BUTTER", 40], ["MILK-WHOLE", 190], ["FISH-SALMON", 25], ["DRY-RICE", 15], ["VEG-LETTUCE", 12]].map(([sku, q]) => ({ productId: pid[sku as string]!, quantity: String(q), unit: PRODUCTS.find((x) => x.sku === sku)!.unit, unitPrice: (buffetPrice[pid[sku as string]!]! * between(0.97, 1.04)).toFixed(2) })),
    ];
    await postGoodsReceipt(prisma, actors.warehouse!, H, { supplierId: suppliers[1], warehouseId: wh.MAIN, receiptDate: at(days[w]!, 6), invoiceNo: `BUF-${days[w]!.toISOString().slice(0, 10)}`, items });
  }
  let sessionsCreated = 0;
  for (const d of days) {
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const sessions: Array<{ type: "BREAKFAST" | "THEME_NIGHT"; deptCode: string; covers: number; expected: number; items: Array<{ key: string; recipe?: boolean; unit: string; perCover: number }> }> = [
      { type: "BREAKFAST", deptCode: "BRKF", covers: Math.round(between(weekend ? 320 : 260, weekend ? 380 : 330)), expected: weekend ? 340 : 290, items: breakfastItems },
    ];
    if (d.getUTCDay() === 6) sessions.push({ type: "THEME_NIGHT", deptCode: "REST", covers: Math.round(between(120, 160)), expected: 140, items: themeItems });
    for (const ss of sessions) {
      const session = await createSession(prisma, fb, H, { departmentId: dept[ss.deptCode], warehouseId: wh.MAIN, type: ss.type, serviceDate: d, expectedCovers: ss.expected, occupiedRooms: ss.type === "BREAKFAST" ? Math.round(ss.covers / 1.8) : null, inHouseGuests: ss.type === "BREAKFAST" ? Math.round(ss.covers * 1.05) : null, boardBasis: ss.type === "BREAKFAST" ? "BB" : "HB" });
      const leftovers: Array<{ key: string; quantity: string; class: string }> = [];
      for (const it of ss.items) {
        const need = ss.expected * it.perCover;
        const first = +(need * 0.8).toFixed(2);
        const refill = +(need * between(0.25, 0.45)).toFixed(2);
        await addLine(prisma, fb, H, session.id, { kind: "PRODUCTION", ...(it.recipe ? { recipeId: it.key } : { productId: it.key }), quantity: first, unit: it.unit });
        await addLine(prisma, fb, H, session.id, { kind: "REFILL", ...(it.recipe ? { recipeId: it.key } : { productId: it.key }), quantity: refill, unit: it.unit });
        const total = first + refill;
        const left = total * between(0.04, ss.covers < ss.expected ? 0.2 : 0.12);
        const waste = +(left * between(0.3, 0.6)).toFixed(3);
        const staff = +(left * 0.15).toFixed(3);
        const reuse = +(left - waste - staff).toFixed(3);
        leftovers.push({ key: it.key, quantity: String(waste), class: it.recipe ? "MUST_DISCARD" : "WASTE" });
        if (staff > 0) leftovers.push({ key: it.key, quantity: String(staff), class: "STAFF_MEAL" });
        if (reuse > 0) leftovers.push({ key: it.key, quantity: String(reuse), class: "REFRIGERATED" });
      }
      // leave yesterday's breakfast open on the last day to show the open-session workflow
      if (d.getTime() === end.getTime() && ss.type === "BREAKFAST") continue;
      await closeSession(prisma, fb, H, session.id, { actualCovers: ss.covers, leftovers });
      sessionsCreated++;
    }
  }

  // ── Minibar (Phase 2): 40 rooms, par per room type, daily consumption, weekly counts ──
  const mbProducts: Array<[string, string, number, string]> = [["MB-WATER", "Water 500ml", 6, "Water"], ["MB-CHOC", "Chocolate Bar", 28, "Chocolate"], ["MB-NUTS", "Mixed Nuts 50g", 45, "Nuts"]];
  for (const [sku, name, , catName] of mbProducts) {
    pid[sku] = (await prisma.product.create({ data: { hotelId: H, sku, name, categoryId: cat[catName]!, defaultSupplierId: suppliers[4], purchaseUnit: "pc", stockUnit: "pc", recipeUnit: "pc", taxRatePct: "10" } })).id;
  }
  const { store: mbStore } = await minibarSetup(prisma as never, admin, H);
  await postGoodsReceipt(prisma, actors.warehouse!, H, {
    supplierId: suppliers[4], warehouseId: mbStore.id, receiptDate: at(days[0]!, 5), invoiceNo: "MB-OPEN",
    items: [{ productId: pid["BEV-COLA"]!, quantity: "60", unit: "case", unitPrice: (22 * 24).toFixed(2) }, { productId: pid["BEV-SODA"]!, quantity: "800", unit: "pc", unitPrice: "14" }, ...mbProducts.map(([sku, , price]) => ({ productId: pid[sku]!, quantity: "1500", unit: "pc", unitPrice: String(price) }))],
  });
  const roomTypes: Record<string, string> = { "1": "Standard", "2": "Standard", "3": "Deluxe", "4": "Suite" };
  const roomIds: string[] = [];
  for (const floor of ["1", "2", "3", "4"]) for (let n = 1; n <= 10; n++) roomIds.push((await prisma.room.create({ data: { hotelId: H, number: `${floor}${String(n).padStart(2, "0")}`, roomType: roomTypes[floor]!, floor, area: floor === "4" ? "Tower" : "Main building" } })).id);
  const pars: Record<string, Array<[string, number, number]>> = {
    Standard: [["BEV-COLA", 2, 90], ["BEV-SODA", 2, 70], ["MB-WATER", 2, 60], ["MB-CHOC", 1, 150], ["MB-NUTS", 1, 180]],
    Deluxe: [["BEV-COLA", 3, 95], ["BEV-SODA", 2, 75], ["MB-WATER", 3, 65], ["MB-CHOC", 2, 160], ["MB-NUTS", 1, 190]],
    Suite: [["BEV-COLA", 4, 110], ["BEV-SODA", 3, 85], ["MB-WATER", 4, 75], ["MB-CHOC", 2, 180], ["MB-NUTS", 2, 220]],
  };
  for (const [roomType, list] of Object.entries(pars)) for (const [sku, par, price] of list) await setPar(prisma, admin, H, { roomType, productId: pid[sku], parQty: par, sellingPrice: price });
  const wh2 = actors.warehouse!;
  for (const r of roomIds) await restockToParLevels(prisma, wh2, H, r, at(days[0]!, 9));
  for (const [i, d] of days.entries()) {
    for (const r of roomIds) {
      if (rnd() > 0.35) continue;
      const room = await prisma.room.findUniqueOrThrow({ where: { id: r } });
      const items: Array<{ productId: string; quantity: string }> = [];
      for (const [sku] of pars[room.roomType]!) {
        if (rnd() > 0.45) continue;
        const have = await roomQty(prisma, H, r, pid[sku]!);
        const q = Math.min(Number(have), 1 + Math.floor(rnd() * 2));
        if (q > 0) items.push({ productId: pid[sku]!, quantity: String(q) });
      }
      if (items.length) await recordMovement(prisma, wh2, H, { roomId: r, type: "CONSUMED", movedAt: at(d, 10), folioRef: `F-${room.number}-${i}`, items });
      await restockToParLevels(prisma, wh2, H, r, at(d, 11));
    }
    if (i % 7 === 6) {
      for (const r of roomIds.filter(() => rnd() < 0.25)) {
        const room = await prisma.room.findUniqueOrThrow({ where: { id: r } });
        const lines = [];
        for (const [sku] of pars[room.roomType]!) {
          const have = Number(await roomQty(prisma, H, r, pid[sku]!));
          lines.push({ productId: pid[sku]!, countedQty: String(rnd() < 0.08 && have > 0 ? have - 1 : have) });
        }
        await countRoom(prisma, wh2, H, { roomId: r, countedAt: at(d, 15), lines });
      }
    }
  }
  console.log(`Buffet sessions closed: ${sessionsCreated}; minibar movements: ${await prisma.minibarMovement.count({ where: { hotelId: H } })}`);

  // ── Rooms & operating costs (Phase 3): 90 rooms, PMS stays, payroll, utilities, meters, laundry, linen, engineering, allocation ──
  const deptMaster: Record<string, [number, number]> = { FB: [120, 2], REST: [600, 9], CAFE: [180, 4], BAR: [150, 4], BRKF: [450, 6], BANQ: [900, 4], KITCH: [520, 14], PAST: [90, 3], ROOMS: [3400, 6], HK: [260, 22], LAUN: [380, 6], ENG: [300, 7], ADM: [420, 10] };
  for (const [code, [sqm, headcount]] of Object.entries(deptMaster)) await prisma.department.update({ where: { id: dept[code] }, data: { sqm, headcount } });
  const sqmByType: Record<string, number> = { Standard: 26, Deluxe: 34, Suite: 55, Villa: 120 };
  await prisma.room.updateMany({ where: { hotelId: H, roomType: "Standard" }, data: { sqm: sqmByType.Standard } });
  await prisma.room.updateMany({ where: { hotelId: H, roomType: "Deluxe" }, data: { sqm: sqmByType.Deluxe } });
  await prisma.room.updateMany({ where: { hotelId: H, roomType: "Suite" }, data: { sqm: sqmByType.Suite } });
  const moreTypes: Record<string, string> = { "5": "Standard", "6": "Standard", "7": "Deluxe", "8": "Deluxe" };
  for (const floor of ["5", "6", "7", "8"]) for (let n = 1; n <= 10; n++) await prisma.room.create({ data: { hotelId: H, number: `${floor}${String(n).padStart(2, "0")}`, roomType: moreTypes[floor]!, floor, area: "Main building", sqm: sqmByType[moreTypes[floor]!] } });
  for (let n = 1; n <= 10; n++) await prisma.room.create({ data: { hotelId: H, number: `V${String(n).padStart(2, "0")}`, roomType: "Villa", floor: "G", area: "Villas", sqm: sqmByType.Villa } });
  const allRooms = await prisma.room.findMany({ where: { hotelId: H }, orderBy: { number: "asc" } });
  await prisma.hotel.update({ where: { id: H }, data: { totalRooms: allRooms.length } });

  // PMS stays: each room fills its calendar with stays (≈ 75–85 % occupancy)
  const rate: Record<string, number> = { Standard: 3200, Deluxe: 4300, Suite: 7600, Villa: 12500 };
  const channels: Array<[string, number, number, number]> = [["DIRECT", 0.25, 0, 0.015], ["OTA", 0.4, 0.17, 0.015], ["AGENCY", 0.1, 0.1, 0], ["CORPORATE", 0.1, 0, 0.01], ["TOUR_OPERATOR", 0.15, 0.2, 0]];
  const pickChannel = () => { let x = rnd(); for (const c of channels) { if ((x -= c[1]) <= 0) return c; } return channels[0]!; };
  const windowEnd = new Date(days.at(-1)!.getTime() + 86_400_000);
  const today0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const resRows: Array<Record<string, string>> = [];
  const nightly = new Map<string, { occ: number; guests: number; rev: number }>();
  let resNo = 1000;
  for (const r of allRooms) {
    let cursor = new Date(days[0]!.getTime() + Math.floor(rnd() * 3) * 86_400_000);
    while (cursor < windowEnd) {
      const nights = 1 + Math.floor(rnd() * (r.roomType === "Villa" ? 9 : 6));
      const dep = new Date(Math.min(cursor.getTime() + nights * 86_400_000, windowEnd.getTime() + 2 * 86_400_000));
      const n = Math.round((dep.getTime() - cursor.getTime()) / 86_400_000);
      const guests = r.roomType === "Villa" ? 3 + Math.floor(rnd() * 3) : r.roomType === "Suite" ? 2 + Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 2);
      const [ch, , comm, fee] = pickChannel();
      const adr = rate[r.roomType]! * between(0.85, 1.12) * (ch === "TOUR_OPERATOR" ? 0.8 : ch === "CORPORATE" ? 0.9 : 1);
      const gross = Math.round(adr * n);
      resRows.push({ external_id: `RES-${++resNo}`, room: r.number, room_type: r.roomType, arrival: cursor.toISOString().slice(0, 10), departure: dep.toISOString().slice(0, 10), guests: String(guests), channel: ch, board_basis: rnd() < 0.7 ? "BB" : "HB", status: dep <= today0 ? "CHECKED_OUT" : "IN_HOUSE", gross_room_revenue: String(gross), commission: (gross * comm).toFixed(2), payment_fee: (gross * fee).toFixed(2), other_distribution: "0" });
      for (let k = 0; k < n; k++) {
        const key = new Date(cursor.getTime() + k * 86_400_000).toISOString().slice(0, 10);
        const cur = nightly.get(key) ?? { occ: 0, guests: 0, rev: 0 };
        nightly.set(key, { occ: cur.occ + 1, guests: cur.guests + guests, rev: cur.rev + gross / n });
      }
      cursor = new Date(dep.getTime() + (rnd() < 0.55 ? 0 : 1 + Math.floor(rnd() * 3)) * 86_400_000);
    }
  }
  const pmsUser = actors.rooms!;
  await commitReservations(prisma, admin, H, "pms-reservations.csv", resRows);
  const occRows = days.map((d) => { const k = d.toISOString().slice(0, 10); const v = nightly.get(k) ?? { occ: 0, guests: 0, rev: 0 }; return { business_date: k, available_rooms: String(allRooms.length), occupied_rooms: String(v.occ), out_of_order: "0", guests: String(v.guests), room_revenue: v.rev.toFixed(2) }; });
  await commitOccupancy(prisma, pmsUser, H, "pms-daily-statistics.csv", occRows);

  // housekeeping store (amenities issued per occupied room) and linen room
  const hkProducts: Array<[string, string, string, string, number]> = [["HK-SOAP", "Guest Soap 25g", "Amenities", "pc", 4.2], ["HK-SLIPPER", "Guest Slippers", "Guest supplies", "pc", 18], ["HK-CHEM", "Multi-surface Cleaner", "Chemicals", "l", 85], ["LIN-SHEET", "Bed Sheet", "Bed linen", "pc", 420], ["LIN-TOWEL", "Bath Towel", "Towels", "pc", 260], ["LIN-ROBE", "Bathrobe", "Bathrobes", "pc", 780]];
  for (const [sku, name, catName, unit] of hkProducts) pid[sku] = (await prisma.product.create({ data: { hotelId: H, sku, name, categoryId: cat[catName]!, defaultSupplierId: suppliers[3], purchaseUnit: unit, stockUnit: unit, recipeUnit: unit === "l" ? "ml" : unit, taxRatePct: "20" } })).id;
  const hkStore = (await prisma.warehouse.create({ data: { hotelId: H, code: "HK", name: "Housekeeping Store", departmentId: dept.HK } })).id;
  const linenRoom = (await prisma.warehouse.create({ data: { hotelId: H, code: "LINEN", name: "Linen Room", departmentId: dept.LAUN } })).id;
  await postGoodsReceipt(prisma, actors.warehouse!, H, { supplierId: suppliers[3], warehouseId: hkStore, receiptDate: at(days[0]!, 6), invoiceNo: "HK-OPEN", items: [["HK-SHAMPOO", 6000, 6.5], ["HK-SOAP", 6000, 4.2], ["HK-SLIPPER", 2500, 18], ["HK-CHEM", 300, 85]].map(([sku, q, pr]) => ({ productId: pid[sku as string]!, quantity: String(q), unit: sku === "HK-CHEM" ? "l" : "pc", unitPrice: String(pr) })) });
  await postGoodsReceipt(prisma, actors.warehouse!, H, { supplierId: suppliers[3], warehouseId: linenRoom, receiptDate: at(days[0]!, 6), invoiceNo: "LINEN-OPEN", items: [["LIN-SHEET", 540, 420], ["LIN-TOWEL", 720, 260], ["LIN-ROBE", 200, 780]].map(([sku, q, pr]) => ({ productId: pid[sku as string]!, quantity: String(q), unit: "pc", unitPrice: String(pr) })) });
  for (const d of days) {
    const occ = nightly.get(d.toISOString().slice(0, 10))?.occ ?? 0;
    const g = nightly.get(d.toISOString().slice(0, 10))?.guests ?? 0;
    for (const [sku, perUnit] of [["HK-SHAMPOO", g * 1.1], ["HK-SOAP", g * 1.2], ["HK-SLIPPER", g * 0.45], ["HK-CHEM", occ * 0.09]] as const) {
      const q = Math.round(Number(perUnit) * between(0.95, 1.05) * 100) / 100;
      if (q > 0) await postMovement(prisma, admin, { hotelId: H, warehouseId: hkStore, productId: pid[sku]!, type: "CONSUMPTION", quantity: -q, txDate: at(d, 14), departmentId: dept.HK, sourceType: "MANUAL", reason: "Daily housekeeping issue" });
    }
    await recordLaundry(prisma, pmsUser, H, { logDate: d, source: "ROOMS", kg: (occ * 3.4 * between(0.9, 1.1)).toFixed(1), pieces: Math.round(occ * 9.5) });
    await recordLaundry(prisma, pmsUser, H, { logDate: d, source: "F_AND_B", kg: (between(35, 55)).toFixed(1), pieces: Math.round(between(220, 340)) });
  }
  // linen losses (spec 109): lost / damaged / discarded, plus a replacement purchase
  for (const [i, d] of days.entries()) {
    if (i % 5 !== 2) continue;
    for (const [sku, type, q] of [["LIN-TOWEL", "LOST", 1 + Math.floor(rnd() * 2)], ["LIN-SHEET", "DAMAGED", 1], ["LIN-ROBE", "DISCARDED", rnd() < 0.4 ? 1 : 0]] as const) {
      if (q > 0) await recordWaste(prisma, pmsUser, H, { departmentId: dept.LAUN, warehouseId: linenRoom, productId: pid[sku], wasteType: type, wasteDate: at(d, 16), quantity: q, unit: "pc", reason: type === "LOST" ? "Not returned from rooms" : type === "DAMAGED" ? "Torn in wash" : "Stained beyond recovery" });
    }
  }

  // assets & meters
  const assetDefs: Array<[string, string, string, string]> = [["HVAC-CH1", "Central chiller 1", "HVAC", "ENG"], ["HVAC-CH2", "Central chiller 2", "HVAC", "ENG"], ["KIT-OVEN1", "Combi oven", "OVEN", "KITCH"], ["KIT-DW1", "Flight dishwasher", "DISHWASHER", "KITCH"], ["KIT-CR1", "Cold room", "REFRIGERATOR", "KITCH"], ["LAU-WM1", "Washer extractor 60 kg", "LAUNDRY", "LAUN"], ["LAU-IR1", "Flatwork ironer", "LAUNDRY", "LAUN"], ["ELV-1", "Guest elevator A", "ELEVATOR", "ENG"], ["POOL-1", "Pool filtration", "POOL", "ENG"]];
  const asset: Record<string, string> = {};
  for (const [code, name, kind, dc] of assetDefs) asset[code] = (await createAsset(prisma, admin, H, { code, name, kind, departmentId: dept[dc] })).id;
  const meterDefs: Array<[string, string, string, string, string, number]> = [["E-ROOMS", "Electricity — guest rooms", "ELECTRICITY", "kWh", "ROOMS", 2600], ["E-KITCH", "Electricity — kitchen", "ELECTRICITY", "kWh", "KITCH", 900], ["E-LAUN", "Electricity — laundry", "ELECTRICITY", "kWh", "LAUN", 700], ["E-REST", "Electricity — restaurant & bar", "ELECTRICITY", "kWh", "REST", 450], ["W-ROOMS", "Water — guest rooms", "WATER", "m3", "ROOMS", 38], ["W-LAUN", "Water — laundry", "WATER", "m3", "LAUN", 14], ["W-KITCH", "Water — kitchen", "WATER", "m3", "KITCH", 9], ["G-KITCH", "Natural gas — kitchen", "GAS", "m3", "KITCH", 160], ["G-LAUN", "Natural gas — laundry", "GAS", "m3", "LAUN", 120]];
  const meterUse = new Map<string, number>();
  for (const [code, name, utility, unit, dc, daily] of meterDefs) {
    const m = await createMeter(prisma, admin, H, { code, name, utility, unit, departmentId: dept[dc] });
    let value = 100000 + Math.floor(rnd() * 50000);
    await recordReading(prisma, admin, H, { meterId: m.id, readingDate: new Date(days[0]!.getTime() - 86_400_000), value });
    for (const d of days) {
      const occ = nightly.get(d.toISOString().slice(0, 10))?.occ ?? 0;
      const use = daily * (dc === "ROOMS" || dc === "LAUN" ? 0.4 + (0.6 * occ) / allRooms.length : 1) * between(0.9, 1.1);
      value += use;
      if (d.getUTCMonth() === days[0]!.getUTCMonth()) meterUse.set(utility, (meterUse.get(utility) ?? 0) + use);
      await recordReading(prisma, admin, H, { meterId: m.id, readingDate: d, value: value.toFixed(1) });
    }
  }

  // expenses for the complete month (accounting / payroll / utility imports + a few manual entries)
  const firstMonth = days.filter((d) => d.getUTCMonth() === days[0]!.getUTCMonth());
  const firstMonthEnd = firstMonth.at(-1)!;
  const mEnd = firstMonthEnd.toISOString().slice(0, 10);
  const mTag = mEnd.slice(0, 7);
  const gl: Array<Record<string, string>> = [];
  for (const [code, [, headcount]] of Object.entries(deptMaster)) {
    const salary = headcount * between(30000, 36000);
    gl.push({ date: mEnd, department: code, category: "LABOR", subcategory: "SALARY", description: `Payroll ${code} ${mTag}`, amount: salary.toFixed(2), quantity: String(headcount), unit: "headcount", external_id: `PAY-${code}-${mTag}` });
    gl.push({ date: mEnd, department: code, category: "LABOR", subcategory: "EMPLOYER_COST", description: `SGK employer share ${code} ${mTag}`, amount: (salary * 0.2275).toFixed(2), external_id: `SGK-${code}-${mTag}` });
    if (["KITCH", "REST", "HK", "BANQ"].includes(code)) gl.push({ date: mEnd, department: code, category: "LABOR", subcategory: "OVERTIME", description: `Overtime ${code} ${mTag}`, amount: (salary * between(0.03, 0.08)).toFixed(2), external_id: `OT-${code}-${mTag}` });
  }
  const meteredKwh = meterUse.get("ELECTRICITY") ?? 0;
  const billKwh = meteredKwh * 1.18; // common areas, pool, lighting are not sub-metered
  gl.push({ date: mEnd, department: "", category: "ENERGY", subcategory: "ELECTRICITY", description: `Electricity ${mTag}`, amount: (billKwh * 3.05).toFixed(2), quantity: billKwh.toFixed(0), unit: "kWh", supplier: "Akdeniz Elektrik", invoice_no: `EL-${mTag}`, external_id: `EL-${mTag}` });
  const billWater = (meterUse.get("WATER") ?? 0) * 1.25;
  gl.push({ date: mEnd, department: "", category: "ENERGY", subcategory: "WATER", description: `Water ${mTag}`, amount: (billWater * 46).toFixed(2), quantity: billWater.toFixed(0), unit: "m3", supplier: "ASAT", invoice_no: `SU-${mTag}`, external_id: `SU-${mTag}` });
  const billGas = (meterUse.get("GAS") ?? 0) * 1.05;
  gl.push({ date: mEnd, department: "", category: "ENERGY", subcategory: "GAS", description: `Natural gas ${mTag}`, amount: (billGas * 14.2).toFixed(2), quantity: billGas.toFixed(0), unit: "m3", supplier: "Antalya Gaz", invoice_no: `DG-${mTag}`, external_id: `DG-${mTag}` });
  for (const [dc, cat_, sub, desc, amt] of [
    ["HK", "HOUSEKEEPING", "OUTSOURCED", "Facade & window cleaning contract", 18500], ["HK", "AMENITIES", "WELCOME", "Welcome amenities (VIP)", 9600], ["LAUN", "LAUNDRY", "OUTSOURCING", "Dry cleaning — guest laundry", 12400], ["LAUN", "LAUNDRY", "CHEMICALS", "Laundry chemicals contract", 15800],
    ["ROOMS", "ROOMS_OTHER", "FRONT_OFFICE", "Key cards & front office supplies", 6400], ["ADM", "ADMINISTRATION", "IT", "PMS / POS licences", 26000], ["ADM", "ADMINISTRATION", "AUDIT", "External audit fee (monthly accrual)", 15000], ["ADM", "ADMINISTRATION", "BANK", "Bank & POS charges", 8200],
    ["ADM", "SALES_MARKETING", "ADVERTISING", "Online advertising", 42000], ["ENG", "ENGINEERING", "PREVENTIVE_MAINTENANCE", "Elevator maintenance contract", 9500], ["ENG", "ENGINEERING", "CONTRACTOR", "HVAC service contract", 14500],
    ["", "RENT", "RENT", "Land lease", 250000], ["", "INSURANCE", "INSURANCE", "Property insurance (monthly)", 31000], ["", "DEPRECIATION", "DEPRECIATION", "Depreciation (monthly)", 185000],
  ] as const) gl.push({ date: mEnd, department: dc, category: cat_, subcategory: sub, description: desc, amount: String(amt), external_id: `GL-${cat_}-${sub}-${mTag}` });
  await commitExpenseImport(prisma, actors.accounting!, H, `gl-export-${mTag}.csv`, gl);
  // engineering jobs during the month (spare parts on assets, emergency repairs in rooms)
  for (const [i, d] of firstMonth.entries()) {
    if (i % 4 === 1) {
      const a = assetDefs[Math.floor(rnd() * assetDefs.length)]!;
      await createExpense(prisma, admin, H, { expenseDate: at(d, 11), departmentId: dept.ENG, category: "ENGINEERING", subCategory: rnd() < 0.5 ? "SPARE_PARTS" : "EQUIPMENT_REPAIR", description: `${a[1]} — ${rnd() < 0.5 ? "bearing replacement" : "service parts"}`, amount: (between(1200, 9500)).toFixed(2), assetId: asset[a[0]], supplierName: "Teknik Yedek Parça" });
    }
    if (i % 6 === 3) {
      const r = allRooms[Math.floor(rnd() * allRooms.length)]!;
      await createExpense(prisma, admin, H, { expenseDate: at(d, 13), category: "ENGINEERING", subCategory: "EMERGENCY_REPAIR", description: `Room ${r.number} — ${rnd() < 0.5 ? "AC failure" : "water leak"}`, amount: (between(900, 4200)).toFixed(2), roomId: r.id });
    }
    if (i % 7 === 0) await createExpense(prisma, admin, H, { expenseDate: at(d, 10), departmentId: dept.HK, category: "HOUSEKEEPING", subCategory: "CHEMICALS", description: "Weekly cleaning chemicals", amount: (between(3800, 5200)).toFixed(2) });
  }

  // allocation rules (USALI style: utilities and engineering to operated departments; A&G and S&M stay undistributed)
  const opDepts = ["ROOMS", "HK", "LAUN", "REST", "CAFE", "BAR", "BRKF", "BANQ", "KITCH", "PAST"];
  await createRule(prisma, admin, H, { name: "Electricity by sub-meter", sourceCategoryGroup: "ENERGY", sourceSubCategory: "ELECTRICITY", sourceDepartmentId: null, driver: "METER", targets: ["ROOMS", "KITCH", "LAUN", "REST"].map((c) => ({ departmentId: dept[c]! })) });
  await createRule(prisma, admin, H, { name: "Water by sub-meter", sourceCategoryGroup: "ENERGY", sourceSubCategory: "WATER", sourceDepartmentId: null, driver: "METER", targets: ["ROOMS", "LAUN", "KITCH"].map((c) => ({ departmentId: dept[c]! })) });
  await createRule(prisma, admin, H, { name: "Natural gas by sub-meter", sourceCategoryGroup: "ENERGY", sourceSubCategory: "GAS", sourceDepartmentId: null, driver: "METER", targets: ["KITCH", "LAUN"].map((c) => ({ departmentId: dept[c]! })) });
  await createRule(prisma, admin, H, { name: "Engineering department by m²", sourceCategoryGroup: "ALL", sourceDepartmentId: dept.ENG, driver: "SQM", targets: opDepts.map((c) => ({ departmentId: dept[c]! })) });
  await postAllocation(prisma, admin, H, (await periodFor(prisma, H, firstMonthEnd)).id);
  console.log(`Rooms: ${allRooms.length}; reservations: ${resRows.length}; expenses: ${await prisma.expense.count({ where: { hotelId: H } })}`);
  // ── Planning (Phase 4): approved budget built from the first month's run rate, targets, saving actions ──
  const fmFrom = new Date(Date.UTC(firstMonthEnd.getUTCFullYear(), firstMonthEnd.getUTCMonth(), 1));
  const fmTo = new Date(Date.UTC(firstMonthEnd.getUTCFullYear(), firstMonthEnd.getUTCMonth() + 1, 1));
  const byDeptCat = await prisma.costTransaction.groupBy({ by: ["departmentId", "categoryGroup"], where: { hotelId: H, txDate: { gte: fmFrom, lt: fmTo } }, _sum: { amount: true } });
  const revByDept = await departmentRevenue(prisma, H, fmFrom, fmTo);
  const season = [0.78, 0.8, 0.86, 0.94, 1.02, 1.12, 1.2, 1.22, 1.0, 0.92, 0.82, 0.86]; // resort seasonality (budget assumption)
  const budgetLines: Array<{ month: number; departmentId: string | null; categoryGroup: string; amount: string; targetPct?: string | null }> = [];
  const fixedish = new Set(["LABOR", "RENT", "INSURANCE", "DEPRECIATION", "ADMINISTRATION", "SALES_MARKETING"]);
  // the hotel's cost history starts this month: budget the rest of the year (no fake YTD gap for earlier months)
  for (let mth = firstMonthEnd.getUTCMonth() + 1; mth <= 12; mth++) {
    const f = season[mth - 1]! / season[firstMonthEnd.getUTCMonth()]!;
    for (const x of byDeptCat) {
      const amt = Number(x._sum.amount?.toString() ?? 0);
      if (amt <= 0 || x.categoryGroup === "ALL") continue;
      const scale = fixedish.has(x.categoryGroup) ? 1 : f;
      budgetLines.push({ month: mth, departmentId: x.departmentId, categoryGroup: x.categoryGroup, amount: (amt * scale * 0.97).toFixed(2), targetPct: x.categoryGroup === "FOOD" ? "0.28" : x.categoryGroup === "BEVERAGE" ? "0.12" : null });
    }
    for (const [d, v] of revByDept.byDept) if (v.gt(0)) budgetLines.push({ month: mth, departmentId: d, categoryGroup: "REVENUE", amount: (Number(v.toString()) * f * 1.03).toFixed(2) });
  }
  // merge duplicates (same month/department/category from DIRECT + ALLOCATED rows)
  const merged = new Map<string, (typeof budgetLines)[number]>();
  for (const l of budgetLines) {
    const k = `${l.month}|${l.departmentId ?? ""}|${l.categoryGroup}`;
    const cur = merged.get(k);
    merged.set(k, cur ? { ...cur, amount: (Number(cur.amount) + Number(l.amount)).toFixed(2) } : l);
  }
  const budgetYear = firstMonthEnd.getUTCFullYear();
  const bud = await createBudget(prisma, actors.accounting!, H, { year: budgetYear, name: `Budget ${budgetYear}`, notes: "Seasonality-weighted, 3 % efficiency target on cost, +3 % revenue" });
  await setBudgetLines(prisma, actors.accounting!, H, bud.id, [...merged.values()].filter((l) => Number(l.amount) > 0));
  await approveBudget(prisma, actors.accounting!, H, bud.id);
  for (const [metric, target, warnAt] of [["FOOD_COST_PCT", "0.32", "0.30"], ["BEVERAGE_COST_PCT", "0.14", "0.12"], ["WASTE_PCT", "0.02", "0.015"], ["UNEXPLAINED_VARIANCE_PCT", "0.03", "0.02"], ["LABOR_COST_PCT", "0.30", "0.28"], ["ENERGY_PER_OCCUPIED_ROOM", "300", "280"], ["ROOM_COST_PER_NIGHT", "1750", "1650"], ["COST_PER_OCCUPIED_ROOM", "3000", "2850"], ["BUFFET_COST_PER_COVER", "120", "110"], ["MINIBAR_SHRINKAGE_PCT", "0.03", "0.02"]] as const) await createTarget(prisma, admin, H, { metric, target, warnAt });
  const sa1 = await createAction(prisma, admin, H, { driver: "WASTE", problem: "Buffet leftovers discarded at breakfast", rootCause: "Production not linked to forecast covers", action: "Produce in waves from the buffet forecast; refill smaller trays", ownerName: "Elif Şahin", targetSaving: "12000", dueDate: new Date(firstMonthEnd.getTime() + 20 * 86_400_000), departmentId: dept.BRKF });
  await updateAction(prisma, admin, H, sa1.id, { status: "IN_PROGRESS" });
  const sa2 = await createAction(prisma, admin, H, { driver: "SUPPLIER_PRICE", problem: "Chicken breast +20 % at current supplier", rootCause: "Single-source contract", action: "Tender with two alternative suppliers", ownerName: "Burak Çelik", targetSaving: "18000", dueDate: new Date(firstMonthEnd.getTime() - 5 * 86_400_000) });
  await updateAction(prisma, admin, H, sa2.id, { status: "DONE", actualSaving: "14500" });
  await createAction(prisma, admin, H, { driver: "ENERGY", problem: "Laundry gas consumption above plan", action: "Heat-recovery check on washer extractors", ownerName: "Engineering chief", targetSaving: "6000", dueDate: new Date(firstMonthEnd.getTime() - 2 * 86_400_000), departmentId: dept.LAUN });
  console.log(`Budget lines: ${merged.size}; targets: 10; saving actions: 3`);
  // control calendar (Phase 5): standard tasks with a realistic completion history
  const { ensureDefaultTasks, calendarView, completeTask } = await import("../src/server/services/calendar");
  await ensureDefaultTasks(prisma, H);
  const cal = await calendarView(prisma, admin, H, days[0]!, new Date(days.at(-1)!.getTime() + 86_400_000));
  for (const [i, it] of cal.items.entries()) if (it.status === "OVERDUE" && i % 4 !== 0) await completeTask(prisma, admin, H, { taskId: it.taskId, dueDate: it.dueDate, note: it.evidence ? `Checked — ${it.evidence}` : "Checked" });


  // ── A pending delete request (demonstrates §285 in the UI) ──
  const anyReceipt = await prisma.stockTransaction.findFirst({ where: { hotelId: H, type: "PURCHASE", productId: pid["HK-SHAMPOO"] } });
  const target = anyReceipt ?? (await prisma.stockTransaction.findFirstOrThrow({ where: { hotelId: H, type: "OPENING", productId: pid["HK-SHAMPOO"] } }));
  await requestStockDelete(prisma, actors.warehouse!, H, { stockTxId: target.id, reason: "Duplicate entry — same delivery note posted twice" });

  const stats = await Promise.all([prisma.stockTransaction.count({ where: { hotelId: H } }), prisma.saleLine.count({ where: { hotelId: H } }), prisma.recipe.count({ where: { hotelId: H } }), prisma.wasteRecord.count({ where: { hotelId: H } })]);
  console.log(`Done. ${stats[0]} stock transactions, ${stats[1]} sale lines, ${stats[2]} recipes, ${stats[3]} waste records.`);
  console.log(`Sign in with any of: ${userDefs.map((u) => `${u[0]}@grandanatolia.test`).join(", ")} — password ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
