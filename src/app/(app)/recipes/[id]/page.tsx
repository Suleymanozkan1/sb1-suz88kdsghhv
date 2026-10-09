import { Fragment } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { pageContext, guarded } from "@/server/page";
import { recipeCost } from "@/server/services/recipes";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import type { CostedLine } from "@/domain/recipe-cost";
import { Alert, Badge, Button, Card, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { money, pct, qty } from "@/lib/format";
import { isDomainError } from "@/domain/errors";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/core";
import { ApproveButton, DeleteRecipeButton, PriceImpact } from "./actions";
import { Title } from "@/components/title";

function Lines({ lines, depth = 0, cur, t }: { lines: CostedLine[]; depth?: number; cur: string; t: T }) {
  return (
    <>
      {lines.map((l, i) => (
        <Fragment key={`${depth}-${i}`}>
          <tr className={depth ? "bg-ink-50/60 text-ink-600" : ""}>
            <Td style={{ paddingLeft: 12 + depth * 20 }}>{depth > 0 && "↳ "}<Title>{l.name}</Title> {l.kind === "SUB_RECIPE" && <Badge tone="violet">{t("sub-recipe")}</Badge>}{l.children && <span className="ml-1 text-xs text-ink-400">{t("(breakdown below is per {qty} {unit} batch)", { qty: l.children.usableOutput.toString(), unit: l.children.outputUnit })}</span>} {l.issues.map((x) => <Badge key={x} tone="red">{t(x)}</Badge>)}</Td>
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
  // not-found is decided on the error code: guarded() returns the translated message ("Reçete bulunamadı" in Turkish)
  const res = await guarded(() => recipeCost(prisma, actor, hotelId, id).catch((e: unknown) => (isDomainError(e) && e.code === "NOT_FOUND" ? notFound() : Promise.reject(e))));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const { result: c, version } = res.data;
  const { marginTargetPct } = await prisma.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { marginTargetPct: true } });
  const recipe = await prisma.recipe.findFirstOrThrow({ where: { id, hotelId, deletedAt: null }, include: { department: true, versions: { orderBy: { version: "desc" } } } });
  const manage = can(actor, "recipe:manage");
  const cur = hotel.baseCurrency;
  // approval / effective moments are timestamps: shown as the hotel's local day (format.date() would give the UTC day)
  const day = (v: Date | null) => (v ? new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: hotel.timezone }).format(v) : "—");
  const products = c.lines.filter((l) => l.kind === "PRODUCT").map((l) => ({ id: l.refId, name: l.name, unitCost: l.unitCost?.toString() ?? null, unit: l.baseUnit }));
  return (
    <>
      <PageHeader
        exportKey="recipe"
        exportParams={{ id }}
        title={recipe.name}
        subtitle={<span>{recipe.code} · {t(recipe.type)} · {recipe.department?.name ?? "—"} · {t("showing v{version} ({status}) at current costs", { version: version.version, status: t(version.status) })}<span className="block">{t("Created on")}: {day(recipe.createdAt)} · {t("Updated on")}: {day(recipe.updatedAt)}</span></span>}
        actions={manage ? <><Link href={`/recipes/${id}/edit`}><Button variant="secondary"><Pencil className="h-4 w-4" /> {t("Edit")}</Button></Link><DeleteRecipeButton recipeId={id} name={recipe.name} /></> : null}
      />
      {!c.complete && <div className="mb-4"><Alert tone="amber">{t("Incomplete cost:")} {c.issues.map((i) => `${t(i.issue)} (${i.path})`).join(", ")}</Alert></div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("Food cost")} value={money(c.foodCost.toString(), cur)} />
        {/* a batch recipe (sauce, dough) is costed per kg / l / pc it makes, a dish per portion */}
        {version.yieldUnit && version.yieldUnit !== "portion" ? (
          <Stat label={t("Cost / {unit}", { unit: t(version.yieldUnit) })} value={money(c.portionCost?.toString(), cur)} hint={t("{n} {unit} made", { n: c.portions.toString(), unit: t(version.yieldUnit) })} />
        ) : (
          <Stat label={t("Cost / portion")} value={money(c.portionCost?.toString(), cur)} hint={t("{n} portions", { n: c.portions.toString() })} />
        )}
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
                  <Td>{day(v.effectiveFrom)}{v.effectiveTo ? ` → ${day(v.effectiveTo)}` : ""}</Td>
                  <Td align="right">{money(v.portionCost?.toString(), cur)}</Td>
                  <Td><span className="text-xs text-ink-500">{v.reason ? t(v.reason) : "—"}</span></Td>
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
