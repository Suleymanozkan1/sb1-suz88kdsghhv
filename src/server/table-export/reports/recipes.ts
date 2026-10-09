import { prisma } from "../../db";
import { listRecipes, recipeCost } from "../../services/recipes";
import type { CostedLine } from "@/domain/recipe-cost";
import type { ReportDef, XValue } from "../types";
import { localDay } from "@/lib/format";

/** /recipes — the recipe list with the search, type and created / updated date filters. */
export const recipes: ReportDef = {
  async load({ actor, hotelId, hotel, t, q }) {
    const search = q.get("q") || undefined;
    const type = q.get("type") || undefined;
    const from = q.get("from") || undefined;
    const to = q.get("to") || undefined;
    const rows = await listRecipes(prisma, actor, hotelId, { q: search, type, from, to });
    const fmt = (d: string | undefined) => (d ? d.split("-").reverse().join(".") : "…");
    return {
      title: t("Recipes"),
      fileName: "receteler",
      filters: [[t("Search"), search ?? "—"], [t("Recipe type"), type ? t(type) : t("All types")], [t("Created or updated"), from || to ? `${fmt(from)} – ${fmt(to)}` : "—"]],
      tables: [{
        columns: [
          { key: "name", header: t("Recipe") }, { key: "code", header: t("Code") }, { key: "pos", header: t("POS code") }, { key: "type", header: t("Type") }, { key: "dept", header: t("Department") },
          { key: "version", header: t("Version") }, { key: "portionCost", header: t("Portion cost"), type: "money" }, { key: "price", header: t("Price"), type: "money" },
          { key: "fc", header: t("Food cost %"), type: "pct" }, { key: "margin", header: t("Margin %"), type: "pct" }, { key: "status", header: t("Status") },
          { key: "created", header: t("Created"), type: "date" }, { key: "updated", header: t("Updated"), type: "date" },
        ],
        rows: rows.map((r) => ({
          name: r.name, code: r.code, pos: r.posCode, type: t(r.type), dept: r.department, version: r.currentVersion ? `v${r.currentVersion}` : null,
          portionCost: r.portionCost, price: r.sellingPrice, fc: r.foodCostPct, margin: r.grossMarginPct,
          status: r.error ? t("error") : !r.currentVersion ? t("no approved version") : r.complete ? t("complete") : t("missing cost"),
          // moments shown as the hotel's local day, as on the page
          created: localDay(hotel.timezone, r.createdAt), updated: localDay(hotel.timezone, r.updatedAt),
        })),
      }],
    };
  },
};

/** /recipes/[id] — one recipe: cost lines (sub-recipes indented) and versions. */
export const recipe: ReportDef = {
  async load({ actor, hotelId, hotel, t, q }) {
    const id = q.get("id") ?? "";
    const { result: c, version } = await recipeCost(prisma, actor, hotelId, id);
    const r = await prisma.recipe.findFirstOrThrow({ where: { id, hotelId, deletedAt: null }, include: { department: true, versions: { orderBy: { version: "desc" } } } });
    const lines: Array<Record<string, XValue>> = [];
    const walk = (ls: CostedLine[], depth: number) => {
      for (const l of ls) {
        lines.push({ name: `${"   ".repeat(depth)}${depth ? "↳ " : ""}${l.name}${l.kind === "SUB_RECIPE" ? ` (${t("sub-recipe")})` : ""}`, qty: l.quantity.toString(), unit: l.unit, unitCost: l.unitCost?.toString() ?? null, baseUnit: l.baseUnit, cost: l.lineCost.toString() });
        if (l.children) walk(l.children.lines, depth + 1);
      }
    };
    walk(c.lines, 0);
    return {
      title: r.name,
      subtitle: `${r.code} · ${t(r.type)} · ${r.department?.name ?? "—"} · v${version.version} (${t(version.status)}) · ${t("Created")} ${localDay(hotel.timezone, r.createdAt).split("-").reverse().join(".")} · ${t("Updated")} ${localDay(hotel.timezone, r.updatedAt).split("-").reverse().join(".")}`,
      fileName: `recete-${r.code}`,
      tables: [
        {
          title: t("Cost"),
          columns: [{ key: "k", header: t("Metric") }, { key: "v", header: t("Value"), type: "money" }, { key: "p", header: "%", type: "pct" }],
          rows: [
            { k: t("Food cost"), v: c.foodCost.toString() },
            // same label as the page: a batch recipe (sauce, dough) is costed per kg / l / pc it makes, a dish per portion
            { k: version.yieldUnit && version.yieldUnit !== "portion" ? t("Cost / {unit}", { unit: t(version.yieldUnit) }) : t("Cost / portion"), v: c.portionCost?.toString() ?? null },
            { k: t("Selling price"), v: c.sellingPrice?.toString() ?? null },
            { k: t("Food cost %"), p: c.foodCostPct?.toString() ?? null },
            { k: t("Margin %"), p: c.grossMarginPct?.toString() ?? null },
          ],
        },
        {
          title: t("Cost explosion"),
          columns: [{ key: "name", header: t("Ingredient") }, { key: "qty", header: t("Quantity used"), type: "qty" }, { key: "unit", header: t("Unit") }, { key: "unitCost", header: t("Unit cost"), type: "unitcost" }, { key: "baseUnit", header: t("Stock unit") }, { key: "cost", header: t("Line cost"), type: "money" }],
          rows: lines,
          totals: { name: t("Food cost"), cost: c.foodCost.toString() },
        },
        {
          title: t("Versions"),
          columns: [{ key: "v", header: t("Version") }, { key: "s", header: t("Status") }, { key: "from", header: t("Effective"), type: "date" }, { key: "to", header: t("Until"), type: "date" }, { key: "pc", header: t("Frozen portion cost"), type: "money" }, { key: "reason", header: t("Reason") }],
          rows: r.versions.map((v) => ({ v: `v${v.version}`, s: t(v.status), from: v.effectiveFrom, to: v.effectiveTo, pc: v.portionCost?.toString() ?? null, reason: v.reason })),
        },
      ],
    };
  },
};
