import { pageContext, guarded } from "@/server/page";
import { prisma } from "@/server/db";
import { can } from "@/server/auth/actor";
import { adminOverview, CATEGORY_GROUPS } from "@/server/services/admin";
import { listInvites } from "@/server/services/tenancy";
import { Alert, PageHeader } from "@/components/ui";
import { AdminConsole } from "./console";
import { getT } from "@/i18n/server";

export const metadata = { title: "Administration" };

export default async function AdminPage() {
  const { actor, hotelId } = await pageContext();
  const t = await getT();
  const res = await guarded(() => Promise.all([adminOverview(prisma, actor, hotelId), listInvites(prisma, actor, hotelId)]));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const [o, invites] = res.data;
  const orgHotels = await prisma.hotel.findMany({ where: { organizationId: actor.organizationId, id: { in: [...actor.hotelIds] } }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, active: true } });
  return (
    <>
      <PageHeader title={t("Administration")} subtitle={t("{hotel} - users & access, hotels, departments (with cost centers), warehouses, categories and hotel settings. Everything is audited; nothing referenced by the ledger is ever deleted.", { hotel: o.hotel.name })} exportKey="admin" />
      <AdminConsole
        me={actor.userId}
        canHotels={can(actor, "admin:hotels")}
        hotel={{ name: o.hotel.name, totalRooms: o.hotel.totalRooms, baseCurrency: o.hotel.baseCurrency, timezone: o.hotel.timezone, priceAlertPct: o.hotel.priceAlertPct.toString(), wasteApprovalValue: o.hotel.wasteApprovalValue.toString(), adjustmentApprovalValue: o.hotel.adjustmentApprovalValue.toString(), marginTargetPct: o.hotel.marginTargetPct.toString() }}
        hotels={orgHotels}
        currentHotelId={hotelId}
        roles={o.roles}
        users={o.users.map((u) => ({ id: u.id, email: u.email, name: u.name, active: u.active, roleKey: u.role.key, roleName: u.role.name, allDepartments: u.role.allDepartments, departmentIds: u.deptAccess.map((d) => d.departmentId), hotelIds: u.hotelAccess.map((h) => h.hotelId) }))}
        invites={invites.map((i) => ({ ...i, createdAt: i.createdAt.toISOString(), expiresAt: i.expiresAt.toISOString(), acceptedAt: i.acceptedAt?.toISOString() ?? null, revokedAt: i.revokedAt?.toISOString() ?? null }))}
        departments={o.departments.map((d) => ({ id: d.id, code: d.code, name: d.name, isOutlet: d.isOutlet, active: d.active, parentId: d.parentId, sqm: d.sqm?.toString() ?? null, headcount: d.headcount }))}
        warehouses={o.warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name, active: w.active, department: w.department?.name ?? null }))}
        categories={o.categories.map((c) => ({ id: c.id, code: c.code, name: c.name, group: c.group, parentId: c.parentId }))}
        groups={[...CATEGORY_GROUPS]}
      />
    </>
  );
}
