"use client";

import { useState } from "react";
import { Alert, Badge, Button } from "@/components/ui";
import { call } from "@/lib/client";
import { useLocale, useT } from "@/i18n/client";
import { translateMessage } from "@/i18n/core";

interface VerifyResult {
  reproducible: boolean;
  differences: string[];
  periodStatus: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
}

export function VerifyButton({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
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
          setErr(e instanceof Error ? translateMessage(locale, e.message) : t("Failed"));
        } finally {
          setBusy(false);
        }
      }}>{busy ? t("Verifying…") : t("Verify")}</Button>
      {res && (res.reproducible ? <Badge tone="green">{t("REPRODUCIBLE")}</Badge> : <Badge tone="red">{t("CHANGED:")} {res.differences.join(", ") || "hash"}{res.reopenedAt ? ` · ${t("reopened {date}", { date: res.reopenedAt.slice(0, 10) })}` : ""}</Badge>)}
      {err && <span className="text-xs text-red-700">{err}</span>}
    </span>
  );
}

export function PackForm({ defaultMonth }: { defaultMonth: string }) {
  const t = useT();
  const locale = useLocale();
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
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? t("Failed ({status})", { status: res.status }));
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "management-pack.pdf";
      a.click();
      URL.revokeObjectURL(a.href);
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? translateMessage(locale, e.message) : t("Failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      {err && <div className="w-full"><Alert>{err}</Alert></div>}
      <label className="text-sm">{t("Month")} <input aria-label={t("Pack month")} type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="ml-1 rounded border border-ink-200 px-2 py-1" /></label>
      <Button onClick={download} disabled={busy}>{busy ? t("Building PDF…") : t("Download management pack (PDF)")}</Button>
    </div>
  );
}
