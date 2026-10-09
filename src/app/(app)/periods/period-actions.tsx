"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { ApiError, call } from "@/lib/client";
import { useLocale, useT } from "@/i18n/client";
import { translateMessage } from "@/i18n/core";

export function PeriodActions({ periodId, status, canReopen, canOverride }: { periodId: string; status: string; canReopen: boolean; canOverride: boolean }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>) {
    setErr(null);
    setBusy(true);
    try { await fn(); router.refresh(); } catch (e) { setErr(e instanceof Error ? translateMessage(locale, e.message) : t("Failed")); } finally { setBusy(false); }
  }
  // the close checklist failed: VALIDATION with details.checks (period.ts). Any other error (closed, forbidden …) is just shown.
  const checklistFailed = (e: unknown) => e instanceof ApiError && e.code === "VALIDATION" && Array.isArray((e.details as { checks?: unknown } | null | undefined)?.checks);
  const close = () => {
    if (!window.confirm(t("Close this period? Posting into it is blocked; only a period reopen (audited) undoes it."))) return;
    return run(async () => {
      try {
        await call("POST", `/api/periods/${periodId}/status`, { status: "CLOSED" });
      } catch (e) {
        if (!canOverride || !checklistFailed(e)) throw e;
        const reason = window.prompt(`${translateMessage(locale, (e as Error).message)}\n\n${t("Close anyway? Enter an override reason:")}`);
        if (!reason?.trim()) return;
        await call("POST", `/api/periods/${periodId}/status`, { status: "CLOSED", overrideReason: reason.trim() });
      }
    });
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        {(status === "OPEN" || status === "REOPENED") && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => call("POST", `/api/periods/${periodId}/status`, { status: "SOFT_CLOSED" }))}>{t("Soft close")}</Button>}
        {status !== "CLOSED" && <Button size="sm" disabled={busy} onClick={close}>{t("Close period")}</Button>}
        {(status === "CLOSED" || status === "SOFT_CLOSED") && canReopen && <Button size="sm" variant="danger" disabled={busy} onClick={() => { const reason = window.prompt(t("Reason for reopening (audited):")); if (reason) run(() => call("POST", `/api/periods/${periodId}/reopen`, { reason })); }}>{t("Reopen")}</Button>}
      </div>
      {err && <p className="max-w-md whitespace-normal text-right text-xs text-red-700">{err}</p>}
    </div>
  );
}
