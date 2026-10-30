"use client";

import { useState } from "react";
import { Alert, Button, Input, Label } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

export function ForgotPasswordForm({ minutes }: { minutes: number }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await call("POST", "/api/auth/password-reset", { email: f.get("email") });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed"));
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <div className="mt-6"><Alert tone="green">{t("If the address belongs to an active account, a reset link is on its way. Check your inbox and spam folder; the link is valid for {minutes} minutes.", { minutes })}</Alert></div>;
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      {error && <Alert>{error}</Alert>}
      <div>
        <Label htmlFor="fp-email">{t("Email")}</Label>
        <Input id="fp-email" name="email" type="email" autoComplete="username" required maxLength={200} />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>{busy ? t("Sending…") : t("Send reset link")}</Button>
    </form>
  );
}
