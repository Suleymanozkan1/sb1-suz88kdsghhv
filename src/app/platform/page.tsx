import { redirect } from "next/navigation";
import { currentActor } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { listTenants } from "@/server/services/tenancy";
import { Badge, PageHeader } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out-button";
import { PlatformConsole } from "./console";

export const metadata = { title: "Platform Tenants" };
export const dynamic = "force-dynamic";

/** Platform operator console: tenants and their hotels (metadata only - never costs, stock or revenue). */
export default async function PlatformPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (!actor.permissions.has("platform:admin")) redirect("/");
  const tenants = await listTenants(prisma, actor);
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader title="HotelCost platform" subtitle={<span>Signed in as {actor.email} <Badge tone="blue">Super administrator</Badge> - tenant data (costs, stock, revenue) is not visible here by design.</span>} actions={<SignOutButton />} />
      <PlatformConsole tenants={tenants.map((t) => ({ id: t.id, name: t.name, active: t.active, isDemo: t.isDemo, createdAt: t.createdAt.toISOString(), users: t._count.users, hotels: t.hotels }))} />
    </main>
  );
}
