import Link from "next/link";
import { prisma } from "@/server/db";
import { getT } from "@/i18n/server";
import { Alert } from "@/components/ui";
import { AuthCard } from "@/components/auth-card";
import { passwordResetValid } from "@/server/services/account";
import { ResetPasswordForm } from "./reset-form";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getT())("Choose a new password") };
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const t = await getT();
  const valid = token.length <= 300 && (await passwordResetValid(prisma, token));
  return (
    <AuthCard title={t("Choose a new password")}>
      {valid ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="mt-6 space-y-4">
          <Alert>{t("This password reset link is invalid, already used or expired")}</Alert>
          <p className="text-center text-sm"><Link href="/forgot-password" className="font-medium text-brand-700 hover:underline">{t("Request a new link")}</Link></p>
        </div>
      )}
    </AuthCard>
  );
}
