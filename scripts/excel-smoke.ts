/** Dev helper: generate the .xlsm for a seeded user into a folder. */
import { writeFileSync } from "node:fs";
import { prisma } from "../src/server/db";
import { buildExcelReport } from "../src/server/excel";

async function main() {
  const email = process.argv[2] ?? "controller@grandanatolia.test";
  const out = process.argv[3] ?? "/tmp";
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true, hotelAccess: true, deptAccess: true } });
  const actor = { userId: u.id, organizationId: u.organizationId, name: u.name, email: u.email, roleKey: u.role.key, roleName: u.role.name, permissions: new Set(u.role.permissions), hotelIds: u.hotelAccess.map((h) => h.hotelId), departmentIds: u.role.allDepartments ? ("ALL" as const) : u.deptAccess.map((d) => d.departmentId) };
  const hotel = await prisma.hotel.findFirstOrThrow({ where: { code: "GAR" } });
  const t0 = Date.now();
  const r = await buildExcelReport(prisma, actor, hotel.id, { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") }, "http://localhost:3100");
  writeFileSync(`${out}/${r.fileName}`, r.buffer);
  console.log(`${out}/${r.fileName}`, r.buffer.length, "bytes", Date.now() - t0, "ms", r.export.score);
}
main().finally(() => prisma.$disconnect());
