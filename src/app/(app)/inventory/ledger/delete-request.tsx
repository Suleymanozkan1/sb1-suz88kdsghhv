"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { call } from "@/lib/client";

/** Posted stock cannot be deleted: this creates a DELETE REQUEST for manager approval (spec §184). */
export function DeleteRequest({ txId }: { txId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    const reason = window.prompt("Posted entries cannot be deleted. Describe why this entry should be reversed (sent to a manager for approval):");
    if (!reason) return;
    setBusy(true);
    try {
      await call("POST", `/api/inventory/${txId}/delete-request`, { reason });
      alert("Delete request created and sent for approval.");
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button onClick={go} disabled={busy} className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50">
      Request delete
    </button>
  );
}
