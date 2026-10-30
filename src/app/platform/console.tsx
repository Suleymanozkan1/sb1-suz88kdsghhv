"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, Input, Label, Select, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";
import { date } from "@/lib/format";

export interface Renewal { id: string; name: string; kind: "ENDING" | "ENDED"; state: "TRIAL" | "ACTIVE" | "PAST_DUE" | "EXPIRED"; endsAt: string | null; readOnlyFrom: string | null }

interface Tenant { id: string; name: string; active: boolean; isDemo: boolean; plan: string; createdAt: string; users: number; hotels: Array<{ id: string; code: string; name: string; active: boolean }> }

export function PlatformConsole({ tenants, renewals = [], billingOn = true }: { tenants: Tenant[]; renewals?: Renewal[]; billingOn?: boolean }) {
  const router = useRouter();
  const t = useT();
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
      setMsg({ tone: "green", text: t("Tenant created. Send the invitation link to its company administrator (valid 7 days, shown once).") });
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof Error ? err.message : t("Failed") });
    } finally { setBusy(false); }
  }

  async function toggle(x: Tenant) {
    const reason = window.prompt(t(x.active ? "Suspend {name}. Reason (audited in the tenant's trail):" : "Reactivate {name}. Reason (audited in the tenant's trail):", { name: x.name }));
    if (!reason) return;
    try { await call("PATCH", `/api/platform/tenants/${x.id}`, { active: !x.active, reason }); router.refresh(); }
    catch (err) { setMsg({ tone: "red", text: err instanceof Error ? err.message : t("Failed") }); }
  }

  async function release(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setMsg(null); setLink(null);
    try {
      await call("POST", "/api/platform/email-release", { email: String(f.get("email") ?? ""), reason: String(f.get("reason") ?? "") });
      setMsg({ tone: "green", text: t("The e-mail address is free: its user was deactivated and renamed.") });
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof Error ? err.message : t("Failed") });
    }
  }

  async function setPlan(x: Tenant, plan: string) {
    try { await call("PATCH", `/api/platform/tenants/${x.id}`, { plan }); router.refresh(); }
    catch (err) { setMsg({ tone: "red", text: err instanceof Error ? err.message : t("Failed") }); }
  }

  return (
    <div className="space-y-4">
      {renewals.length > 0 && (
        <div data-testid="renewal-warnings">
          <Alert tone={renewals.some((r) => r.state === "EXPIRED") ? "red" : "amber"}>
            <p className="font-medium">{t("Subscriptions that end within 7 days or have ended ({count})", { count: renewals.length })}</p>
            {!billingOn && <p className="mt-1">{t("Billing enforcement is off on this installation, so no tenant is read-only right now.")}</p>}
            <ul className="mt-1 list-disc pl-5">
              {renewals.map((r) => (
                <li key={r.id}>
                  <span className="font-medium">{r.name}</span>{": "}
                  {r.state === "EXPIRED"
                    ? t("ended on {date}; the tenant is read-only", { date: date(r.endsAt) })
                    : r.state === "PAST_DUE"
                      ? t("paid period ended on {date}; read-only from {readOnly}", { date: date(r.endsAt), readOnly: date(r.readOnlyFrom) })
                      : r.state === "TRIAL"
                        ? t("free trial ends on {date}; read-only from then unless paid", { date: date(r.endsAt) })
                        : t("paid period ends on {date}; read-only from {readOnly} unless renewed", { date: date(r.endsAt), readOnly: date(r.readOnlyFrom) })}
                </li>
              ))}
            </ul>
            <p className="mt-1">{t("Record the payment or extend the trial under Subscriptions below.")}</p>
          </Alert>
        </div>
      )}
      <Card title={t("New tenant (company)")}>
        <form onSubmit={create} className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2"><Label htmlFor="t-org">{t("Company name")}</Label><Input id="t-org" name="organizationName" required /></div>
          <div><Label htmlFor="t-code">{t("First hotel code")}</Label><Input id="t-code" name="hotelCode" required pattern="[A-Z0-9][A-Z0-9_-]*" placeholder="IST1" /></div>
          <div><Label htmlFor="t-hotel">{t("First hotel name")}</Label><Input id="t-hotel" name="hotelName" required /></div>
          <div><Label htmlFor="t-rooms">{t("Rooms")}</Label><Input id="t-rooms" name="totalRooms" type="number" min={0} defaultValue={0} /></div>
          <div><Label htmlFor="t-cur">{t("Currency")}</Label><Input id="t-cur" name="baseCurrency" defaultValue="TRY" maxLength={3} /></div>
          <div><Label htmlFor="t-aname">{t("Company administrator")}</Label><Input id="t-aname" name="adminName" required /></div>
          <div><Label htmlFor="t-amail">{t("Administrator e-mail")}</Label><Input id="t-amail" name="adminEmail" type="email" required /></div>
          <div className="md:col-span-4"><Button type="submit" disabled={busy}>{busy ? t("Creating…") : t("Create tenant")}</Button></div>
        </form>
        {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
        {link && <code className="mt-2 block break-all rounded-lg bg-ink-950 p-3 font-mono text-xs text-brand-200" data-testid="invite-link">{link}</code>}
      </Card>
      <Card title={t("Tenants ({count})", { count: tenants.length })} padded={false}>
        <Table label={t("Tenants")}>
          <thead><tr><Th>{t("Company")}</Th><Th>{t("Hotels")}</Th><Th align="right">{t("Users")}</Th><Th>{t("Plan")}</Th><Th>{t("Created")}</Th><Th>{t("Status")}</Th><Th /></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {tenants.map((x) => (
              <tr key={x.id}>
                <Td className="font-medium">{x.name} {x.isDemo && <Badge tone="blue">{t("demo")}</Badge>}</Td>
                <Td>{x.hotels.map((h) => `${h.code}${h.active ? "" : ` (${t("suspended")})`}`).join(", ")}</Td>
                <Td align="right">{x.users}</Td>
                <Td>
                  <Select aria-label={t("Plan")} className="w-32 py-1" value={x.plan} onChange={(e) => void setPlan(x, e.target.value)}>
                    <option value="BASIC">{t("Basic plan")}</option><option value="STANDARD">{t("Standard plan")}</option><option value="PREMIUM">{t("Premium plan")}</option>
                  </Select>
                </Td>
                <Td>{x.createdAt.slice(0, 10)}</Td>
                <Td><Badge tone={x.active ? "green" : "red"}>{x.active ? t("ACTIVE") : t("SUSPENDED")}</Badge></Td>
                <Td><Button size="sm" variant={x.active ? "danger" : "secondary"} onClick={() => void toggle(x)}>{x.active ? t("Suspend") : t("Reactivate")}</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card title={t("Release a login e-mail")}>
        <p className="mb-3 text-sm text-ink-600">{t("A login e-mail belongs to one user across all companies. If a company took an address that another company needs, release it here: that user is deactivated and renamed (audited in the company's trail).")}</p>
        <form onSubmit={release} className="grid gap-3 md:grid-cols-4">
          <div><Label htmlFor="r-mail">{t("E-mail")}</Label><Input id="r-mail" name="email" type="email" required /></div>
          <div className="md:col-span-2"><Label htmlFor="r-reason">{t("Reason")}</Label><Input id="r-reason" name="reason" required minLength={5} /></div>
          <div className="flex items-end"><Button type="submit" variant="danger">{t("Release")}</Button></div>
        </form>
      </Card>
    </div>
  );
}
