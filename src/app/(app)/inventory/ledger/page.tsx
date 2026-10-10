import Link from "next/link";
import { pageContext, guarded } from "@/server/page";
import { explodeSalesRows, ledgerEntries, summarizeSalesRows, type DetailLine } from "@/server/services/inventory";
import { LEDGER_TYPES, ledgerRange, parseLedgerQuery, sourceText } from "@/server/table-export/reports/ledger";
import { can, canDepartment } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, PageHeader, Table, Td, Th, cn } from "@/components/ui";
import { money, qty, date } from "@/lib/format";
import { getT } from "@/i18n/server";
import { DeleteRequest } from "./delete-request";
import { LedgerFilters } from "./ledger-filters";
import { Title } from "@/components/title";

export const metadata = { title: "Stock Ledger" };
const PAGE = 50;
const SUMMARY_MAX = 5000;

export default async function LedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const f = parseLedgerQuery(sp);
  const t = await getT();
  const page = Math.max(1, Number(sp.page ?? 1));
  const { actor, hotelId, hotel } = await pageContext();
  // the summary merges a day's sales rows, so it is merged over the whole selection (as the export does, up to
  // SUMMARY_MAX movements) and paged afterwards; otherwise a day split across two pages would show as two partial rows
  const summary = f.view !== "detail";
  const res = await guarded(() => ledgerEntries(prisma, actor, hotelId, { warehouseId: f.warehouseId, productId: f.productId, type: f.type, ...ledgerRange(f), ...(summary ? { take: SUMMARY_MAX } : { take: PAGE, skip: (page - 1) * PAGE }) }));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const { rows } = res.data;
  const all: DetailLine[] = summary ? await summarizeSalesRows(prisma, rows) : await explodeSalesRows(prisma, rows);
  const total = summary ? all.length : res.data.total;
  const lines = summary ? all.slice((page - 1) * PAGE, page * PAGE) : all;
  const [warehouses, product] = await Promise.all([
    prisma.warehouse.findMany({ where: { hotelId, active: true }, orderBy: { name: "asc" } }),
    f.productId ? prisma.product.findFirst({ where: { id: f.productId, hotelId } }) : null,
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const keep = Object.fromEntries(Object.entries({ view: f.view, warehouseId: f.warehouseId, productId: f.productId, type: f.type, from: f.from, to: f.to }).filter(([, v]) => v)) as Record<string, string>;
  const q = (p: Record<string, string>) => `?${new URLSearchParams({ ...keep, ...p })}`;
  const cur = hotel.baseCurrency;
  const tab = (v: "summary" | "detail", label: string) => (
    <Link href={q({ view: v, page: "1" })} className={cn("rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium", f.view === v ? "border-brand-600 text-brand-800" : "border-transparent text-ink-500 hover:text-ink-800")}>{label}</Link>
  );
  return (
    <>
      <PageHeader title={t("Stock movements")} subtitle={t("Append-only. Posted entries are never edited or deleted — corrections are reversals approved by a manager.")} />
      <Card className="mb-4">
        <LedgerFilters exportKey="ledger" view={f.view} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} types={LEDGER_TYPES} value={f} product={product ? { id: product.id, name: product.name, sku: product.sku, stockUnit: product.stockUnit, purchaseUnit: product.purchaseUnit, recipeUnit: product.recipeUnit } : null} />
      </Card>
      <div className="mb-2 flex gap-1 border-b border-ink-200">
        {tab("summary", t("Stock movements"))}
        {tab("detail", t("Stock movements – detailed"))}
      </div>
      {summary && res.data.total > SUMMARY_MAX && <div className="mb-3"><Alert tone="amber">{t("The summary covers the latest {n} movements; narrow the date range to see older ones.", { n: SUMMARY_MAX })}</Alert></div>}
      <Card padded={false} title={f.view === "detail" ? t("{total} movements, sales split per check", { total }) : t("{total} movements", { total })}>
        <Table>
          <thead><tr><Th>{t("Date")}</Th><Th>{t("Type")}</Th><Th>{t("Product")}</Th><Th>{t("Warehouse")}</Th><Th align="right">{t("Qty")}</Th><Th align="right">{t("Unit cost")}</Th><Th align="right">{t("Total")}</Th><Th>{t("Source / reason")}</Th><Th /></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {lines.map((d, i) => {
              const r = d.row;
              const first = i === 0 || lines[i - 1]!.row.id !== r.id;
              return (
                <tr key={`${r.id}-${i}`} className={r.reversedBy ? "bg-ink-50 text-ink-400" : ""}>
                  <Td>{date(r.txDate)}</Td>
                  <Td><Badge tone={Number(r.quantity) > 0 ? "green" : r.type === "REVERSAL" ? "violet" : r.type === "WASTE" ? "red" : "amber"}>{t(r.type)}</Badge></Td>
                  <Td><Link href={q({ productId: r.productId, page: "1" })} className="hover:underline"><Title>{r.product.name}</Title></Link></Td>
                  <Td>{r.warehouse.name}</Td>
                  <Td align="right">{qty(d.quantity.toString(), r.product.stockUnit)}</Td>
                  <Td align="right">{money(r.unitCost.toString(), cur, 4)}</Td>
                  <Td align="right">{money(d.total.toString(), cur)}</Td>
                  <Td className="max-w-md whitespace-normal"><span className={cn("text-xs", r.type === "WASTE" ? "text-red-700" : "text-ink-500")}>{sourceText(d, t)}</span>{r.reversedBy && <Badge tone="violet">{t("reversed")}</Badge>}</Td>
                  <Td>{first && !d.merged && !r.reversedBy && r.type !== "REVERSAL" && !r.transferGroup && can(actor, "inventory:post") && (!r.departmentId || canDepartment(actor, r.departmentId)) && <DeleteRequest txId={r.id} />}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <div className="flex items-center justify-between border-t border-ink-100 px-4 py-2 text-sm">
          <span className="text-ink-500">{t("Page {page} of {pages}", { page, pages })}</span>
          <span className="flex gap-2">
            {page > 1 && <Link className="rounded border px-2 py-1 hover:bg-ink-50" href={q({ page: String(page - 1) })}>{t("Previous")}</Link>}
            {page < pages && <Link className="rounded border px-2 py-1 hover:bg-ink-50" href={q({ page: String(page + 1) })}>{t("Next")}</Link>}
          </span>
        </div>
      </Card>
    </>
  );
}
