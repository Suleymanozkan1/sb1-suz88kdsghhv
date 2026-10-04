import { Fragment } from "react";
import { notFound } from "next/navigation";
import { pageContext, guarded } from "@/server/page";
import { recipeCost } from "@/server/services/recipes";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import type { CostedLine } from "@/domain/recipe-cost";
import { Alert, Badge, Card, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { money, pct, qty, date } from "@/lib/format";
import { ApproveButton, PriceImpact } from "./actions";

function Lines({ lines, depth = 0, cur }: { lines: CostedLine[]; depth?: number; cur: string }) {
  return (
    <>
      {lines.map((l, i) => (
        <Fragment key={`${depth}-${i}`}>
          <tr className={depth ? "bg-ink-50/60 text-ink-600" : ""}>
            <Td style={{ paddingLeft: 12 + depth * 20 }}>{depth > 0 && "↳ "}{l.name} {l.kind === "SUB_RECIPE" && <Badge tone="violet">sub-recipe</Badge>}{l.children && <span className="ml-1 text-xs text-ink-400">(breakdown below is per {l.children.usableOutput.toString()} {l.children.outputUnit} batch)</span>} {l.issues.map((x) => <Badge key={x} tone="red">{x}</Badge>)}</Td>
            <Td align="right">{qty(l.quantity.toString(), l.unit)}</Td>
            <Td align="right">{pct(l.yieldPct.toString(), 0)}</Td>
            <Td align="right">{pct(l.wastePct.toString(), 1)}</Td>
            <Td align="right">{qty(l.apQty.toString(), l.baseUnit)}</Td>
            <Td align="right">{l.unitCost ? money(l.unitCost.toString(), cur, 4) : "—"}</Td>
            <Td align="right">{money(l.ingredientCost.toString(), cur)}</Td>
            <Td align="right">{money(l.yieldAdjustment.toString(), cur)}</Td>
            <Td align="right">{money(l.wasteCost.toString(), cur)}</Td>
            <Td align="right" className="font-medium">{money(l.lineCost.toString(), cur)}</Td>
          </tr>
          {l.children && <Lines lines={l.children.lines} depth={depth + 1} cur={cur} />}
        </Fragment>
      ))}
    </>
  );
}

export default async function RecipeDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => recipeCost(prisma, actor, hotelId, id));
  if (!res.ok) return res.error.includes("not found") ? notFound() : <Alert>{res.error}</Alert>;
  const { result: c, version } = res.data;
  const { marginTargetPct } = await prisma.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { marginTargetPct: true } });
  const recipe = await prisma.recipe.findUniqueOrThrow({ where: { id }, include: { department: true, versions: { orderBy: { version: "desc" } } } });
  const cur = hotel.baseCurrency;
  const products = c.lines.filter((l) => l.kind === "PRODUCT").map((l) => ({ id: l.refId, name: l.name, unitCost: l.unitCost?.toString() ?? null, unit: l.baseUnit }));
  return (
    <>
      <PageHeader title={recipe.name} subtitle={<span>{recipe.code} · {recipe.type} · {recipe.department?.name ?? "—"} · showing v{version.version} ({version.status}) at current costs</span>} />
      {!c.complete && <div className="mb-4"><Alert tone="amber">Incomplete cost: {c.issues.map((i) => `${i.issue} (${i.path})`).join(", ")}</Alert></div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Food cost / batch" value={money(c.foodCost.toString(), cur)} />
        <Stat label="Full cost / batch" value={money(c.fullBatchCost.toString(), cur)} />
        <Stat label="Cost / portion" value={money(c.portionCost?.toString(), cur)} hint={`${c.portions.toString()} portions`} />
        <Stat label="Selling price" value={money(c.sellingPrice?.toString(), cur)} />
        <Stat label="Food cost %" value={pct(c.foodCostPct?.toString())} />
        <Stat label="Margin %" value={pct(c.grossMarginPct?.toString())} tone={c.grossMarginPct && c.grossMarginPct.lt(marginTargetPct.toString()) ? "warn" : "good"} hint={`Contribution ${money(c.grossContribution?.toString(), cur)} · target ${marginTargetPct.toString()}%`} />
      </div>
      <Card title="Cost explosion" className="mt-4" padded={false}>
        <Table>
          <thead><tr><Th>Ingredient</Th><Th align="right">Qty (EP)</Th><Th align="right">Yield</Th><Th align="right">Waste</Th><Th align="right">AP qty</Th><Th align="right">Unit cost</Th><Th align="right">Ingredient</Th><Th align="right">Yield adj.</Th><Th align="right">Waste</Th><Th align="right">Line cost</Th></tr></thead>
          <tbody className="divide-y divide-ink-100"><Lines lines={c.lines} cur={cur} /></tbody>
          <tfoot className="border-t-2 border-ink-200 font-medium">
            <tr><Td colSpan={6}>Food cost</Td><Td align="right">{money(c.ingredientCost.toString(), cur)}</Td><Td align="right">{money(c.yieldAdjustment.toString(), cur)}</Td><Td align="right">{money(c.wasteCost.toString(), cur)}</Td><Td align="right">{money(c.foodCost.toString(), cur)}</Td></tr>
            <tr><Td colSpan={9}>+ Packaging {money(c.packagingCost.toString(), cur)} · Labor {money(c.laborCost.toString(), cur)} · Energy {money(c.energyCost.toString(), cur)} · Other {money(c.otherCost.toString(), cur)}</Td><Td align="right">{money(c.fullBatchCost.toString(), cur)}</Td></tr>
          </tfoot>
        </Table>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Versions" padded={false}>
          <Table>
            <thead><tr><Th>Version</Th><Th>Status</Th><Th>Effective</Th><Th align="right">Frozen portion cost</Th><Th>Reason</Th><Th /></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {recipe.versions.map((v) => (
                <tr key={v.id}>
                  <Td>v{v.version}</Td>
                  <Td><Badge tone={v.status === "APPROVED" ? "green" : v.status === "DRAFT" ? "amber" : "gray"}>{v.status}</Badge></Td>
                  <Td>{date(v.effectiveFrom)}{v.effectiveTo ? ` → ${date(v.effectiveTo)}` : ""}</Td>
                  <Td align="right">{money(v.portionCost?.toString(), cur)}</Td>
                  <Td><span className="text-xs text-ink-500">{v.reason ?? "—"}</span></Td>
                  <Td>{v.status === "DRAFT" && can(actor, "recipe:approve") && <ApproveButton versionId={v.id} />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title="Price impact what-if"><PriceImpact products={products} currency={cur} /></Card>
      </div>
    </>
  );
}
