"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";

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
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => run(() => call<{ status: string; checks: Check[] }>("POST", "/api/integrity/check"), (r) => setRes(r))}>{busy ? "Running…" : "Run integrity check"}</Button>
        {canRebuild && <Button variant="secondary" disabled={busy} onClick={() => { const reason = window.prompt("Reason for rebuilding balances (audited):"); if (reason) void run(() => call<{ corrected: number }>("POST", "/api/integrity/rebuild", { reason }), (r) => setMsg({ tone: r.corrected ? "amber" : "green", text: r.corrected ? `${r.corrected} balance(s) corrected from the ledger — see the run log` : "Balances already match the ledger — nothing changed" })); }}>Rebuild balances from ledger</Button>}
        {canReprocess && <Button variant="secondary" disabled={busy} onClick={() => run(() => call<{ status: string; mapped: number; stillUnmapped: number; skippedClosed: number }>("POST", "/api/integrity/reprocess-sales"), (r) => setMsg({ tone: r.status === "COMPLETED" ? "green" : "amber", text: `Reprocess ${r.status}: ${r.mapped} mapped, ${r.stillUnmapped} still unmapped, ${r.skippedClosed} in closed periods left unchanged` }))}>Reprocess unmapped sales</Button>}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {res && (
        <>
          <p className="text-sm">Result: <Badge tone={res.status === "OK" ? "green" : res.status === "WARNINGS" ? "amber" : "red"}>{res.status}</Badge></p>
          <Table>
            <thead><tr><Th>Check</Th><Th>Result</Th><Th align="right">Findings</Th><Th>Examples</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {res.checks.map((c) => (
                <tr key={c.key}>
                  <Td>{c.label}</Td><Td><Badge tone={c.ok ? "green" : c.severity === "CRITICAL" ? "red" : "amber"}>{c.ok ? "PASS" : c.severity === "CRITICAL" ? "FAIL" : "WARNING"}</Badge></Td><Td align="right">{c.count}</Td>
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
