"use client";

import { useRouter } from "next/navigation";
import { setLocaleCookie, useLocale, useT } from "@/i18n/client";
import type { Locale } from "@/i18n/core";

/** TR / EN switch for pages outside the app shell (sign-in, setup, invitation). */
export function LanguageSwitch() {
  const router = useRouter();
  const locale = useLocale();
  const t = useT();
  return (
    <>
      <label htmlFor="lang-switch" className="sr-only">{t("Language")}</label>
      <select id="lang-switch" value={locale} onChange={(e) => { setLocaleCookie(e.target.value as Locale); router.refresh(); }} className="rounded-md border border-ink-200 bg-white px-2 py-1 text-xs text-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-500">
        <option value="tr">TR</option>
        <option value="en">EN</option>
      </select>
    </>
  );
}
