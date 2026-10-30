"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirmPassword")) return setError(t("Passwords do not match"));
    setBusy(true);
    setError(null);
    try {
      await call("POST", "/api/auth/password-reset/confirm", { token, password: f.get("password"), confirmPassword: f.get("confirmPassword") });
      router.replace("/login?reset=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      {error && <Alert>{error}</Alert>}
      <div>
        <Label htmlFor="rp-new" hint={t("at least 10 characters")}>{t("New password")}</Label>
        <Input id="rp-new" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={200} />
      </div>
      <div>
        <Label htmlFor="rp-confirm">{t("Repeat new password")}</Label>
        <Input id="rp-confirm" name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={200} />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>{busy ? t("Saving…") : t("Set new password")}</Button>
    </form>
  );
}
