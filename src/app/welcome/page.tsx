/**
 * Public product page. The audit (10/2026) found no shop window at all: "/" went straight to the sign-in form and
 * the value proposition lived only in an engineering README. This page says, in the buyer's terms, what the product
 * finds and why its numbers can be trusted, with the real list prices from the platform console.
 *
 * Nothing on it is invented: no customer logos, testimonials or savings claims. The variance chart is labelled as an
 * example. On a SaaS installation set PUBLIC_LANDING=1 so that visitors without a session land here instead of on
 * the sign-in form (src/middleware.ts); a self-hosted hotel keeps its plain sign-in page.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Check, FileSpreadsheet, Lock, ScrollText, ShieldCheck } from "lucide-react";
import { prisma } from "@/server/db";
import { planPrices } from "@/server/services/billing";
import { FEATURES, FEATURE_LABEL, type Feature } from "@/lib/features";
import { PLANS } from "@/domain/plan";
import { PLAN_LABEL } from "@/components/feature-gate";
import { LanguageSwitch } from "@/components/language-switch";
import { money } from "@/lib/format";
import { getT } from "@/i18n/server";

export const metadata = { title: "Hotel food & beverage cost control", description: "Explains, line by line, the difference between what a hotel bought and what its recipes should have used." };
export const dynamic = "force-dynamic";

/** Illustrative split of one month's variance; shown with an explicit "example" label. */
const EXAMPLE = [
  { label: "Price / timing", share: 31 },
  { label: "Recorded waste", share: 22 },
  { label: "Buffet (per cover)", share: 17 },
  { label: "On-house / Hospitality", share: 9 },
  { label: "Staff meals", share: 7 },
  { label: "Unexplained", share: 14 },
];

export default async function WelcomePage() {
  // a self-hosted installation has no public product page (and no prices to show)
  if (process.env.PUBLIC_LANDING !== "1") redirect("/login");
  const t = await getT();
  const prices = await planPrices(prisma).catch(() => null);
  const priced = prices && PLANS.every((p) => Number(prices[p].monthlyPerHotel) > 0);
  const contact = process.env.PUBLIC_CONTACT_EMAIL?.trim();
  const featuresOf = (p: (typeof PLANS)[number]) => (Object.keys(FEATURES) as Feature[]).filter((f) => FEATURES[f] === p && f !== "reorderAlerts");

  return (
    <div className="min-h-screen bg-white text-ink-900">
      <header className="border-b border-ink-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <span className="flex items-center gap-2 text-lg font-semibold"><Building2 className="h-6 w-6 text-brand-600" aria-hidden /> HotelCost</span>
          <div className="flex items-center gap-3">
            <LanguageSwitch />
            <Link href="/login" className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-50">{t("Sign in")}</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:py-20">
          <div>
            <p className="text-sm font-medium text-brand-700">{t("Cost control for hotel food & beverage")}</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{t("Find the money your kitchen loses every month.")}</h1>
            <p className="mt-5 max-w-xl text-lg text-ink-600">{t("HotelCost compares what you bought with what your recipes should have used, and explains the difference line by line: price, waste, buffet, minibar, on-house, and the part nobody can explain yet.")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              {contact ? <a href={`mailto:${contact}?subject=${encodeURIComponent("HotelCost demo")}`} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">{t("Book a demo")}</a> : null}
              <Link href="/login" className={contact ? "rounded-lg border border-ink-200 px-5 py-2.5 text-sm font-semibold text-ink-800 hover:bg-ink-50" : "rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"}>{t("Sign in")}</Link>
            </div>
            <p className="mt-4 text-sm text-ink-500">{t("30-day free trial with every feature. Your data stays yours: nothing is deleted when a trial ends.")}</p>
          </div>

          <figure className="rounded-2xl border border-ink-200 bg-ink-50 p-6">
            <figcaption className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">{t("Where the variance came from")}</span>
              <span className="rounded bg-white px-2 py-0.5 text-xs font-medium text-ink-600 ring-1 ring-ink-200">{t("Example")}</span>
            </figcaption>
            <ul className="mt-5 space-y-3">
              {EXAMPLE.map((r) => (
                <li key={r.label}>
                  <div className="flex justify-between text-sm"><span className={r.label === "Unexplained" ? "font-semibold text-red-800" : "text-ink-700"}>{t(r.label)}</span><span className="tabular-nums text-ink-600">%{r.share}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-white"><div className={r.label === "Unexplained" ? "h-2 rounded-full bg-red-600" : "h-2 rounded-full bg-brand-600"} style={{ width: `${r.share * 2.5}%` }} /></div>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-xs text-ink-500">{t("Each line opens the documents behind it: the receipt, the waste record, the buffet session, the count.")}</p>
          </figure>
        </section>

        <section className="border-y border-ink-100 bg-ink-50">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="text-2xl font-semibold">{t("How it works")}</h2>
            <ol className="mt-8 grid gap-6 md:grid-cols-4">
              {[
                ["Products and prices", "Import your product list and supplier prices from Excel, or pull them from Micros."],
                ["Recipes", "Build recipes with sub-recipes and yields. Approving a recipe freezes its cost for the sales of that day."],
                ["Sales and counts", "POS sales become theoretical consumption; counts and receipts give the actual."],
                ["The variance, explained", "Theoretical against actual, split by cause, every number traceable to its source document."],
              ].map(([title, text], i) => (
                <li key={title}>
                  <span className="text-sm font-semibold text-brand-700">{i + 1}</span>
                  <h3 className="mt-1 font-semibold">{t(title!)}</h3>
                  <p className="mt-1 text-sm text-ink-600">{t(text!)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold">{t("Numbers you can defend")}</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              [ScrollText, "Nothing is overwritten", "Stock and cost ledgers only grow: a correction is a reversal you can see, enforced by the database itself."],
              [ShieldCheck, "No invented zeros", "When data is missing the report says so instead of showing 0. Estimates are marked as estimates."],
              [Lock, "Each hotel sees only its own data", "Company, hotel and department separation is checked on every request and again in the database."],
              [FileSpreadsheet, "The month in Excel", "A complete management pack as PDF and a full-cost workbook for your own analysis."],
            ].map(([Icon, title, text]) => {
              const I = Icon as typeof Lock;
              return (
                <div key={title as string}>
                  <I className="h-5 w-5 text-brand-600" aria-hidden />
                  <h3 className="mt-2 font-semibold">{t(title as string)}</h3>
                  <p className="mt-1 text-sm text-ink-600">{t(text as string)}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="border-t border-ink-100 bg-ink-50">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="text-2xl font-semibold">{t("Packages")}</h2>
            <p className="mt-2 text-sm text-ink-600">{priced ? t("Per active hotel per month, VAT excluded.") : t("Ask us for a quote.")}</p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {PLANS.map((p, i) => (
                <div key={p} className="flex flex-col rounded-xl border border-ink-200 bg-white p-5">
                  <h3 className="font-semibold">{t(PLAN_LABEL[p])}</h3>
                  {priced && prices && <p className="mt-1 text-2xl font-semibold tabular-nums">{money(prices[p].monthlyPerHotel, prices[p].currency, 0)}</p>}
                  <ul className="mt-4 space-y-1.5 text-sm">
                    {p === "BASIC" && <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />{t("Purchasing, stock, counts, recipes, waste, sales, theoretical vs actual, reports")}</li>}
                    {featuresOf(p).map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />{t(FEATURE_LABEL[f])}</li>)}
                    {i > 0 && <li className="text-xs text-ink-500">{t("+ everything in {plan}", { plan: t(PLAN_LABEL[PLANS[i - 1]!]) })}</li>}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-6 text-sm text-ink-600">{t("Getting started takes data, not weeks of consulting: product, price and opening-stock imports come with templates, and the app shows the next step until your first variance is ready.")}</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink-100">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-ink-500 sm:px-6">
          <span>HotelCost</span>
          {contact && <a href={`mailto:${contact}`} className="hover:text-ink-800">{contact}</a>}
        </div>
      </footer>
    </div>
  );
}
