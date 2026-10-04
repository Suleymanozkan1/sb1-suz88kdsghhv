/**
 * Builds the HotelCost Full Cost Report workbook (.xlsm) from the export contract.
 *
 * Layers (spec 116): RAW_* (hidden, protected) -> CALC (reconciliation formulas, _LISTS) ->
 * REPORT sheets. Every dataset is an Excel Table named tbl_<sectionKey>; the VBA project
 * refreshes the same tables from the API, so the prefilled file and a refreshed file share
 * one layout and one schema.
 */
import ExcelJS from "exceljs";
import type { Column, FullCostExport, Section } from "../services/export";
import { EXPORT_VERSION, APP_VERSION } from "../services/export";

export const WORKBOOK_VERSION = "1.0.0";
export const CONTROL_SHEET = "01_CONTROL";
const HEADER_ROW = 6;

const BRAND = "FF158459";
const INK = "FF1E2230";
const MUTED = "FF667391";
const LIGHT = "FFF6F7F9";

interface SheetSpec {
  name: string;
  title: string;
  /** section keys placed side by side */
  sections: string[];
  headerRow?: number;
  hidden?: boolean;
  description: string;
  print?: boolean;
}

/** Workbook structure (spec 146). */
export const SHEETS: SheetSpec[] = [
  { name: "02_EXECUTIVE_SUMMARY", title: "Executive Summary", sections: ["executiveSummary", "monthlySummary"], headerRow: 18, description: "Headline KPIs, monthly cost summary by category, data status of every figure", print: true },
  { name: "03_COST_DETAIL", title: "Cost Detail", sections: ["costDetail"], description: "Every cost ledger posting and purchase line with trace id" },
  { name: "04_FOOD_COST", title: "Food Cost", sections: ["foodCost"], description: "Opening + purchases ± transfers − closing = actual food cost vs theoretical", print: true },
  { name: "05_BEVERAGE_COST", title: "Beverage Cost", sections: ["beverageCost"], description: "Same statement for beverage", print: true },
  { name: "06_RECIPE_COST", title: "Recipe Cost", sections: ["recipeCost"], description: "Recipe cost explosion incl. sub-recipes, yield and waste" },
  { name: "07_THEORETICAL_CONSUMPTION", title: "Theoretical Consumption", sections: ["theoreticalConsumption"], description: "Sales × frozen recipe-version requirements" },
  { name: "08_ACTUAL_CONSUMPTION", title: "Actual Consumption", sections: ["actualConsumption"], description: "Usage movements from the stock ledger" },
  { name: "09_CONSUMPTION_VARIANCE", title: "Theoretical vs Actual", sections: ["consumptionVariance"], description: "Usage gap per ingredient incl. waste and unexplained usage", print: true },
  { name: "10_WASTE", title: "Waste", sections: ["waste"], description: "Waste records valued at cost" },
  { name: "11_WASTE_SUMMARY", title: "Waste Summary", sections: ["wasteSummary", "wasteByCategory", "wasteByDepartment"], description: "Waste KPIs, by category and by department", print: true },
  { name: "12_YIELD", title: "Yield", sections: ["yield"], description: "AP/EP yield tests and standard yields" },
  { name: "13_PORTION_VARIANCE", title: "Portion Variance", sections: ["portionVariance"], description: "Standard vs actual portion (capture planned)" },
  { name: "14_BUFFET_COST", title: "Buffet Cost", sections: ["buffetCost"], description: "Buffet sessions: covers, production, refills, leftovers, waste, cost and waste per cover" },
  { name: "15_BUFFET_SUMMARY", title: "Buffet Summary", sections: ["buffetSummary"], description: "Buffet cost per cover by meal" },
  { name: "16_BUFFET_PRODUCT", title: "Buffet Product Cost", sections: ["buffetProduct"], description: "Buffet item flow: produced, refilled, consumed, waste, reusable" },
  { name: "17_MINIBAR_COST", title: "Minibar Cost", sections: ["minibarCost"], description: "Minibar by room: restock, consumption, shrinkage, cost, revenue, contribution" },
  { name: "18_ROOM_COST", title: "Room Cost", sections: ["roomCost"], description: "Full room cost (Phase 3)" },
  { name: "19_ROOM_TYPE_COST", title: "Room Type Cost", sections: ["roomTypeCost"], description: "Room cost by type (Phase 3)" },
  { name: "20_HOUSEKEEPING_COST", title: "Housekeeping Cost", sections: ["housekeepingCost"], description: "Housekeeping (Phase 3)" },
  { name: "21_LAUNDRY_COST", title: "Laundry Cost", sections: ["laundryCost"], description: "Laundry (Phase 3)" },
  { name: "22_LABOR_COST", title: "Labor Cost", sections: ["laborCost"], description: "Labor (Phase 3)" },
  { name: "23_ENERGY_COST", title: "Energy Cost", sections: ["energyCost"], description: "Energy (Phase 3)" },
  { name: "24_ENGINEERING_COST", title: "Engineering Cost", sections: ["engineeringCost"], description: "Engineering (Phase 3)" },
  { name: "25_PURCHASE_COST", title: "Purchase Cost", sections: ["purchaseCost"], description: "Receipts with previous vs current price" },
  { name: "26_SUPPLIER_PRICE", title: "Supplier Price", sections: ["supplierPrice"], description: "Supplier price history statistics" },
  { name: "27_PURCHASE_PRICE_VARIANCE", title: "Purchase Price Variance", sections: ["ppv"], description: "PPV per product" },
  { name: "28_INVENTORY_VALUE", title: "Inventory Value", sections: ["inventoryValue"], description: "Current stock value by warehouse" },
  { name: "29_MONTHLY_STOCK", title: "Monthly Stock", sections: ["monthlyStock"], description: "Stock roll-forward per product" },
  { name: "30_STOCK_VARIANCE", title: "Stock Variance", sections: ["stockVariance"], description: "System vs physical counts" },
  { name: "31_CRITICAL_STOCK", title: "Critical Stock", sections: ["criticalStock"], description: "Low / critical / out-of-stock items with order suggestion" },
  { name: "32_STOCK_AGING", title: "Stock Aging", sections: ["stockAging"], description: "Active / slow / dead / overstock" },
  { name: "33_REORDER_RECOMMENDATION", title: "Reorder Recommendation", sections: ["reorder"], description: "Recommended orders with explanation" },
  { name: "34_DEPARTMENT_COST", title: "Department Cost", sections: ["departmentCost"], description: "Revenue, direct / allocated cost, contribution", print: true },
  { name: "35_OUTLET_COST", title: "Outlet Cost", sections: ["outletCost"], description: "Outlets only" },
  { name: "36_COST_CENTER", title: "Cost Center", sections: ["costCenter"], description: "Cost centers" },
  { name: "37_COST_ALLOCATION", title: "Cost Allocation", sections: ["costAllocation"], description: "Allocation detail (Phase 3)" },
  { name: "38_PNL", title: "P&L Cost View", sections: ["pnl"], description: "Revenue to net profit (partial until labor/energy/overhead modules)", print: true },
  { name: "39_BUDGET_VARIANCE", title: "Budget Variance", sections: ["budgetVariance"], description: "Budget vs actual (Phase 4)" },
  { name: "40_FORECAST", title: "Forecast", sections: ["forecast"], description: "Forecast (Phase 4)" },
  { name: "41_COST_SAVING", title: "Cost Saving", sections: ["costSaving"], description: "Saving actions (Phase 4)" },
  { name: "42_TOP_COST_DRIVERS", title: "Top Cost Drivers", sections: ["topCostDrivers"], description: "Largest price-driven cost increases" },
  { name: "43_TOP_WASTE", title: "Top Waste", sections: ["topWaste"], description: "Products causing most waste cost" },
  { name: "44_TOP_VARIANCE", title: "Top Variance", sections: ["topVariance"], description: "Largest theoretical vs actual differences" },
  { name: "45_UNEXPLAINED_VARIANCE", title: "Unexplained Variance", sections: ["unexplainedVariance"], description: "Usage not explained by recipes, waste, staff meals or complimentary", print: true },
  { name: "46_RECONCILIATION", title: "Reconciliation", sections: [], description: "Server checks, workbook formula checks and VBA checks (PASS / WARNING / FAIL)", print: true },
  { name: "47_MISSING_COST_DATA", title: "Missing Cost Data", sections: ["missingData"], description: "Products without cost, recipes with issues, unmapped sales ..." },
  { name: "48_EXPORT_ERRORS", title: "Export Errors", sections: [], description: "Errors and warnings recorded by the macro" },
  { name: "49_FORMULAS", title: "Formula Dictionary", sections: [], description: "Cost formulas (TR / EN)" },
  { name: "50_SOURCE_MAP", title: "Source Map", sections: [], description: "Where every dataset comes from" },
  { name: "51_README", title: "README", sections: [], description: "How to use and refresh this workbook" },
  { name: "52_TRENDS", title: "Trends", sections: ["costTrend", "priceTrend", "recipeTrend"], description: "12-month cost, price and recipe cost trends" },
  { name: "53_DASHBOARD_CHARTS", title: "Dashboard Charts", sections: [], description: "Charts rebuilt by the macro" },
  { name: "54_PRODUCT_SALES", title: "Monthly Product Sales + Cost", sections: ["productSales"], description: "Every product sold: qty, revenue, recipe cost, contribution, margin", print: true },
  { name: "55_PIVOTS", title: "Pivot Tables", sections: [], description: "Pivots rebuilt by the macro" },
  { name: "56_RECIPE_SUMMARY", title: "Recipe Summary", sections: ["recipeSummary"], description: "One line per recipe" },
  { name: "RAW_PRODUCTS", title: "RAW_PRODUCTS", sections: ["rawProducts"], hidden: true, description: "Product master (raw)" },
  { name: "RAW_STOCK_TRANSACTIONS", title: "RAW_STOCK_TRANSACTIONS", sections: ["rawStockTransactions"], hidden: true, description: "Stock ledger (raw)" },
  { name: "RAW_SALES", title: "RAW_SALES", sections: ["rawSales"], hidden: true, description: "Sales lines (raw)" },
  { name: "RUN_LOG", title: "Run Log", sections: [], hidden: true, description: "Macro run history" },
  { name: "_LISTS", title: "Lists", sections: [], hidden: true, description: "Filter lists" },
];

const CURRENCY: Record<string, string> = { TRY: "₺", EUR: "€", USD: "$", GBP: "£" };

function numFmt(type: Column["type"], cur: string): string | undefined {
  switch (type) {
    case "money":
      return `#,##0.00 "${CURRENCY[cur] ?? cur}"`;
    case "unitcost":
      return `#,##0.0000 "${CURRENCY[cur] ?? cur}"`;
    case "qty":
      return "#,##0.00";
    case "int":
      return "0";
    case "pct":
      return "0.00%";
    case "date":
      return "yyyy-mm-dd";
    case "datetime":
      return "yyyy-mm-dd hh:mm";
    default:
      return undefined;
  }
}

function cellValue(v: string | null | undefined, type: Column["type"]): ExcelJS.CellValue {
  if (v === null || v === undefined || v === "") return null;
  switch (type) {
    case "money":
    case "unitcost":
    case "qty":
    case "int":
    case "pct": {
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    }
    case "date":
      return new Date(`${v.slice(0, 10)}T00:00:00Z`);
    case "datetime":
      return new Date(v);
    default:
      return v;
  }
}

const colLetter = (n: number) => {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

export interface DefinedName {
  name: string;
  ref: string;
}

export interface BuiltWorkbook {
  buffer: Buffer;
  definedNames: DefinedName[];
  sheetOrder: string[];
  tableLocations: Record<string, { sheet: string; ref: string }>;
}

function title(ws: ExcelJS.Worksheet, text: string, sub: string) {
  ws.getCell("A1").value = text;
  ws.getCell("A1").font = { bold: true, size: 16, color: { argb: INK } };
  ws.getCell("A2").value = sub;
  ws.getCell("A2").font = { size: 10, color: { argb: MUTED } };
  ws.getCell("A3").value = { formula: `HYPERLINK("#'${CONTROL_SHEET}'!A1","← Dashboard'a Dön / Back to CONTROL")`, result: "← Dashboard'a Dön / Back to CONTROL" };
  ws.getCell("A3").font = { color: { argb: BRAND }, underline: true, size: 10 };
}

function writeTable(ws: ExcelJS.Worksheet, sec: Section, startCol: number, headerRow: number, currency: string, locations: BuiltWorkbook["tableLocations"]) {
  const status = ws.getCell(headerRow - 2, startCol);
  status.value = `Data status: ${sec.status}${sec.note ? ` - ${sec.note}` : ""}  |  rows: ${sec.rows.length}`;
  status.font = { size: 9, italic: true, color: { argb: sec.status === "NOT_AVAILABLE" ? "FFB45309" : MUTED } };
  const sub = ws.getCell(headerRow - 1, startCol);
  sub.value = sec.title;
  sub.font = { bold: true, size: 11, color: { argb: INK } };
  const rows = sec.rows.length
    ? sec.rows.map((r) => sec.columns.map((c) => cellValue(r[c.key], c.type)))
    : [sec.columns.map(() => null)];
  ws.addTable({
    name: `tbl_${sec.key}`,
    ref: `${colLetter(startCol)}${headerRow}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium4", showRowStripes: true },
    columns: sec.columns.map((c) => ({ name: c.header, filterButton: true })),
    rows,
  });
  sec.columns.forEach((c, i) => {
    const col = ws.getColumn(startCol + i);
    const fmt = numFmt(c.type, currency);
    if (fmt) col.numFmt = fmt;
    const longest = Math.max(c.header.length, ...sec.rows.slice(0, 200).map((r) => (r[c.key] ?? "").length));
    col.width = Math.min(Math.max(longest + 2, c.type === "text" ? 12 : 14), 60);
  });
  // per-row formats for statement tables carrying a "kind" column (value may be money or pct)
  const kindIdx = sec.columns.findIndex((c) => c.key === "kind");
  const valIdx = sec.columns.findIndex((c) => c.key === "value");
  if (kindIdx >= 0 && valIdx >= 0) {
    sec.rows.forEach((r, i) => {
      const f = r.kind === "pct" ? "0.00%" : r.kind === "int" ? "0" : numFmt("money", currency)!;
      ws.getCell(headerRow + 1 + i, startCol + valIdx).numFmt = f;
    });
  }
  const end = colLetter(startCol + sec.columns.length - 1);
  locations[sec.key] = { sheet: ws.name, ref: `${colLetter(startCol)}${headerRow}:${end}${headerRow + rows.length}` };
  // status colouring for status-like columns
  sec.columns.forEach((c, i) => {
    if (!/status|impact/i.test(c.key)) return;
    const L = colLetter(startCol + i);
    const ref = `${L}${headerRow + 1}:${L}${headerRow + 100000}`;
    ws.addConditionalFormatting({
      ref,
      rules: [
        { type: "containsText", operator: "containsText", text: "FAIL", priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEE2E2" } } } },
        { type: "containsText", operator: "containsText", text: "CRITICAL", priority: 2, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEE2E2" } } } },
        { type: "containsText", operator: "containsText", text: "OUT_OF_STOCK", priority: 3, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEE2E2" } } } },
        { type: "containsText", operator: "containsText", text: "Dead Stock", priority: 4, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEE2E2" } } } },
        { type: "containsText", operator: "containsText", text: "UNFAVOURABLE", priority: 5, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEE2E2" } } } },
        { type: "containsText", operator: "containsText", text: "WARNING", priority: 6, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEF3C7" } } } },
        { type: "containsText", operator: "containsText", text: "LOW", priority: 7, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEF3C7" } } } },
        { type: "containsText", operator: "containsText", text: "Slow", priority: 8, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEF3C7" } } } },
        { type: "containsText", operator: "containsText", text: "NOT_AVAILABLE", priority: 9, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEF3C7" } } } },
        { type: "containsText", operator: "containsText", text: "PASS", priority: 10, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFD6F5E3" } } } },
      ],
    });
  });
  // variance colouring
  for (const [i, c] of sec.columns.entries()) {
    if (!/^(unexplained|varianceCost|variance|priceVariance)$/.test(c.key) || c.type !== "money") continue;
    const L = colLetter(startCol + i);
    ws.addConditionalFormatting({
      ref: `${L}${headerRow + 1}:${L}${headerRow + 100000}`,
      rules: [
        { type: "cellIs", operator: "greaterThan", formulae: ["0.005"], priority: 20, style: { font: { color: { argb: "FFB91C1C" } } } },
        { type: "cellIs", operator: "lessThan", formulae: ["-0.005"], priority: 21, style: { font: { color: { argb: "FF15803D" } } } },
      ],
    });
  }
  return startCol + sec.columns.length + 1;
}

const FORMULAS: Array<[string, string, string]> = [
  ["Actual Cost / Gerçek Maliyet", "= Opening Inventory + Purchases + Transfers In − Transfers Out − Closing Inventory", "Açılış stoku + Alımlar + Gelen transfer − Giden transfer − Kapanış stoku"],
  ["Food Cost % / Yiyecek Maliyet %", "= Actual Food Cost / Food Revenue", "Gerçek yiyecek maliyeti / Yiyecek geliri"],
  ["Theoretical Cost / Teorik Maliyet", "= Σ (Quantity Sold × Recipe Cost of the version effective on the sale date)", "Σ (Satılan adet × satış tarihindeki reçete versiyonu maliyeti)"],
  ["Cost Variance / Maliyet Farkı", "= Actual Cost − Theoretical Cost", "Gerçek − Teorik"],
  ["Unexplained Variance / Açıklanamayan Fark", "= Variance − Price/timing − Recorded Waste − Staff Meals − Complimentary", "Fark − Fiyat/zamanlama − Kayıtlı zayi − Personel yemeği − İkram"],
  ["Usage Gap / Kullanım Farkı", "= Actual Usage − Theoretical Usage − Recorded Waste", "Gerçek kullanım − Teorik kullanım − Kayıtlı zayi"],
  ["Weighted Average Cost / Ağırlıklı Ortalama", "= (Old Qty × Old Avg + Received Qty × Landed Unit Cost) / (Old Qty + Received Qty)", "(Eski miktar × eski ort. + Gelen miktar × birim maliyet) / toplam miktar"],
  ["Landed Cost / Varış Maliyeti", "= Net Price − Discount + Freight + Shipping + Customs + Handling + Other (tax excluded)", "Net fiyat − iskonto + navlun + nakliye + gümrük + elleçleme + diğer (KDV hariç)"],
  ["Yield % / Verim %", "= EP Quantity / AP Quantity", "Kullanılabilir miktar / Alınan miktar"],
  ["Required AP / Gerekli Brüt Miktar", "= EP Quantity / Yield %", "Net miktar / Verim"],
  ["Recipe Line Cost / Reçete Satır Maliyeti", "= AP Qty × Unit Cost × (1 + Standard Waste %)", "Brüt miktar × birim maliyet × (1 + standart fire %)"],
  ["Cost per Portion / Porsiyon Maliyeti", "= Batch Cost / Usable Portions", "Parti maliyeti / Kullanılabilir porsiyon"],
  ["Gross Margin % / Brüt Marj %", "= (Selling Price − Portion Cost) / Selling Price", "(Satış fiyatı − porsiyon maliyeti) / satış fiyatı"],
  ["Waste % / Zayi %", "= Waste Cost / Actual Cost (other bases: purchase qty, consumption, production, revenue)", "Zayi maliyeti / Gerçek maliyet"],
  ["Purchase Price Variance / Alış Fiyat Farkı", "= (Actual Purchase Price − Previous Price) × Quantity", "(Gerçek alış fiyatı − önceki fiyat) × miktar"],
  ["Stock Turnover / Stok Devir Hızı", "= Consumption Cost / Average Inventory Value", "Tüketim maliyeti / Ortalama stok değeri"],
  ["Days of Stock / Stok Gün Sayısı", "= Closing Stock Value / Average Daily Consumption Cost", "Kapanış stok değeri / Ortalama günlük tüketim"],
  ["Recommended Order / Önerilen Sipariş", "= Expected Consumption + Safety Stock + Lead-time Demand − Current Stock − Open PO (rounded up to purchase units)", "Beklenen tüketim + Emniyet stoku + Tedarik süresi talebi − Mevcut stok − Açık sipariş"],
];

export async function buildWorkbook(e: FullCostExport, opts: { apiBaseUrl: string; lists: { departments: { id: string; name: string; outlet: boolean }[]; warehouses: { id: string; name: string }[] } }): Promise<BuiltWorkbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HotelCost";
  wb.lastModifiedBy = e.meta.generatedBy;
  wb.created = new Date(e.meta.generatedAt);
  wb.calcProperties.fullCalcOnLoad = true;
  const cur = e.meta.hotel.currency;
  const names: DefinedName[] = [];
  const locations: BuiltWorkbook["tableLocations"] = {};

  // ── 01_CONTROL ──
  const ctl = wb.addWorksheet(CONTROL_SHEET, { properties: { tabColor: { argb: BRAND } }, views: [{ showGridLines: false }] });
  ctl.getColumn(1).width = 3;
  ctl.getColumn(2).width = 26;
  ctl.getColumn(3).width = 44;
  ctl.getColumn(4).width = 3;
  for (const c of [5, 6, 7, 8, 9, 10]) ctl.getColumn(c).width = 16;
  ctl.getCell("B1").value = "HOTELCOST";
  ctl.getCell("B1").font = { bold: true, size: 22, color: { argb: BRAND } };
  ctl.getCell("B2").value = "FULL COST REPORT";
  ctl.getCell("B2").font = { bold: true, size: 14, color: { argb: INK } };
  ctl.getCell("C2").value = `${e.meta.hotel.name} · ${e.meta.period.label}`;
  ctl.getCell("C2").font = { size: 12, color: { argb: MUTED } };
  const deptList = ["All", ...opts.lists.departments.map((d) => d.name)];
  const outletList = ["All", ...opts.lists.departments.filter((d) => d.outlet).map((d) => d.name)];
  const whList = ["All", ...opts.lists.warehouses.map((w) => w.name)];
  const params: Array<[string, string, ExcelJS.CellValue, { input?: boolean; list?: string; date?: boolean; fmt?: string }]> = [
    ["Hotel", "ctl_Hotel", e.meta.hotel.name, {}],
    ["Hotel ID", "ctl_HotelId", e.meta.hotel.id, { input: true }],
    ["Period", "ctl_PeriodLabel", e.meta.period.label, {}],
    ["Start Date", "ctl_StartDate", new Date(`${e.meta.period.from}T00:00:00Z`), { input: true, date: true, fmt: "yyyy-mm-dd" }],
    ["End Date", "ctl_EndDate", new Date(`${e.meta.period.to}T00:00:00Z`), { input: true, date: true, fmt: "yyyy-mm-dd" }],
    ["Currency", "ctl_Currency", cur, {}],
    ["Department", "ctl_Department", e.meta.filters.department ?? "All", { input: true, list: "lst_DepartmentNames" }],
    ["Outlet", "ctl_Outlet", "All", { input: true, list: "lst_OutletNames" }],
    ["Warehouse", "ctl_Warehouse", e.meta.filters.warehouse ?? "All", { input: true, list: "lst_WarehouseNames" }],
    ["Category", "ctl_Category", e.meta.filters.categoryGroup ?? "All", { input: true, list: "lst_CategoryNames" }],
    ["Refresh Mode", "ctl_RefreshMode", "Refresh Current Period", { input: true, list: '"Refresh Current Period,Full Rebuild"' }],
    ["API Base URL", "ctl_ApiUrl", opts.apiBaseUrl, { input: true }],
  ];
  let r = 4;
  ctl.getCell(`B${r - 1}`).value = "PARAMETERS (yellow cells are editable)";
  ctl.getCell(`B${r - 1}`).font = { bold: true, size: 10, color: { argb: MUTED } };
  for (const [label, name, value, o] of params) {
    ctl.getCell(`B${r}`).value = label;
    ctl.getCell(`B${r}`).font = { bold: true, color: { argb: INK } };
    const c = ctl.getCell(`C${r}`);
    c.value = value;
    if (o.fmt) c.numFmt = o.fmt;
    if (o.input) {
      c.protection = { locked: false };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF9C3" } };
      c.border = { bottom: { style: "thin", color: { argb: "FFEAB308" } } };
    }
    if (o.list) c.dataValidation = { type: "list", allowBlank: false, formulae: [o.list.startsWith('"') ? o.list : `=${o.list}`], showErrorMessage: true, errorTitle: "HotelCost", error: "Choose a value from the list." };
    if (o.date) c.dataValidation = { type: "date", operator: "greaterThan", allowBlank: false, formulae: [new Date("2000-01-01T00:00:00Z")], showErrorMessage: true, error: "Enter a valid date (yyyy-mm-dd)." };
    names.push({ name, ref: `'${CONTROL_SHEET}'!$C$${r}` });
    r++;
  }
  r++;
  ctl.getCell(`B${r}`).value = "REPORT METADATA";
  ctl.getCell(`B${r}`).font = { bold: true, size: 10, color: { argb: MUTED } };
  r++;
  const metaRows: Array<[string, string, ExcelJS.CellValue]> = [
    ["Generated At", "ctl_GeneratedAt", e.meta.generatedAt],
    ["Generated By", "ctl_GeneratedBy", e.meta.generatedBy],
    ["Data Through", "ctl_DataThrough", e.meta.dataThrough ?? "—"],
    ["Export ID", "ctl_ExportId", e.exportId],
    ["Export Schema Version", "ctl_ExportVersion", e.exportVersion],
    ["Application Version", "ctl_AppVersion", e.appVersion],
    ["Workbook Version", "ctl_WorkbookVersion", WORKBOOK_VERSION],
    ["Content Hash (SHA-256)", "ctl_ContentHash", e.meta.contentHash],
    ["Scope", "ctl_Scope", e.meta.scope.departments === "ALL" ? "All departments" : e.meta.scope.departments.join(", ")],
    ["Last Run Status", "ctl_RunStatus", "Prefilled by HotelCost server (macros not run yet)"],
  ];
  for (const [label, name, value] of metaRows) {
    ctl.getCell(`B${r}`).value = label;
    ctl.getCell(`B${r}`).font = { color: { argb: MUTED } };
    ctl.getCell(`C${r}`).value = value;
    names.push({ name, ref: `'${CONTROL_SHEET}'!$C$${r}` });
    r++;
  }
  // score panel
  ctl.getCell("F11").value = "EXPORT SCORE";
  ctl.getCell("F11").font = { bold: true, size: 10, color: { argb: MUTED } };
  const scores: Array<[string, string, ExcelJS.CellValue]> = [
    ["Data Quality %", "ctl_ScoreDataQuality", e.score.dataQuality ? Number(e.score.dataQuality) : null],
    ["Reconciliation", "ctl_ScoreRecon", e.score.reconciliation],
    ["Warnings", "ctl_ScoreWarnings", e.score.warnings],
    ["Errors", "ctl_ScoreErrors", e.score.errors],
  ];
  scores.forEach(([label, name, value], i) => {
    const row = 12 + i;
    ctl.getCell(`F${row}`).value = label;
    ctl.mergeCells(`G${row}:H${row}`);
    const c = ctl.getCell(`G${row}`);
    c.value = value;
    c.font = { bold: true, size: 12 };
    c.alignment = { horizontal: "center" };
    names.push({ name, ref: `'${CONTROL_SHEET}'!$G$${row}` });
  });
  ctl.addConditionalFormatting({
    ref: "G13:H13",
    rules: [
      { type: "containsText", operator: "containsText", text: "FAIL", priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEE2E2" } } } },
      { type: "containsText", operator: "containsText", text: "WARNING", priority: 2, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEF3C7" } } } },
      { type: "containsText", operator: "containsText", text: "PASS", priority: 3, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFD6F5E3" } } } },
    ],
  });
  ctl.getCell("F21").value = "Button not working? Enable macros (File > Info > Enable Content). The prefilled data below is valid without macros.";
  ctl.getCell("F21").font = { size: 9, italic: true, color: { argb: MUTED } };
  // navigation menu
  r += 1;
  ctl.getCell(`B${r}`).value = "NAVIGATION";
  ctl.getCell(`B${r}`).font = { bold: true, size: 10, color: { argb: MUTED } };
  r++;
  const navStart = r;
  SHEETS.filter((s) => !s.hidden).forEach((s, i) => {
    const row = navStart + i;
    ctl.getCell(`B${row}`).value = { formula: `HYPERLINK("#'${s.name}'!A1","${s.name}")`, result: s.name };
    ctl.getCell(`B${row}`).font = { color: { argb: BRAND }, underline: true };
    ctl.getCell(`C${row}`).value = s.description;
    ctl.getCell(`C${row}`).font = { size: 9, color: { argb: MUTED } };
  });
  ctl.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

  // ── report / raw sheets ──
  const sectionSheet: Record<string, string> = {};
  for (const spec of SHEETS) {
    const ws = wb.addWorksheet(spec.name, { state: spec.hidden ? "hidden" : "visible", views: [{ state: "frozen", ySplit: spec.headerRow ?? HEADER_ROW, showGridLines: false }] });
    title(ws, spec.name === "02_EXECUTIVE_SUMMARY" ? "HOTELCOST — FULL COST REPORT" : spec.title, `${e.meta.hotel.name} · ${e.meta.period.label} · ${cur} · Generated ${e.meta.generatedAt.slice(0, 16).replace("T", " ")} by ${e.meta.generatedBy} · Export ${e.exportVersion}`);
    let col = 1;
    for (const key of spec.sections) {
      const sec = e.sections[key];
      if (!sec) continue;
      col = writeTable(ws, sec, col, spec.headerRow ?? HEADER_ROW, cur, locations);
      sectionSheet[key] = spec.name;
    }
    if (spec.print) ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: `${spec.headerRow ?? HEADER_ROW}:${spec.headerRow ?? HEADER_ROW}` };
    else ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  }
  const sheet = (n: string) => wb.getWorksheet(n)!;

  // ── Executive summary KPI tiles (live formulas over tbl_executiveSummary) ──
  const ex = sheet("02_EXECUTIVE_SUMMARY");
  const tiles: Array<[string, string, "money" | "pct"]> = [
    ["Total Revenue", "totalRevenue", "money"], ["Actual Cost", "actualCost", "money"], ["Theoretical Cost", "theoreticalCost", "money"], ["Cost Variance", "costVariance", "money"],
    ["Unexplained Variance", "unexplainedVariance", "money"], ["Total Waste Cost", "totalWasteCost", "money"], ["Stock Value", "totalStockValue", "money"], ["Purchases", "totalPurchaseCost", "money"],
    ["Actual Cost %", "actualCostPct", "pct"], ["Theoretical Cost %", "theoreticalCostPct", "pct"], ["Food Cost %", "foodCostPct", "pct"], ["Beverage Cost %", "beverageCostPct", "pct"],
    ["Waste %", "wastePct", "pct"], ["Stock Turnover", "stockTurnover", "money"], ["Days of Stock", "daysOfStock", "money"], ["Cost / Occupied Room", "costPerOccupiedRoom", "money"],
  ];
  tiles.forEach(([label, key, kind], i) => {
    const rowBase = 5 + Math.floor(i / 4) * 3;
    const c = 1 + (i % 4) * 3;
    const L = colLetter(c);
    ex.getCell(`${L}${rowBase}`).value = label.toUpperCase();
    ex.getCell(`${L}${rowBase}`).font = { size: 9, bold: true, color: { argb: MUTED } };
    const v = e.summary[key];
    const cell = ex.getCell(`${L}${rowBase + 1}`);
    const cached = v?.value === null || v?.value === undefined ? v?.status ?? "n/a" : Number(v.value);
    cell.value = { formula: `IFERROR(IF(INDEX(tbl_executiveSummary[Value],MATCH("${key}",tbl_executiveSummary[Metric],0))="",INDEX(tbl_executiveSummary[Data Status],MATCH("${key}",tbl_executiveSummary[Metric],0)),INDEX(tbl_executiveSummary[Value],MATCH("${key}",tbl_executiveSummary[Metric],0))),"n/a")`, result: cached as never };
    cell.numFmt = kind === "pct" ? "0.00%" : key === "stockTurnover" || key === "daysOfStock" ? "#,##0.00" : numFmt("money", cur)!;
    cell.font = { size: 16, bold: true, color: { argb: key === "unexplainedVariance" ? "FFB45309" : INK } };
    for (const rr of [rowBase, rowBase + 1]) ex.getCell(`${L}${rr}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
  });
  ex.getCell("A4").value = `Data quality ${e.score.dataQuality ?? "—"}% · Reconciliation ${e.score.reconciliation} · Status column shows ACTUAL / THEORETICAL / ESTIMATED / NOT_AVAILABLE / INSUFFICIENT_DATA for every figure (no false precision).`;
  ex.getCell("A4").font = { size: 9, italic: true, color: { argb: MUTED } };

  // ── 46_RECONCILIATION ──
  const rec = sheet("46_RECONCILIATION");
  const serverSec: Section = {
    key: "serverChecks", title: "Server-side checks (same engine as the application)", status: "OK", source: "export.checks",
    columns: [{ key: "check", header: "Check", type: "text" }, { key: "expected", header: "Expected", type: "money" }, { key: "actual", header: "Actual", type: "money" }, { key: "difference", header: "Difference", type: "money" }, { key: "status", header: "Status", type: "text" }, { key: "note", header: "Note", type: "text" }],
    rows: e.checks.map((c) => ({ check: c.check, expected: c.expected, actual: c.actual, difference: c.difference, status: c.status, note: c.note })),
  };
  let rc = writeTable(rec, serverSec, 1, HEADER_ROW, cur, locations);
  const S = (k: string) => `INDEX(tbl_executiveSummary[Value],MATCH("${k}",tbl_executiveSummary[Metric],0))`;
  const num = (k: string) => Number(e.summary[k]?.value ?? 0);
  const sumCol = (k: string, col: string, pred?: (r: Record<string, string | null>) => boolean) => (e.sections[k]?.rows ?? []).filter((x) => !pred || pred(x)).reduce((a, x) => a + Number(x[col] ?? 0), 0);
  const filtered = !!(e.meta.filters.departmentId || e.meta.filters.warehouseId) || e.meta.scope.departments !== "ALL";
  const excelChecks: Array<[string, string, number, string, number, string?]> = [
    ["Executive Actual Cost = Σ 09_CONSUMPTION_VARIANCE[Actual Cost]", S("actualCost"), num("actualCost"), "SUM(tbl_consumptionVariance[Actual Cost])", sumCol("consumptionVariance", "actualCost")],
    ["Executive Actual Cost = Σ 03_COST_DETAIL[Total Cost] (excl. purchases)", S("actualCost"), num("actualCost"), `SUMIFS(tbl_costDetail[Total Cost],tbl_costDetail[Transaction Type],"<>PURCHASE (inventory)")`, sumCol("costDetail", "totalCost", (x) => x.transactionType !== "PURCHASE (inventory)"), "FILTER"],
    ["Executive Stock Value = Σ 29_MONTHLY_STOCK[Closing Value]", S("totalStockValue"), num("totalStockValue"), "SUM(tbl_monthlyStock[Closing Value])", sumCol("monthlyStock", "closingValue")],
    ["Executive Waste = Σ 10_WASTE[Waste Cost] (posted)", S("totalWasteCost"), num("totalWasteCost"), `SUMIFS(tbl_waste[Waste Cost],tbl_waste[Status],"POSTED")`, sumCol("waste", "wasteCost", (x) => x.status === "POSTED")],
    ["Executive Unexplained = Σ 09_CONSUMPTION_VARIANCE[Unexplained Usage]", S("unexplainedVariance"), num("unexplainedVariance"), "SUM(tbl_consumptionVariance[Unexplained Usage])", sumCol("consumptionVariance", "unexplained")],
    ["Executive Theoretical = Σ RAW_SALES[Theoretical Cost]", S("theoreticalCost"), num("theoreticalCost"), "SUM(tbl_rawSales[Theoretical Cost])", sumCol("rawSales", "theoreticalCost"), "CATEGORY"],
    ["Σ 34_DEPARTMENT_COST[Total Cost] = Σ 03_COST_DETAIL (excl. purchases)", `SUMIFS(tbl_costDetail[Total Cost],tbl_costDetail[Transaction Type],"<>PURCHASE (inventory)")`, sumCol("costDetail", "totalCost", (x) => x.transactionType !== "PURCHASE (inventory)"), "SUM(tbl_departmentCost[Total Cost])", sumCol("departmentCost", "totalCost")],
    ["Σ 03_COST_DETAIL purchases = Σ 25_PURCHASE_COST[Landed Value]", `SUMIFS(tbl_costDetail[Total Cost],tbl_costDetail[Transaction Type],"PURCHASE (inventory)")`, sumCol("costDetail", "totalCost", (x) => x.transactionType === "PURCHASE (inventory)"), "SUM(tbl_purchaseCost[Landed Value])", sumCol("purchaseCost", "landedValue")],
    ["38_PNL Direct Cost = Executive Total Cost", S("totalCost"), num("totalCost"), "INDEX(tbl_pnl[Value],2)", Number(e.sections.pnl?.rows[1]?.value ?? 0)],
  ];
  const exSec: Section = {
    key: "excelChecks", title: "Workbook formula checks (live)", status: "OK", source: "Excel formulas",
    columns: [{ key: "check", header: "Check", type: "text" }, { key: "expected", header: "Expected", type: "money" }, { key: "actual", header: "Actual", type: "money" }, { key: "difference", header: "Difference", type: "money" }, { key: "status", header: "Status", type: "text" }],
    rows: excelChecks.map(([c]) => ({ check: c, expected: null, actual: null, difference: null, status: null })),
  };
  const exStart = rc;
  rc = writeTable(rec, exSec, exStart, HEADER_ROW, cur, locations);
  excelChecks.forEach(([, fExp, vExp, fAct, vAct, guard], i) => {
    const row = HEADER_ROW + 1 + i;
    const [B, C, D, E] = [colLetter(exStart + 1), colLetter(exStart + 2), colLetter(exStart + 3), colLetter(exStart + 4)];
    rec.getCell(`${B}${row}`).value = { formula: fExp, result: vExp };
    rec.getCell(`${C}${row}`).value = { formula: fAct, result: vAct };
    rec.getCell(`${D}${row}`).value = { formula: `${C}${row}-${B}${row}`, result: vAct - vExp };
    const ok = Math.abs(vAct - vExp) <= 0.01;
    const guardExpr = guard === "FILTER" ? `OR(ctl_Department<>"All",ctl_Warehouse<>"All",ctl_Scope<>"All departments")` : guard === "CATEGORY" ? `ctl_Category<>"All"` : null;
    const guardActive = guard === "FILTER" ? filtered : guard === "CATEGORY" ? !!e.meta.filters.categoryGroup : false;
    const base = `IF(ABS(${D}${row})<=0.01,"PASS","FAIL")`;
    rec.getCell(`${E}${row}`).value = { formula: guardExpr ? `IF(${guardExpr},"WARNING",${base})` : base, result: guardActive ? "WARNING" : ok ? "PASS" : "FAIL" };
  });
  const vbaSec: Section = {
    key: "vbaChecks", title: "Macro checks (row counts, duplicates) — filled on refresh", status: "OK", source: "modReconciliation",
    columns: [{ key: "check", header: "Check", type: "text" }, { key: "expected", header: "Expected", type: "int" }, { key: "actual", header: "Actual", type: "int" }, { key: "status", header: "Status", type: "text" }],
    rows: Object.values(e.sections).map((s) => ({ check: `Row count ${s.key}`, expected: String(s.rows.length), actual: String(s.rows.length), status: "PASS" })),
  };
  writeTable(rec, vbaSec, rc, HEADER_ROW, cur, locations);

  // ── 48_EXPORT_ERRORS / RUN_LOG ──
  writeTable(sheet("48_EXPORT_ERRORS"), { key: "errors", title: "Export errors and warnings", status: "OK", source: "modErrorHandling", columns: ["Time", "Run ID", "Module", "Record", "Error Type", "Description", "Severity"].map((h, i) => ({ key: `c${i}`, header: h, type: i === 0 ? "datetime" : "text" })), rows: [] }, 1, HEADER_ROW, cur, locations);
  writeTable(sheet("RUN_LOG"), { key: "runLog", title: "Run log", status: "OK", source: "modErrorHandling", columns: ["Run ID", "Date", "User", "Hotel", "Period", "Start Time", "End Time", "Status", "Records Processed", "Errors", "Warnings"].map((h, i) => ({ key: `c${i}`, header: h, type: i === 1 ? "date" : i === 5 || i === 6 ? "datetime" : i >= 8 ? "int" : "text" })), rows: [{ c0: e.exportId, c1: e.meta.generatedAt.slice(0, 10), c2: e.meta.generatedBy, c3: e.meta.hotel.name, c4: e.meta.period.label, c5: e.meta.generatedAt, c6: e.meta.generatedAt, c7: `SERVER PREFILL (${e.score.reconciliation})`, c8: String(Object.values(e.counts).reduce((a, b) => a + b, 0)), c9: String(e.score.errors), c10: String(e.score.warnings) }] }, 1, HEADER_ROW, cur, locations);

  // ── 49_FORMULAS / 50_SOURCE_MAP / 51_README ──
  writeTable(sheet("49_FORMULAS"), { key: "formulas", title: "Formula dictionary (EN / TR)", status: "OK", source: "HotelCost domain engine", columns: [{ key: "a", header: "Metric", type: "text" }, { key: "b", header: "Formula (EN)", type: "text" }, { key: "c", header: "Formül (TR)", type: "text" }], rows: FORMULAS.map(([a, b, c]) => ({ a, b, c })) }, 1, HEADER_ROW, cur, locations);
  writeTable(sheet("50_SOURCE_MAP"), {
    key: "sourceMap", title: "Source map", status: "OK", source: "export contract",
    columns: [{ key: "a", header: "Excel Sheet", type: "text" }, { key: "b", header: "Excel Table", type: "text" }, { key: "c", header: "Dataset", type: "text" }, { key: "d", header: "Source (module / table)", type: "text" }, { key: "e", header: "Source API", type: "text" }, { key: "f", header: "Data Status", type: "text" }, { key: "g", header: "Rows", type: "int" }],
    rows: Object.values(e.sections).map((s) => ({ a: sectionSheet[s.key] ?? "(not placed)", b: `tbl_${s.key}`, c: s.title, d: s.source, e: `GET /api/export/full-cost → sections.${s.key}`, f: s.status, g: String(s.rows.length) })),
  }, 1, HEADER_ROW, cur, locations);
  const readme = sheet("51_README");
  const lines = [
    "WHAT THIS WORKBOOK IS",
    "The Excel reporting layer of HotelCost. Every figure is calculated by the HotelCost server with the same cost engine as the web application; Excel does not re-implement cost logic.",
    "",
    "HOW TO REFRESH",
    "1. Enable macros (File > Info > Enable Content). 2. On 01_CONTROL set Start Date, End Date and optional Department / Outlet / Warehouse / Category.",
    "3. Click 'TÜM COST RAPORLARINI OLUŞTUR / GENERATE FULL COST REPORT'. 4. Paste your API token when asked (web app > Excel Export > Create token).",
    "The token is kept in memory only; it is never written into this file. You can also set the Windows environment variable HOTELCOST_TOKEN.",
    "Refresh Mode: 'Refresh Current Period' overwrites the report tables; 'Full Rebuild' first clears all generated tables, pivots and charts, then rebuilds them.",
    "Manual notes outside the tables, the run log and the error log are never deleted by a refresh.",
    "",
    "WHAT THE MACRO DOES (security transparency)",
    "It sends ONE authenticated HTTPS GET request to <API Base URL>/api/export/full-cost and writes the answer into the tables of this workbook.",
    "It does not read or write other files (except the optional PDF export into this workbook's folder), does not run external programs and does not contain credentials.",
    "Source code of every module is visible in the VBA editor (Alt+F11) and in the HotelCost repository (src/server/excel/vba).",
    "",
    "SHEETS",
    ...SHEETS.filter((s) => !s.hidden).map((s) => `${s.name} — ${s.description}`),
    "RAW_* sheets (hidden, protected) contain the raw datasets used by pivots. RUN_LOG and _LISTS are hidden helper sheets.",
    "",
    "COLOURS",
    "Green = PASS / good · Yellow = WARNING / not available / low stock · Red = FAIL / critical / dead stock / unfavourable variance.",
    "Red numbers in variance columns = actual above theoretical (unfavourable); green = below.",
    "",
    "DATA STATUS",
    "ACTUAL = from posted transactions · THEORETICAL = from recipes × sales · ESTIMATED = depends on assumptions (e.g. revenue split) · NOT_AVAILABLE = module not implemented yet · INSUFFICIENT_DATA = not computable.",
    "Blank cells in NOT_AVAILABLE sections are intentional: HotelCost never shows a fabricated zero.",
    "",
    "VARIANCE DEFINITIONS",
    "Variance = Actual − Theoretical. Unexplained = Variance − Price/timing − Recorded waste − Staff meals − Complimentary. Unexplained usage is evidence for investigation, not an accusation.",
    "",
    "IF SOMETHING GOES WRONG",
    "See 48_EXPORT_ERRORS and 46_RECONCILIATION. A failed or incomplete download is never written as a successful report (status 'EXPORT FAILED').",
    "HTTP 401/403: create a new token or check your export permission. Mac Excel cannot refresh (no MSXML); the prefilled data is still valid.",
    "",
    `Workbook ${WORKBOOK_VERSION} · Export schema ${EXPORT_VERSION} · Application ${APP_VERSION}`,
  ];
  lines.forEach((t, i) => {
    const c = readme.getCell(`A${5 + i}`);
    c.value = t;
    if (t === t.toUpperCase() && t.length > 3 && !t.includes("—")) c.font = { bold: true, color: { argb: BRAND } };
  });
  readme.getColumn(1).width = 160;
  sheet("53_DASHBOARD_CHARTS").getCell("A5").value = "Charts are (re)built by the macro from the report tables: cost trend, food cost %, waste %, stock value, department cost, top cost drivers, top waste, price trend, buffet cost per cover.";
  sheet("55_PIVOTS").getCell("A5").value = "Pivot tables are (re)built by the macro: department, category, supplier, product, waste, stock, recipe, buffet and minibar cost.";

  // ── _LISTS ──
  const lst = sheet("_LISTS");
  const listTable = (key: string, col: number, header: string[], rows: string[][]) => {
    writeTable(lst, { key, title: key, status: "OK", source: "lists", columns: header.map((h, i) => ({ key: `c${i}`, header: h, type: "text" })), rows: rows.map((rr) => Object.fromEntries(rr.map((v, i) => [`c${i}`, v]))) }, col, HEADER_ROW, cur, locations);
  };
  listTable("lstDepartments", 1, ["Name", "ID"], opts.lists.departments.map((d) => [d.name, d.id]));
  listTable("lstWarehouses", 4, ["Name", "ID"], opts.lists.warehouses.map((w) => [w.name, w.id]));
  const writeList = (col: string, items: string[], name: string) => {
    items.forEach((v, i) => (lst.getCell(`${col}${HEADER_ROW + 1 + i}`).value = v));
    names.push({ name, ref: `'_LISTS'!$${col}$${HEADER_ROW + 1}:$${col}$${HEADER_ROW + items.length}` });
  };
  writeList("H", deptList, "lst_DepartmentNames");
  writeList("I", outletList, "lst_OutletNames");
  writeList("J", whList, "lst_WarehouseNames");
  writeList("K", ["All", "FOOD", "BEVERAGE", "PACKAGING", "HOUSEKEEPING", "ENGINEERING"], "lst_CategoryNames");

  // ── protection (no password: prevents accidental edits; VBA re-protects after refresh) ──
  for (const ws of wb.worksheets) {
    await ws.protect("", { selectLockedCells: true, selectUnlockedCells: true, autoFilter: true, sort: true, formatColumns: true, pivotTables: true });
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, definedNames: names, sheetOrder: wb.worksheets.map((w) => w.name), tableLocations: locations };
}
