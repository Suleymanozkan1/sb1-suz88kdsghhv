import { redirect } from "next/navigation";
import Link from "next/link";
import { getT } from "@/i18n/server";
import { AuthCard } from "@/components/auth-card";
import { passwordResetAvailable, RESET_MINUTES } from "@/server/services/account";
import { ForgotPasswordForm } from "./forgot-form";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getT())("Forgot password") };
}

export default async function ForgotPasswordPage() {
  // without a mail server the link is not offered: the administrator resets passwords
  if (!passwordResetAvailable()) redirect("/login");
  const t = await getT();
  return (
    <AuthCard title={t("Forgot password")}>
      <p className="mt-2 text-sm text-ink-600">{t("Enter the e-mail address you sign in with. If it belongs to an account, we send a link to choose a new password.")}</p>
      <ForgotPasswordForm minutes={RESET_MINUTES} />
      <p className="mt-6 text-center text-sm"><Link href="/login" className="font-medium text-brand-700 hover:underline">{t("Back to sign in")}</Link></p>
    </AuthCard>
  );
}
