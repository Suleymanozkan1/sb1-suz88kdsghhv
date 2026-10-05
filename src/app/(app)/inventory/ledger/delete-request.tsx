"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

/** Posted stock cannot be deleted: this creates a DELETE REQUEST for manager approval. */
export function DeleteRequest({ txId }: { txId: string }) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);
  async function go() {
    const reason = window.prompt(t("Posted entries cannot be deleted. Describe why this entry should be reversed (sent to a manager for approval):"));
    if (!reason) return;
    setBusy(true);
    try {
      await call("POST", `/api/inventory/${txId}/delete-request`, { reason });
      alert(t("Delete request created and sent for approval."));
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : t("Failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <button onClick={go} disabled={busy} className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50">
      {t("Request delete")}
    </button>
  );
}
