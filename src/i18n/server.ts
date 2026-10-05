/** Server-side locale: the hc_lang cookie, else the default. Use in server components and route handlers. */
import { cookies } from "next/headers";
import { cache } from "react";
import { defaultLocale, LANG_COOKIE, makeT, normalizeLocale, type Locale, type T } from "./core";

export const getLocale = cache(async (): Promise<Locale> => normalizeLocale((await cookies()).get(LANG_COOKIE)?.value) ?? defaultLocale());

export async function getT(): Promise<T> {
  return makeT(await getLocale());
}
