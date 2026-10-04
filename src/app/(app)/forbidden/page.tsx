import Link from "next/link";
import { pageContext } from "@/server/page";
import { Alert, PageHeader } from "@/components/ui";

export const metadata = { title: "No permission" };

export default async function Forbidden({ searchParams }: { searchParams: Promise<{ need?: string }> }) {
  const { actor } = await pageContext();
  const { need } = await searchParams;
  return (
    <div className="space-y-4">
      <PageHeader title="No permission" />
      <Alert tone="amber">
        Your role ({actor.roleName}) does not include this page{need ? <> (requires <code>{need.slice(0, 40)}</code>)</> : null}. Ask your company administrator if you need access.
      </Alert>
      <Link href="/" className="text-sm font-medium text-brand-700 hover:underline">Back to the dashboard</Link>
    </div>
  );
}
