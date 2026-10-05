"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { call } from "@/lib/client";
import { useLocale, useT } from "@/i18n/client";
import { translateMessage } from "@/i18n/core";

function useRun() {
  const router = useRouter();
  const locale = useLocale();
  const t = useT();
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      setMsg({ tone: "green", text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? translateMessage(locale, e.message) : t("Failed") });
    } finally {
      setBusy(false);
    }
  }
  return { msg, busy, run };
}

export function NewBudget({ year }: { year: number }) {
  const t = useT();
  const { msg, busy, run } = useRun();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget).entries()); void run(() => call("POST", "/api/budgets", f), t("Draft budget created — load its lines below")); }}>
      {msg && <div className="w-full"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div><Label htmlFor="nb-year">{t("Year")}</Label><Input id="nb-year" name="year" defaultValue={year} className="w-24" /></div>
      <div><Label htmlFor="nb-name">{t("Name")}</Label><Input id="nb-name" name="name" required minLength={2} placeholder={t("Original budget")} /></div>
      <Button type="submit" disabled={busy}>{t("Create draft")}</Button>
    </form>
  );
}

export function BudgetLinesUpload({ budgets }: { budgets: { id: string; label: string }[] }) {
  const t = useT();
  const { msg, busy, run } = useRun();
  const [id, setId] = useState(budgets[0]?.id ?? "");
  const [csv, setCsv] = useState("");
  return (
    <div className="space-y-2">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <div><Label htmlFor="bl-budget">{t("Draft budget")}</Label><Select id="bl-budget" value={id} onChange={(e) => setId(e.target.value)}>{budgets.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</Select></div>
        <input type="file" accept=".csv" aria-label={t("Budget CSV file")} className="text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
      </div>
      <textarea aria-label={t("Budget CSV")} className="h-24 w-full rounded-lg border border-ink-200 p-2 font-mono text-xs" placeholder={"month,department,category,amount,target_pct\n10,REST,FOOD,185000,0.28\n10,,ENERGY,240000,"} value={csv} onChange={(e) => setCsv(e.target.value)} />
      <Button disabled={!id || !csv || busy} onClick={() => run(() => call("PUT", `/api/budgets/${id}/lines`, { csv }), t("Budget lines replaced"))}>{t("Replace budget lines")}</Button>
    </div>
  );
}

export function BudgetActions({ id, status, canApprove }: { id: string; status: string; canApprove: boolean }) {
  const t = useT();
  const { msg, busy, run } = useRun();
  return (
    <span className="inline-flex items-center gap-1">
      {status === "DRAFT" && canApprove && <Button size="sm" variant="secondary" disabled={busy} onClick={() => window.confirm(t("Approve this budget? Approved budgets are frozen; changes need a revision.")) && run(() => call("POST", `/api/budgets/${id}/approve`), t("Approved"))}>{t("Approve")}</Button>}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const name = window.prompt(t("Revision name:")); if (!name) return; const factor = window.prompt(t("Scale all lines by (e.g. 1.05):"), "1") ?? "1"; void run(() => call("POST", `/api/budgets/${id}/revise`, { name, factor }), t("Revision created")); }}>{t("Revise")}</Button>
      {msg?.tone === "red" && <span className="text-xs text-red-700">{msg.text}</span>}
    </span>
  );
}

export function TargetForm({ metrics }: { metrics: { key: string; label: string; unit: string }[] }) {
  const t = useT();
  const { msg, busy, run } = useRun();
  const [m, setM] = useState(metrics[0]?.key ?? "");
  const unit = metrics.find((x) => x.key === m)?.unit;
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
      const conv = (v: string) => (v === "" ? null : unit === "pct" ? String(Number(v) / 100) : v);
      void run(() => call("POST", "/api/targets", { metric: m, target: conv(f.target!), warnAt: conv(f.warnAt ?? ""), direction: f.direction }), t("Target saved"));
    }}>
      {msg && <div className="w-full"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div><Label htmlFor="tg-metric">{t("Metric")}</Label><Select id="tg-metric" value={m} onChange={(e) => setM(e.target.value)}>{metrics.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</Select></div>
      <div><Label htmlFor="tg-target">{t("Target")} {unit === "pct" ? "(%)" : ""}</Label><Input id="tg-target" name="target" inputMode="decimal" required className="w-28" /></div>
      <div><Label htmlFor="tg-warn">{t("Warn at")} {unit === "pct" ? "(%)" : ""}</Label><Input id="tg-warn" name="warnAt" inputMode="decimal" className="w-28" /></div>
      <div><Label htmlFor="tg-dir">{t("Direction")}</Label><Select id="tg-dir" name="direction"><option value="MAX">{t("Stay below")}</option><option value="MIN">{t("Stay above")}</option></Select></div>
      <Button type="submit" disabled={busy}>{t("Set target")}</Button>
    </form>
  );
}
