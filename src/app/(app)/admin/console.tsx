"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, Input, Label, Select, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";

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
  const [tab, setTab] = useState<Tab>("Users");
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [edit, setEdit] = useState<User | null>(null);
  const [roleKey, setRoleKey] = useState(p.roles.find((r) => r.key === "viewer")?.key ?? p.roles[0]?.key ?? "");
  const deptName = new Map(p.departments.map((d) => [d.id, d.name]));
  const roleOf = (k: string) => p.roles.find((r) => r.key === k);

  async function run(fn: () => Promise<unknown>, ok: string, form?: HTMLFormElement) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "green", text: ok });
      form?.reset();
      router.refresh();
      return true;
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Failed" });
      return false;
    }
  }

  const deptPicker = (name: string, selected: string[] = []) => (
    <fieldset className="md:col-span-4">
      <legend className="mb-1 text-sm font-medium text-ink-700">Departments (for department-scoped roles)</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {p.departments.filter((d) => d.active).map((d) => (
          <label key={d.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name={name} value={d.id} defaultChecked={selected.includes(d.id)} /> {d.name}</label>
        ))}
      </div>
    </fieldset>
  );
  const hotelPicker = (name: string, selected: string[]) => (
    <fieldset className="md:col-span-4">
      <legend className="mb-1 text-sm font-medium text-ink-700">Hotels</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {p.hotels.map((h) => (
          <label key={h.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name={name} value={h.id} defaultChecked={selected.includes(h.id)} /> {h.name}</label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Administration sections" className="flex flex-wrap gap-1">
        {TABS.filter((t) => t !== "Hotels" || p.canHotels).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setMsg(null); setLink(null); }} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-brand-600 text-white" : "bg-white text-ink-700 ring-1 ring-ink-200 hover:bg-ink-50"}`}>{t}</button>
        ))}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {tab === "Users" && (
        <>
          <Card title="Add user">
            <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => call("POST", "/api/admin/users", { email: val(f, "email"), name: val(f, "name"), password: val(f, "password"), roleKey: val(f, "roleKey"), departmentIds: multi(f, "dept"), hotelIds: multi(f, "hotel") }), "User created", e.currentTarget); }}>
              <div><Label htmlFor="u-name">Name</Label><Input id="u-name" name="name" required /></div>
              <div><Label htmlFor="u-email">E-mail</Label><Input id="u-email" name="email" type="email" required /></div>
              <div><Label htmlFor="u-pw" hint="min 10">Initial password</Label><Input id="u-pw" name="password" type="password" required minLength={10} autoComplete="new-password" /></div>
              <div><Label htmlFor="u-role">Role</Label><Select id="u-role" name="roleKey" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>{p.roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</Select></div>
              {hotelPicker("hotel", [p.currentHotelId])}
              {!roleOf(roleKey)?.allDepartments && deptPicker("dept")}
              <div className="md:col-span-4"><Button type="submit">Create user</Button></div>
            </form>
          </Card>
          <Card title={`Users of this hotel (${p.users.length})`} padded={false}>
            <Table label="Users">
              <thead><tr><Th>Name</Th><Th>E-mail</Th><Th>Role</Th><Th>Departments</Th><Th>Hotels</Th><Th>Status</Th><Th /></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {p.users.map((u) => (
                  <tr key={u.id}>
                    <Td className="font-medium">{u.name}</Td><Td>{u.email}</Td><Td>{u.roleName}</Td>
                    <Td className="max-w-xs truncate">{u.allDepartments ? "All" : u.departmentIds.map((d) => deptName.get(d) ?? "other hotel").join(", ")}</Td>
                    <Td>{u.hotelIds.length}</Td>
                    <Td><Badge tone={u.active ? "green" : "gray"}>{u.active ? "ACTIVE" : "INACTIVE"}</Badge></Td>
                    <Td><Button size="sm" variant="secondary" onClick={() => setEdit(u)}>Edit</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          {edit && (
            <Card title={`Edit ${edit.name}`}>
              <form className="grid gap-3 md:grid-cols-4" onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const role = roleOf(val(f, "roleKey"));
                const body: Record<string, unknown> = { name: val(f, "name"), roleKey: val(f, "roleKey"), active: f.get("active") === "on", hotelIds: multi(f, "hotel") };
                if (!role?.allDepartments) body.departmentIds = multi(f, "dept");
                if (val(f, "password")) body.password = val(f, "password");
                if (await run(() => call("PATCH", `/api/admin/users/${edit.id}`, body), "User updated - open sessions were ended where access changed")) setEdit(null);
              }}>
                <div><Label htmlFor="e-name">Name</Label><Input id="e-name" name="name" defaultValue={edit.name} required /></div>
                <div><Label htmlFor="e-role">Role</Label><Select id="e-role" name="roleKey" defaultValue={edit.roleKey} disabled={edit.id === p.me}>{p.roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</Select>{edit.id === p.me && <input type="hidden" name="roleKey" value={edit.roleKey} />}</div>
                <div><Label htmlFor="e-pw" hint="leave empty to keep">Reset password</Label><Input id="e-pw" name="password" type="password" minLength={10} autoComplete="new-password" /></div>
                <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={edit.active} disabled={edit.id === p.me} /> Active{edit.id === p.me && <input type="hidden" name="active" value="on" />}</label>
                {hotelPicker("hotel", edit.hotelIds)}
                {!edit.allDepartments && deptPicker("dept", edit.departmentIds)}
                <div className="flex gap-2 md:col-span-4"><Button type="submit">Save</Button><Button type="button" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
              </form>
            </Card>
          )}
        </>
      )}

      {tab === "Invitations" && (
        <>
          <Card title="Invite a user">
            <form className="grid gap-3 md:grid-cols-4" onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setLink(null);
              let token = "";
              const ok = await run(async () => { token = (await call<{ token: string }>("POST", "/api/admin/invites", { email: val(f, "email"), name: val(f, "name") || undefined, roleKey: val(f, "roleKey"), hotelIds: multi(f, "hotel"), departmentIds: multi(f, "dept") })).token; }, "Invitation created - send this link (valid 7 days, shown once)", e.currentTarget);
              if (ok) setLink(`${window.location.origin}/invite?token=${token}`);
            }}>
              <div><Label htmlFor="v-name">Name (optional)</Label><Input id="v-name" name="name" /></div>
              <div><Label htmlFor="v-email">E-mail</Label><Input id="v-email" name="email" type="email" required /></div>
              <div><Label htmlFor="v-role">Role</Label><Select id="v-role" name="roleKey" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>{p.roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</Select></div>
              {hotelPicker("hotel", [p.currentHotelId])}
              {!roleOf(roleKey)?.allDepartments && deptPicker("dept")}
              <div className="md:col-span-4"><Button type="submit">Create invitation</Button></div>
            </form>
            {link && <code className="mt-3 block break-all rounded-lg bg-ink-950 p-3 font-mono text-xs text-brand-200" data-testid="invite-link">{link}</code>}
          </Card>
          <Card title="Invitations" padded={false}>
            <Table label="Invitations">
              <thead><tr><Th>E-mail</Th><Th>Role</Th><Th>Created</Th><Th>Status</Th><Th /></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {p.invites.map((i) => {
                  const status = i.acceptedAt ? "ACCEPTED" : i.revokedAt ? "REVOKED" : new Date(i.expiresAt) < new Date() ? "EXPIRED" : "OPEN";
                  return (
                    <tr key={i.id}>
                      <Td>{i.email}</Td><Td>{roleOf(i.roleKey)?.name ?? i.roleKey}</Td><Td>{i.createdAt.slice(0, 10)}</Td>
                      <Td><Badge tone={status === "ACCEPTED" ? "green" : status === "OPEN" ? "blue" : "gray"}>{status}</Badge></Td>
                      <Td>{status === "OPEN" && <Button size="sm" variant="ghost" onClick={() => void run(() => call("POST", `/api/admin/invites/${i.id}/revoke`), "Invitation revoked")}>Revoke</Button>}</Td>
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
          <Card title="New hotel in your company">
            <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => call("POST", "/api/admin/hotels", { code: val(f, "code"), name: val(f, "name"), totalRooms: val(f, "rooms") || 0, baseCurrency: val(f, "cur") || "TRY", withDefaults: f.get("defaults") === "on" }), "Hotel created - switch to it from the hotel selector", e.currentTarget); }}>
              <div><Label htmlFor="h-code">Code</Label><Input id="h-code" name="code" required pattern="[A-Z0-9][A-Z0-9_-]*" placeholder="AYT2" /></div>
              <div><Label htmlFor="h-name">Name</Label><Input id="h-name" name="name" required /></div>
              <div><Label htmlFor="h-rooms">Rooms</Label><Input id="h-rooms" name="rooms" type="number" min={0} defaultValue={0} /></div>
              <div><Label htmlFor="h-cur">Currency</Label><Input id="h-cur" name="cur" defaultValue="TRY" maxLength={3} /></div>
              <label className="flex items-center gap-2 text-sm md:col-span-4"><input type="checkbox" name="defaults" defaultChecked /> Create standard departments, cost centers, warehouses and categories</label>
              <div className="md:col-span-4"><Button type="submit">Create hotel</Button></div>
            </form>
          </Card>
          <Card title="Hotels you administer" padded={false}>
            <Table label="Hotels">
              <thead><tr><Th>Code</Th><Th>Name</Th><Th>Status</Th><Th /></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {p.hotels.map((h) => (
                  <tr key={h.id}>
                    <Td className="font-mono">{h.code}</Td><Td>{h.name}{h.id === p.currentHotelId && " (current)"}</Td>
                    <Td><Badge tone={h.active ? "green" : "red"}>{h.active ? "ACTIVE" : "SUSPENDED"}</Badge></Td>
                    <Td>{h.id !== p.currentHotelId && <Button size="sm" variant={h.active ? "danger" : "secondary"} onClick={() => void run(() => call("PATCH", `/api/admin/hotels/${h.id}`, { active: !h.active }), h.active ? "Hotel suspended" : "Hotel reactivated")}>{h.active ? "Suspend" : "Reactivate"}</Button>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {tab === "Departments" && (
        <>
          <Card title="New department (its cost center is created with it)">
            <form className="grid gap-3 md:grid-cols-6" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => call("POST", "/api/admin/departments", { code: val(f, "code").toUpperCase(), name: val(f, "name"), isOutlet: f.get("outlet") === "on", parentId: val(f, "parent") || null, sqm: val(f, "sqm") || null, headcount: val(f, "hc") || null }), "Department created", e.currentTarget); }}>
              <div><Label htmlFor="d-code">Code</Label><Input id="d-code" name="code" required /></div>
              <div><Label htmlFor="d-name">Name</Label><Input id="d-name" name="name" required /></div>
              <div><Label htmlFor="d-parent">Parent</Label><Select id="d-parent" name="parent" defaultValue=""><option value="">-</option>{p.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
              <div><Label htmlFor="d-sqm">Area m²</Label><Input id="d-sqm" name="sqm" type="number" min={0} step="any" /></div>
              <div><Label htmlFor="d-hc">Headcount</Label><Input id="d-hc" name="hc" type="number" min={0} /></div>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="outlet" /> Revenue outlet</label>
              <div className="md:col-span-6"><Button type="submit">Create department</Button></div>
            </form>
          </Card>
          <Card title="Departments" padded={false}>
            <Table label="Departments">
              <thead><tr><Th>Code</Th><Th>Name</Th><Th>Parent</Th><Th>Outlet</Th><Th align="right">m²</Th><Th align="right">Headcount</Th><Th>Status</Th><Th /></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {p.departments.map((d) => (
                  <tr key={d.id}>
                    <Td className="font-mono">{d.code}</Td><Td>{d.name}</Td><Td>{d.parentId ? deptName.get(d.parentId) : "-"}</Td><Td>{d.isOutlet ? "yes" : ""}</Td>
                    <Td align="right">{d.sqm ?? "-"}</Td><Td align="right">{d.headcount ?? "-"}</Td>
                    <Td><Badge tone={d.active ? "green" : "gray"}>{d.active ? "ACTIVE" : "INACTIVE"}</Badge></Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => void run(() => call("PATCH", `/api/admin/departments/${d.id}`, { active: !d.active }), "Department updated")}>{d.active ? "Deactivate" : "Activate"}</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {tab === "Warehouses" && (
        <>
          <Card title="New warehouse / store">
            <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => call("POST", "/api/admin/warehouses", { code: val(f, "code").toUpperCase(), name: val(f, "name"), departmentId: val(f, "dept") || null }), "Warehouse created", e.currentTarget); }}>
              <div><Label htmlFor="w-code">Code</Label><Input id="w-code" name="code" required /></div>
              <div><Label htmlFor="w-name">Name</Label><Input id="w-name" name="name" required /></div>
              <div><Label htmlFor="w-dept">Department</Label><Select id="w-dept" name="dept" defaultValue=""><option value="">Shared (no department)</option>{p.departments.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
              <div className="flex items-end"><Button type="submit">Create warehouse</Button></div>
            </form>
          </Card>
          <Card title="Warehouses" padded={false}>
            <Table label="Warehouses">
              <thead><tr><Th>Code</Th><Th>Name</Th><Th>Department</Th><Th>Status</Th><Th /></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {p.warehouses.map((w) => (
                  <tr key={w.id}>
                    <Td className="font-mono">{w.code}</Td><Td>{w.name}</Td><Td>{w.department ?? "Shared"}</Td>
                    <Td><Badge tone={w.active ? "green" : "gray"}>{w.active ? "ACTIVE" : "INACTIVE"}</Badge></Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => void run(() => call("PATCH", `/api/admin/warehouses/${w.id}`, { active: !w.active }), "Warehouse updated")}>{w.active ? "Deactivate" : "Activate"}</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {tab === "Categories" && (
        <>
          <Card title="New product category">
            <form className="grid gap-3 md:grid-cols-5" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => call("POST", "/api/admin/categories", { code: val(f, "code").toUpperCase(), name: val(f, "name"), group: val(f, "group"), parentId: val(f, "parent") || null }), "Category created", e.currentTarget); }}>
              <div><Label htmlFor="c-code">Code</Label><Input id="c-code" name="code" required /></div>
              <div><Label htmlFor="c-name">Name</Label><Input id="c-name" name="name" required /></div>
              <div><Label htmlFor="c-group">Report group</Label><Select id="c-group" name="group">{p.groups.map((g) => <option key={g}>{g}</option>)}</Select></div>
              <div><Label htmlFor="c-parent">Parent</Label><Select id="c-parent" name="parent" defaultValue=""><option value="">- (top level)</option>{p.categories.filter((c) => !c.parentId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
              <div className="flex items-end"><Button type="submit">Create category</Button></div>
            </form>
          </Card>
          <Card title={`Categories (${p.categories.length})`} padded={false}>
            <Table label="Categories">
              <thead><tr><Th>Group</Th><Th>Code</Th><Th>Name</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">{p.categories.map((c) => <tr key={c.id}><Td>{c.group}</Td><Td className="font-mono">{c.code}</Td><Td>{c.parentId ? `↳ ${c.name}` : <strong>{c.name}</strong>}</Td></tr>)}</tbody>
            </Table>
          </Card>
        </>
      )}

      {tab === "Hotel settings" && (
        <Card title="Hotel settings (thresholds drive alerts and approvals)">
          <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => call("PUT", "/api/admin/hotel", Object.fromEntries(["name", "totalRooms", "baseCurrency", "timezone", "priceAlertPct", "wasteApprovalValue", "adjustmentApprovalValue", "marginTargetPct"].map((k) => [k, val(f, k)]))), "Settings saved"); }}>
            <div><Label htmlFor="s-name">Hotel name</Label><Input id="s-name" name="name" defaultValue={String(p.hotel.name)} required /></div>
            <div><Label htmlFor="s-rooms">Rooms</Label><Input id="s-rooms" name="totalRooms" type="number" min={0} defaultValue={String(p.hotel.totalRooms)} /></div>
            <div><Label htmlFor="s-cur">Base currency</Label><Input id="s-cur" name="baseCurrency" maxLength={3} defaultValue={String(p.hotel.baseCurrency)} /></div>
            <div><Label htmlFor="s-tz">Timezone</Label><Input id="s-tz" name="timezone" defaultValue={String(p.hotel.timezone)} /></div>
            <div><Label htmlFor="s-pa">Price alert %</Label><Input id="s-pa" name="priceAlertPct" type="number" step="any" min={0} defaultValue={String(p.hotel.priceAlertPct)} /></div>
            <div><Label htmlFor="s-wa">Waste approval above</Label><Input id="s-wa" name="wasteApprovalValue" type="number" step="any" min={0} defaultValue={String(p.hotel.wasteApprovalValue)} /></div>
            <div><Label htmlFor="s-aa">Adjustment approval above</Label><Input id="s-aa" name="adjustmentApprovalValue" type="number" step="any" min={0} defaultValue={String(p.hotel.adjustmentApprovalValue)} /></div>
            <div><Label htmlFor="s-mt">Margin target %</Label><Input id="s-mt" name="marginTargetPct" type="number" step="any" min={0} max={100} defaultValue={String(p.hotel.marginTargetPct)} /></div>
            <div className="md:col-span-4"><Button type="submit">Save settings</Button></div>
          </form>
        </Card>
      )}
    </div>
  );
}
