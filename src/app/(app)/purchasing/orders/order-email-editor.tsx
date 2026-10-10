"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Input, Label } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";
import { DEFAULT_ORDER_EMAIL, ORDER_EMAIL_PLACEHOLDERS, renderOrderEmail, type OrderLine } from "./order-email";
import { Title } from "@/components/title";

export interface TemplateProps {
  template: { subject: string; body: string; custom: boolean };
  hotel: string;
  today: string;
  /** what the preview shows: the supplier and the lines of the first due order (or sample rows) */
  sample: { supplier: string; lines: OrderLine[] };
  canManage: boolean;
}

/** The order e-mail suppliers receive: the hotel edits subject and text (placeholders), sees a live preview, can go back to the default. */
export function OrderEmailEditor({ template, hotel, today, sample, canManage }: TemplateProps) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = useState({ subject: template.subject, body: template.body });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const dirty = v.subject !== template.subject || v.body !== template.body;
  const preview = renderOrderEmail(v, { supplier: sample.supplier, hotel, date: today, lines: sample.lines });

  async function run(fn: () => Promise<{ subject: string; body: string }>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setV({ subject: r.subject, body: r.body });
      setMsg({ tone: "green", text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : t("Failed") });
    } finally {
      setBusy(false);
    }
  }
  const save = () => run(() => call("PUT", "/api/auto-order/template", v), t("Order e-mail template saved."));
  const reset = () => {
    if (confirm(t("Replace the order e-mail with the default template?"))) void run(() => call("DELETE", "/api/auto-order/template"), t("The default template is back."));
  };

  return (
    <details className="rounded-xl border border-ink-200 bg-white" data-testid="order-email-template">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-ink-800">
        <Title>{t("Order e-mail template")}</Title>
        <Badge tone={template.custom ? "blue" : "gray"}>{template.custom ? t("Edited") : t("Default")}</Badge>
      </summary>
      <div className="grid gap-4 border-t border-ink-100 p-4 lg:grid-cols-2">
        <div className="space-y-3">
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <div><Label htmlFor="oe-s">{t("Subject")}</Label><Input id="oe-s" disabled={!canManage} value={v.subject} maxLength={200} onChange={(e) => setV({ ...v, subject: e.target.value })} /></div>
          <div>
            <Label htmlFor="oe-b">{t("E-mail text")}</Label>
            <textarea id="oe-b" disabled={!canManage} className="h-64 w-full rounded-lg border border-ink-200 p-2 text-sm disabled:bg-ink-50" maxLength={5000} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
          </div>
          <p className="text-xs text-ink-500">
            {t("Placeholders")}: {ORDER_EMAIL_PLACEHOLDERS.map((p) => <code key={p} className="mr-1 rounded bg-ink-100 px-1">{p}</code>)}
            <span className="block">{t("{supplier} company name, {hotel} hotel name, {date} order date, {lines} the product / quantity / unit table (required).")}</span>
          </p>
          {canManage && (
            <div className="flex gap-2">
              <Button disabled={busy || !dirty || !v.subject.trim() || !v.body.includes("{lines}")} onClick={save}>{t("Save template")}</Button>
              <Button variant="secondary" disabled={busy || (!template.custom && v.subject === DEFAULT_ORDER_EMAIL.subject && v.body === DEFAULT_ORDER_EMAIL.body)} onClick={reset}>{t("Reset to default")}</Button>
            </div>
          )}
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-500">{t("Preview")}</p>
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-3">
            <p className="mb-2 text-sm"><span className="text-ink-500">{t("Subject")}:</span> <span className="font-medium">{preview.subject}</span></p>
            {/* the template is escaped by renderOrderEmail: only its own table markup is HTML */}
            <div className="rounded bg-white p-3" data-testid="order-email-preview" dangerouslySetInnerHTML={{ __html: preview.html }} />
          </div>
        </div>
      </div>
    </details>
  );
}
