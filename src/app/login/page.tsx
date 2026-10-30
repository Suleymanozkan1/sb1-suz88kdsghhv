import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { currentActor } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { getT } from "@/i18n/server";
import { LoginForm } from "./login-form";
import { LanguageSwitch } from "@/components/language-switch";
import { Alert } from "@/components/ui";
import { passwordResetAvailable } from "@/server/services/account";
import { pageTitle } from "@/i18n/metadata";

export const generateMetadata = pageTitle("Sign in");
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ joined?: string; reset?: string }> }) {
  if (await currentActor()) redirect("/");
  // an empty installation has nobody to sign in: send the owner to the first-run setup
  if ((await prisma.user.count()) === 0) redirect("/setup");
  const t = await getT();
  const { joined, reset } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-ink-200">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-semibold text-ink-950">
            <Building2 className="h-6 w-6 text-brand-600" aria-hidden /> HotelCost
          </div>
          <LanguageSwitch />
        </div>
        <h1 className="text-2xl font-semibold text-ink-950">{t("Sign in")}</h1>
        {joined === "1" && <div className="mt-4"><Alert tone="green">{t("Account created. Sign in with your e-mail and new password.")}</Alert></div>}
        {reset === "1" && <div className="mt-4"><Alert tone="green">{t("Your password was changed. Sign in with the new one.")}</Alert></div>}
        <LoginForm />
        {passwordResetAvailable() && <p className="mt-4 text-center text-sm"><a href="/forgot-password" className="font-medium text-brand-700 hover:underline">{t("Forgot your password?")}</a></p>}
        {process.env.PUBLIC_LANDING === "1" && <p className="mt-6 text-center text-sm text-ink-600"><a href="/welcome" className="font-medium text-brand-700 hover:underline">{t("What is HotelCost?")}</a></p>}
      </div>
    </main>
  );
}
