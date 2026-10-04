/**
 * First setup of an empty database (cloud / Vercel or any server):
 *   DATABASE_URL=… npm run setup:first-company -- --company="My Hotels" --hotel="My Hotel" --hotel-code=HTL1 \
 *       --admin-email=me@example.com --admin-password='…' [--rooms=120] [--currency=TRY]
 *   DATABASE_URL=… npm run setup:first-company -- --platform-admin=ops@example.com --platform-password='…'
 * The first form creates the company with standard departments, cost centers, warehouses and categories and its
 * administrator. The second creates the SaaS platform operator (tenant management only, no tenant data).
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { bootstrapInstallation } from "../src/server/services/admin";
import { SUPER_ADMIN_TEMPLATE } from "../src/server/auth/permissions";

const prisma = new PrismaClient();
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);

async function main() {
  const platform = arg("platform-admin");
  if (platform) {
    const pw = arg("platform-password") ?? "";
    if (pw.length < 12) throw new Error("--platform-password must have at least 12 characters");
    if (await prisma.user.findUnique({ where: { email: platform.toLowerCase() } })) throw new Error("this e-mail already exists");
    const org = (await prisma.organization.findFirst({ where: { isPlatform: true } })) ?? (await prisma.organization.create({ data: { name: "HotelCost Platform", isPlatform: true } }));
    const role = (await prisma.role.findFirst({ where: { organizationId: org.id, key: SUPER_ADMIN_TEMPLATE.key } })) ?? (await prisma.role.create({ data: { organizationId: org.id, key: SUPER_ADMIN_TEMPLATE.key, name: SUPER_ADMIN_TEMPLATE.name, allDepartments: true, permissions: SUPER_ADMIN_TEMPLATE.permissions } }));
    await prisma.user.create({ data: { organizationId: org.id, email: platform.toLowerCase(), name: "Platform administrator", passwordHash: await bcrypt.hash(pw, 10), roleId: role.id } });
    console.log(`platform administrator ${platform} created (sign in → /platform)`);
    return;
  }
  const r = await bootstrapInstallation(prisma as never, {
    organizationName: arg("company") ?? "",
    hotelName: arg("hotel") ?? "",
    hotelCode: (arg("hotel-code") ?? "HTL1").toUpperCase(),
    totalRooms: arg("rooms") ?? "0",
    baseCurrency: arg("currency") ?? "TRY",
    adminEmail: arg("admin-email") ?? "",
    adminName: arg("admin-name") ?? "Administrator",
    adminPassword: arg("admin-password") ?? "",
  });
  console.log(`company created (hotel ${r.hotelId}); sign in as ${arg("admin-email")}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
