"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { call } from "@/lib/client";
import { useLocale, useT } from "@/i18n/client";
import { translateMessage } from "@/i18n/core";

export function DoneButton({ taskId, dueDate }: { taskId: string; dueDate: string }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
        const note = window.prompt(t("Note (optional):"));
        if (note === null) return; // Cancel: the control stays open
        setErr(null);
        setBusy(true);
        try {
          await call("POST", "/api/calendar/complete", { taskId, dueDate, note: note.trim() || null });
          router.refresh();
        } catch (e) {
          setErr(e instanceof Error ? translateMessage(locale, e.message) : t("Failed"));
        } finally {
          setBusy(false);
        }
      }}>{t("Mark done")}</Button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </span>
  );
}

/** Owner role = a role key of the organization (completing a control compares it with the user's role key); empty = period managers only. */
export function NewTask({ roles }: { roles: { key: string; name: string }[] }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [rec, setRec] = useState("WEEKLY");
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
      setMsg(null);
      setBusy(true);
      try {
        await call("POST", "/api/calendar/tasks", { title: f.title, recurrence: rec, weekday: rec === "WEEKLY" ? f.weekday : null, monthDay: rec === "MONTHLY" ? f.monthDay : null, ownerRole: f.ownerRole || null });
        setMsg({ tone: "green", text: t("Task added") });
        form.reset();
        router.refresh();
      } catch (x) {
        setMsg({ tone: "red", text: x instanceof Error ? translateMessage(locale, x.message) : t("Failed") });
      } finally {
        setBusy(false);
      }
    }}>
      {msg && <div className="w-full"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div><Label htmlFor="ct-title">{t("Control task")}</Label><Input id="ct-title" name="title" required minLength={3} placeholder={t("Bar spirits spot check")} /></div>
      <div><Label htmlFor="ct-rec">{t("Recurrence")}</Label><Select id="ct-rec" value={rec} onChange={(e) => setRec(e.target.value)}><option value="WEEKLY">{t("WEEKLY")}</option><option value="MONTHLY">{t("MONTHLY")}</option></Select></div>
      {rec === "WEEKLY" ? <div><Label htmlFor="ct-wd">{t("Weekday")}</Label><Select id="ct-wd" name="weekday">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => <option key={d} value={i + 1}>{t(d)}</option>)}</Select></div> : <div><Label htmlFor="ct-md" hint={t("0 = last day")}>{t("Day of month")}</Label><Input id="ct-md" name="monthDay" inputMode="numeric" defaultValue="0" className="w-20" /></div>}
      <div><Label htmlFor="ct-owner">{t("Owner role")}</Label><Select id="ct-owner" name="ownerRole" defaultValue="" className="w-48"><option value="">{t("— (period managers only)")}</option>{roles.map((r) => <option key={r.key} value={r.key}>{t(r.name)}</option>)}</Select></div>
      <Button type="submit" disabled={busy}>{t("Add task")}</Button>
    </form>
  );
}
