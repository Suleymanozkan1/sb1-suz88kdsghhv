"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input } from "@/components/ui";
import { call } from "@/lib/client";
import { useLocale, useT } from "@/i18n/client";
import { translateMessage } from "@/i18n/core";

type Item = { name: string; amount: string };

/** The month's items: rename, change amounts, add or remove rows, then save them together. */
export function RoomCostItemsForm({ month, items, canEdit }: { month: string; items: Item[]; canEdit: boolean }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [rows, setRows] = useState<Item[]>(items);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const set = (i: number, patch: Partial<Item>) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + (Number(r.amount.replace(",", ".")) || 0), 0);
  async function save() {
    setMsg(null);
    setBusy(true);
    try {
      const filled = rows.filter((r) => r.name.trim());
      await call("PUT", "/api/rooms/expenses", { month, items: filled.map((r) => ({ name: r.name.trim(), amount: r.amount.trim() || "0" })) });
      setMsg({ tone: "green", text: t("Saved — room cost uses the new amounts") });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? translateMessage(locale, e.message) : t("Failed") });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-500"><th className="pb-1">{t("Item")}</th><th className="w-44 pb-1 text-right">{t("Amount")}</th>{canEdit && <th className="w-10" />}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-1 pr-2"><Input aria-label={t("Item {n} name", { n: i + 1 })} value={r.name} disabled={!canEdit} maxLength={120} onChange={(e) => set(i, { name: e.target.value })} /></td>
              <td className="py-1"><Input aria-label={t("Item {n} amount", { n: i + 1 })} value={r.amount} disabled={!canEdit} inputMode="decimal" placeholder="0" className="text-right" onChange={(e) => set(i, { amount: e.target.value })} /></td>
              {canEdit && <td className="py-1 pl-1"><Button type="button" size="sm" variant="ghost" aria-label={t("Remove item {n}", { n: i + 1 })} onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))}>✕</Button></td>}
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="font-semibold"><td className="pt-2">{t("Total")}</td><td className="pt-2 text-right tabular-nums">{total.toLocaleString(locale === "tr" ? "tr-TR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>{canEdit && <td />}</tr></tfoot>
      </table>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setRows((rs) => [...rs, { name: "", amount: "" }])}>{t("Add item")}</Button>
          <Button type="button" disabled={busy} onClick={() => void save()}>{t("Save month")}</Button>
        </div>
      ) : <p className="text-xs text-ink-500">{t("Only roles that manage operating costs can change these amounts.")}</p>}
    </div>
  );
}
