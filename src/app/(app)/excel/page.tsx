import { FileSpreadsheet } from "lucide-react";
import { pageContext, monthRange } from "@/server/page";
import { authorize, departmentScope } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Badge, Card, Empty, Label, PageHeader, Select, Input, Table, Td, Th } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { TokenPanel } from "./token-panel";

export const metadata = { title: "Excel Export" };

export default async function ExcelPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { actor, hotelId, hotel } = await pageContext();
  authorize(actor, "report:export", { hotelId });
  const range = monthRange(await searchParams);
  const [departments, warehouses, reports] = await Promise.all([
    prisma.department.findMany({ where: { hotelId, ...departmentScope(actor, "id") }, orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: { hotelId }, orderBy: { name: "asc" } }),
    prisma.report.findMany({ where: { hotelId, reportType: "FULL_COST_EXPORT" }, orderBy: { generatedAt: "desc" }, take: 15 }),
  ]);
  const users = new Map((await prisma.user.findMany({ where: { id: { in: reports.map((r) => r.generatedById) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return (
    <>
      <PageHeader title="Excel full cost report (.xlsm)" subtitle="The whole cost operation in one macro-enabled workbook — same cost engine as this application, reconciled, audited and refreshable from Excel." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Generate workbook" className="lg:col-span-2">
          <form method="get" action="/api/export/workbook" className="grid gap-3 md:grid-cols-3">
            <div><Label htmlFor="x-from">Start date</Label><Input id="x-from" name="from" type="date" defaultValue={range.fromStr} required /></div>
            <div><Label htmlFor="x-to">End date</Label><Input id="x-to" name="to" type="date" defaultValue={range.toStr} required /></div>
            <div><Label htmlFor="x-group">Category</Label><Select id="x-group" name="group" defaultValue=""><option value="">All</option>{["FOOD", "BEVERAGE", "PACKAGING", "HOUSEKEEPING", "ENGINEERING"].map((g) => <option key={g}>{g}</option>)}</Select></div>
            <div><Label htmlFor="x-dept">Department / outlet</Label><Select id="x-dept" name="departmentId" defaultValue=""><option value="">All accessible</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
            <div><Label htmlFor="x-wh">Warehouse</Label><Select id="x-wh" name="warehouseId" defaultValue=""><option value="">All</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></div>
            <input type="hidden" name="hotelId" value={hotelId} />
            <div className="flex items-end">
              <button type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">
                <FileSpreadsheet className="h-4 w-4" aria-hidden /> Download .xlsm
              </button>
            </div>
          </form>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ink-600">
            <li>Opens on <strong>01_CONTROL</strong> with the <strong>TÜM COST RAPORLARINI OLUŞTUR</strong> button; all report sheets are already filled for {hotel.name}.</li>
            <li>Enable macros to refresh from Excel (Windows): the macro calls this server&apos;s <code>/api/export/full-cost</code> with your API token, rebuilds pivots and charts and re-runs reconciliation.</li>
            <li>Only departments you can access are exported. Modules not yet implemented are marked <Badge tone="amber">NOT_AVAILABLE</Badge> — never shown as zero.</li>
          </ul>
        </Card>
        <Card title="API token for Excel refresh"><TokenPanel /></Card>
      </div>
      <Card title="Recent exports (archive)" className="mt-4" padded={false}>
        {reports.length === 0 ? <div className="p-4"><Empty title="No exports yet" /></div> : (
          <Table>
            <thead><tr><Th>Generated</Th><Th>By</Th><Th>Export ID</Th><Th>Period</Th><Th>Reconciliation</Th><Th align="right">Data quality</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {reports.map((r) => {
                const d = r.data as { exportId?: string; meta?: { period?: { label?: string } }; score?: { reconciliation?: string; dataQuality?: string } };
                return (
                  <tr key={r.id}>
                    <Td>{dateTime(r.generatedAt)}</Td><Td>{users.get(r.generatedById)}</Td><Td className="font-mono text-xs">{d.exportId}</Td><Td>{d.meta?.period?.label}</Td>
                    <Td><Badge tone={d.score?.reconciliation === "PASS" ? "green" : d.score?.reconciliation === "FAIL" ? "red" : "amber"}>{d.score?.reconciliation}</Badge></Td>
                    <Td align="right">{d.score?.dataQuality ?? "—"}%</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
