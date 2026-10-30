import { redirect } from "next/navigation";
import { currentActor, currentHotelId } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { Shell } from "@/components/shell";
import { navFlags } from "@/components/nav";
import { canOpenApprovals } from "@/server/services/approvals";
import { decidableApprovalCount } from "@/server/approval-badge";
import { trainingVideosOf } from "@/server/services/admin";
import { TrainingVideosProvider } from "@/components/page-help";
import { effectiveVideos } from "@/lib/training-videos";
import { accessHas, FEATURES, organizationAccess, type Feature } from "@/server/plans";
import { SubscriptionBanner } from "@/components/subscription-banner";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const hotelId = await currentHotelId();
  if (!hotelId) redirect(actor.permissions.has("platform:admin") ? "/platform" : "/no-access");
  const [hotels, pending, approvals, org, access] = await Promise.all([
    prisma.hotel.findMany({ where: { id: { in: [...actor.hotelIds] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // only the requests this user can decide: a chef is not shown the manager's queue
    decidableApprovalCount(prisma, actor, hotelId),
    // count approvers (Admin → warehouses) open /approvals even when their role has no dashboard
    canOpenApprovals(prisma, actor, hotelId),
    prisma.organization.findUnique({ where: { id: actor.organizationId }, select: { trainingVideos: true } }),
    organizationAccess(prisma, actor.organizationId),
  ]);
  // modules outside the package: shown with a lock in the menu (their pages explain, see FeatureGate)
  const locked = (Object.keys(FEATURES) as Feature[]).filter((f) => !accessHas(access, f));
  return (
    <Shell user={{ name: actor.name, role: actor.roleName }} hotels={hotels} hotelId={hotelId} permissions={[...actor.permissions]} navFlags={navFlags(actor, approvals)} pendingApprovals={pending} locked={locked}>
      {access.access && <SubscriptionBanner state={access.access.state} daysLeft={access.access.daysLeft} admin={actor.permissions.has("admin:users")} />}
      <TrainingVideosProvider videos={effectiveVideos(trainingVideosOf(org?.trainingVideos))}>{children}</TrainingVideosProvider>
    </Shell>
  );
}
