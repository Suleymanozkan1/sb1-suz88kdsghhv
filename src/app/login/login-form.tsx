"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

export function LoginForm() {
  const router = useRouter();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await call("POST", "/api/auth/login", { email: f.get("email"), password: f.get("password") });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Sign-in failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <div>
        <Label htmlFor="email">{t("Email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div>
        <Label htmlFor="password">{t("Password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? t("Signing in…") : t("Sign in")}
      </Button>
    </form>
  );
}
