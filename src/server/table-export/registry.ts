/**
 * Report definition of every list/report page (key = PageHeader exportKey). Add one line per page.
 * tests/unit/page-exports.test.ts checks that every page under src/app/(app) has a registered key.
 */
import type { ReportDef } from "./types";
import { inventory } from "./reports/inventory";

export const REPORTS: Record<string, ReportDef> = {
  inventory,
};
