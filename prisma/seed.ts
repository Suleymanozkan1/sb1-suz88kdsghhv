/**
 * Demo / seed data (spec §308–§309). Everything is posted THROUGH THE SERVICES so the
 * ledger, cost postings, price history, approvals and audit trail are real.
 * Covers the previous month and the current month up to yesterday.
 *
 * Refuses to run twice (never duplicates data in an existing database).
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ROLE_TEMPLATES } from "../src/server/auth/permissions";
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

async function main() {
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
