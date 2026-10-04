"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { call } from "@/lib/client";

export function Decide({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go(decision: "APPROVE" | "REJECT") {
    const note = window.prompt(decision === "APPROVE" ? "Approval note (optional)" : "Reason for rejection (required)") ?? undefined;
    if (decision === "REJECT" && !note) return;
    setBusy(true);
    setErr(null);
    try {
      await call("POST", `/api/approvals/${id}/decide`, { decision, note });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <Button size="sm" disabled={busy} onClick={() => go("APPROVE")}>Approve</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => go("REJECT")}>Reject</Button>
      </div>
      {err && <p className="max-w-xs whitespace-normal text-xs text-red-700">{err}</p>}
    </div>
  );
}
