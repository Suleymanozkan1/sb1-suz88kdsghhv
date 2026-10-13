"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Alert, Badge, Button, Input, Label, Select } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

type Kind = "ON_HOUSE" | "HOSPITALITY";
interface Reason { id: string; kind: Kind; name: string; noteRequired: boolean; active: boolean }

/** The hotel's reason list: add, rename, explanation required or not, deactivate, order. */
export function ReasonList({ reasons }: { reasons: Reason[] }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<Kind>("ON_HOUSE");
  const [name, setName] = useState("");
  const [noteRequired, setNoteRequired] = useState(true);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("Failed"));
    } finally {
      setBusy(false);
    }
  }
  const patch = (id: string, body: Record<string, unknown>) => run(() => call("PATCH", `/api/comps/reasons/${id}`, body));

  return (
    <div className="space-y-4">
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        {(["ON_HOUSE", "HOSPITALITY"] as const).map((k) => {
          const list = reasons.filter((r) => r.kind === k);
          return (
            <div key={k}>
              <h3 className="mb-2 text-sm font-semibold text-ink-800">{t(k === "ON_HOUSE" ? "On-house" : "Hospitality")}</h3>
              <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100 text-sm">
                {list.map((r, i) => {
                  const edited = names[r.id];
                  return (
                    <li key={r.id} className={`flex flex-wrap items-center gap-2 px-2 py-1.5 ${r.active ? "" : "opacity-60"}`}>
                      <Input aria-label={t("Reason name")} value={edited ?? r.name} onChange={(e) => setNames((n) => ({ ...n, [r.id]: e.target.value }))} className="w-48 flex-1" />
                      {edited !== undefined && edited.trim() !== r.name && <Button size="sm" disabled={busy || edited.trim().length < 2} onClick={() => patch(r.id, { name: edited.trim() }).then(() => setNames((n) => { const c = { ...n }; delete c[r.id]; return c; }))}>{t("Save")}</Button>}
                      <label className="flex items-center gap-1 text-xs text-ink-600"><input type="checkbox" checked={r.noteRequired} disabled={busy} onChange={(e) => patch(r.id, { noteRequired: e.target.checked })} /> {t("Explanation required")}</label>
                      {!r.active && <Badge>{t("inactive")}</Badge>}
                      <Button size="sm" variant="ghost" disabled={busy || i === 0} aria-label={t("Move up")} onClick={() => patch(r.id, { move: "up" })}><ArrowUp className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" disabled={busy || i === list.length - 1} aria-label={t("Move down")} onClick={() => patch(r.id, { move: "down" })}><ArrowDown className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => patch(r.id, { active: !r.active })}>{r.active ? t("Deactivate") : t("Activate")}</Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-2 border-t border-ink-100 pt-3">
        <div>
          <Label htmlFor="nr-kind">{t("Comp type")}</Label>
          <Select id="nr-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="w-36">
            <option value="ON_HOUSE">{t("On-house")}</option>
            <option value="HOSPITALITY">{t("Hospitality")}</option>
          </Select>
        </div>
        <div><Label htmlFor="nr-name">{t("New reason")}</Label><Input id="nr-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="w-56" /></div>
        <label className="flex items-center gap-1 pb-2 text-xs text-ink-600"><input type="checkbox" checked={noteRequired} onChange={(e) => setNoteRequired(e.target.checked)} /> {t("Explanation required")}</label>
        <Button type="button" disabled={busy || name.trim().length < 2} onClick={() => run(() => call("POST", "/api/comps/reasons", { kind, name: name.trim(), noteRequired })).then(() => setName(""))}>{t("Add reason")}</Button>
      </div>
    </div>
  );
}
