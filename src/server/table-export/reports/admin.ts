import { prisma } from "../../db";
import { can } from "../../auth/actor";
import { adminOverview } from "../../services/admin";
import { listInvites } from "../../services/tenancy";
import type { ReportDef, XTable } from "../types";

/** /admin — every list of the admin console: users, invitations, hotels, departments, warehouses, categories, hotel settings. */
export const admin: ReportDef = {
  async load({ actor, hotelId, t }) {
    const [o, invites] = await Promise.all([adminOverview(prisma, actor, hotelId), listInvites(prisma, actor, hotelId)]);
    const orgHotels = await prisma.hotel.findMany({ where: { organizationId: actor.organizationId, id: { in: [...actor.hotelIds] } }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, active: true } });
    const deptName = new Map(o.departments.map((d) => [d.id, d.name]));
    const roleOf = (k: string) => o.roles.find((r) => r.key === k);
    const now = new Date();
    const tables: XTable[] = [
      {
        title: t("Users of this hotel ({count})", { count: o.users.length }),
        columns: [{ key: "name", header: t("Name") }, { key: "email", header: t("E-mail") }, { key: "role", header: t("Role") }, { key: "depts", header: t("Departments") }, { key: "hotels", header: t("Hotels"), type: "int" }, { key: "status", header: t("Status") }],
        rows: o.users.map((u) => ({
          name: u.name, email: u.email, role: t(u.role.name),
          depts: u.role.allDepartments ? t("All") : u.deptAccess.map((d) => deptName.get(d.departmentId) ?? t("other hotel")).join(", "),
          hotels: u.hotelAccess.length, status: u.active ? t("ACTIVE") : t("INACTIVE"),
        })),
      },
      {
        title: t("Invitations"),
        columns: [{ key: "email", header: t("E-mail") }, { key: "role", header: t("Role") }, { key: "created", header: t("Created"), type: "date" }, { key: "status", header: t("Status") }],
        rows: invites.map((i) => {
          const status = i.acceptedAt ? "ACCEPTED" : i.revokedAt ? "REVOKED" : i.expiresAt < now ? "EXPIRED" : "OPEN";
          return { email: i.email, role: t(roleOf(i.roleKey)?.name ?? i.roleKey), created: i.createdAt.toISOString().slice(0, 10), status: t(status) };
        }),
      },
    ];
    if (can(actor, "admin:hotels")) {
      tables.push({
        title: t("Hotels you administer"),
        columns: [{ key: "code", header: t("Code") }, { key: "name", header: t("Name") }, { key: "status", header: t("Status") }],
        rows: orgHotels.map((h) => ({ code: h.code, name: `${h.name}${h.id === hotelId ? ` (${t("current")})` : ""}`, status: h.active ? t("ACTIVE") : t("SUSPENDED") })),
      });
    }
    tables.push(
      {
        title: t("Departments"),
        columns: [
          { key: "code", header: t("Code") }, { key: "name", header: t("Name") }, { key: "parent", header: t("Parent") }, { key: "outlet", header: t("Outlet") },
          { key: "sqm", header: t("m²"), type: "qty" }, { key: "headcount", header: t("Headcount"), type: "int" }, { key: "status", header: t("Status") },
        ],
        rows: o.departments.map((d) => ({ code: d.code, name: d.name, parent: d.parentId ? deptName.get(d.parentId) : "", outlet: d.isOutlet ? t("yes") : "", sqm: d.sqm, headcount: d.headcount, status: d.active ? t("ACTIVE") : t("INACTIVE") })),
      },
      {
        title: t("Warehouses"),
        columns: [{ key: "code", header: t("Code") }, { key: "name", header: t("Name") }, { key: "dept", header: t("Department") }, { key: "status", header: t("Status") }, { key: "approvers", header: t("Count approvers") }],
        rows: o.warehouses.map((w) => ({ code: w.code, name: w.name, dept: w.department?.name ?? t("Shared"), status: w.active ? t("ACTIVE") : t("INACTIVE"), approvers: w.countApprovers.length ? w.countApprovers.map((a) => t(o.roles.find((r) => r.key === a.roleKey)?.name ?? a.roleKey)).join(", ") : t("Any role with the approval right") })),
      },
      {
        title: t("Categories ({count})", { count: o.categories.length }),
        columns: [{ key: "group", header: t("Group") }, { key: "code", header: t("Code") }, { key: "name", header: t("Name") }],
        rows: o.categories.map((c) => ({ group: t(c.group), code: c.code, name: c.parentId ? `↳ ${c.name}` : c.name })),
      },
      {
        title: t("Hotel settings"),
        columns: [
          { key: "name", header: t("Hotel name") }, { key: "rooms", header: t("Rooms"), type: "int" }, { key: "cur", header: t("Base currency") }, { key: "tz", header: t("Timezone") },
          { key: "priceAlert", header: t("Price alert %"), type: "pct" }, { key: "waste", header: t("Waste approval above"), type: "money" }, { key: "adj", header: t("Adjustment approval above"), type: "money" }, { key: "margin", header: t("Margin target %"), type: "pct" },
        ],
        rows: [{ name: o.hotel.name, rooms: o.hotel.totalRooms, cur: o.hotel.baseCurrency, tz: o.hotel.timezone, priceAlert: o.hotel.priceAlertPct, waste: o.hotel.wasteApprovalValue, adj: o.hotel.adjustmentApprovalValue, margin: o.hotel.marginTargetPct }],
      },
    );
    return { title: t("Administration"), fileName: "yonetim", tables };
  },
};
