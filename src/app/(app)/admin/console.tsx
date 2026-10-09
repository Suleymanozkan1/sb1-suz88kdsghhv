"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, Input, Label, Select, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";
import { useLocale, useT } from "@/i18n/client";

interface Role { id: string; key: string; name: string; allDepartments: boolean }
interface User { id: string; email: string; name: string; active: boolean; roleKey: string; roleName: string; allDepartments: boolean; departmentIds: string[]; hotelIds: string[] }
interface Invite { id: string; email: string; name: string | null; roleKey: string; createdAt: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null }
interface Dept { id: string; code: string; name: string; isOutlet: boolean; active: boolean; parentId: string | null; sqm: string | null; headcount: number | null }
interface Hotel { id: string; code: string; name: string; active: boolean }
interface Props {
  me: string;
  canHotels: boolean;
  hotel: Record<string, string | number>;
  hotels: Hotel[];
  currentHotelId: string;
  roles: Role[];
  users: User[];
  invites: Invite[];
  departments: Dept[];
  warehouses: Array<{ id: string; code: string; name: string; active: boolean; department: string | null }>;
  categories: Array<{ id: string; code: string; name: string; group: string; parentId: string | null }>;
  groups: string[];
}

const TABS = ["Users", "Invitations", "Hotels", "Departments", "Warehouses", "Categories", "Hotel settings"] as const;
type Tab = (typeof TABS)[number];
const val = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const multi = (f: FormData, k: string) => f.getAll(k).map(String);

export function AdminConsole(p: Props) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>("Users");
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [edit, setEditUser] = useState<User | null>(null);
  // role chosen in the edit form: decides whether the department picker is needed
  const [editRole, setEditRole] = useState("");
  const setEdit = (u: User | null) => { setEditUser(u); setEditRole(u?.roleKey ?? ""); };
  const [roleKey, setRoleKey] = useState(p.roles.find((r) => r.key === "viewer")?.key ?? p.roles[0]?.key ?? "");
  const deptName = new Map(p.departments.map((d) => [d.id, d.name]));
  const roleOf = (k: string) => p.roles.find((r) => r.key === k);

  async function run(fn: () => Promise<unknown>, ok: string, form?: HTMLFormElement) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "green", text: t(ok) });
      form?.reset();
      router.refresh();
      return true;
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : t("Failed") });
      return false;
    }
  }

  const deptPicker = (name: string, selected: string[] = []) => (
    <fieldset className="md:col-span-4">
      <legend className="mb-1 text-sm font-medium text-ink-700">{t("Departments (for department-scoped roles)")}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {p.departments.filter((d) => d.active).map((d) => (
          <label key={d.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name={name} value={d.id} defaultChecked={selected.includes(d.id)} /> {d.name}</label>
        ))}
      </div>
    </fieldset>
  );
  const hotelPicker = (name: string, selected: string[]) => (
    <fieldset className="md:col-span-4">
      <legend className="mb-1 text-sm font-medium text-ink-700">{t("Hotels")}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {p.hotels.filter((h) => h.active).map((h) => (
          <label key={h.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name={name} value={h.id} defaultChecked={selected.includes(h.id)} /> {h.name}</label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={t("Administration sections")} className="flex flex-wrap gap-1">
        {TABS.filter((x) => x !== "Hotels" || p.canHotels).map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} onClick={() => { setTab(x); setMsg(null); setLink(null); }} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === x ? "bg-brand-600 text-white" : "bg-white text-ink-700 ring-1 ring-ink-200 hover:bg-ink-50"}`}>{t(x)}</button>
        ))}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {tab === "Users" && (
        <>
          <Card title={t("Add user")}>
            <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => call("POST", "/api/admin/users", { email: val(f, "email"), name: val(f, "name"), password: val(f, "password"), roleKey: val(f, "roleKey"), departmentIds: multi(f, "dept"), hotelIds: multi(f, "hotel") }), "User created", e.currentTarget); }}>
              <div><Label htmlFor="u-name">{t("Name")}</Label><Input id="u-name" name="name" required /></div>
              <div><Label htmlFor="u-email">{t("E-mail")}</Label><Input id="u-email" name="email" type="email" required /></div>
              <div><Label htmlFor="u-pw" hint={t("min 10")}>{t("Initial password")}</Label><Input id="u-pw" name="password" type="password" required minLength={10} autoComplete="new-password" /></div>
              <div><Label htmlFor="u-role">{t("Role")}</Label><Select id="u-role" name="roleKey" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>{p.roles.map((r) => <option key={r.key} value={r.key}>{t(r.name)}</option>)}</Select></div>
              {hotelPicker("hotel", [p.currentHotelId])}
              {!roleOf(roleKey)?.allDepartments && deptPicker("dept")}
              <div className="md:col-span-4"><Button type="submit">{t("Create user")}</Button></div>
            </form>
          </Card>
          <Card title={t("Users of this hotel ({count})", { count: p.users.length })} padded={false}>
            <Table label={t("Users")}>
              <thead><tr><Th>{t("Name")}</Th><Th>{t("E-mail")}</Th><Th>{t("Role")}</Th><Th>{t("Departments")}</Th><Th>{t("Hotels")}</Th><Th>{t("Status")}</Th><Th /></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {p.users.map((u) => (
                  <tr key={u.id}>
                    <Td className="font-medium">{u.name}</Td><Td>{u.email}</Td><Td>{t(u.roleName)}</Td>
                    <Td className="max-w-xs truncate">{u.allDepartments ? t("All") : u.departmentIds.map((d) => deptName.get(d) ?? t("other hotel")).join(", ")}</Td>
                    <Td>{u.hotelIds.length}</Td>
                    <Td><Badge tone={u.active ? "green" : "gray"}>{u.active ? t("ACTIVE") : t("INACTIVE")}</Badge></Td>
                    <Td><Button size="sm" variant="secondary" onClick={() => setEdit(u)}>{t("Edit")}</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          {edit && (
            <Card key={edit.id} title={t("Edit {name}", { name: edit.name })}>
              <form className="grid gap-3 md:grid-cols-4" onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const role = roleOf(val(f, "roleKey"));
                const body: Record<string, unknown> = { name: val(f, "name"), roleKey: val(f, "roleKey"), active: f.get("active") === "on", hotelIds: multi(f, "hotel") };
                if (!role?.allDepartments) body.departmentIds = multi(f, "dept");
                if (val(f, "password")) body.password = val(f, "password");
                if (await run(() => call("PATCH", `/api/admin/users/${edit.id}`, body), "User updated - open sessions were ended where access changed")) setEdit(null);
              }}>
                <div><Label htmlFor="e-name">{t("Name")}</Label><Input id="e-name" name="name" defaultValue={edit.name} required /></div>
                <div><Label htmlFor="e-role">{t("Role")}</Label><Select id="e-role" name="roleKey" value={editRole} onChange={(e) => setEditRole(e.target.value)} disabled={edit.id === p.me}>{p.roles.map((r) => <option key={r.key} value={r.key}>{t(r.name)}</option>)}</Select>{edit.id === p.me && <input type="hidden" name="roleKey" value={edit.roleKey} />}</div>
                <div><Label htmlFor="e-pw" hint={t("leave empty to keep")}>{t("Reset password")}</Label><Input id="e-pw" name="password" type="password" minLength={10} autoComplete="new-password" /></div>
                <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={edit.active} disabled={edit.id === p.me} /> {t("Active")}{edit.id === p.me && <input type="hidden" name="active" value="on" />}</label>
                {hotelPicker("hotel", edit.hotelIds)}
                {!roleOf(editRole)?.allDepartments && deptPicker("dept", edit.departmentIds)}
                <div className="flex gap-2 md:col-span-4"><Button type="submit">{t("Save")}</Button><Button type="button" variant="ghost" onClick={() => setEdit(null)}>{t("Cancel")}</Button></div>
              </form>
            </Card>
          )}
        </>
      )}

      {tab === "Invitations" && (
        <>
          <Card title={t("Invite a user")}>
            <form className="grid gap-3 md:grid-cols-4" onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setLink(null);
              let token = "";
              const ok = await run(async () => { token = (await call<{ token: string }>("POST", "/api/admin/invites", { email: val(f, "email"), name: val(f, "name") || undefined, roleKey: val(f, "roleKey"), hotelIds: multi(f, "hotel"), departmentIds: multi(f, "dept") })).token; }, "Invitation created - send this link (valid 7 days, shown once)", e.currentTarget);
              if (ok) setLink(`${window.location.origin}/invite?token=${token}`);
            }}>
              <div><Label htmlFor="v-name">{t("Name (optional)")}</Label><Input id="v-name" name="name" /></div>
              <div><Label htmlFor="v-email">{t("E-mail")}</Label><Input id="v-email" name="email" type="email" required /></div>
              <div><Label htmlFor="v-role">{t("Role")}</Label><Select id="v-role" name="roleKey" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>{p.roles.map((r) => <option key={r.key} value={r.key}>{t(r.name)}</option>)}</Select></div>
              {hotelPicker("hotel", [p.currentHotelId])}
              {!roleOf(roleKey)?.allDepartments && deptPicker("dept")}
              <div className="md:col-span-4"><Button type="submit">{t("Create invitation")}</Button></div>
            </form>
            {link && <code className="mt-3 block break-all rounded-lg bg-ink-950 p-3 font-mono text-xs text-brand-200" data-testid="invite-link">{link}</code>}
          </Card>
          <Card title={t("Invitations")} padded={false}>
            <Table label={t("Invitations")}>
              <thead><tr><Th>{t("E-mail")}</Th><Th>{t("Role")}</Th><Th>{t("Created")}</Th><Th>{t("Status")}</Th><Th /></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {p.invites.map((i) => {
                  const status = i.acceptedAt ? "ACCEPTED" : i.revokedAt ? "REVOKED" : new Date(i.expiresAt) < new Date() ? "EXPIRED" : "OPEN";
                  return (
                    <tr key={i.id}>
                      <Td>{i.email}</Td><Td>{t(roleOf(i.roleKey)?.name ?? i.roleKey)}</Td><Td>{i.createdAt.slice(0, 10)}</Td>
                      <Td><Badge tone={status === "ACCEPTED" ? "green" : status === "OPEN" ? "blue" : "gray"}>{t(status)}</Badge></Td>
                      <Td>{status === "OPEN" && <Button size="sm" variant="ghost" onClick={() => void run(() => call("POST", `/api/admin/invites/${i.id}/revoke`), "Invitation revoked")}>{t("Revoke")}</Button>}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {tab === "Hotels" && p.canHotels && (
        <>
          <Card title={t("New hotel in your company")}>
            <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => call("POST", "/api/admin/hotels", { code: val(f, "code"), name: val(f, "name"), totalRooms: val(f, "rooms") || 0, baseCurrency: val(f, "cur") || "TRY", withDefaults: f.get("defaults") === "on", locale }), "Hotel created - switch to it from the hotel selector", e.currentTarget); }}>
              <div><Label htmlFor="h-code">{t("Code")}</Label><Input id="h-code" name="code" required pattern="[A-Z0-9][A-Z0-9_-]*" placeholder="AYT2" /></div>
              <div><Label htmlFor="h-name">{t("Name")}</Label><Input id="h-name" name="name" required /></div>
              <div><Label htmlFor="h-rooms">{t("Rooms")}</Label><Input id="h-rooms" name="rooms" type="number" min={0} defaultValue={0} /></div>
              <div><Label htmlFor="h-cur">{t("Currency")}</Label><Input id="h-cur" name="cur" defaultValue="TRY" maxLength={3} /></div>
              <label className="flex items-center gap-2 text-sm md:col-span-4"><input type="checkbox" name="defaults" defaultChecked /> {t("Create standard departments, cost centers, warehouses and categories")}</label>
              <div className="md:col-span-4"><Button type="submit">{t("Create hotel")}</Button></div>
            </form>
          </Card>
          <Card title={t("Hotels you administer")} padded={false}>
            <Table label={t("Hotels")}>
              <thead><tr><Th>{t("Code")}</Th><Th>{t("Name")}</Th><Th>{t("Status")}</Th><Th /></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {p.hotels.map((h) => (
                  <tr key={h.id}>
                    <Td className="font-mono">{h.code}</Td><Td>{h.name}{h.id === p.currentHotelId && ` (${t("current")})`}</Td>
                    <Td><Badge tone={h.active ? "green" : "red"}>{h.active ? t("ACTIVE") : t("SUSPENDED")}</Badge></Td>
                    <Td>{h.id !== p.currentHotelId && <Button size="sm" variant={h.active ? "danger" : "secondary"} onClick={() => void run(() => call("PATCH", `/api/admin/hotels/${h.id}`, { active: !h.active }), h.active ? "Hotel suspended" : "Hotel reactivated")}>{h.active ? t("Suspend") : t("Reactivate")}</Button>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {tab === "Departments" && (
        <>
          <Card title={t("New department (its cost center is created with it)")}>
            <form className="grid gap-3 md:grid-cols-6" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => call("POST", "/api/admin/departments", { code: val(f, "code").toUpperCase(), name: val(f, "name"), isOutlet: f.get("outlet") === "on", parentId: val(f, "parent") || null, sqm: val(f, "sqm") || null, headcount: val(f, "hc") || null }), "Department created", e.currentTarget); }}>
              <div><Label htmlFor="d-code">{t("Code")}</Label><Input id="d-code" name="code" required /></div>
              <div><Label htmlFor="d-name">{t("Name")}</Label><Input id="d-name" name="name" required /></div>
              <div><Label htmlFor="d-parent">{t("Parent")}</Label><Select id="d-parent" name="parent" defaultValue=""><option value="">-</option>{p.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
              <div><Label htmlFor="d-sqm">{t("Area m²")}</Label><Input id="d-sqm" name="sqm" inputMode="decimal" /></div>
              <div><Label htmlFor="d-hc">{t("Headcount")}</Label><Input id="d-hc" name="hc" type="number" min={0} /></div>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="outlet" /> {t("Revenue outlet")}</label>
              <div className="md:col-span-6"><Button type="submit">{t("Create department")}</Button></div>
            </form>
          </Card>
          <Card title={t("Departments")} padded={false}>
            <Table label={t("Departments")}>
              <thead><tr><Th>{t("Code")}</Th><Th>{t("Name")}</Th><Th>{t("Parent")}</Th><Th>{t("Outlet")}</Th><Th align="right">{t("m²")}</Th><Th align="right">{t("Headcount")}</Th><Th>{t("Status")}</Th><Th /></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {p.departments.map((d) => (
                  <tr key={d.id}>
                    <Td className="font-mono">{d.code}</Td><Td>{d.name}</Td><Td>{d.parentId ? deptName.get(d.parentId) : "-"}</Td><Td>{d.isOutlet ? t("yes") : ""}</Td>
                    <Td align="right">{d.sqm ?? "-"}</Td><Td align="right">{d.headcount ?? "-"}</Td>
                    <Td><Badge tone={d.active ? "green" : "gray"}>{d.active ? t("ACTIVE") : t("INACTIVE")}</Badge></Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => void run(() => call("PATCH", `/api/admin/departments/${d.id}`, { active: !d.active }), "Department updated")}>{d.active ? t("Deactivate") : t("Activate")}</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {tab === "Warehouses" && (
        <>
          <Card title={t("New warehouse / store")}>
            <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => call("POST", "/api/admin/warehouses", { code: val(f, "code").toUpperCase(), name: val(f, "name"), departmentId: val(f, "dept") || null }), "Warehouse created", e.currentTarget); }}>
              <div><Label htmlFor="w-code">{t("Code")}</Label><Input id="w-code" name="code" required /></div>
              <div><Label htmlFor="w-name">{t("Name")}</Label><Input id="w-name" name="name" required /></div>
              <div><Label htmlFor="w-dept">{t("Department")}</Label><Select id="w-dept" name="dept" defaultValue=""><option value="">{t("Shared (no department)")}</option>{p.departments.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
              <div className="flex items-end"><Button type="submit">{t("Create warehouse")}</Button></div>
            </form>
          </Card>
          <Card title={t("Warehouses")} padded={false}>
            <Table label={t("Warehouses")}>
              <thead><tr><Th>{t("Code")}</Th><Th>{t("Name")}</Th><Th>{t("Department")}</Th><Th>{t("Status")}</Th><Th /></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {p.warehouses.map((w) => (
                  <tr key={w.id}>
                    <Td className="font-mono">{w.code}</Td><Td>{w.name}</Td><Td>{w.department ?? t("Shared")}</Td>
                    <Td><Badge tone={w.active ? "green" : "gray"}>{w.active ? t("ACTIVE") : t("INACTIVE")}</Badge></Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => void run(() => call("PATCH", `/api/admin/warehouses/${w.id}`, { active: !w.active }), "Warehouse updated")}>{w.active ? t("Deactivate") : t("Activate")}</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {tab === "Categories" && (
        <>
          <Card title={t("New product category")}>
            <form className="grid gap-3 md:grid-cols-5" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => call("POST", "/api/admin/categories", { code: val(f, "code").toUpperCase(), name: val(f, "name"), group: val(f, "group"), parentId: val(f, "parent") || null }), "Category created", e.currentTarget); }}>
              <div><Label htmlFor="c-code">{t("Code")}</Label><Input id="c-code" name="code" required /></div>
              <div><Label htmlFor="c-name">{t("Name")}</Label><Input id="c-name" name="name" required /></div>
              <div><Label htmlFor="c-group">{t("Report group")}</Label><Select id="c-group" name="group">{p.groups.map((g) => <option key={g} value={g}>{t(g)}</option>)}</Select></div>
              <div><Label htmlFor="c-parent">{t("Parent")}</Label><Select id="c-parent" name="parent" defaultValue=""><option value="">{t("- (top level)")}</option>{p.categories.filter((c) => !c.parentId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
              <div className="flex items-end"><Button type="submit">{t("Create category")}</Button></div>
            </form>
          </Card>
          <Card title={t("Categories ({count})", { count: p.categories.length })} padded={false}>
            <Table label={t("Categories")}>
              <thead><tr><Th>{t("Group")}</Th><Th>{t("Code")}</Th><Th>{t("Name")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">{p.categories.map((c) => <tr key={c.id}><Td>{t(c.group)}</Td><Td className="font-mono">{c.code}</Td><Td>{c.parentId ? `↳ ${c.name}` : <strong>{c.name}</strong>}</Td></tr>)}</tbody>
            </Table>
          </Card>
        </>
      )}

      {tab === "Hotel settings" && (
        <Card title={t("Hotel settings (thresholds drive alerts and approvals)")}>
          <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => call("PUT", "/api/admin/hotel", { ...Object.fromEntries(["name", "totalRooms", "baseCurrency", "timezone", "priceAlertPct", "wasteApprovalValue", "adjustmentApprovalValue", "marginTargetPct", "businessDayCutoff"].map((k) => [k, val(f, k)])), autoDeductSales: f.get("autoDeductSales") === "on" }), "Settings saved"); }}>
            <div><Label htmlFor="s-name">{t("Hotel name")}</Label><Input id="s-name" name="name" defaultValue={String(p.hotel.name)} required /></div>
            <div><Label htmlFor="s-rooms">{t("Rooms")}</Label><Input id="s-rooms" name="totalRooms" type="number" min={0} defaultValue={String(p.hotel.totalRooms)} /></div>
            <div><Label htmlFor="s-cur">{t("Base currency")}</Label><Input id="s-cur" name="baseCurrency" maxLength={3} defaultValue={String(p.hotel.baseCurrency)} /></div>
            <div><Label htmlFor="s-tz">{t("Timezone")}</Label><Input id="s-tz" name="timezone" defaultValue={String(p.hotel.timezone)} /></div>
            <div><Label htmlFor="s-pa">{t("Price alert %")}</Label><Input id="s-pa" name="priceAlertPct" inputMode="decimal" defaultValue={String(p.hotel.priceAlertPct)} /></div>
            <div><Label htmlFor="s-wa">{t("Waste approval above")}</Label><Input id="s-wa" name="wasteApprovalValue" inputMode="decimal" defaultValue={String(p.hotel.wasteApprovalValue)} /></div>
            <div><Label htmlFor="s-aa">{t("Adjustment approval above")}</Label><Input id="s-aa" name="adjustmentApprovalValue" inputMode="decimal" defaultValue={String(p.hotel.adjustmentApprovalValue)} /></div>
            <div><Label htmlFor="s-mt">{t("Margin target %")}</Label><Input id="s-mt" name="marginTargetPct" inputMode="decimal" defaultValue={String(p.hotel.marginTargetPct)} /></div>
            <div><Label htmlFor="s-bd" hint={t("night audit")}>{t("Business day ends at")}</Label><Input id="s-bd" name="businessDayCutoff" type="time" defaultValue={String(p.hotel.businessDayCutoff ?? "03:30")} /></div>
            <label className="flex items-center gap-2 text-sm text-ink-700 md:col-span-3"><input type="checkbox" name="autoDeductSales" defaultChecked={Number(p.hotel.autoDeductSales ?? 1) === 1} />{t("Deduct sold dishes' recipe ingredients from stock automatically (Micros sales)")}</label>
            <div className="md:col-span-4"><Button type="submit">{t("Save settings")}</Button></div>
          </form>
        </Card>
      )}
    </div>
  );
}
