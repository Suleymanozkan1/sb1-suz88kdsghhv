import { redirect } from "next/navigation";
import { currentActor } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { listTenants } from "@/server/services/tenancy";
import { Badge, PageHeader } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out-button";
import { PlatformConsole } from "./console";
import { getT } from "@/i18n/server";

export const metadata = { title: "Platform Tenants" };
export const dynamic = "force-dynamic";

/** Platform operator console: tenants and their hotels (metadata only - never costs, stock or revenue). */
export default async function PlatformPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!actor.permissions.has("platform:admin")) redirect("/");
  const tenants = await listTenants(prisma, actor);
  const t = await getT();
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader title={t("HotelCost platform")} subtitle={<span>{t("Signed in as {email}", { email: actor.email })} <Badge tone="blue">{t("Super administrator")}</Badge> - {t("tenant data (costs, stock, revenue) is not visible here by design.")}</span>} actions={<SignOutButton />} />
      <PlatformConsole tenants={tenants.map((x) => ({ id: x.id, name: x.name, active: x.active, isDemo: x.isDemo, createdAt: x.createdAt.toISOString(), users: x._count.users, hotels: x.hotels }))} />
    </main>
  );
}
