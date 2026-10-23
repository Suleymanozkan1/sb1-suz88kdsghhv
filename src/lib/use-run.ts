"use client";
/**
 * Runs a server call from a form: busy flag, translated error or success message, then a refresh so the server
 * components re-read. Several older screens carry a private copy of this hook; new screens use this one.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "@/i18n/client";
import { translateMessage } from "@/i18n/core";

export function useRun() {
  const router = useRouter();
  const locale = useLocale();
  const t = useT();
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      setMsg({ tone: "green", text: ok });
      router.refresh();
      return true;
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? translateMessage(locale, e.message) : t("Failed") });
      return false;
    } finally {
      setBusy(false);
    }
  }
  const fail = (text: string) => setMsg({ tone: "red", text });
  return { msg, busy, run, fail };
}
