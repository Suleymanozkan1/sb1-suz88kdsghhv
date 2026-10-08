import Link from "next/link";
import { pageContext } from "@/server/page";
import { Alert, PageHeader } from "@/components/ui";
import { getT } from "@/i18n/server";
import { homeHref } from "@/components/nav";

export const metadata = { title: "No permission" };

export default async function Forbidden({ searchParams }: { searchParams: Promise<{ need?: string }> }) {
  const { actor } = await pageContext();
  const { need } = await searchParams;
  const t = await getT();
  // "/" itself is off-limits without dashboard:view: send the user to the first page their role opens
  const home = homeHref(actor.permissions);
  return (
    <div className="space-y-4">
      <PageHeader title={t("No permission")} />
      <Alert tone="amber">
        {t("Your role ({role}) does not include this page", { role: t(actor.roleName) })}{need ? <> ({t("requires")} <code>{need.slice(0, 40)}</code>)</> : null}. {t("Ask your company administrator if you need access.")}
      </Alert>
      {home && <Link href={home} className="text-sm font-medium text-brand-700 hover:underline">{home === "/" ? t("Back to the dashboard") : t("Back to the start page")}</Link>}
    </div>
  );
}
