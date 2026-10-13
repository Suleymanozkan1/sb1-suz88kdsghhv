"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { ProductPicker, unitsFor, type PickedProduct } from "@/components/product-picker";
import { call } from "@/lib/client";
import { money, parseNum } from "@/lib/format";
import { useT } from "@/i18n/client";

type Kind = "ON_HOUSE" | "HOSPITALITY";
interface Reason { id: string; kind: Kind; name: string; noteRequired: boolean }
interface Line { key: string; mode: "recipe" | "product"; recipeId: string; product: PickedProduct | null; quantity: string; unit: string }
// the first line is server-rendered: its key (used in element ids) must be the same on server and client
const blank = (key: string = crypto.randomUUID()): Line => ({ key, mode: "recipe", recipeId: "", product: null, quantity: "1", unit: "" });

/**
 * Manual entry of an on-house / hospitality record (the fallback when Micros / Opera did not send it): what was
 * served — dishes / drinks by recipe, or products as they are — to whom and why. Saving deducts it from the store.
 */
export function CompForm({ today, currency, departments, warehouses, recipes, reasons }: {
  /** business day (night audit), not the calendar day */
  today: string;
  currency: string;
  departments: Array<{ id: string; name: string; storeId: string | null }>;
  warehouses: Array<{ id: string; name: string }>;
  recipes: Array<{ id: string; name: string; posCode: string | null; departmentId: string | null }>;
  reasons: Reason[];
}) {
  const router = useRouter();
  const t = useT();
  const [kind, setKind] = useState<Kind>("ON_HOUSE");
  const [dept, setDept] = useState(departments[0]?.id ?? "");
  const [wh, setWh] = useState("");
  const [day, setDay] = useState(today);
  const [reasonId, setReasonId] = useState("");
  const [person, setPerson] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([blank("c-0")]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const kindReasons = reasons.filter((r) => r.kind === kind);
  const reason = kindReasons.find((r) => r.id === reasonId) ?? null;
  // the department's own store, as its sales; the user can pick another one
  const store = wh || departments.find((d) => d.id === dept)?.storeId || warehouses[0]?.id || "";
  const set = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const chosen = (l: Line) => (l.mode === "recipe" ? Boolean(l.recipeId) : Boolean(l.product));
  const ready = lines.filter((l) => chosen(l) && parseNum(l.quantity) > 0);
  const incomplete = lines.filter((l) => chosen(l) && !(parseNum(l.quantity) > 0));
  const noteMissing = Boolean(reason?.noteRequired && !note.trim());

  async function save() {
    setMsg(null);
    if (!reason) return setMsg({ tone: "red", text: t("Choose a reason from the list") });
    if (noteMissing) return setMsg({ tone: "red", text: t("An explanation is required for this reason") });
    if (!ready.length || incomplete.length) return setMsg({ tone: "red", text: t("Add at least one item with a quantity") });
    setBusy(true);
    try {
      const r = await call<{ totalCost: string }>("POST", "/api/comps", {
        kind,
        businessDate: day,
        departmentId: dept,
        warehouseId: store || null,
        reasonId: reason.id,
        person: person || null,
        note: note || null,
        lines: ready.map((l) => (l.mode === "recipe" ? { recipeId: l.recipeId, quantity: l.quantity } : { productId: l.product!.id, quantity: l.quantity, unit: l.unit || l.product!.stockUnit })),
      });
      setMsg({ tone: "green", text: t("Saved and deducted from stock: {cost} at cost.", { cost: money(r.totalCost, currency) }) });
      setLines([blank()]);
      setPerson("");
      setNote("");
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof Error ? err.message : t("Failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <Label htmlFor="cf-kind">{t("Comp type")}</Label>
          <Select id="cf-kind" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setReasonId(""); }}>
            <option value="ON_HOUSE">{t("On-house")}</option>
            <option value="HOSPITALITY">{t("Hospitality")}</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="cf-reason">{t("Comp reason")}</Label>
          <Select id="cf-reason" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
            <option value="">{t("Choose…")}</option>
            {kindReasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="cf-person">{kind === "ON_HOUSE" ? t("Authorised person") : t("Guest / company")}</Label>
          <Input id="cf-person" value={person} maxLength={120} onChange={(e) => setPerson(e.target.value)} placeholder={kind === "ON_HOUSE" ? t("e.g. Ahmet Yılmaz (owner)") : t("e.g. ABC Turizm")} />
        </div>
        <div>
          <Label htmlFor="cf-date">{t("Date")}</Label>
          <Input id="cf-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="cf-dept">{t("Department")}</Label>
          <Select id="cf-dept" value={dept} onChange={(e) => { setDept(e.target.value); setWh(""); }}>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        </div>
        <div>
          <Label htmlFor="cf-wh">{t("Deduct from store")}</Label>
          <Select id="cf-wh" value={store} onChange={(e) => setWh(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="cf-note">{reason?.noteRequired ? t("Explanation (required)") : t("Explanation")}</Label>
          <Input id="cf-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. lunch with the visiting sales team")} aria-invalid={noteMissing || undefined} />
        </div>
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={l.key} className="grid items-end gap-2 rounded-lg border border-ink-100 p-2 md:grid-cols-12">
            <div className="md:col-span-2">
              <Label htmlFor={`cm-${l.key}`}>{t("Item {n}", { n: i + 1 })}</Label>
              <Select id={`cm-${l.key}`} value={l.mode} onChange={(e) => set(l.key, { mode: e.target.value as Line["mode"], recipeId: "", product: null, unit: "" })}>
                <option value="recipe">{t("Recipe (dish / drink)")}</option>
                <option value="product">{t("Product")}</option>
              </Select>
            </div>
            <div className="md:col-span-5">
              {l.mode === "recipe" ? (
                <>
                  <Label htmlFor={`cr-${l.key}`}>{t("Recipe")}</Label>
                  <Select id={`cr-${l.key}`} value={l.recipeId} onChange={(e) => set(l.key, { recipeId: e.target.value })}>
                    <option value="">{t("Choose…")}</option>
                    {recipes.map((r) => <option key={r.id} value={r.id}>{r.name}{r.posCode ? ` (${r.posCode})` : ""}</option>)}
                  </Select>
                </>
              ) : (
                <>
                  <Label htmlFor={`cp-${l.key}`}>{t("Product")}</Label>
                  <ProductPicker id={`cp-${l.key}`} value={l.product} onChange={(p) => set(l.key, { product: p, unit: p?.stockUnit ?? "" })} />
                </>
              )}
            </div>
            <div className="md:col-span-2"><Label htmlFor={`cq-${l.key}`}>{t("Quantity")}</Label><Input id={`cq-${l.key}`} inputMode="decimal" value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} /></div>
            <div className="md:col-span-2">
              {l.mode === "product" ? (
                <><Label htmlFor={`cu-${l.key}`}>{t("Unit")}</Label><Select id={`cu-${l.key}`} value={l.unit} onChange={(e) => set(l.key, { unit: e.target.value })}>{unitsFor(l.product).map((u) => <option key={u}>{u}</option>)}</Select></>
              ) : (
                <p className="pb-2 text-xs text-ink-500">{t("portions")}</p>
              )}
            </div>
            <div className="md:col-span-1"><Button type="button" variant="ghost" aria-label={t("Remove")} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blank()]))}><Trash2 className="h-4 w-4" /></Button></div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="h-4 w-4" /> {t("Add line")}</Button>
        <Button type="button" disabled={busy || !ready.length || incomplete.length > 0} onClick={save}>{t("Save")}</Button>
        <span className="text-xs text-ink-500">{t("Recipes are deducted from the store by their ingredients; no sales revenue is booked.")}</span>
      </div>
    </div>
  );
}
