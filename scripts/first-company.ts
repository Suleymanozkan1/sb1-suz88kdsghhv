/**
 * First setup of an empty database (cloud / Vercel or any server):
 *   DATABASE_URL=… npm run setup:first-company -- --company="My Hotels" --hotel="My Hotel" --hotel-code=HTL1 \
 *       --admin-email=me@example.com --admin-password='…' [--rooms=120] [--currency=TRY] \
 *       [--plan=BASIC|STANDARD|PREMIUM] [--paid-through=YYYY-MM-DD]
 *   DATABASE_URL=… npm run setup:first-company -- --platform-admin=ops@example.com --platform-password='…'
 * The first form creates the company with standard departments, cost centers, warehouses and categories and its
 * administrator. The second creates the SaaS platform operator (tenant management only, no tenant data).
 *
 * Billing applies once a platform operator exists (src/server/plans.ts). A company created without --paid-through
 * runs on the 30-day trial and becomes read-only after it, so a paying first customer needs --plan and
 * --paid-through; both forms warn about tenants that would otherwise lapse.
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { bootstrapInstallation } from "../src/server/services/admin";
import { SUPER_ADMIN_TEMPLATE } from "../src/server/auth/permissions";
import { billingEnabled } from "../src/server/plans";
import { parseSubscriptionOptions, trialWarning } from "./lib/first-company-options";

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
    // billing is enforced from now on: name every customer that is only on a trial
    const trials = await prisma.organization.findMany({ where: { isPlatform: false, isDemo: false, paidThrough: null }, select: { name: true, trialEndsAt: true } });
    if (trials.length && (await billingEnabled(prisma as never))) {
      console.warn(`WARNING: billing is now enforced. ${trials.length} company(ies) have no paid period and become READ-ONLY when their trial ends:`);
      for (const o of trials) console.warn(`  - ${o.name}: trial ends ${o.trialEndsAt?.toISOString().slice(0, 10) ?? "(no trial)"}`);
      console.warn("Record their payments in /platform → Subscriptions, or set BILLING_ENFORCEMENT=off until billing starts (docs/VERCEL.md).");
    }
    return;
  }
  // validated before anything is written
  const sub = parseSubscriptionOptions(arg("plan"), arg("paid-through"));
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
  const org = await prisma.organization.update({ where: { id: r.organizationId }, data: { ...(sub.plan && { plan: sub.plan }), ...(sub.paidThrough && { paidThrough: sub.paidThrough }) }, select: { plan: true, trialEndsAt: true, paidThrough: true } });
  if (sub.plan || sub.paidThrough) {
    await prisma.auditLog.create({ data: { organizationId: r.organizationId, hotelId: r.hotelId, userId: r.adminId, action: "INSTALLATION_SUBSCRIPTION", entityType: "Organization", entityId: r.organizationId, after: { plan: org.plan, paidThrough: org.paidThrough }, source: "SETUP" } });
  }
  console.log(`company created (hotel ${r.hotelId}); sign in as ${arg("admin-email")}`);
  console.log(`package ${org.plan}${org.paidThrough ? `, paid through ${org.paidThrough.toISOString().slice(0, 10)}` : ""}`);
  if (!org.paidThrough) console.warn(trialWarning(org.trialEndsAt, await billingEnabled(prisma as never)));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
