/**
 * Package contents shared by server and client (menu locks, upgrade screens, API gates). No server imports here.
 * The subscription logic that decides which plan a tenant has lives in src/server/plans.ts.
 */
import type { Plan } from "@/domain/plan";

/** feature → lowest plan that includes it */
export const FEATURES = {
  /** list of products at their reorder point */
  reorderAlerts: "BASIC",
  /** breakfast / buffet sessions: the biggest F&B cost line of a Turkish B&B / all-inclusive hotel, so in every plan (audit v2) */
  buffet: "BASIC",
  minibar: "STANDARD",
  /** room cost, room expenses */
  rooms: "STANDARD",
  /** operating costs: labor, energy, laundry, engineering … */
  opex: "STANDARD",
  /** on-house & hospitality (free consumption) */
  comps: "BASIC",
  menuEngineering: "STANDARD",
  /** macro-enabled full-cost workbook (.xlsm) and its refresh token */
  excel: "STANDARD",
  /** Micros / Opera automation (import API, nightly runs, run log) */
  integrations: "STANDARD",
  /** cost allocation rules and runs */
  allocation: "PREMIUM",
  /** budgets and targets */
  budget: "PREMIUM",
  /** forecast, scenarios, what-if */
  forecast: "PREMIUM",
  /** saving opportunities and actions */
  savings: "PREMIUM",
  /** orders e-mailed to suppliers automatically when stock reaches the reorder point */
  autoOrderEmail: "PREMIUM",
} as const satisfies Record<string, Plan>;
export type Feature = keyof typeof FEATURES;

/** Human label of each feature (English source; translated by the UI). */
export const FEATURE_LABEL: Record<Feature, string> = {
  reorderAlerts: "Reorder alerts",
  buffet: "Breakfast / buffet",
  minibar: "Minibar",
  rooms: "Room cost",
  opex: "Operating costs",
  comps: "On-house & Hospitality",
  menuEngineering: "Menu engineering",
  excel: "Excel workbook",
  integrations: "Micros / Opera automation",
  allocation: "Cost allocation",
  budget: "Budget & targets",
  forecast: "Forecast & what-if",
  savings: "Cost savings",
  autoOrderEmail: "E-mailed orders",
};


/**
 * API path → feature. One table, applied by the API wrapper to every route under the prefix, so a new route in a
 * gated module cannot forget its check. Longest prefix wins.
 */
export const FEATURE_ROUTES: Array<[string, Feature]> = [
  ["/api/buffet", "buffet"],
  ["/api/minibar", "minibar"],
  ["/api/rooms", "rooms"],
  ["/api/opex", "opex"],
  ["/api/comps", "comps"],
  ["/api/menu-engineering", "menuEngineering"],
  // CSV exports (/api/export/[section]) stay in every plan; the macro workbook and its background jobs do not
  ["/api/export/full-cost", "excel"],
  ["/api/export/workbook", "excel"],
  ["/api/export/jobs", "excel"],
  ["/api/auth/api-token", "excel"],
  ["/api/integrations", "integrations"],
  ["/api/allocation", "allocation"],
  ["/api/budgets", "budget"],
  ["/api/targets", "budget"],
  ["/api/forecast", "forecast"],
  ["/api/what-if", "forecast"],
  ["/api/savings", "savings"],
  // page exports (PDF / Excel / CSV) of the gated modules all go through one route: gate them by report key
  ["/api/table-export/buffet", "buffet"],
  ["/api/table-export/buffet-session", "buffet"],
  ["/api/table-export/buffet-count", "buffet"],
  ["/api/table-export/minibar", "minibar"],
  ["/api/table-export/rooms", "rooms"],
  ["/api/table-export/room-expenses", "rooms"],
  ["/api/table-export/comps", "comps"],
  ["/api/table-export/menu-engineering", "menuEngineering"],
  ["/api/table-export/savings", "savings"],
  ["/api/table-export/allocation", "allocation"],
  ["/api/table-export/budget", "budget"],
  ["/api/table-export/forecast", "forecast"],
];

/**
 * The path as the router resolves it. Next matches a percent-encoded segment to its decoded route
 * ("/api/table-export/%62udget" runs the [key] = "budget" handler), so the gate must compare the decoded path:
 * the raw one let an encoded key through (audit v2, S1). Undecodable input and repeated slashes never match a
 * gated prefix by accident: they are normalised or rejected.
 */
export function canonicalPath(raw: string): string | null {
  let p: string;
  try {
    p = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return p.replace(/\/+/g, "/").toLowerCase();
}

export function featureForPath(path: string): Feature | null {
  const p = canonicalPath(path) ?? path;
  let best: [string, Feature] | null = null;
  for (const r of FEATURE_ROUTES) if ((p === r[0] || p.startsWith(r[0] + "/")) && (!best || r[0].length > best[0].length)) best = r;
  return best?.[1] ?? null;
}

/** Import kinds that write a gated module's data (the import screen itself is in every plan). */
export const IMPORT_FEATURE: Partial<Record<string, Feature>> = { expenses: "opex", occupancy: "rooms", reservations: "rooms" };

/** /api/export/{group} sub-exports of gated modules, and single tables inside an otherwise open group. */
export const EXPORT_GROUP_FEATURE: Partial<Record<string, Feature>> = { buffet: "buffet", minibar: "minibar", rooms: "rooms" };
export const EXPORT_TABLE_FEATURE: Partial<Record<string, Feature>> = { costSaving: "savings", menuEngineering: "menuEngineering" };

/** Page path → feature, for the menu and the page guard. */
export const FEATURE_PAGES: Array<[string, Feature]> = [
  ["/buffet", "buffet"],
  ["/minibar", "minibar"],
  ["/rooms", "rooms"],
  ["/operations", "opex"],
  ["/comps", "comps"],
  ["/menu-engineering", "menuEngineering"],
  ["/excel", "excel"],
  ["/allocation", "allocation"],
  ["/budget", "budget"],
  ["/forecast", "forecast"],
  ["/savings", "savings"],
];

export function featureForPage(path: string): Feature | null {
  for (const [p, f] of FEATURE_PAGES) if (path === p || path.startsWith(p + "/")) return f;
  return null;
}
