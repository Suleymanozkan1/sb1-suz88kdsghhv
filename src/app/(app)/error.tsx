"use client";
/**
 * Error boundary for every page under the app shell: the menu stays usable, the user can retry, and the reference
 * (Next.js error digest, also in the server log) lets support find the exact failure. Before, an unexpected error
 * replaced the whole app with Next's bare error screen.
 */
import { useEffect } from "react";
import { useT } from "@/i18n/client";
import { Button } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => {
    // the server already logged it with the same digest; this is for the browser console during support calls
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="max-w-xl rounded-xl border border-red-200 bg-white p-6">
      <h1 className="text-base font-semibold text-ink-900">{t("This page could not be loaded")}</h1>
      <p className="mt-2 text-sm text-ink-600">{t("Nothing was changed. Try again; if it keeps happening, send the reference below to support.")}</p>
      {error.digest && <p className="mt-3 text-xs text-ink-500">{t("Reference")}: <code className="font-mono">{error.digest}</code></p>}
      <Button className="mt-4" onClick={reset}>{t("Try again")}</Button>
    </div>
  );
}
