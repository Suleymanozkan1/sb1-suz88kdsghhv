/**
 * Public "Security & data" page: what the product actually does to protect a hotel's numbers, stated from the code
 * (audit v2: a Turkish B2B buyer's first questions are about data, not features). Nothing here is a promise the code
 * does not keep. Where the data is hosted and the legal texts (KVKK notice, terms) come from the operator's
 * environment, because only the operator can state them; a missing one is simply not shown.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, FileSearch, KeyRound, Lock, ScrollText, ShieldCheck } from "lucide-react";
import { getT } from "@/i18n/server";
import { LanguageSwitch } from "@/components/language-switch";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getT();
  return { title: t("Security & data") };
}

export default async function SecurityPage() {
  if (process.env.PUBLIC_LANDING !== "1") redirect("/login");
  const t = await getT();
  const e = process.env;
  const legal = [
    [e.PUBLIC_PRIVACY_URL, t("KVKK notice and privacy policy")],
    [e.PUBLIC_TERMS_URL, t("Subscription terms")],
    [e.PUBLIC_DPA_URL, t("Data processing agreement")],
  ].filter((x): x is [string, string] => !!x[0]?.trim());
  const items: Array<[typeof Lock, string, string]> = [
    [ScrollText, "The ledger cannot be rewritten", "Stock and cost entries are append-only. A correction is a visible reversal. The database itself refuses edits, deletes and table truncation of these records, independent of the application."],
    [Lock, "Each company sees only its own data", "Company, hotel and department separation is checked on every request and again by database rules that reject any link between records of different hotels."],
    [KeyRound, "Accounts and sessions", "Passwords are stored as bcrypt hashes. Sessions expire after 12 hours and end immediately when a user is deactivated. Sign-in attempts are rate limited."],
    [FileSearch, "Every change is traceable", "Who changed what, when, with before and after values and the reason, in an audit trail that cannot be edited either."],
    [ShieldCheck, "Numbers are never invented", "When data is missing the report says so instead of showing zero; estimates are marked as estimates."],
    [Building2, "Your data stays yours", "When a subscription ends nothing is deleted: the data remains viewable and exportable (CSV, Excel, PDF)."],
  ];
  return (
    <div className="min-h-screen bg-white text-ink-900">
      <header className="border-b border-ink-100">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/welcome" className="flex items-center gap-2 text-lg font-semibold"><Building2 className="h-6 w-6 text-brand-600" aria-hidden /> HotelCost</Link>
          <LanguageSwitch />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">{t("Security & data")}</h1>
        <p className="mt-3 max-w-2xl text-ink-600">{t("How HotelCost protects a hotel's cost records. Each point describes how the software works today.")}</p>
        <div className="mt-10 grid gap-8 sm:grid-cols-2">
          {items.map(([Icon, title, text]) => (
            <div key={title}>
              <Icon className="h-5 w-5 text-brand-600" aria-hidden />
              <h2 className="mt-2 font-semibold">{t(title)}</h2>
              <p className="mt-1 text-sm text-ink-600">{t(text)}</p>
            </div>
          ))}
        </div>
        {(e.PUBLIC_DATA_LOCATION?.trim() || legal.length > 0) && (
          <section className="mt-12 rounded-xl border border-ink-200 bg-ink-50 p-5 text-sm">
            {e.PUBLIC_DATA_LOCATION?.trim() && <p><span className="font-medium">{t("Where the data is hosted")}:</span> {e.PUBLIC_DATA_LOCATION}</p>}
            {legal.length > 0 && <ul className="mt-2 space-y-1">{legal.map(([href, label]) => <li key={href}><a href={href} className="text-brand-700 hover:underline">{label}</a></li>)}</ul>}
          </section>
        )}
      </main>
    </div>
  );
}
