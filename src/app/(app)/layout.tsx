import { redirect } from "next/navigation";
import { currentActor, currentHotelId } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { Shell } from "@/components/shell";
import { canOpenApprovals } from "@/server/services/approvals";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const hotelId = await currentHotelId();
  if (!hotelId) redirect(actor.permissions.has("platform:admin") ? "/platform" : "/no-access");
  const [hotels, pending, approvals] = await Promise.all([
    prisma.hotel.findMany({ where: { id: { in: [...actor.hotelIds] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.approval.count({ where: { hotelId, status: "PENDING" } }),
    // count approvers (Admin → warehouses) open /approvals even when their role has no dashboard
    canOpenApprovals(prisma, actor, hotelId),
  ]);
  return (
    <Shell user={{ name: actor.name, role: actor.roleName }} hotels={hotels} hotelId={hotelId} permissions={[...actor.permissions]} navFlags={approvals ? ["approvals"] : []} pendingApprovals={pending}>
      {children}
    </Shell>
  );
}
