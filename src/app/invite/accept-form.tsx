"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label } from "@/components/ui";
import { call } from "@/lib/client";

export function AcceptForm({ token, name }: { token: string; name: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (f.get("password") !== f.get("password2")) return setErr("Passwords do not match");
        setBusy(true); setErr(null);
        try {
          await call("POST", "/api/invites/accept", { token, name: f.get("name"), password: f.get("password") });
          router.replace("/login?joined=1");
        } catch (e2) {
          setErr(e2 instanceof Error ? e2.message : "Failed");
        } finally { setBusy(false); }
      }}
    >
      <div><Label htmlFor="i-name">Your name</Label><Input id="i-name" name="name" defaultValue={name} required minLength={2} /></div>
      <div><Label htmlFor="i-pw" hint="at least 10 characters">Password</Label><Input id="i-pw" name="password" type="password" required minLength={10} autoComplete="new-password" /></div>
      <div><Label htmlFor="i-pw2">Repeat password</Label><Input id="i-pw2" name="password2" type="password" required minLength={10} autoComplete="new-password" /></div>
      {err && <Alert>{err}</Alert>}
      <Button type="submit" disabled={busy}>{busy ? "Creating account…" : "Create my account"}</Button>
    </form>
  );
}
