import { prisma } from "@/server/db";
import { describeInvite } from "@/server/services/tenancy";
import { Alert } from "@/components/ui";
import { AcceptForm } from "./accept-form";
import { getT } from "@/i18n/server";

export const metadata = { title: "Accept invitation" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const t = await getT();
  let info: Awaited<ReturnType<typeof describeInvite>> | null = null;
  try { info = await describeInvite(prisma, token); } catch { info = null; }
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold text-ink-950">{t("Join HotelCost")}</h1>
      {info ? (
        <>
          <p className="text-sm text-ink-600">{t("You were invited to")} <strong>{info.organization}</strong> {t("as")} <strong>{info.email}</strong>. {t("Choose your name and password.")}</p>
          <AcceptForm token={token} name={info.name ?? ""} />
        </>
      ) : (
        <Alert>{t("This invitation is invalid, already used or expired. Ask your administrator for a new one.")}</Alert>
      )}
    </main>
  );
}
