"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

/** A breakfast record: meal (breakfast only) and date; an existing record of that date is simply opened. */
export function NewDay({ today }: { today: string }) {
  const t = useT();
  const router = useRouter();
  const [day, setDay] = useState(today); // the hotel's business day (night audit cut-off), not the UTC or calendar day
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return setErr(t("Invalid date"));
    setErr(null);
    setBusy(true);
    try {
      const s = await call<{ id: string }>("POST", "/api/buffet/days", { type: "BREAKFAST", serviceDate: day });
      router.push(`/buffet/${s.id}`); // busy stays on while the day page loads
    } catch (x) {
      setErr(x instanceof Error ? x.message : t("Failed"));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3" data-testid="new-breakfast-day">
      {err && <div className="w-full"><Alert>{err}</Alert></div>}
      <div className="w-40"><Label htmlFor="bd-meal">{t("Meal")}</Label><Select id="bd-meal" name="type" defaultValue="BREAKFAST"><option value="BREAKFAST">{t("BREAKFAST")}</option></Select></div>
      <div className="w-44"><Label htmlFor="bd-date">{t("Date")}</Label><Input id="bd-date" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} /></div>
      <Button type="submit" disabled={busy}>{busy ? t("Opening…") : t("Create")}</Button>
    </form>
  );
}
