/**
 * Report definition of every list/report page (key = PageHeader exportKey). Add one line per page.
 * tests/unit/page-exports.test.ts checks that every page under src/app/(app) has a registered key.
 */
import type { ReportDef } from "./types";
import { inventory } from "./reports/inventory";
import { recipe, recipes } from "./reports/recipes";
import { products } from "./reports/products";
import { ledger } from "./reports/ledger";
import { orders, purchasing } from "./reports/purchasing";
import { counts, countSummaryReport } from "./reports/counts";
import { waste } from "./reports/waste";
import { buffet, buffetSession } from "./reports/buffet";
import { minibar } from "./reports/minibar";
import { imports } from "./reports/imports";
import { periods } from "./reports/periods";
import { approvals } from "./reports/approvals";
import { calendar } from "./reports/calendar";
import { reports } from "./reports/reports";
import { audit } from "./reports/audit";
import { integrity } from "./reports/integrity";
import { sales } from "./reports/sales";
import { admin } from "./reports/admin";
import { dashboard } from "./reports/dashboard";
import { variance } from "./reports/variance";
import { menuEngineering } from "./reports/menu-engineering";
import { savings } from "./reports/savings";
import { review } from "./reports/review";
import { dataQuality } from "./reports/data-quality";

export const REPORTS: Record<string, ReportDef> = {
  inventory,
  recipes,
  recipe,
  products,
  ledger,
  purchasing,
  orders,
  imports,
  counts,
  "count-summary": countSummaryReport,
  waste,
  buffet,
  "buffet-session": buffetSession,
  minibar,
  periods,
  approvals,
  calendar,
  reports,
  audit,
  integrity,
  sales,
  admin,
  dashboard,
  variance,
  "menu-engineering": menuEngineering,
  savings,
  review,
  "data-quality": dataQuality,
};
