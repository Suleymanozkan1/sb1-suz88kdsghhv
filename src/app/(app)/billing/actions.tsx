"use client";

import { Alert, Button, Input, Label } from "@/components/ui";
import { call } from "@/lib/client";
import { useRun } from "@/lib/use-run";
import { useT } from "@/i18n/client";

export function PlanRequestButton({ plan, label, disabled }: { plan: string; label: string; disabled: boolean }) {
  const t = useT();
  const { msg, busy, run } = useRun();
  return (
    <div className="space-y-1">
      <Button size="sm" variant="secondary" disabled={disabled || busy} onClick={() => void run(() => call("POST", "/api/billing/request", { plan }), t("Request sent: the operator will contact you"))}>{label}</Button>
      {msg && <p className={msg.tone === "red" ? "text-xs text-red-700" : "text-xs text-brand-700"}>{msg.text}</p>}
    </div>
  );
}

export function BillingProfileForm({ profile }: { profile: { billingName: string; billingTaxId: string; billingAddress: string; billingEmail: string } }) {
  const t = useT();
  const { msg, busy, run } = useRun();
  return (
    <form
      className="grid gap-3 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget).entries());
        void run(() => call("PATCH", "/api/billing", f), t("Saved"));
      }}
    >
      {msg && <div className="md:col-span-2"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div><Label htmlFor="bp-name">{t("Company title")}</Label><Input id="bp-name" name="billingName" defaultValue={profile.billingName} maxLength={200} /></div>
      <div><Label htmlFor="bp-tax">{t("Tax office / number")}</Label><Input id="bp-tax" name="billingTaxId" defaultValue={profile.billingTaxId} maxLength={40} /></div>
      <div className="md:col-span-2"><Label htmlFor="bp-addr">{t("Address")}</Label><Input id="bp-addr" name="billingAddress" defaultValue={profile.billingAddress} maxLength={500} /></div>
      <div><Label htmlFor="bp-mail">{t("Invoice e-mail")}</Label><Input id="bp-mail" name="billingEmail" type="email" defaultValue={profile.billingEmail} maxLength={200} /></div>
      <div className="flex items-end"><Button type="submit" disabled={busy}>{t("Save")}</Button></div>
    </form>
  );
}
