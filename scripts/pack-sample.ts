/** Dev helper: render the monthly management pack PDF for the seeded hotel (npm run pack:sample -- <dir>). */
import { writeFileSync } from "node:fs";
import { prisma } from "../src/server/db";
import { managementPack } from "../src/server/services/reports";
async function main() {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: "controller@grandanatolia.test" }, include: { role: true, hotelAccess: true } });
  const actor = { userId: u.id, organizationId: u.organizationId, name: u.name, email: u.email, roleKey: u.role.key, roleName: u.role.name, permissions: new Set(u.role.permissions), hotelIds: u.hotelAccess.map((h) => h.hotelId), departmentIds: "ALL" as const };
  const t0 = Date.now();
  const r = await managementPack(prisma, actor as never, u.hotelAccess[0]!.hotelId, { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") });
  writeFileSync(`${process.argv[2]}/${r.fileName}`, r.pdf);
  console.log(r.fileName, r.pdf.length, r.reconciliation, Date.now() - t0, "ms");
}
main().finally(() => prisma.$disconnect());
