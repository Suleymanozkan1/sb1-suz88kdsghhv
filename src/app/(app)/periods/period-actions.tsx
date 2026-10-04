"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { call } from "@/lib/client";

export function PeriodActions({ periodId, status, canReopen, canOverride }: { periodId: string; status: string; canReopen: boolean; canOverride: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setErr(null);
    try { await fn(); router.refresh(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  }
  const close = () => run(async () => {
    try {
      await call("POST", `/api/periods/${periodId}/status`, { status: "CLOSED" });
    } catch (e) {
      if (!canOverride) throw e;
      const reason = window.prompt(`${e instanceof Error ? e.message : ""}\n\nClose anyway? Enter an override reason:`);
      if (!reason) return;
      await call("POST", `/api/periods/${periodId}/status`, { status: "CLOSED", overrideReason: reason });
    }
  });
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        {(status === "OPEN" || status === "REOPENED") && <Button size="sm" variant="secondary" onClick={() => run(() => call("POST", `/api/periods/${periodId}/status`, { status: "SOFT_CLOSED" }))}>Soft close</Button>}
        {status !== "CLOSED" && <Button size="sm" onClick={close}>Close period</Button>}
        {(status === "CLOSED" || status === "SOFT_CLOSED") && canReopen && <Button size="sm" variant="danger" onClick={() => { const reason = window.prompt("Reason for reopening (audited):"); if (reason) run(() => call("POST", `/api/periods/${periodId}/reopen`, { reason })); }}>Reopen</Button>}
      </div>
      {err && <p className="max-w-md whitespace-normal text-right text-xs text-red-700">{err}</p>}
    </div>
  );
}
