/** Dev helper: run the full-cost export for a seeded hotel and print reconciliation results. */
import { prisma } from "../src/server/db";
import { buildFullCostExport, toTsv } from "../src/server/services/export";

async function main() {
  const email = process.argv[2] ?? "controller@grandanatolia.test";
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true, hotelAccess: true, deptAccess: true } });
  const actor = { userId: u.id, organizationId: u.organizationId, name: u.name, email: u.email, roleKey: u.role.key, roleName: u.role.name, permissions: new Set(u.role.permissions), hotelIds: u.hotelAccess.map((h) => h.hotelId), departmentIds: u.role.allDepartments ? ("ALL" as const) : u.deptAccess.map((d) => d.departmentId) };
  const from = new Date(`${process.argv[3] ?? "2026-09-01"}T00:00:00Z`);
  const to = new Date(`${process.argv[4] ?? "2026-10-01"}T00:00:00Z`);
  const t0 = Date.now();
  const e = await buildFullCostExport(prisma, actor, u.hotelAccess[0]!.hotelId, { from, to });
  console.log("ms", Date.now() - t0, e.score);
  for (const c of e.checks.filter((c) => !c.check.startsWith("Module"))) console.log(c.status.padEnd(7), c.check, "| exp", c.expected, "| act", c.actual, "| diff", c.difference);
  console.log(e.counts);
  console.log("tsv bytes", toTsv(e).length);
}
main().finally(() => prisma.$disconnect());
