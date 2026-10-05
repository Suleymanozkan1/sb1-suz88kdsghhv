"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { call } from "@/lib/client";
import { useLocale, useT } from "@/i18n/client";
import { translateMessage } from "@/i18n/core";

export function PeriodActions({ periodId, status, canReopen, canOverride }: { periodId: string; status: string; canReopen: boolean; canOverride: boolean }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [err, setErr] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setErr(null);
    try { await fn(); router.refresh(); } catch (e) { setErr(e instanceof Error ? translateMessage(locale, e.message) : t("Failed")); }
  }
  const close = () => run(async () => {
    try {
      await call("POST", `/api/periods/${periodId}/status`, { status: "CLOSED" });
    } catch (e) {
      if (!canOverride) throw e;
      const reason = window.prompt(`${e instanceof Error ? translateMessage(locale, e.message) : ""}\n\n${t("Close anyway? Enter an override reason:")}`);
      if (!reason) return;
      await call("POST", `/api/periods/${periodId}/status`, { status: "CLOSED", overrideReason: reason });
    }
  });
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        {(status === "OPEN" || status === "REOPENED") && <Button size="sm" variant="secondary" onClick={() => run(() => call("POST", `/api/periods/${periodId}/status`, { status: "SOFT_CLOSED" }))}>{t("Soft close")}</Button>}
        {status !== "CLOSED" && <Button size="sm" onClick={close}>{t("Close period")}</Button>}
        {(status === "CLOSED" || status === "SOFT_CLOSED") && canReopen && <Button size="sm" variant="danger" onClick={() => { const reason = window.prompt(t("Reason for reopening (audited):")); if (reason) run(() => call("POST", `/api/periods/${periodId}/reopen`, { reason })); }}>{t("Reopen")}</Button>}
      </div>
      {err && <p className="max-w-md whitespace-normal text-right text-xs text-red-700">{err}</p>}
    </div>
  );
}
