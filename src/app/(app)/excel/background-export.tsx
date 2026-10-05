"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";
import { dateTime } from "@/lib/format";
import { useLocale, useT } from "@/i18n/client";
import { translateMessage } from "@/i18n/core";

interface Job {
  id: string;
  status: string;
  params: { from: string; to: string };
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  fileName: string | null;
  size: number | null;
  reconciliation: string | null;
  expiresAt: string | null;
}

const ACTIVE = ["PENDING", "RUNNING"];
const tone = (s: string) => (s === "COMPLETED" ? "green" : s === "FAILED" ? "red" : "amber");

/** Queue the workbook on the server for large periods; the list polls until every job has finished. */
export function BackgroundExport({ formId, timezone }: { formId: string; timezone: string }) {
  const t = useT();
  const locale = useLocale();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setJobs(await call<Job[]>("GET", "/api/export/jobs")), []);
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);
  const running = jobs.some((j) => ACTIVE.includes(j.status));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load().catch(() => undefined), 3000);
    return () => clearInterval(timer);
  }, [running, load]);

  async function queue() {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form || !form.reportValidity()) return;
    const f = new FormData(form);
    setBusy(true);
    setErr(null);
    try {
      await call("POST", "/api/export/jobs", { from: f.get("from"), to: f.get("to"), departmentId: f.get("departmentId") ?? "", warehouseId: f.get("warehouseId") ?? "", group: f.get("group") ?? "" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? translateMessage(locale, e.message) : t("Failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t border-ink-100 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={busy} onClick={() => void queue()}>{busy ? t("Queuing…") : t("Generate in background")}</Button>
        <p className="text-xs text-ink-500">{t("For large periods: the server builds the workbook while you keep working; download it here when it is ready (kept 24 h).")}</p>
      </div>
      {err && <Alert>{err}</Alert>}
      {jobs.length > 0 && (
        <Table label={t("Background exports")}>
          <thead><tr><Th>{t("Queued")}</Th><Th>{t("Period")}</Th><Th>{t("Status")}</Th><Th>{t("Reconciliation")}</Th><Th align="right">{t("Size")}</Th><Th>{t("File")}</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {jobs.map((j) => (
              <tr key={j.id}>
                <Td>{dateTime(j.createdAt, timezone)}</Td>
                <Td>{j.params.from.slice(0, 10)} → {new Date(new Date(j.params.to).getTime() - 86400000).toISOString().slice(0, 10)}</Td>
                <Td><Badge tone={tone(j.status)}>{t(j.status)}</Badge>{j.error && <span className="block text-xs text-red-700">{translateMessage(locale, j.error)}</span>}</Td>
                <Td>{j.reconciliation ? t(j.reconciliation) : "—"}</Td>
                <Td align="right">{j.size ? `${(j.size / 1e6).toFixed(1)} MB` : "—"}</Td>
                <Td>{j.status === "COMPLETED" && j.expiresAt && new Date(j.expiresAt) > new Date() ? <a className="text-brand-700 underline" href={`/api/export/jobs/${j.id}/download`}>{t("Download")}</a> : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
