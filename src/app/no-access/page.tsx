import { redirect } from "next/navigation";
import { currentActor } from "@/server/auth/session";
import { Alert } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out-button";
import { getT } from "@/i18n/server";

export const metadata = { title: "No hotel access" };
export const dynamic = "force-dynamic";

export default async function NoAccess() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (actor.hotelIds.length) redirect("/");
  const t = await getT();
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold text-ink-950">{t("No hotel assigned")}</h1>
      <Alert tone="amber">{t("Your account ({email}) is active but not assigned to any active hotel. Ask your company administrator to give you access.", { email: actor.email })}</Alert>
      <SignOutButton />
    </main>
  );
}
