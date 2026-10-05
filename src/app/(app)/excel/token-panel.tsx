"use client";

import { Fragment, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { call } from "@/lib/client";
import { dateTime } from "@/lib/format";
import { useLocale, useT } from "@/i18n/client";
import { translateMessage } from "@/i18n/core";

/** Fill {name} slots of a translated sentence with elements (bold words, code, badges). */
function rich(text: string, parts: Record<string, React.ReactNode>): React.ReactNode[] {
  return text.split(/\{(\w+)\}/).map((s, i) => (i % 2 ? <Fragment key={i}>{parts[s] ?? `{${s}}`}</Fragment> : s));
}

export function TokenPanel({ timezone }: { timezone: string }) {
  const t = useT();
  const locale = useLocale();
  const [token, setToken] = useState<{ token: string; expiresAt: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-ink-600">{rich(t("Excel asks for this token when you click the button. It is shown {once}, valid for 30 days, and never stored in the workbook."), { once: <strong>{t("once")}</strong> })}</p>
      {err && <Alert>{err}</Alert>}
      {token ? (
        <div className="space-y-2">
          <code className="block break-all rounded-lg bg-ink-950 p-3 font-mono text-xs text-brand-200" data-testid="api-token">{token.token}</code>
          <p className="text-xs text-ink-500">{t("Expires {date}. Copy it now.", { date: dateTime(token.expiresAt, timezone) })}</p>
        </div>
      ) : (
        <Button onClick={async () => { try { setToken(await call("POST", "/api/auth/api-token")); } catch (e) { setErr(e instanceof Error ? translateMessage(locale, e.message) : t("Failed")); } }}>{t("Create token")}</Button>
      )}
    </div>
  );
}
