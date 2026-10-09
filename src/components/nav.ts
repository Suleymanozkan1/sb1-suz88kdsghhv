/**
 * Main navigation: one list for the sidebar (shell.tsx) and for server pages that need the first page a
 * role can open (home redirect, "back" link on /forbidden). No "use client": importable on both sides.
 */
import {
  BarChart3, Boxes, FileSpreadsheet, UtensilsCrossed, Wine, ChefHat, ClipboardCheck, ClipboardList, FileSearch, Gauge, Package, Receipt, ShieldCheck, ShoppingCart, Trash2, Upload, CalendarClock, Truck, BedDouble, Wrench, Split, FileUp, Target, TrendingUp, LayoutGrid, PiggyBank, FileText, CalendarCheck, ListChecks, ShieldAlert, Users,
} from "lucide-react";

export const NAV = [
  { href: "/", label: "Dashboard", icon: Gauge, perm: "dashboard:view" },
  { href: "/variance", label: "Theoretical vs Actual", icon: BarChart3, perm: "variance:view" },
  { href: "/inventory", label: "Inventory", icon: Boxes, perm: "inventory:view" },
  { href: "/inventory/ledger", label: "Stock Ledger", icon: ClipboardList, perm: "inventory:view" },
  { href: "/inventory/counts", label: "Stock Counts", icon: ClipboardCheck, perm: "inventory:count" },
  { href: "/purchasing", label: "Purchasing", icon: ShoppingCart, perm: "purchase:view" },
  { href: "/purchasing/orders", label: "Order Suggestions", icon: Truck, perm: "purchase:view" },
  { href: "/products", label: "Products", icon: Package, perm: "product:view" },
  { href: "/recipes", label: "Recipes", icon: ChefHat, perm: "recipe:view" },
  { href: "/waste", label: "Waste", icon: Trash2, perm: "waste:view" },
  { href: "/buffet", label: "Buffet", icon: UtensilsCrossed, perm: "buffet:view" },
  { href: "/minibar", label: "Minibar", icon: Wine, perm: "minibar:view" },
  { href: "/rooms", label: "Room Cost", icon: BedDouble, perm: "rooms:view" },
  { href: "/operations", label: "Operating Costs", icon: Wrench, perm: "opex:view" },
  { href: "/allocation", label: "Cost Allocation", icon: Split, perm: "opex:view" },
  { href: "/imports", label: "Imports", icon: FileUp, perm: "report:view" },
  { href: "/budget", label: "Budget & Targets", icon: Target, perm: "budget:view" },
  { href: "/forecast", label: "Forecast & What-if", icon: TrendingUp, perm: "budget:view" },
  { href: "/menu-engineering", label: "Menu Engineering", icon: LayoutGrid, perm: "recipe:view" },
  { href: "/savings", label: "Cost Savings", icon: PiggyBank, perm: "budget:view" },
  { href: "/sales", label: "Sales Import", icon: Upload, perm: "sales:import" },
  { href: "/approvals", label: "Approvals", icon: Receipt, perm: "dashboard:view" },
  { href: "/periods", label: "Cost Periods", icon: CalendarClock, perm: "period:manage" },
  { href: "/review", label: "Weekly Review", icon: ListChecks, perm: "report:view" },
  { href: "/calendar", label: "Control Calendar", icon: CalendarCheck, perm: "report:view" },
  { href: "/reports", label: "Reports & Pack", icon: FileText, perm: "report:view" },
  { href: "/data-quality", label: "Data Quality", icon: ShieldCheck, perm: "dashboard:view" },
  { href: "/excel", label: "Excel Export", icon: FileSpreadsheet, perm: "report:export" },
  { href: "/audit", label: "Audit Trail", icon: FileSearch, perm: "audit:view" },
  { href: "/integrity", label: "Calculation Integrity", icon: ShieldAlert, perm: "audit:view" },
  { href: "/admin", label: "Administration", icon: Users, perm: "admin:users" },
];

/** The role's start page: the dashboard, else the first menu entry it may open (null: none at all). */
export function homeHref(permissions: Iterable<string>): string | null {
  const has = new Set(permissions);
  return NAV.find((n) => has.has(n.perm))?.href ?? null;
}
