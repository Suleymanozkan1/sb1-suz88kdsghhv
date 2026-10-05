"use client";

import { createContext, useContext, useMemo } from "react";
import { LANG_COOKIE, makeT, type Locale, type T } from "./core";

const Ctx = createContext<Locale>("tr");

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>;
}

export const useLocale = () => useContext(Ctx);

export function useT(): T {
  const locale = useContext(Ctx);
  return useMemo(() => makeT(locale), [locale]);
}

/** Store the choice for a year; the caller refreshes the page so server components re-render. */
export function setLocaleCookie(locale: Locale) {
  document.cookie = `${LANG_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}
