/**
 * Getting started: the shortest path from an empty hotel to the first theoretical-vs-actual variance.
 *
 * The audit (10/2026) found the cold start steep and unguided: the first meaningful number needs products, supplier
 * prices, opening stock, approved recipes and sales, and nothing told a new user that order. Every step here is
 * read from the hotel's real data (never a "done" flag a user ticks), so the list cannot claim a step that is not
 * actually in place, and it disappears by itself once everything is.
 */
import type { Db } from "../db";
import { type Actor, authorize } from "../auth/actor";

export interface OnboardingStep {
  key: string;
  title: string;
  hint: string;
  href: string;
  /** permission needed to DO the step (not just to view the page); the link is shown only to users who have it */
  perm: string;
  done: boolean;
}

export async function gettingStarted(db: Db, actor: Actor, hotelId: string): Promise<{ steps: OnboardingStep[]; done: number; total: number }> {
  authorize(actor, "dashboard:view", { hotelId });
  const [products, prices, opening, approved, sales, counts, users] = await Promise.all([
    db.product.count({ where: { hotelId } }),
    db.supplierPrice.count({ where: { hotelId } }),
    db.stockTransaction.count({ where: { hotelId, type: { in: ["OPENING", "PURCHASE"] } } }),
    db.recipeVersion.count({ where: { recipe: { hotelId }, status: "APPROVED" } }),
    db.saleLine.count({ where: { hotelId } }),
    db.stockCount.count({ where: { hotelId, status: { in: ["APPROVED", "POSTED"] } } }),
    db.user.count({ where: { organizationId: actor.organizationId, active: true } }),
  ]);
  const steps: OnboardingStep[] = [
    { key: "products", title: "Add your products", hint: "Import the product list (or pull it from Micros) with purchase, stock and recipe units.", href: "/imports", perm: "product:manage", done: products > 0 },
    { key: "prices", title: "Load supplier prices", hint: "One price per product and supplier: the cost of every recipe starts here.", href: "/imports", perm: "purchase:prices", done: prices > 0 },
    { key: "stock", title: "Enter opening stock or a first receipt", hint: "Stock on hand at go-live, or the first goods receipt.", href: "/purchasing", perm: "inventory:receive", done: opening > 0 },
    { key: "recipes", title: "Build and approve a recipe", hint: "Approving freezes its cost; every sale uses the approved version of its day.", href: "/recipes", perm: "recipe:manage", done: approved > 0 },
    { key: "sales", title: "Import sales", hint: "POS sales turn recipes into theoretical consumption.", href: "/sales", perm: "sales:import", done: sales > 0 },
    { key: "count", title: "Approve a stock count", hint: "Counted stock gives the actual consumption the variance compares against.", href: "/inventory/counts", perm: "inventory:count", done: counts > 0 },
    { key: "team", title: "Invite your team", hint: "Chefs, storekeepers and managers each see only their own work.", href: "/admin", perm: "admin:users", done: users > 1 },
  ];
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length };
}
