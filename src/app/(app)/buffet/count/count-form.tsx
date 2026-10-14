"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Table, Td, Th, cn } from "@/components/ui";
import { call } from "@/lib/client";
import { parseNum, qty } from "@/lib/format";
import { useT } from "@/i18n/client";
import { Title } from "@/components/title";

type Mode = "CONSUMPTION" | "WASTE";
interface Item { key: string; name: string; unit: string; isDish: boolean; issued: string | null; remaining: string | null; mode: Mode }

/** Opens (or creates) the breakfast day of a date, to record its issues. */
export function OpenDay({ date }: { date: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const s = await call<{ id: string }>("POST", "/api/buffet/days", { type: "BREAKFAST", serviceDate: date });
      router.push(`/buffet/${s.id}`);
    } catch (x) {
      setErr(x instanceof Error ? x.message : t("Failed"));
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      {err && <Alert>{err}</Alert>}
      <Button onClick={go} disabled={busy}>{t("Record issues")}</Button>
    </div>
  );
}

/**
 * The count sheet: one quantity box per issued item, a two-way Tüketim / Fire switch per row (the chosen one is green).
 * Built for typing from the paper sheet: Enter / ↓ next row, ↑ previous, T / F choose, Space switches, Tab passes the
 * switch on the way to the next row.
 */
export function CountForm({ sessionId, items, counted, editable }: { sessionId: string; items: Item[]; counted: boolean; editable: boolean }) {
  const t = useT();
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, { remaining: string; mode: Mode }>>(() => Object.fromEntries(items.map((i) => [i.key, { remaining: i.remaining === null ? "" : String(Number(i.remaining)).replace(".", ","), mode: i.mode }])));
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const toggles = useRef<Record<string, HTMLButtonElement | null>>({});

  // ready to type the first row straight away (also when correcting a saved count)
  useEffect(() => {
    if (editable) inputs.current[0]?.focus();
  }, [editable]);

  const setMode = (key: string, mode: Mode, focus = false) => {
    setVals((v) => ({ ...v, [key]: { ...v[key]!, mode } }));
    if (focus) requestAnimationFrame(() => toggles.current[`${key}|${mode}`]?.focus());
  };
  const goRow = (i: number) => {
    if (i >= items.length) return document.getElementById("bc-save")?.focus();
    const el = inputs.current[Math.max(0, i)];
    el?.focus();
    el?.select();
  };
  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>, i: number, key: string) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      goRow(i + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      goRow(i - 1);
    } else if (/^[tTfF]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setMode(key, /^[tT]$/.test(e.key) ? "CONSUMPTION" : "WASTE");
    }
  };
  const onToggleKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number, key: string) => {
    const cur = vals[key]!.mode;
    if (e.key === " " || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setMode(key, cur === "CONSUMPTION" ? "WASTE" : "CONSUMPTION", true);
    } else if (/^[tTfF]$/.test(e.key)) {
      e.preventDefault();
      setMode(key, /^[tT]$/.test(e.key) ? "CONSUMPTION" : "WASTE", true);
    } else if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      goRow(i + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      goRow(i);
    }
  };

  async function submit() {
    setMsg(null);
    const lines = items.map((i) => ({ key: i.key, remaining: vals[i.key]!.remaining.trim(), mode: vals[i.key]!.mode }));
    const bad = items.filter((i, k) => {
      const r = lines[k]!.remaining;
      return r !== "" && (!(parseNum(r) >= 0) || (i.issued !== null && parseNum(r) > Number(i.issued)));
    });
    if (bad.length) {
      const idx = items.indexOf(bad[0]!);
      goRow(idx);
      return setMsg({ tone: "red", text: t("Check the remaining quantity of {names}: a number from 0 up to the issued quantity.", { names: bad.map((b) => b.name).join(", ") }) });
    }
    setBusy(true);
    try {
      // an empty box means nothing is left
      await call("POST", `/api/buffet/sessions/${sessionId}/count`, { lines: lines.map((l) => ({ ...l, remaining: l.remaining === "" ? "0" : l.remaining })) });
      setMsg({ tone: "green", text: t("Breakfast count saved.") });
      router.refresh();
    } catch (x) {
      setMsg({ tone: "red", text: x instanceof Error ? x.message : t("Failed") });
    } finally {
      setBusy(false);
    }
  }

  const label: Record<Mode, string> = { CONSUMPTION: t("Consumption"), WASTE: t("Waste") };
  return (
    <div data-testid="breakfast-count">
      {msg && <div className="px-4 pt-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <Table label={t("Breakfast count")}>
        <thead>
          <tr><Th align="right">#</Th><Th>{t("Product")}</Th><Th align="right">{t("Issued")}</Th><Th align="right">{t("Remaining")}</Th><Th>{t("Remainder is")}</Th><Th align="right">{t("Consumption")}</Th></tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {items.map((i, k) => {
            const v = vals[i.key]!;
            const r = v.remaining.trim() === "" ? 0 : parseNum(v.remaining);
            const issued = Number(i.issued ?? 0);
            const wrong = Number.isNaN(r) || r < 0 || r > issued;
            return (
              <tr key={i.key}>
                <Td align="right" className="text-ink-400">{k + 1}</Td>
                <Td><span className="font-medium"><Title>{i.name}</Title></span>{i.isDish && <span className="ml-1 text-xs text-ink-400">({t("dish")})</span>}</Td>
                <Td align="right">{qty(i.issued, i.unit)}</Td>
                <Td align="right">
                  {editable ? (
                    <span className="inline-flex items-center gap-1.5">
                      <input ref={(el) => { inputs.current[k] = el; }} aria-label={t("Remaining {name}", { name: i.name })} inputMode="decimal" autoComplete="off" placeholder="0" className={cn("block w-24 rounded-lg border border-ink-200 bg-white px-3 py-2 text-right text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20", wrong && "border-red-400")} value={v.remaining} onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => onInputKey(e, k, i.key)} onChange={(e) => { const remaining = e.target.value; setVals((s) => ({ ...s, [i.key]: { ...s[i.key]!, remaining } })); }} />
                      <span className="w-6 text-left text-xs text-ink-500">{i.unit}</span>
                    </span>
                  ) : qty(i.remaining, i.unit)}
                </Td>
                <Td>
                  <div role="radiogroup" aria-label={t("Remainder of {name}", { name: i.name })} className="inline-flex overflow-hidden rounded-lg border border-ink-200">
                    {(["CONSUMPTION", "WASTE"] as const).map((m) => {
                      const on = v.mode === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          disabled={!editable}
                          tabIndex={on ? 0 : -1}
                          ref={(el) => { toggles.current[`${i.key}|${m}`] = el; }}
                          onClick={() => setMode(i.key, m)}
                          onKeyDown={(e) => onToggleKey(e, k, i.key)}
                          className={cn("px-3 py-1.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-800", on ? "bg-brand-600 text-white" : "bg-white text-ink-600 hover:bg-ink-50", m === "WASTE" && "border-l border-ink-200")}
                        >
                          {label[m]}
                        </button>
                      );
                    })}
                  </div>
                </Td>
                <Td align="right" className={wrong ? "text-red-700" : ""}>{wrong ? t("more than issued") : qty(issued - r, i.unit)}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {editable && (
        <div className="flex items-center gap-3 border-t border-ink-100 p-4">
          <Button id="bc-save" onClick={submit} disabled={busy}>{busy ? t("Saving…") : counted ? t("Save count again") : t("Save count")}</Button>
          <p className="text-xs text-ink-500">{t("An empty box counts as nothing left.")}</p>
        </div>
      )}
    </div>
  );
}
