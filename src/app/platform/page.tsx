import { redirect } from "next/navigation";
import Link from "next/link";
import { currentActor } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { listTenants } from "@/server/services/tenancy";
import { Badge, PageHeader } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out-button";
import { PlatformConsole } from "./console";
import { BillingConsole } from "./billing-console";
import { billingSettings, planPrices, tenantSubscriptions } from "@/server/services/billing";
import { getT } from "@/i18n/server";

export const metadata = { title: "Platform Tenants" };
export const dynamic = "force-dynamic";

/** Platform operator console: tenants and their hotels (metadata only - never costs, stock or revenue). */
export default async function PlatformPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!actor.permissions.has("platform:admin")) redirect("/");
  const [tenants, subs, prices, settings] = await Promise.all([listTenants(prisma, actor), tenantSubscriptions(prisma, actor), planPrices(prisma), billingSettings(prisma)]);
  const t = await getT();
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader title={t("HotelCost platform")} subtitle={<span>{t("Signed in as {email}", { email: actor.email })} <Badge tone="blue">{t("Super administrator")}</Badge> · {t("tenant data (costs, stock, revenue) is not visible here by design.")}</span>} actions={<div className="flex items-center gap-2"><Link href="/account/password" className="text-sm font-medium text-brand-700 hover:underline">{t("Change password")}</Link><SignOutButton /></div>} />
      <PlatformConsole tenants={tenants.map((x) => ({ id: x.id, name: x.name, active: x.active, isDemo: x.isDemo, plan: x.plan, createdAt: x.createdAt.toISOString(), users: x._count.users, hotels: x.hotels }))} />
      <h2 className="mb-3 mt-8 text-lg font-semibold">{t("Subscriptions & billing")}</h2>
      <BillingConsole
        prices={prices}
        settings={settings}
        tenants={subs.map((x) => ({
          id: x.id,
          name: x.name,
          plan: x.plan,
          isDemo: x.isDemo,
          active: x.active,
          activeHotels: x.activeHotels,
          billableHotels: x.billableHotels,
          trialEndsAt: x.trialEndsAt?.toISOString() ?? null,
          paidThrough: x.paidThrough?.toISOString() ?? null,
          access: x.access ? { state: x.access.state, daysLeft: x.access.daysLeft } : null,
          invoices: x.billingInvoices.map((i) => ({ id: i.id, number: i.number, plan: i.plan, hotelCount: i.hotelCount, total: i.total.toFixed(2), currency: i.currency, status: i.status, dueDate: i.dueDate.toISOString(), periodStart: i.periodStart.toISOString(), periodEnd: i.periodEnd.toISOString(), paidAt: i.paidAt?.toISOString() ?? null })),
          requests: x.planRequests.map((r) => ({ id: r.id, plan: r.plan, note: r.note, createdAt: r.createdAt.toISOString() })),
        }))}
      />
    </main>
  );
}
