import { Check } from "lucide-react";
import { pageContext, guarded, requirePageAccess } from "@/server/page";
import { billingOverview } from "@/server/services/billing";
import { prisma } from "@/server/db";
import { PLANS } from "@/server/plans";
import { Alert, Badge, Card, Empty, PageHeader, Table, Td, Th, cn } from "@/components/ui";
import { PLAN_LABEL } from "@/components/feature-gate";
import { date, money } from "@/lib/format";
import { getT } from "@/i18n/server";
import { BillingProfileForm, PlanRequestButton } from "./actions";

export const metadata = { title: "Subscription" };

const STATE_TONE = { TRIAL: "blue", ACTIVE: "green", PAST_DUE: "amber", EXPIRED: "red" } as const;
const STATE_LABEL = { TRIAL: "Free trial", ACTIVE: "Active", PAST_DUE: "Payment overdue", EXPIRED: "Ended (read-only)" } as const;
const INVOICE_TONE = { OPEN: "amber", PAID: "green", VOID: "gray" } as const;
const INVOICE_LABEL = { OPEN: "Awaiting payment", PAID: "Paid", VOID: "Voided" } as const;

export default async function BillingPage() {
  const t = await getT();
  const { actor, hotelId } = await pageContext();
  requirePageAccess(actor, "admin:users", hotelId);
  const res = await guarded(() => billingOverview(prisma, actor, hotelId));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const d = res.data;

  if (!d.enabled || d.organization.isDemo) {
    return (
      <>
        <PageHeader title={t("Subscription")} />
        <Empty title={d.organization.isDemo ? t("Demo company: every feature is open") : t("This installation is licensed: every feature is open")}>{t("There is nothing to pay here.")}</Empty>
      </>
    );
  }

  const openRequest = d.requests.find((r) => r.status === "OPEN");
  const a = d.access;
  return (
    <>
      <PageHeader title={t("Subscription")} subtitle={t("Your package, payment notices and the bank details for transfers. Prices are per active hotel per month, VAT excluded.")} />

      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <Card title={t("Status")}>
          {a && <Badge tone={STATE_TONE[a.state]}>{t(STATE_LABEL[a.state])}</Badge>}
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-ink-500">{t("Package")}</dt><dd className="font-medium">{t(PLAN_LABEL[d.plan])}{d.effectivePlan !== d.plan && <span className="text-ink-500"> · {t("all features open during the trial")}</span>}</dd></div>
            {a?.state === "TRIAL" && <div className="flex justify-between gap-2"><dt className="text-ink-500">{t("Trial ends")}</dt><dd>{date(d.trialEndsAt)} ({t("{n} days", { n: a.daysLeft ?? 0 })})</dd></div>}
            {d.paidThrough && <div className="flex justify-between gap-2"><dt className="text-ink-500">{t("Paid through")}</dt><dd>{date(d.paidThrough)}</dd></div>}
            <div className="flex justify-between gap-2"><dt className="text-ink-500">{t("Active hotels")}</dt><dd>{d.organization.activeHotels}</dd></div>
          </dl>
        </Card>
        <Card title={t("To pay")} className="md:col-span-2">
          {d.bank ? (
            <div className="space-y-2 text-sm">
              <p className="text-2xl font-semibold tabular-nums">{money(d.openTotal, d.invoices.find((i) => i.status === "OPEN")?.currency ?? "TRY")}</p>
              <p className="text-ink-600">{t("Pay by bank transfer and write the payment notice number in the description. The operator confirms the payment and your period is extended.")}</p>
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <div><dt className="text-xs text-ink-500">{t("Bank")}</dt><dd>{d.bank.bankName || "-"}</dd></div>
                <div><dt className="text-xs text-ink-500">{t("Account name")}</dt><dd>{d.bank.accountName || "-"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs text-ink-500">IBAN</dt><dd className="font-mono tabular-nums tracking-wide">{d.bank.iban.replace(/(.{4})/g, "$1 ").trim()}</dd></div>
              </dl>
              {d.bank.note && <p className="text-ink-600">{d.bank.note}</p>}
            </div>
          ) : (
            <p className="text-sm text-ink-600">{d.invoices.some((i) => i.status === "OPEN") ? t("The operator has not entered the bank details yet. Please contact them.") : t("Nothing to pay right now.")}</p>
          )}
        </Card>
      </div>

      <Card title={t("Packages")} className="mb-4" padded={false}>
        <div className="grid gap-px bg-ink-100 md:grid-cols-3">
          {PLANS.map((p) => {
            const current = p === d.plan;
            return (
              <div key={p} className={cn("flex flex-col bg-white p-4", current && "ring-2 ring-inset ring-brand-500")}>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{t(PLAN_LABEL[p])}</h3>
                  {current && <Badge tone="green">{t("Your package")}</Badge>}
                </div>
                <p className="mt-1 text-lg font-semibold tabular-nums">{money(d.prices[p].monthlyPerHotel, d.prices[p].currency, 0)}<span className="text-sm font-normal text-ink-500"> / {t("hotel / month")}</span></p>
                <ul className="mt-3 flex-1 space-y-1 text-sm">
                  {p === "BASIC" && <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />{t("Purchasing, stock, counts, recipes, waste, sales, theoretical vs actual, reports")}</li>}
                  {d.features[p].filter((f) => f.from === p && f.key !== "reorderAlerts").map((f) => (
                    <li key={f.key} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />{t(f.label)}</li>
                  ))}
                  {p !== "BASIC" && <li className="text-xs text-ink-500">{t("+ everything in {plan}", { plan: t(PLAN_LABEL[PLANS[PLANS.indexOf(p) - 1]!]) })}</li>}
                </ul>
                {!current && <div className="mt-3"><PlanRequestButton plan={p} label={t("Request {plan}", { plan: t(PLAN_LABEL[p]) })} disabled={!!openRequest} /></div>}
              </div>
            );
          })}
        </div>
        {openRequest && <p className="border-t border-ink-100 px-4 py-2 text-sm text-ink-600">{t("Your request for {plan} ({date}) is waiting for the operator.", { plan: t(PLAN_LABEL[openRequest.plan]), date: date(openRequest.createdAt) })}</p>}
      </Card>

      <Card title={t("Payment notices")} className="mb-4" padded={false}>
        {d.invoices.length === 0 ? <div className="p-4"><Empty title={t("No payment notices yet")} /></div> : (
          <Table label={t("Payment notices")}>
            <thead><tr><Th>{t("Number")}</Th><Th>{t("Period")}</Th><Th>{t("Package")}</Th><Th align="right">{t("Hotels")}</Th><Th align="right">{t("Total incl. VAT")}</Th><Th>{t("Due")}</Th><Th>{t("Status")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {d.invoices.map((i) => (
                <tr key={i.id}>
                  <Td className="font-mono">{i.number}</Td>
                  <Td>{date(i.periodStart)} – {date(i.periodEnd)}</Td>
                  <Td>{t(PLAN_LABEL[i.plan])}</Td>
                  <Td align="right">{i.hotelCount}</Td>
                  <Td align="right" className="tabular-nums">{money(i.total.toString(), i.currency)}</Td>
                  <Td>{date(i.dueDate)}</Td>
                  <Td><Badge tone={INVOICE_TONE[i.status]}>{t(INVOICE_LABEL[i.status])}</Badge>{i.status === "PAID" && i.paidAt && <span className="ml-1 text-xs text-ink-500">{date(i.paidAt)}</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="border-t border-ink-100 px-4 py-2 text-xs text-ink-500">{t("Payment notices are not tax invoices; the legal invoice is issued by the operator's accounting.")}</p>
      </Card>

      <Card title={t("Invoice recipient")}>
        <BillingProfileForm profile={d.profile} />
      </Card>
    </>
  );
}
