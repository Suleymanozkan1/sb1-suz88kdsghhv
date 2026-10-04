"use client";

import { useState } from "react";
import { Alert, Badge, Button } from "@/components/ui";
import { call } from "@/lib/client";

interface VerifyResult {
  reproducible: boolean;
  differences: string[];
  periodStatus: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
}

export function VerifyButton({ id }: { id: string }) {
  const [res, setRes] = useState<VerifyResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
        setBusy(true);
        setErr(null);
        try {
          setRes(await call<VerifyResult>("POST", `/api/reports/${id}/verify`));
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Failed");
        } finally {
          setBusy(false);
        }
      }}>{busy ? "Verifying…" : "Verify"}</Button>
      {res && (res.reproducible ? <Badge tone="green">REPRODUCIBLE</Badge> : <Badge tone="red">CHANGED: {res.differences.join(", ") || "hash"}{res.reopenedAt ? ` · reopened ${res.reopenedAt.slice(0, 10)}` : ""}</Badge>)}
      {err && <span className="text-xs text-red-700">{err}</span>}
    </span>
  );
}

export function PackForm({ defaultMonth }: { defaultMonth: string }) {
  const [month, setMonth] = useState(defaultMonth);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    setErr(null);
    try {
      const [y, m] = month.split("-").map(Number) as [number, number];
      const from = `${month}-01`;
      const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const res = await fetch(`/api/reports/management-pack?from=${from}&to=${to}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `Failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "management-pack.pdf";
      a.click();
      URL.revokeObjectURL(a.href);
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      {err && <div className="w-full"><Alert>{err}</Alert></div>}
      <label className="text-sm">Month <input aria-label="Pack month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="ml-1 rounded border border-ink-200 px-2 py-1" /></label>
      <Button onClick={download} disabled={busy}>{busy ? "Building PDF…" : "Download management pack (PDF)"}</Button>
    </div>
  );
}
