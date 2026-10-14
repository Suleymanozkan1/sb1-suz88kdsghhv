"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

/** Deletes a record and gives its stock back (reversal entries; only while its cost period is open). */
export function DeleteComp({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    const reason = window.prompt(t("Delete this record and return its items to stock? Reason (audited):"));
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await call("DELETE", `/api/comps/${id}`, { reason });
      router.refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t("Failed"));
    } finally {
      setBusy(false);
    }
  }
  return <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={t("Delete")} title={t("Delete")} onClick={run}><Trash2 className="h-4 w-4" /></Button>;
}
