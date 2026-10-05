import Link from "next/link";
import { pageContext } from "@/server/page";
import { Alert, PageHeader } from "@/components/ui";
import { getT } from "@/i18n/server";

export const metadata = { title: "No permission" };

export default async function Forbidden({ searchParams }: { searchParams: Promise<{ need?: string }> }) {
  const { actor } = await pageContext();
  const { need } = await searchParams;
  const t = await getT();
  return (
    <div className="space-y-4">
      <PageHeader title={t("No permission")} />
      <Alert tone="amber">
        {t("Your role ({role}) does not include this page", { role: t(actor.roleName) })}{need ? <> ({t("requires")} <code>{need.slice(0, 40)}</code>)</> : null}. {t("Ask your company administrator if you need access.")}
      </Alert>
      <Link href="/" className="text-sm font-medium text-brand-700 hover:underline">{t("Back to the dashboard")}</Link>
    </div>
  );
}
