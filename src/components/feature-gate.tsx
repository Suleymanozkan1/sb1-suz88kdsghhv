/**
 * Package gate for a module's pages. Used as the module folder's layout.tsx: a segment layout renders whenever the
 * user enters the module (also by client-side navigation, which the app-wide layout does not re-render), and covers
 * every subpage. The API routes are gated separately (src/server/http/handler.ts); this only replaces the page with
 * an explanation instead of a wall of "PLAN_REQUIRED" errors: nothing was deleted, it comes back with the package, and
 * the module's figures can be downloaded as CSV meanwhile (src/lib/feature-exports.ts).
 */
import Link from "next/link";
import { Lock } from "lucide-react";
import { currentActor } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { accessHas, FEATURES, FEATURE_LABEL, organizationAccess, type Feature } from "@/server/plans";
import { featureExport } from "@/lib/feature-exports";
import { exportMaxMonths } from "@/server/export-limits";
import { Button, Input, Label, PageHeader, Select } from "./ui";
import { getT } from "@/i18n/server";

/** same labels as the order screen ("Temel paket" / "Orta paket" / "Üst paket" in Turkish) */
export const PLAN_LABEL = { BASIC: "Basic plan", STANDARD: "Standard plan", PREMIUM: "Premium plan" } as const;

export async function FeatureGate({ feature, children }: { feature: Feature; children: React.ReactNode }) {
  const actor = await currentActor();
  if (!actor) return children; // the app layout redirects to sign-in
  const access = await organizationAccess(prisma, actor.organizationId);
  if (accessHas(access, feature)) return children;
  const t = await getT();
  const need = FEATURES[feature];
  const admin = actor.permissions.has("admin:users");
  // the module's figures stay downloadable as CSV in every plan (/api/export/[section])
  const csv = actor.permissions.has("report:export") ? featureExport(feature) : null;
  const today = new Date();
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  return (
    <div className="space-y-4">
      <PageHeader title={t(FEATURE_LABEL[feature])} />
      <div className="flex max-w-2xl gap-4 rounded-xl border border-ink-200 bg-white p-6">
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-ink-400" aria-hidden />
        <div className="space-y-2 text-sm text-ink-700">
          <p className="font-medium text-ink-900">{t("{feature} is included in the {plan}.", { feature: t(FEATURE_LABEL[feature]), plan: t(PLAN_LABEL[need]) })}</p>
          <p>{t("Your company uses the {plan}. Nothing was deleted: everything recorded here is kept and is back on this screen as soon as the package includes it again.", { plan: t(PLAN_LABEL[access.storedPlan]) })}</p>
          {csv && (
            <form method="get" action={`/api/export/${csv.section}`} className="space-y-2 rounded-lg bg-ink-50 p-3">
              <p className="font-medium text-ink-900">{t("Until then you can download its figures as CSV.")}</p>
              <input type="hidden" name="format" value="csv" />
              <div className="grid gap-2 sm:grid-cols-3">
                <div><Label htmlFor="fg-table">{t("Report")}</Label><Select id="fg-table" name="table">{csv.tables.map(([key, title]) => <option key={key} value={key}>{t(title)}</option>)}</Select></div>
                <div><Label htmlFor="fg-from">{t("From")}</Label><Input id="fg-from" name="from" type="date" defaultValue={ymd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (exportMaxMonths() ?? 4) + 1, 1)))} required /></div>
                <div><Label htmlFor="fg-to">{t("To")}</Label><Input id="fg-to" name="to" type="date" defaultValue={ymd(today)} required /></div>
              </div>
              <Button type="submit" size="sm" variant="secondary">{t("Download CSV")}</Button>
            </form>
          )}
          {admin ? (
            <Link href="/billing" className="inline-block font-medium text-brand-700 hover:underline">{t("Compare packages and request an upgrade")}</Link>
          ) : (
            <p className="text-ink-500">{t("Your company administrator can change the package.")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
