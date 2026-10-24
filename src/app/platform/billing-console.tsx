"use client";
/**
 * Platform operator: list prices, bank details, and each tenant's subscription with its payment notices.
 * Manual billing: issue a notice → the tenant transfers → "Mark paid" with the transfer reference.
 */
import { Alert, Badge, Button, Card, Input, Label, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";
import { useRun } from "@/lib/use-run";
import { useT } from "@/i18n/client";
import { date, money } from "@/lib/format";

type Plan = "BASIC" | "STANDARD" | "PREMIUM";
const PLAN_LABEL: Record<Plan, string> = { BASIC: "Basic plan", STANDARD: "Standard plan", PREMIUM: "Premium plan" };
const STATE_TONE = { TRIAL: "blue", ACTIVE: "green", PAST_DUE: "amber", EXPIRED: "red" } as const;
const STATE_LABEL = { TRIAL: "Free trial", ACTIVE: "Active", PAST_DUE: "Payment overdue", EXPIRED: "Ended (read-only)" } as const;
const INVOICE_TONE = { OPEN: "amber", PAID: "green", VOID: "gray" } as const;

export interface TenantSub {
  id: string;
  name: string;
  plan: Plan;
  isDemo: boolean;
  active: boolean;
  activeHotels: number;
  trialEndsAt: string | null;
  paidThrough: string | null;
  access: { state: keyof typeof STATE_TONE; daysLeft: number | null } | null;
  invoices: Array<{ id: string; number: string; plan: Plan; total: string; currency: string; status: keyof typeof INVOICE_TONE; dueDate: string; periodStart: string; periodEnd: string; paidAt: string | null }>;
  requests: Array<{ id: string; plan: Plan; note: string | null; createdAt: string }>;
}

export function BillingConsole({ prices, settings, tenants }: { prices: Record<Plan, { monthlyPerHotel: string; currency: string }>; settings: { bankName: string; accountName: string; iban: string; taxRate: string; paymentTermDays: number; note: string }; tenants: TenantSub[] }) {
  const t = useT();
  const { msg, busy, run } = useRun();
  const ask = (q: string, d = "") => window.prompt(q, d);

  return (
    <div className="space-y-4">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("List prices (per active hotel / month, VAT excluded)")}>
          <form className="grid grid-cols-2 gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void run(() => call("PUT", "/api/platform/billing/prices", Object.fromEntries(new FormData(e.currentTarget).entries())), t("Prices saved")); }}>
            {(Object.keys(PLAN_LABEL) as Plan[]).map((p) => (
              <div key={p}><Label htmlFor={`price-${p}`}>{t(PLAN_LABEL[p])}</Label><Input id={`price-${p}`} name={p} inputMode="decimal" defaultValue={prices[p].monthlyPerHotel} required /></div>
            ))}
            <div><Label htmlFor="price-cur">{t("Currency")}</Label><Input id="price-cur" name="currency" defaultValue={prices.BASIC.currency} maxLength={3} required /></div>
            <div className="col-span-2 sm:col-span-4"><Button type="submit" disabled={busy}>{t("Save prices")}</Button></div>
          </form>
        </Card>
        <Card title={t("Bank transfer details and terms")}>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void run(() => call("PUT", "/api/platform/billing/settings", Object.fromEntries(new FormData(e.currentTarget).entries())), t("Settings saved")); }}>
            <div><Label htmlFor="bs-bank">{t("Bank")}</Label><Input id="bs-bank" name="bankName" defaultValue={settings.bankName} /></div>
            <div><Label htmlFor="bs-acc">{t("Account name")}</Label><Input id="bs-acc" name="accountName" defaultValue={settings.accountName} /></div>
            <div className="sm:col-span-2"><Label htmlFor="bs-iban">IBAN</Label><Input id="bs-iban" name="iban" defaultValue={settings.iban} className="font-mono" /></div>
            <div><Label htmlFor="bs-vat" hint={t("e.g. 0.20 for 20%")}>{t("VAT rate")}</Label><Input id="bs-vat" name="taxRate" inputMode="decimal" defaultValue={settings.taxRate} /></div>
            <div><Label htmlFor="bs-term">{t("Payment term (days)")}</Label><Input id="bs-term" name="paymentTermDays" type="number" min={0} max={120} defaultValue={settings.paymentTermDays} /></div>
            <div className="sm:col-span-2"><Label htmlFor="bs-note">{t("Note shown to tenants")}</Label><Input id="bs-note" name="note" defaultValue={settings.note} maxLength={500} /></div>
            <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{t("Save")}</Button></div>
          </form>
        </Card>
      </div>

      <Card title={t("Subscriptions")} padded={false}>
        <Table label={t("Subscriptions")}>
          <thead><tr><Th>{t("Tenant")}</Th><Th>{t("Package")}</Th><Th>{t("Status")}</Th><Th>{t("Paid through")}</Th><Th>{t("Payment notices")}</Th><Th /></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {tenants.map((x) => (
              <tr key={x.id} className={x.active ? "" : "text-ink-500"}>
                <Td className="font-medium">{x.name}{x.isDemo && <span className="ml-1"><Badge>{t("demo")}</Badge></span>}<div className="text-xs font-normal text-ink-500">{t("{n} active hotels", { n: x.activeHotels })}</div>
                  {x.requests.map((r) => (
                    <div key={r.id} className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                      <Badge tone="blue">{t("Requests {plan}", { plan: t(PLAN_LABEL[r.plan]) })}</Badge>
                      {r.note && <span className="text-ink-600">“{r.note}”</span>}
                      <button className="text-brand-700 hover:underline" onClick={() => void run(() => call("PATCH", `/api/platform/plan-requests/${r.id}`, { status: "DONE" }), t("Marked done"))}>{t("Done")}</button>
                      <button className="text-red-700 hover:underline" onClick={() => void run(() => call("PATCH", `/api/platform/plan-requests/${r.id}`, { status: "REJECTED" }), t("Rejected"))}>{t("Reject")}</button>
                    </div>
                  ))}
                </Td>
                <Td>{t(PLAN_LABEL[x.plan])}</Td>
                <Td>{x.access ? <><Badge tone={STATE_TONE[x.access.state]}>{t(STATE_LABEL[x.access.state])}</Badge>{x.access.daysLeft !== null && <span className="ml-1 text-xs text-ink-500">{t("{n} days", { n: x.access.daysLeft })}</span>}</> : <span className="text-xs text-ink-500">{t("not billed")}</span>}</Td>
                <Td>{x.paidThrough ? date(x.paidThrough) : "-"}</Td>
                <Td className="text-xs">
                  {x.invoices.length === 0 ? <span className="text-ink-500">-</span> : x.invoices.slice(0, 4).map((i) => (
                    <div key={i.id} className="flex flex-wrap items-center gap-1 py-0.5">
                      <span className="font-mono">{i.number}</span>
                      <span className="tabular-nums">{money(i.total, i.currency)}</span>
                      <Badge tone={INVOICE_TONE[i.status]}>{t(i.status === "OPEN" ? "Awaiting payment" : i.status === "PAID" ? "Paid" : "Voided")}</Badge>
                      {i.status === "OPEN" && (
                        <>
                          <button className="text-brand-700 hover:underline" disabled={busy} onClick={() => { const ref = ask(t("Transfer reference / description for {n}:", { n: i.number })); if (ref) void run(() => call("POST", `/api/platform/invoices/${i.id}/paid`, { paymentRef: ref }), t("Marked paid; the paid period was extended")); }}>{t("Mark paid")}</button>
                          <button className="text-red-700 hover:underline" disabled={busy} onClick={() => { const reason = ask(t("Void {n}. Reason (audited):", { n: i.number })); if (reason) void run(() => call("POST", `/api/platform/invoices/${i.id}/void`, { reason }), t("Voided")); }}>{t("Void")}</button>
                        </>
                      )}
                    </div>
                  ))}
                </Td>
                <Td className="whitespace-nowrap text-right">
                  {!x.isDemo && (
                    <span className="inline-flex flex-col items-end gap-1">
                      <Button size="sm" variant="secondary" disabled={busy || x.invoices.some((i) => i.status === "OPEN")} title={x.invoices.some((i) => i.status === "OPEN") ? t("An open payment notice exists") : undefined} onClick={() => { const m = ask(t("Months to bill for {name} ({plan}):", { name: x.name, plan: t(PLAN_LABEL[x.plan]) }), "1"); if (m) void run(() => call("POST", `/api/platform/tenants/${x.id}/invoices`, { months: m }), t("Payment notice issued")); }}>{t("Issue notice")}</Button>
                      <button className="text-xs text-brand-700 hover:underline" disabled={busy} onClick={() => { const until = ask(t("Access for {name} until (YYYY-MM-DD), without a payment notice:", { name: x.name })); if (!until) return; const reason = ask(t("Reason (audited):")); if (reason) void run(() => call("POST", `/api/platform/tenants/${x.id}/grant`, { until, reason }), t("Access granted")); }}>{t("Grant access")}</button>
                      <button className="text-xs text-brand-700 hover:underline" disabled={busy} onClick={() => { const days = ask(t("Extra trial days for {name}:", { name: x.name }), "14"); if (!days) return; const reason = ask(t("Reason (audited):")); if (reason) void run(() => call("POST", `/api/platform/tenants/${x.id}/trial`, { days, reason }), t("Trial extended")); }}>{t("Extend trial")}</button>
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
