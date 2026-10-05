"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";
import { useLocale, useT } from "@/i18n/client";
import { translateMessage } from "@/i18n/core";

interface Check {
  key: string;
  label: string;
  ok: boolean;
  severity: string;
  count: number;
  examples: unknown[];
}

export function IntegrityActions({ canRebuild, canReprocess }: { canRebuild: boolean; canReprocess: boolean }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [res, setRes] = useState<{ status: string; checks: Check[] } | null>(null);
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
        <Button disabled={busy} onClick={() => run(() => call<{ status: string; checks: Check[] }>("POST", "/api/integrity/check"), (r) => setRes(r))}>{busy ? t("Running…") : t("Run integrity check")}</Button>
        {canRebuild && <Button variant="secondary" disabled={busy} onClick={() => { const reason = window.prompt(t("Reason for rebuilding balances (audited):")); if (reason) void run(() => call<{ corrected: number }>("POST", "/api/integrity/rebuild", { reason }), (r) => setMsg({ tone: r.corrected ? "amber" : "green", text: r.corrected ? t("{n} balance(s) corrected from the ledger — see the run log", { n: r.corrected }) : t("Balances already match the ledger — nothing changed") })); }}>{t("Rebuild balances from ledger")}</Button>}
        {canReprocess && <Button variant="secondary" disabled={busy} onClick={() => run(() => call<{ status: string; mapped: number; stillUnmapped: number; skippedClosed: number }>("POST", "/api/integrity/reprocess-sales"), (r) => setMsg({ tone: r.status === "COMPLETED" ? "green" : "amber", text: t("Reprocess {status}: {mapped} mapped, {unmapped} still unmapped, {closed} in closed periods left unchanged", { status: t(r.status), mapped: r.mapped, unmapped: r.stillUnmapped, closed: r.skippedClosed }) }))}>{t("Reprocess unmapped sales")}</Button>}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {res && (
        <>
          <p className="text-sm">{t("Result:")} <Badge tone={res.status === "OK" ? "green" : res.status === "WARNINGS" ? "amber" : "red"}>{t(res.status)}</Badge></p>
          <Table>
            <thead><tr><Th>{t("Check")}</Th><Th>{t("Result")}</Th><Th align="right">{t("Findings")}</Th><Th>{t("Examples")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {res.checks.map((c) => (
                <tr key={c.key}>
                  <Td>{t(c.label)}</Td><Td><Badge tone={c.ok ? "green" : c.severity === "CRITICAL" ? "red" : "amber"}>{c.ok ? t("PASS") : c.severity === "CRITICAL" ? t("FAIL") : t("WARNING")}</Badge></Td><Td align="right">{c.count}</Td>
                  <Td className="max-w-xl truncate font-mono text-xs text-ink-500">{c.examples.length ? JSON.stringify(c.examples.slice(0, 3)) : ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}
