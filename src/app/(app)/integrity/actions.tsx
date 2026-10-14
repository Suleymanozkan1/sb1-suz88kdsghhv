"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@/components/ui";
import { call } from "@/lib/client";
import { useLocale, useT } from "@/i18n/client";
import { translateMessage } from "@/i18n/core";

interface CheckResult {
  runId: string;
  status: string;
  checks: Array<{ count: number }>;
}

export function IntegrityActions({ canRebuild, canReprocess }: { canRebuild: boolean; canReprocess: boolean }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [msg, setMsg] = useState<{ tone: "red" | "green" | "amber"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run<T>(fn: () => Promise<T>, done: (r: T) => void) {
    setBusy(true);
    setMsg(null);
    try {
      done(await fn());
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? translateMessage(locale, e.message) : t("Failed") });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => run(() => call<CheckResult>("POST", "/api/integrity/check"), (r) => {
          // the result is shown below from the stored run: every finding links to its record
          const n = r.checks.reduce((a, c) => a + c.count, 0);
          setMsg({ tone: r.status === "OK" ? "green" : r.status === "WARNINGS" ? "amber" : "red", text: t("Check finished: {status} · findings: {n}", { status: t(r.status), n }) });
          router.push(`/integrity?run=${r.runId}#run`);
        })}>{busy ? t("Running…") : t("Run integrity check")}</Button>
        {canRebuild && <Button variant="secondary" disabled={busy} onClick={() => { const reason = window.prompt(t("Reason for rebuilding balances (audited):")); if (reason) void run(() => call<{ corrected: number }>("POST", "/api/integrity/rebuild", { reason }), (r) => setMsg({ tone: r.corrected ? "amber" : "green", text: r.corrected ? t("{n} balance(s) corrected from the ledger — see the run log", { n: r.corrected }) : t("Balances already match the ledger — nothing changed") })); }}>{t("Rebuild balances from ledger")}</Button>}
        {canReprocess && <Button variant="secondary" disabled={busy} onClick={() => run(() => call<{ status: string; mapped: number; stillUnmapped: number; skippedClosed: number }>("POST", "/api/integrity/reprocess-sales"), (r) => setMsg({ tone: r.status === "COMPLETED" ? "green" : "amber", text: t("Reprocess {status}: {mapped} mapped, {unmapped} still unmapped, {closed} in closed periods left unchanged", { status: t(r.status), mapped: r.mapped, unmapped: r.stillUnmapped, closed: r.skippedClosed }) }))}>{t("Reprocess unmapped sales")}</Button>}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </div>
  );
}
