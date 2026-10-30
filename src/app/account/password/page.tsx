import { redirect } from "next/navigation";
import { currentActor } from "@/server/auth/session";
import { getT } from "@/i18n/server";
import { AuthCard } from "@/components/auth-card";
import { ChangePasswordForm } from "./change-form";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getT())("Change password") };
}

/** Outside the app shell, so platform operators and users without a hotel reach it too. */
export default async function ChangePasswordPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  const t = await getT();
  const back = actor.hotelIds.length ? "/" : actor.permissions.has("platform:admin") ? "/platform" : "/no-access";
  return (
    <AuthCard title={t("Change password")}>
      <p className="mt-2 text-sm text-ink-600">{t("Signed in as {email}", { email: actor.email })}</p>
      <ChangePasswordForm back={back} />
    </AuthCard>
  );
}
