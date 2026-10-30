/**
 * Where the figures of a package-gated module can still be downloaded when the package no longer includes it (after
 * the trial, after a downgrade): the CSV sections of /api/export/[section], which stay open in every plan. Used by the
 * package gate (src/components/feature-gate.tsx) so a closed module says honestly that nothing was lost. Modules
 * without an entry have no CSV section of their own. No server imports here.
 */
import type { Feature } from "./features";

export interface FeatureExport {
  /** /api/export/<section> */
  section: string;
  /** [table key, English title] of the CSV tables, in the section's order */
  tables: Array<[string, string]>;
}

export const FEATURE_EXPORTS: Partial<Record<Feature, FeatureExport>> = {
  buffet: { section: "buffet", tables: [["buffetCost", "Buffet Cost"], ["buffetSummary", "Buffet Summary"], ["buffetProduct", "Buffet Product Cost"]] },
  minibar: { section: "minibar", tables: [["minibarCost", "Minibar Cost"]] },
  rooms: { section: "rooms", tables: [["roomCost", "Room Cost"], ["roomTypeCost", "Room Type Cost"], ["roomFloorCost", "Room Cost by Floor / Area"]] },
  opex: {
    section: "rooms",
    tables: [["housekeepingCost", "Housekeeping Cost"], ["laundryCost", "Laundry Cost"], ["linenCost", "Linen Movement"], ["laborCost", "Labor Cost"], ["energyCost", "Energy Cost"], ["meterReadings", "Meter Consumption"], ["engineeringCost", "Engineering Cost"], ["assetCost", "Cost per Asset"]],
  },
  menuEngineering: { section: "pnl", tables: [["menuEngineering", "Menu Engineering"]] },
  savings: { section: "pnl", tables: [["costSaving", "Cost Saving"]] },
  allocation: { section: "departments", tables: [["departmentCost", "Department Cost"], ["costCenter", "Cost Center"]] },
};

export const featureExport = (f: Feature): FeatureExport | null => FEATURE_EXPORTS[f] ?? null;
