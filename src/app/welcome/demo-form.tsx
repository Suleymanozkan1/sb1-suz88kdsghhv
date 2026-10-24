"use client";

import { useState } from "react";
import { Alert, Button, Input, Label } from "@/components/ui";
import { call } from "@/lib/client";
import { useLocale, useT } from "@/i18n/client";
import { translateMessage } from "@/i18n/core";

/** Demo request: stored and sent to the operator (src/server/services/demo-requests.ts). */
export function DemoForm() {
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  if (state === "sent") return <Alert tone="green">{t("Thank you. Your request has reached us and we will get back to you.")}</Alert>;
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setState("busy");
        try {
          await call("POST", "/api/demo-request", Object.fromEntries(new FormData(e.currentTarget).entries()));
          setState("sent");
        } catch (err) {
          setError(err instanceof Error ? translateMessage(locale, err.message) : t("Failed"));
          setState("idle");
        }
      }}
    >
      {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
      <div><Label htmlFor="dr-name">{t("Name")}</Label><Input id="dr-name" name="name" required minLength={2} maxLength={120} autoComplete="name" /></div>
      <div><Label htmlFor="dr-company">{t("Hotel or company")}</Label><Input id="dr-company" name="company" required minLength={2} maxLength={160} autoComplete="organization" /></div>
      <div><Label htmlFor="dr-email">{t("E-mail")}</Label><Input id="dr-email" name="email" type="email" required maxLength={200} autoComplete="email" /></div>
      <div><Label htmlFor="dr-phone">{t("Phone (optional)")}</Label><Input id="dr-phone" name="phone" type="tel" maxLength={40} autoComplete="tel" /></div>
      <div><Label htmlFor="dr-rooms">{t("Number of rooms (optional)")}</Label><Input id="dr-rooms" name="rooms" inputMode="numeric" maxLength={6} /></div>
      <div className="sm:col-span-2"><Label htmlFor="dr-msg">{t("What would you like to see? (optional)")}</Label><textarea id="dr-msg" name="message" maxLength={1000} rows={3} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" /></div>
      {/* honeypot: hidden from people, filled by bots */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <div className="sm:col-span-2"><Button type="submit" disabled={state === "busy"}>{t("Request a demo")}</Button></div>
    </form>
  );
}
