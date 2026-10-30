"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Input, Label } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

export function ChangePasswordForm({ back }: { back: string }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (f.get("newPassword") !== f.get("confirmPassword")) return setError(t("Passwords do not match"));
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ sessionsEnded: number }>("POST", "/api/auth/password", { currentPassword: f.get("currentPassword"), newPassword: f.get("newPassword"), confirmPassword: f.get("confirmPassword") });
      form.reset();
      setDone(r.sessionsEnded);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      {error && <Alert>{error}</Alert>}
      {done !== null && <Alert tone="green">{done > 0 ? t("Your password was changed. You were signed out on {n} other device(s).", { n: done }) : t("Your password was changed.")}</Alert>}
      <div>
        <Label htmlFor="cp-current">{t("Current password")}</Label>
        <Input id="cp-current" name="currentPassword" type="password" autoComplete="current-password" required />
      </div>
      <div>
        <Label htmlFor="cp-new" hint={t("at least 10 characters")}>{t("New password")}</Label>
        <Input id="cp-new" name="newPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={200} />
      </div>
      <div>
        <Label htmlFor="cp-confirm">{t("Repeat new password")}</Label>
        <Input id="cp-confirm" name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={200} />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>{busy ? t("Saving…") : t("Change password")}</Button>
      <p className="text-center text-sm"><Link href={back} className="font-medium text-brand-700 hover:underline">{t("Back to HotelCost")}</Link></p>
    </form>
  );
}
