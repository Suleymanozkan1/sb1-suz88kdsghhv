"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Label } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";
import type { DemoState } from "@/server/setup";

const DEMO_ACCOUNTS = [
  ["companyadmin@test.local", "Company Administrator"],
  ["controller@test.local", "Cost Controller"],
  ["chef@test.local", "Chef"],
  ["warehouse@test.local", "Warehouse User"],
  ["viewer@test.local", "Viewer (read-only)"],
] as const;

export function DemoPanel({ initial }: { initial: DemoState }) {
  const t = useT();
  const [s, setS] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setS(await call<DemoState>("GET", "/api/setup/demo"));
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    }
  }, []);
  // the dataset is built one step per request (each fits the hosting time limit); one request at a time
  const stepping = useRef(false);
  useEffect(() => {
    if (s.state !== "running" || stepping.current) return;
    stepping.current = true;
    let alive = true;
    void (async () => {
      let prev = -1;
      try {
        for (;;) {
          const next = await call<DemoState>("POST", "/api/setup/demo/step");
          if (!alive) return;
          setS(next);
          if (next.state !== "running") return;
          // another tab is running the current step: wait instead of asking again at once
          if (next.done === prev) await new Promise((r) => setTimeout(r, 3000));
          prev = next.done;
        }
      } catch (x) {
        if (alive) setErr(x instanceof Error ? x.message : String(x));
      } finally {
        stepping.current = false;
      }
    })();
    return () => {
      alive = false;
    };
  }, [s.state]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await refresh();
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4 text-sm">
      {err && <Alert>{err}</Alert>}
      {s.state === "running" && (
        <Alert tone="amber">
          {t("Demo data is being loaded. Keep this page open; it takes a few minutes.")}{" "}
          ({t("Step {d}/{n}", { d: s.done, n: s.total })}{s.next ? ` · ${s.next}` : ""})
        </Alert>
      )}
      {s.state === "done" && (
        <>
          <Alert tone="green">{t("Demo data is ready: {c} companies, {h} hotels, {u} users.", { c: s.companies, h: s.hotels, u: s.users })}</Alert>
          <div>
            <p className="font-medium text-ink-900">{t("Demo accounts (password: the one you set during setup)")}</p>
            <ul className="mt-2 space-y-1 font-mono text-xs text-ink-700">
              {DEMO_ACCOUNTS.map(([email, role]) => <li key={email}>{email} <span className="font-sans text-ink-500">· {t(role)}</span></li>)}
            </ul>
            <p className="mt-2 text-xs text-ink-500">{t("To try them, sign out and sign in with one of these addresses. Your own company is not affected.")}</p>
          </div>
          <Button variant="danger" disabled={busy} onClick={() => window.confirm(t("Remove all demo companies and their data?")) && void act(() => call("DELETE", "/api/setup/demo"))}>{t("Remove demo data")}</Button>
        </>
      )}
      {s.state === "failed" && (
        <>
          <Alert>{t("Loading the demo data did not finish.")}{s.error ? ` (${s.error})` : ""}</Alert>
          {s.companies > 0 && <Button variant="secondary" disabled={busy} onClick={() => void act(() => call("DELETE", "/api/setup/demo"))}>{t("Clean up and start again")}</Button>}
        </>
      )}
      {(s.state === "none" || (s.state === "failed" && s.companies === 0)) && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const pw = String(new FormData(e.currentTarget).get("password") ?? ""); void act(() => call("POST", "/api/setup/demo", { password: pw })); }}>
          <p className="text-ink-700">{t("Load two sample companies with three hotels and one month of data. Demo users get your password.")}</p>
          <div><Label htmlFor="pw">{t("Your password")}</Label><Input id="pw" name="password" type="password" required autoComplete="current-password" /></div>
          <Button type="submit" disabled={busy}>{t("Load demo data")}</Button>
        </form>
      )}
      <p><Link href="/" className="font-medium text-brand-700 hover:underline">{t("Go to the dashboard")}</Link></p>
    </div>
  );
}
