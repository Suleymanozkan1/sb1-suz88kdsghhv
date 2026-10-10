"use client";

import { titleTr } from "@/lib/format";
import { useLocale } from "@/i18n/client";

/** A heading or product name in display title case for the reader's language ("dana incik" → "Dana İncik"). */
export function Title({ children }: { children: string | null | undefined }) {
  return <>{titleTr(children, useLocale())}</>;
}
