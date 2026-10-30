import { Fragment } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { pageContext, guarded } from "@/server/page";
import { selfApprovalAllowed } from "@/server/services/segregation";
import { recipeCost } from "@/server/services/recipes";
import { can, canDepartment } from "@/server/auth/actor";
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

/** Version status in plain words (feedback r3 §3): the version in force, an older one, a draft … */
const VERSION_STATUS: Record<string, { label: string; tone: "green" | "gray" | "amber" | "red" }> = {
  APPROVED: { label: "In force", tone: "green" },
  SUPERSEDED: { label: "Old version", tone: "gray" },
  DRAFT: { label: "Draft", tone: "amber" },
  PENDING_APPROVAL: { label: "Awaiting approval", tone: "amber" },
  REJECTED: { label: "Rejected", tone: "red" },
};

/** What each costing issue means for the user, and what fixes it. */
const ISSUE_TEXT: Record<string, string> = {
  MISSING_COST: "no cost yet: enter a purchase or a price for this product",
  INACTIVE_PRODUCT: "the product is inactive: activate it again or replace it in the recipe",
  MISSING_PRODUCT: "the product no longer exists: replace it in the recipe",
  MISSING_SUB_RECIPE: "the sub-recipe has no version in force",
  INCOMPLETE_SUB_RECIPE: "the sub-recipe's cost is incomplete",
};

export default async function RecipeDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const [recipe, selfOk] = await Promise.all([prisma.recipe.findFirst({ where: { id, hotelId, deletedAt: null }, include: { department: true, versions: { orderBy: { version: "desc" } } } }), selfApprovalAllowed(prisma, hotelId)]);
  if (!recipe) notFound();
  // not-found is decided on the error code: guarded() returns the translated message ("Reçete bulunamadı" in Turkish)
  const res = await guarded(() => recipeCost(prisma, actor, hotelId, id).catch((e: unknown) => (isDomainError(e) && e.code === "NOT_FOUND" ? notFound() : Promise.reject(e))));
  // no department access: the page says so instead of showing an empty recipe
  if (!res.ok && !canDepartment(actor, recipe.departmentId)) return <Alert>{res.error}</Alert>;
  const { marginTargetPct } = await prisma.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { marginTargetPct: true } });
  const drafts = recipe.versions.filter((v) => ["DRAFT", "PENDING_APPROVAL", "REJECTED"].includes(v.status)).map((v) => v.id);
  const draftEdits = drafts.length ? await prisma.auditLog.groupBy({ by: ["entityId"], where: { hotelId, entityType: "RecipeVersion", entityId: { in: drafts }, action: "RECIPE_DRAFT_UPDATE" }, _max: { createdAt: true } }) : [];
  const manage = can(actor, "recipe:manage");
  const cur = hotel.baseCurrency;
  // creation / update moments are timestamps: shown as the hotel's local date and time
  const fmt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: hotel.timezone });
  const at = (v: Date | null | undefined) => (v ? fmt.format(v) : "—");
  /** last change of a version: approval (in force), the moment a newer version replaced it, or the last draft edit */
  const updatedAt = (v: (typeof recipe.versions)[number]) => {
    if (v.status === "SUPERSEDED") return recipe.versions.filter((x) => x.version > v.version && x.approvedAt).sort((a, b) => a.version - b.version)[0]?.approvedAt ?? v.effectiveTo ?? v.approvedAt ?? v.createdAt;
    if (v.status === "APPROVED") return v.approvedAt ?? v.createdAt;
    return draftEdits.find((d) => d.entityId === v.id)?._max.createdAt ?? v.createdAt;
  };
  const inForce = recipe.versions.find((v) => v.status === "APPROVED");
  const header = (
    <PageHeader
      exportKey="recipe"
      exportParams={{ id }}
      title={recipe.name}
      subtitle={res.ok ? t("Showing version {version} at today's ingredient costs.", { version: res.data.version.version }) : undefined}
      actions={manage ? <><Link href={`/recipes/${id}/edit`}><Button variant="secondary"><Pencil className="h-4 w-4" /> {t("Edit")}</Button></Link><DeleteRecipeButton recipeId={id} name={recipe.name} /></> : null}
    />
  );
  const meta = (
    <p className="-mt-3 mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-600">
      <span>{recipe.code} · {t(recipe.type)} · {recipe.department?.name ?? "—"}</span>
      <span>{t("Created at")}: <b className="font-medium text-ink-800">{at(recipe.createdAt)}</b></span>
      <span>{t("Last updated")}: <b className="font-medium text-ink-800">{at(recipe.updatedAt)}</b></span>
      {inForce && <span>{t("Version in force")}: <b className="font-medium text-ink-800">v{inForce.version}</b></span>}
    </p>
  );
  const versions = (
    <Card title={t("Versions")} padded={false}>
      <Table>
        <thead><tr><Th>{t("Version")}</Th><Th>{t("Status")}</Th><Th>{t("Created on")}</Th><Th>{t("Updated on")}</Th><Th align="right">{t("Portion cost when saved")}</Th><Th>{t("Reason for change")}</Th><Th /></tr></thead>
        <tbody className="divide-y divide-ink-100">
          {recipe.versions.map((v) => {
            const st = VERSION_STATUS[v.status] ?? { label: v.status, tone: "gray" as const };
            return (
              <tr key={v.id}>
                <Td>v{v.version}</Td>
                <Td><Badge tone={st.tone}>{t(st.label)}</Badge></Td>
                <Td className="whitespace-nowrap">{at(v.createdAt)}</Td>
                <Td className="whitespace-nowrap">{at(updatedAt(v))}</Td>
                <Td align="right">{money(v.portionCost?.toString(), cur)}</Td>
                <Td><span className="text-xs text-ink-500">{v.reason ? t(v.reason) : "—"}</span></Td>
                <Td>{v.status === "DRAFT" && can(actor, "recipe:approve") && (selfOk || v.createdById !== actor.userId ? <ApproveButton versionId={v.id} /> : <span className="text-xs text-ink-400">{t("Another person approves")}</span>)}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
  if (!res.ok) {
    // the cost cannot be calculated (e.g. a unit that no longer converts): the recipe, its dates and versions stay visible
    return (
      <>
        {header}
        {meta}
        <div className="mb-4"><Alert>{t("The cost of this recipe cannot be calculated: {reason}", { reason: res.error })}</Alert></div>
        {versions}
      </>
    );
  }
  const { result: c, version } = res.data;
  const products = c.lines.filter((l) => l.kind === "PRODUCT").map((l) => ({ id: l.refId, name: l.name, unitCost: l.unitCost?.toString() ?? null, unit: l.baseUnit }));
  return (
    <>
      {header}
      {meta}
      {!c.complete && (
        <div className="mb-4">
          <Alert tone="amber">
            <p className="font-medium">{t("The cost of this recipe is incomplete:")}</p>
            <ul className="mt-1 list-disc pl-5">{c.issues.map((i, k) => <li key={k}><Title>{i.path.split(" › ").pop() ?? i.path}</Title>: {t(ISSUE_TEXT[i.issue] ?? i.issue)}</li>)}</ul>
          </Alert>
        </div>
      )}
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
      <div className="mt-4">{versions}</div>
      <Card title={t("Price impact what-if")} className="mt-4"><PriceImpact products={products} currency={cur} /></Card>
    </>
  );
}
