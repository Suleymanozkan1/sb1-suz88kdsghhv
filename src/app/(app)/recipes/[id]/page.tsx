import { Fragment } from "react";
import { notFound } from "next/navigation";
import { pageContext, guarded } from "@/server/page";
import { recipeCost } from "@/server/services/recipes";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import type { CostedLine } from "@/domain/recipe-cost";
import { Alert, Badge, Card, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { money, pct, qty, date } from "@/lib/format";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/core";
import { ApproveButton, PriceImpact } from "./actions";

function Lines({ lines, depth = 0, cur, t }: { lines: CostedLine[]; depth?: number; cur: string; t: T }) {
  return (
    <>
      {lines.map((l, i) => (
        <Fragment key={`${depth}-${i}`}>
          <tr className={depth ? "bg-ink-50/60 text-ink-600" : ""}>
            <Td style={{ paddingLeft: 12 + depth * 20 }}>{depth > 0 && "↳ "}{l.name} {l.kind === "SUB_RECIPE" && <Badge tone="violet">{t("sub-recipe")}</Badge>}{l.children && <span className="ml-1 text-xs text-ink-400">{t("(breakdown below is per {qty} {unit} batch)", { qty: l.children.usableOutput.toString(), unit: l.children.outputUnit })}</span>} {l.issues.map((x) => <Badge key={x} tone="red">{t(x)}</Badge>)}</Td>
            <Td align="right">{qty(l.quantity.toString(), l.unit)}</Td>
            <Td align="right">{l.unitCost ? `${money(l.unitCost.toString(), cur, 4)} / ${l.baseUnit}` : "—"}</Td>
            <Td align="right" className="font-medium">{money(l.lineCost.toString(), cur)}</Td>
          </tr>
          {l.children && <Lines lines={l.children.lines} depth={depth + 1} cur={cur} t={t} />}
        </Fragment>
      ))}
    </>
  );
}

export default async function RecipeDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => recipeCost(prisma, actor, hotelId, id));
  if (!res.ok) return res.error.includes("not found") ? notFound() : <Alert>{res.error}</Alert>;
  const { result: c, version } = res.data;
  const { marginTargetPct } = await prisma.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { marginTargetPct: true } });
  const recipe = await prisma.recipe.findFirstOrThrow({ where: { id, hotelId }, include: { department: true, versions: { orderBy: { version: "desc" } } } });
  const cur = hotel.baseCurrency;
  const products = c.lines.filter((l) => l.kind === "PRODUCT").map((l) => ({ id: l.refId, name: l.name, unitCost: l.unitCost?.toString() ?? null, unit: l.baseUnit }));
  return (
    <>
      <PageHeader exportKey="recipe" exportParams={{ id }} title={recipe.name} subtitle={<span>{recipe.code} · {t(recipe.type)} · {recipe.department?.name ?? "—"} · {t("showing v{version} ({status}) at current costs", { version: version.version, status: t(version.status) })}</span>} />
      {!c.complete && <div className="mb-4"><Alert tone="amber">{t("Incomplete cost:")} {c.issues.map((i) => `${t(i.issue)} (${i.path})`).join(", ")}</Alert></div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("Food cost")} value={money(c.foodCost.toString(), cur)} />
        <Stat label={t("Cost / portion")} value={money(c.portionCost?.toString(), cur)} hint={t("{n} portions", { n: c.portions.toString() })} />
        <Stat label={t("Selling price")} value={money(c.sellingPrice?.toString(), cur)} />
        <Stat label={t("Food cost %")} value={pct(c.foodCostPct?.toString())} />
        <Stat label={t("Margin %")} value={pct(c.grossMarginPct?.toString())} tone={c.grossMarginPct && c.grossMarginPct.lt(marginTargetPct.toString()) ? "warn" : "good"} hint={t("Contribution {amount} · target {target}%", { amount: money(c.grossContribution?.toString(), cur), target: marginTargetPct.toString() })} />
      </div>
      <Card title={t("Cost explosion")} className="mt-4" padded={false}>
        <Table>
          <thead><tr><Th>{t("Ingredient")}</Th><Th align="right">{t("Quantity used")}</Th><Th align="right">{t("Unit cost")}</Th><Th align="right">{t("Line cost")}</Th></tr></thead>
          <tbody className="divide-y divide-ink-100"><Lines lines={c.lines} cur={cur} t={t} /></tbody>
          <tfoot className="border-t-2 border-ink-200 font-medium">
            <tr><Td colSpan={3}>{t("Food cost")}</Td><Td align="right">{money(c.foodCost.toString(), cur)}</Td></tr>
          </tfoot>
        </Table>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={t("Versions")} padded={false}>
          <Table>
            <thead><tr><Th>{t("Version")}</Th><Th>{t("Status")}</Th><Th>{t("Effective")}</Th><Th align="right">{t("Frozen portion cost")}</Th><Th>{t("Reason")}</Th><Th /></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {recipe.versions.map((v) => (
                <tr key={v.id}>
                  <Td>v{v.version}</Td>
                  <Td><Badge tone={v.status === "APPROVED" ? "green" : v.status === "DRAFT" ? "amber" : "gray"}>{t(v.status)}</Badge></Td>
                  <Td>{date(v.effectiveFrom)}{v.effectiveTo ? ` → ${date(v.effectiveTo)}` : ""}</Td>
                  <Td align="right">{money(v.portionCost?.toString(), cur)}</Td>
                  <Td><span className="text-xs text-ink-500">{v.reason ?? "—"}</span></Td>
                  <Td>{v.status === "DRAFT" && can(actor, "recipe:approve") && <ApproveButton versionId={v.id} />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title={t("Price impact what-if")}><PriceImpact products={products} currency={cur} /></Card>
      </div>
    </>
  );
}
