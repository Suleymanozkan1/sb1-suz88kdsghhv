"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, Input, Label, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";

interface Tenant { id: string; name: string; active: boolean; isDemo: boolean; createdAt: string; users: number; hotels: Array<{ id: string; code: string; name: string; active: boolean }> }

export function PlatformConsole({ tenants }: { tenants: Tenant[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setMsg(null); setLink(null);
    try {
      const r = await call<{ inviteToken: string }>("POST", "/api/platform/tenants", Object.fromEntries(["organizationName", "hotelCode", "hotelName", "totalRooms", "baseCurrency", "adminEmail", "adminName"].map((k) => [k, String(f.get(k) ?? "")])));
      setLink(`${window.location.origin}/invite?token=${r.inviteToken}`);
      setMsg({ tone: "green", text: "Tenant created. Send the invitation link to its company administrator (valid 7 days, shown once)." });
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof Error ? err.message : "Failed" });
    } finally { setBusy(false); }
  }

  async function toggle(t: Tenant) {
    const reason = window.prompt(`${t.active ? "Suspend" : "Reactivate"} ${t.name} - reason (audited in the tenant's trail):`);
    if (!reason) return;
    try { await call("PATCH", `/api/platform/tenants/${t.id}`, { active: !t.active, reason }); router.refresh(); }
    catch (err) { setMsg({ tone: "red", text: err instanceof Error ? err.message : "Failed" }); }
  }

  return (
    <div className="space-y-4">
      <Card title="New tenant (company)">
        <form onSubmit={create} className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2"><Label htmlFor="t-org">Company name</Label><Input id="t-org" name="organizationName" required /></div>
          <div><Label htmlFor="t-code">First hotel code</Label><Input id="t-code" name="hotelCode" required pattern="[A-Z0-9][A-Z0-9_-]*" placeholder="IST1" /></div>
          <div><Label htmlFor="t-hotel">First hotel name</Label><Input id="t-hotel" name="hotelName" required /></div>
          <div><Label htmlFor="t-rooms">Rooms</Label><Input id="t-rooms" name="totalRooms" type="number" min={0} defaultValue={0} /></div>
          <div><Label htmlFor="t-cur">Currency</Label><Input id="t-cur" name="baseCurrency" defaultValue="TRY" maxLength={3} /></div>
          <div><Label htmlFor="t-aname">Company administrator</Label><Input id="t-aname" name="adminName" required /></div>
          <div><Label htmlFor="t-amail">Administrator e-mail</Label><Input id="t-amail" name="adminEmail" type="email" required /></div>
          <div className="md:col-span-4"><Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create tenant"}</Button></div>
        </form>
        {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
        {link && <code className="mt-2 block break-all rounded-lg bg-ink-950 p-3 font-mono text-xs text-brand-200" data-testid="invite-link">{link}</code>}
      </Card>
      <Card title={`Tenants (${tenants.length})`} padded={false}>
        <Table label="Tenants">
          <thead><tr><Th>Company</Th><Th>Hotels</Th><Th align="right">Users</Th><Th>Created</Th><Th>Status</Th><Th /></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {tenants.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium">{t.name} {t.isDemo && <Badge tone="blue">demo</Badge>}</Td>
                <Td>{t.hotels.map((h) => `${h.code}${h.active ? "" : " (suspended)"}`).join(", ")}</Td>
                <Td align="right">{t.users}</Td>
                <Td>{t.createdAt.slice(0, 10)}</Td>
                <Td><Badge tone={t.active ? "green" : "red"}>{t.active ? "ACTIVE" : "SUSPENDED"}</Badge></Td>
                <Td><Button size="sm" variant={t.active ? "danger" : "secondary"} onClick={() => void toggle(t)}>{t.active ? "Suspend" : "Reactivate"}</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
