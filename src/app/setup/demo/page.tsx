import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { prisma } from "@/server/db";
import { currentActor } from "@/server/auth/session";
import { assertInstallationOwner, demoStatus } from "@/server/setup";
import { isDomainError } from "@/domain/errors";
import { getT } from "@/i18n/server";
import { LanguageSwitch } from "@/components/language-switch";
import { DemoPanel } from "./demo-panel";

export const metadata = { title: "Demo veri" };
export const dynamic = "force-dynamic";

export default async function DemoPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  try {
    await assertInstallationOwner(prisma, actor);
  } catch (e) {
    if (isDomainError(e)) redirect("/forbidden");
    throw e;
  }
  const t = await getT();
  const status = await demoStatus(prisma);
  return (
    <main className="flex min-h-screen items-start justify-center bg-ink-50 p-6 sm:items-center">
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-sm ring-1 ring-ink-200">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-semibold text-ink-950">
            <Building2 className="h-6 w-6 text-brand-600" aria-hidden /> HotelCost
          </div>
          <LanguageSwitch />
        </div>
        <h1 className="text-2xl font-semibold text-ink-950">{t("Demo data")}</h1>
        <DemoPanel initial={status} />
      </div>
    </main>
  );
}
