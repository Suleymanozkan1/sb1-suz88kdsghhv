"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label } from "@/components/ui";
import { call } from "@/lib/client";
import { useLocale, useT } from "@/i18n/client";

export function SetupForm({ secretKind }: { secretKind: "token" | "db-password" }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim();
    if (v("adminPassword") !== v("adminPassword2")) return setErr(t("The passwords do not match"));
    setBusy(true);
    setErr(null);
    try {
      const r = await call<{ demo: boolean }>("POST", "/api/setup", {
        secret: v("secret"), organizationName: v("organizationName"), hotelName: v("hotelName"), hotelCode: v("hotelCode").toUpperCase(),
        totalRooms: v("totalRooms") || "0", baseCurrency: v("baseCurrency") || "TRY", adminName: v("adminName"), adminEmail: v("adminEmail"),
        adminPassword: v("adminPassword"), loadDemo: f.get("loadDemo") === "on", locale,
      });
      router.replace(r.demo ? "/setup/demo" : "/");
      router.refresh();
    } catch (x) {
      setErr(x instanceof Error ? x.message : t("Setup failed"));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-5">
      {err && <Alert>{err}</Alert>}
      <fieldset className="rounded-xl border border-ink-200 p-4">
        <legend className="px-1 text-sm font-medium text-ink-800">{t("Setup code")}</legend>
        <Label htmlFor="secret">{secretKind === "token" ? t("SETUP_TOKEN value") : t("Database password")}</Label>
        <Input id="secret" name="secret" type="password" required autoComplete="off" />
        <p className="mt-1.5 text-xs text-ink-500">
          {secretKind === "token"
            ? t("The value of the SETUP_TOKEN environment variable of this deployment.")
            : t("Vercel → your project → Settings → Environment Variables → PGPASSWORD → click the eye icon and copy the value. This proves you own the installation.")}
        </p>
      </fieldset>
      <fieldset className="grid gap-3 rounded-xl border border-ink-200 p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-medium text-ink-800">{t("Company and hotel")}</legend>
        <div className="sm:col-span-2"><Label htmlFor="organizationName">{t("Company name")}</Label><Input id="organizationName" name="organizationName" required minLength={2} /></div>
        <div><Label htmlFor="hotelName">{t("Hotel name")}</Label><Input id="hotelName" name="hotelName" required minLength={2} /></div>
        <div><Label htmlFor="hotelCode" hint={t("letters and digits")}>{t("Hotel code")}</Label><Input id="hotelCode" name="hotelCode" required pattern="[A-Za-z0-9][A-Za-z0-9_-]*" maxLength={20} placeholder="IST1" /></div>
        <div><Label htmlFor="totalRooms">{t("Number of rooms")}</Label><Input id="totalRooms" name="totalRooms" type="number" min={0} defaultValue={100} /></div>
        <div><Label htmlFor="baseCurrency">{t("Currency")}</Label><Input id="baseCurrency" name="baseCurrency" defaultValue="TRY" maxLength={3} /></div>
      </fieldset>
      <fieldset className="grid gap-3 rounded-xl border border-ink-200 p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-medium text-ink-800">{t("Administrator")}</legend>
        <div><Label htmlFor="adminName">{t("Name")}</Label><Input id="adminName" name="adminName" required minLength={2} autoComplete="name" /></div>
        <div><Label htmlFor="adminEmail">{t("Email")}</Label><Input id="adminEmail" name="adminEmail" type="email" required autoComplete="username" /></div>
        <div><Label htmlFor="adminPassword" hint={t("min 10")}>{t("Password")}</Label><Input id="adminPassword" name="adminPassword" type="password" required minLength={10} autoComplete="new-password" /></div>
        <div><Label htmlFor="adminPassword2">{t("Password again")}</Label><Input id="adminPassword2" name="adminPassword2" type="password" required minLength={10} autoComplete="new-password" /></div>
      </fieldset>
      <label className="flex items-start gap-2 text-sm text-ink-800">
        <input type="checkbox" name="loadDemo" className="mt-0.5 h-4 w-4 rounded border-ink-300" />
        <span>{t("Also load demo companies")}<span className="block text-xs text-ink-500">{t("Two sample companies with three hotels and one month of data, for trying the program. Demo users get the password above. You can remove them later.")}</span></span>
      </label>
      <Button type="submit" className="w-full" disabled={busy}>{busy ? t("Setting up…") : t("Complete setup")}</Button>
    </form>
  );
}
