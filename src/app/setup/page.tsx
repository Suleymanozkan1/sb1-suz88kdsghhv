import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { prisma } from "@/server/db";
import { needsSetup, setupSecretKind } from "@/server/setup";
import { getT } from "@/i18n/server";
import { LanguageSwitch } from "@/components/language-switch";
import { Alert } from "@/components/ui";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Kurulum" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await needsSetup(prisma))) redirect("/login");
  const t = await getT();
  const kind = setupSecretKind();
  return (
    <main className="flex min-h-screen items-start justify-center bg-ink-50 p-6 sm:items-center">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-sm ring-1 ring-ink-200">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-semibold text-ink-950">
            <Building2 className="h-6 w-6 text-brand-600" aria-hidden /> HotelCost
          </div>
          <LanguageSwitch />
        </div>
        <h1 className="text-2xl font-semibold text-ink-950">{t("First setup")}</h1>
        <p className="mt-1 text-sm text-ink-500">{t("Create your company, first hotel and administrator account.")}</p>
        {kind === "none" ? (
          <div className="mt-6"><Alert>{t("No setup code is available: set SETUP_TOKEN in the hosting environment variables and redeploy.")}</Alert></div>
        ) : (
          <SetupForm secretKind={kind} />
        )}
      </div>
    </main>
  );
}
