/**
 * Package gate for a module's pages. Used as the module folder's layout.tsx: a segment layout renders whenever the
 * user enters the module (also by client-side navigation, which the app-wide layout does not re-render), and covers
 * every subpage. The API routes are gated separately (src/server/http/handler.ts); this only replaces the page with
 * an explanation instead of a wall of "PLAN_REQUIRED" errors.
 */
import Link from "next/link";
import { Lock } from "lucide-react";
import { currentActor } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { accessHas, FEATURES, FEATURE_LABEL, organizationAccess, type Feature } from "@/server/plans";
import { PageHeader } from "./ui";
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
  return (
    <div className="space-y-4">
      <PageHeader title={t(FEATURE_LABEL[feature])} />
      <div className="flex max-w-2xl gap-4 rounded-xl border border-ink-200 bg-white p-6">
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-ink-400" aria-hidden />
        <div className="space-y-2 text-sm text-ink-700">
          <p className="font-medium text-ink-900">{t("{feature} is included in the {plan}.", { feature: t(FEATURE_LABEL[feature]), plan: t(PLAN_LABEL[need]) })}</p>
          <p>{t("Your company uses the {plan}. Your data is not affected: everything recorded so far stays as it is.", { plan: t(PLAN_LABEL[access.storedPlan]) })}</p>
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
