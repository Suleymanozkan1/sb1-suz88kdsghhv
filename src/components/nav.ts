/**
 * Main navigation: one list for the sidebar (shell.tsx) and for server pages that need the first page a
 * role can open (home redirect, "back" link on /forbidden). No "use client": importable on both sides.
 *
 * Grouped by job (audit 10/2026: 29 flat entries were hard to scan). The order inside the list still decides a
 * role's start page (homeHref), so the dashboard stays first. Entries of a module outside the tenant's package are
 * shown with a lock instead of hidden: the user learns the module exists and which package has it.
 */
import {
  BarChart3, Boxes, FileSpreadsheet, UtensilsCrossed, Wine, ChefHat, ClipboardCheck, ClipboardList, FileSearch, Gauge, Package, Receipt, ShieldCheck, ShoppingCart, Trash2, Upload, CalendarClock, Truck, BedDouble, Wrench, FileUp, LayoutGrid, PiggyBank, FileText, CalendarCheck, ListChecks, ShieldAlert, Users, Gift, ClipboardPen, Split, Target, TrendingUp, CreditCard,
} from "lucide-react";
import type { Feature } from "@/lib/features";
import type { Permission } from "@/server/auth/permissions";

export type NavGroup = "overview" | "stock" | "kitchen" | "hotel" | "planning" | "control" | "admin";

export const NAV_GROUPS: Array<{ key: NavGroup; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "stock", label: "Stock & purchasing" },
  { key: "kitchen", label: "Kitchen & outlets" },
  { key: "hotel", label: "Hotel costs" },
  { key: "planning", label: "Planning" },
  { key: "control", label: "Reports & control" },
  { key: "admin", label: "Company" },
];

/** Menu flag of department-scoped users whose departments include the Minibar department (its page refuses everyone else). */
export const MINIBAR_DEPARTMENT = "minibar-department";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Gauge;
  /**
   * What the page itself requires (its requirePageAccess, the same permission its services check), so a menu entry
   * never leads to a "no permission" page. A list: any one of them (Imports shows the kinds the role may import).
   */
  perm: Permission | readonly Permission[];
  /** further permissions the page requires on top of `perm` (all of them) */
  alsoNeeds?: readonly Permission[];
  /** hotel-wide figures only: the page (and its services) refuse department-scoped roles (ALL_DEPARTMENTS flag) */
  hotelWide?: true;
  /** a department-scoped role sees the entry only with this server-computed flag (its department is in the role's scope) */
  scopeFlag?: string;
  group: NavGroup;
  flag?: string;
  /** module that belongs to a package (src/server/plans.ts) */
  feature?: Feature;
  /** no built-in how-to video recorded for this page (yet) */
  noVideo?: boolean;
};

/** /imports: any import kind (src/server/services/imports.ts IMPORT_PERMISSION) or the Micros / Opera automation (sales:import) */
export const IMPORTS_PAGE_PERMISSIONS: readonly Permission[] = ["opex:manage", "pms:import", "product:manage", "purchase:prices", "inventory:adjust", "sales:import"];

export const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: Gauge, perm: "dashboard:view", group: "overview" },
  { href: "/variance", label: "Theoretical vs Actual", icon: BarChart3, perm: "variance:view", group: "overview" },
  { href: "/review", label: "Cost Review", icon: ListChecks, perm: "report:view", group: "overview" },
  { href: "/calendar", label: "Control Calendar", icon: CalendarCheck, perm: "report:view", group: "overview" },
  { href: "/inventory", label: "Inventory", icon: Boxes, perm: "inventory:view", group: "stock" },
  { href: "/inventory/ledger", label: "Stock Ledger", icon: ClipboardList, perm: "inventory:view", group: "stock" },
  { href: "/inventory/counts", label: "Stock Counts", icon: ClipboardCheck, perm: "inventory:count", group: "stock" },
  // approved count results by store (feedback r3 §10): for managers who neither count nor approve
  { href: "/inventory/counts/results", label: "Count Results", icon: ClipboardPen, perm: "inventory:view", group: "stock" },
  { href: "/purchasing", label: "Purchasing", icon: ShoppingCart, perm: "purchase:view", group: "stock" },
  { href: "/purchasing/orders", label: "Order Suggestions", icon: Truck, perm: "purchase:view", group: "stock" },
  { href: "/products", label: "Products", icon: Package, perm: "product:view", group: "stock" },
  { href: "/recipes", label: "Recipes", icon: ChefHat, perm: "recipe:view", group: "kitchen" },
  { href: "/sales", label: "Sales Import", icon: Upload, perm: "sales:import", group: "kitchen" },
  { href: "/waste", label: "Waste", icon: Trash2, perm: "waste:view", group: "kitchen" },
  { href: "/buffet", label: "Breakfast", icon: UtensilsCrossed, perm: "buffet:view", group: "kitchen", feature: "buffet" },
  { href: "/minibar", label: "Minibar", icon: Wine, perm: "minibar:view", scopeFlag: MINIBAR_DEPARTMENT, group: "kitchen", feature: "minibar" },
  // free consumption: on-house (owners, GM …) and hospitality (feedback r3 §8)
  { href: "/comps", label: "On-house & Hospitality", icon: Gift, perm: "comp:view", group: "kitchen", feature: "comps" },
  // sales mix and margin by dish: a cost analysis, not for roles without variance rights (breakfast chef)
  { href: "/menu-engineering", label: "Menu Engineering", icon: LayoutGrid, perm: "recipe:view", alsoNeeds: ["variance:view"], group: "kitchen", feature: "menuEngineering" },
  { href: "/rooms", label: "Room Cost", icon: BedDouble, perm: "rooms:view", group: "hotel", feature: "rooms" },
  { href: "/operations", label: "Operating Costs", icon: Wrench, perm: "opex:view", group: "hotel", feature: "opex" },
  { href: "/allocation", label: "Cost Allocation", icon: Split, perm: "opex:view", hotelWide: true, group: "hotel", feature: "allocation", noVideo: true },
  { href: "/budget", label: "Budget & Targets", icon: Target, perm: "budget:view", group: "planning", feature: "budget", noVideo: true },
  { href: "/forecast", label: "Forecast & What-if", icon: TrendingUp, perm: "budget:view", hotelWide: true, group: "planning", feature: "forecast", noVideo: true },
  { href: "/savings", label: "Cost Savings", icon: PiggyBank, perm: "budget:view", group: "planning", feature: "savings" },
  { href: "/reports", label: "Reports & Pack", icon: FileText, perm: "report:view", group: "control" },
  { href: "/excel", label: "Excel Export", icon: FileSpreadsheet, perm: "report:export", group: "control", feature: "excel" },
  { href: "/imports", label: "Imports", icon: FileUp, perm: IMPORTS_PAGE_PERMISSIONS, group: "control" },
  // also for approval:decide and count approvers without the dashboard: the layout computes the "approvals" flag
  { href: "/approvals", label: "Approvals", icon: Receipt, perm: "dashboard:view", flag: "approvals", group: "control" },
  { href: "/periods", label: "Cost Periods", icon: CalendarClock, perm: "period:manage", group: "control" },
  { href: "/data-quality", label: "Data Quality", icon: ShieldCheck, perm: "dashboard:view", group: "control" },
  { href: "/audit", label: "Audit Trail", icon: FileSearch, perm: "audit:view", group: "control" },
  { href: "/integrity", label: "Calculation Integrity", icon: ShieldAlert, perm: "audit:view", group: "control" },
  { href: "/admin", label: "Administration", icon: Users, perm: "admin:users", group: "admin" },
  { href: "/billing", label: "Subscription", icon: CreditCard, perm: "admin:users", group: "admin", noVideo: true },
];

/** Menu flag of users whose role covers all departments (actor.departmentIds === "ALL"): opens the hotel-wide pages. */
export const ALL_DEPARTMENTS = "all-departments";

/** The menu flags the server computes for an actor: department scope and the approvals list (count approvers). */
export function navFlags(actor: { departmentIds: "ALL" | readonly string[] }, approvals: boolean, scope: readonly string[] = []): string[] {
  return [...(actor.departmentIds === "ALL" ? [ALL_DEPARTMENTS] : []), ...(approvals ? ["approvals"] : []), ...scope];
}

const anyOf = (p: Permission | readonly Permission[]): readonly Permission[] => (typeof p === "string" ? [p] : p);

/** Does a user with these permissions pass the page's own permission check? */
export function pageAllowed(n: Pick<NavItem, "perm" | "alsoNeeds">, permissions: Iterable<string>): boolean {
  const has = new Set(permissions);
  return anyOf(n.perm).some((p) => has.has(p)) && (n.alsoNeeds ?? []).every((p) => has.has(p));
}

/** Menu entries the user may open: by permission, or by a flag the server computed (e.g. "approvals" for count approvers). */
export function navItems(permissions: Iterable<string>, flags: Iterable<string> = []) {
  const has = new Set(permissions);
  const flag = new Set(flags);
  return NAV.filter((n) => (pageAllowed(n, has) || (n.flag !== undefined && flag.has(n.flag))) && (!n.hotelWide || flag.has(ALL_DEPARTMENTS)) && (!n.scopeFlag || flag.has(ALL_DEPARTMENTS) || flag.has(n.scopeFlag)));
}

/** A link to a menu page (e.g. a getting-started step) is shown only when the page would open; other links are not checked here. */
export function canOpenHref(href: string, permissions: Iterable<string>, flags: Iterable<string> = []): boolean {
  const n = NAV.find((x) => x.href === href);
  return !n || navItems(permissions, flags).includes(n);
}

/**
 * The role's start page: the dashboard, else the first menu entry it may open (null: none at all). A module outside
 * the package is skipped, so nobody lands on a locked page.
 */
export function homeHref(permissions: Iterable<string>, flags: Iterable<string> = [], locked: Iterable<string> = []): string | null {
  const off = new Set(locked);
  return navItems(permissions, flags).find((n) => !n.feature || !off.has(n.feature))?.href ?? null;
}
