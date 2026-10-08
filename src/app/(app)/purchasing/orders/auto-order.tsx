"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { filterRules } from "./filter-rules";
import { Trash2 } from "lucide-react";
import { Alert, Badge, Button, Input, Label, Select, Table, Td, Th, cn } from "@/components/ui";
import { ProductPicker, type PickedProduct } from "@/components/product-picker";
import { call } from "@/lib/client";
import { dateTime, qty } from "@/lib/format";
import { useT } from "@/i18n/client";

export interface RuleRow {
  id: string;
  product: string;
  unit: string;
  category: string;
  supplierId: string;
  supplier: string;
  email: string | null;
  ownEmail: string | null;
  reorderPoint: string;
  safetyStock: string | null;
  orderQty: string;
  active: boolean;
  stock: string;
  due: boolean;
  productId: string;
  lastSend: { at: string | Date; status: string; error: string | null } | null;
}
interface Supplier { id: string; name: string; email: string | null }

type Msg = { tone: "red" | "green" | "amber" | "blue"; text: string } | null;

/** One editable rule row: numbers, supplier and e-mail are edited in place; the switch at the right turns it on/off. */
function Row({ r, suppliers, canManage, onMsg }: { r: RuleRow; suppliers: Supplier[]; canManage: boolean; onMsg: (m: Msg) => void }) {
  const t = useT();
  const router = useRouter();
  const init = { supplierId: r.supplierId, reorderPoint: r.reorderPoint, safetyStock: r.safetyStock ?? "", orderQty: r.orderQty, email: r.ownEmail ?? "" };
  const [v, setV] = useState(init);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  // the page lists active suppliers only: keep a deactivated supplier of this rule selectable instead of showing the first active one
  const options = suppliers.some((s) => s.id === r.supplierId) ? suppliers : [{ id: r.supplierId, name: `${r.supplier} (${t("inactive")})`, email: r.ownEmail ? null : r.email }, ...suppliers];
  const supplierEmail = options.find((s) => s.id === v.supplierId)?.email ?? "";

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    onMsg(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      onMsg({ tone: "red", text: `${r.product}: ${e instanceof Error ? e.message : t("Failed")}` });
    } finally {
      setBusy(false);
    }
  }
  const save = () => run(() => call("PATCH", `/api/auto-order/${r.id}`, { productId: r.productId, supplierId: v.supplierId, reorderPoint: v.reorderPoint, safetyStock: v.safetyStock === "" ? null : v.safetyStock, orderQty: v.orderQty, email: v.email, active: r.active }));
  const toggle = () => run(() => call("PATCH", `/api/auto-order/${r.id}`, { active: !r.active }));
  const remove = () => {
    if (confirm(t("Delete the rule for {name}?", { name: r.product }))) void run(() => call("DELETE", `/api/auto-order/${r.id}`));
  };
  const num = (k: "reorderPoint" | "safetyStock" | "orderQty") => (
    <div className="ml-auto w-20"><Input aria-label={k} inputMode="decimal" className="px-2 py-1 text-right" disabled={!canManage} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></div>
  );
  return (
    <tr className={cn(r.due && "bg-amber-50", !r.active && "text-ink-400")}>
      <Td>
        <div className="w-32">
          <Select aria-label={t("Supplier")} className="py-1 pl-2" disabled={!canManage} value={v.supplierId} onChange={(e) => setV({ ...v, supplierId: e.target.value })}>
            {options.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
      </Td>
      <Td className="font-medium" style={{ whiteSpace: "normal" }}>{r.product}<span className="block text-xs font-normal text-ink-400">{r.unit}</span></Td>
      <Td style={{ whiteSpace: "normal" }}>{r.category}</Td>
      <Td align="right" className={cn(r.due && "font-semibold text-amber-800")}>{qty(r.stock, r.unit, 2)}{r.due && <span className="block text-xs font-normal" style={{ whiteSpace: "normal" }}>{t("at reorder point")}</span>}</Td>
      <Td align="right">{num("reorderPoint")}</Td>
      <Td align="right">{num("safetyStock")}</Td>
      <Td align="right">{num("orderQty")}</Td>
      <Td>
        <div className="w-40"><Input aria-label={t("E-mail")} type="email" className="px-2 py-1" disabled={!canManage} placeholder={supplierEmail || t("no e-mail")} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
          {r.lastSend && <span className={cn("mt-0.5 block whitespace-normal text-xs", r.lastSend.status === "SENT" ? "text-brand-700" : "text-red-700")}>{r.lastSend.status === "SENT" ? t("Sent {date}", { date: dateTime(r.lastSend.at) }) : t("Not sent: {error}", { error: t(r.lastSend.error ?? "") })}</span>}
        </div>
      </Td>
      <Td>
        <div className="flex items-center gap-2">
          {dirty && canManage && <Button size="sm" disabled={busy} onClick={save}>{t("Save")}</Button>}
          <button
            type="button"
            role="switch"
            aria-checked={r.active}
            aria-label={r.active ? t("Active") : t("Passive")}
            disabled={!canManage || busy}
            onClick={toggle}
            className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50", r.active ? "bg-brand-600" : "bg-ink-300")}
          >
            <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition", r.active ? "translate-x-4" : "translate-x-0.5")} />
          </button>
          <span className="w-10 text-xs">{r.active ? t("Active") : t("Passive")}</span>
          {canManage && <button type="button" aria-label={t("Delete")} title={t("Delete")} disabled={busy} onClick={remove} className="text-ink-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
        </div>
      </Td>
    </tr>
  );
}

export function AutoOrder({ rules, suppliers, canManage, emailEnabled, mailConfigured }: { rules: RuleRow[]; suppliers: Supplier[]; canManage: boolean; emailEnabled: boolean; mailConfigured: boolean }) {
  const t = useT();
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const sp = useSearchParams();
  const [filter, setFilterState] = useState(sp?.get("q") ?? "");
  const [onlyDue, setOnlyDueState] = useState(sp?.get("due") === "1");
  // the filters live in the URL as well, so PDF / Excel / CSV export exactly the rows on screen
  const syncUrl = (q: string, d: boolean) => {
    const u = new URLSearchParams(window.location.search);
    if (q.trim()) u.set("q", q.trim());
    else u.delete("q");
    if (d) u.set("due", "1");
    else u.delete("due");
    const qs = u.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  };
  const setFilter = (v: string) => {
    setFilterState(v);
    syncUrl(v, onlyDue);
  };
  const setOnlyDue = (v: boolean) => {
    setOnlyDueState(v);
    syncUrl(filter, v);
  };
  const [add, setAdd] = useState<{ product: PickedProduct | null; supplierId: string; reorderPoint: string; safetyStock: string; orderQty: string; email: string }>({ product: null, supplierId: suppliers[0]?.id ?? "", reorderPoint: "", safetyStock: "", orderQty: "", email: "" });

  const shown = filterRules(rules, filter, onlyDue);
  const due = rules.filter((r) => r.due).length;

  async function act(fn: () => Promise<Msg>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await fn());
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : t("Failed") });
    } finally {
      setBusy(false);
    }
  }
  const fill = () => act(async () => {
    const r = await call<{ created: number }>("POST", "/api/auto-order/fill");
    return r.created ? { tone: "green", text: t("{n} rule(s) created from the order recommendations. They start passive: check the numbers and switch them on.", { n: r.created }) } : { tone: "blue", text: t("No new products to add: every recommended product with a default supplier already has a rule.") };
  });
  const check = () => act(async () => {
    const r = await call<{ due: number; sent: number; failed: number; emailEnabled: boolean }>("POST", "/api/auto-order/run");
    if (!r.due) return { tone: "green", text: t("No product is at its reorder point.") };
    if (!r.emailEnabled) return { tone: "amber", text: t("{n} product(s) at the reorder point. Automatic e-mail orders are part of the Premium plan: order them by hand.", { n: r.due }) };
    return r.failed ? { tone: "red", text: t("{sent} order line(s) e-mailed, {failed} failed — see the rows.", { sent: r.sent, failed: r.failed }) } : { tone: "green", text: t("{sent} order line(s) e-mailed to the suppliers.", { sent: r.sent }) };
  });
  const create = () => act(async () => {
    if (!add.product) throw new Error(t("Choose a product"));
    await call("POST", "/api/auto-order", { productId: add.product.id, supplierId: add.supplierId, reorderPoint: add.reorderPoint, safetyStock: add.safetyStock || null, orderQty: add.orderQty, email: add.email, active: true });
    setAdd({ ...add, product: null, reorderPoint: "", safetyStock: "", orderQty: "", email: "" });
    return { tone: "green", text: t("Rule saved.") };
  });

  return (
    <div className="space-y-4">
      {!emailEnabled ? (
        <Alert tone="blue">{t("Basic plan: products at their reorder point are highlighted here. Automatic e-mail orders to suppliers are part of the Premium plan.")}</Alert>
      ) : !mailConfigured ? (
        <Alert tone="amber">{t("Premium plan: e-mail orders are on, but no mail server is configured (SMTP_URL). Orders cannot be sent yet.")}</Alert>
      ) : (
        <Alert tone="green">{t("Premium plan: when the stock of an active rule reaches its reorder point the order is e-mailed to the supplier (checked every night and on “Check now”).")}</Alert>
      )}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-64"><Label htmlFor="ao-q">{t("Search")}</Label><Input id="ao-q" value={filter} placeholder={t("Product, category or supplier")} onChange={(e) => setFilter(e.target.value)} /></div>
        <label className="mb-2 flex items-center gap-1.5 text-sm text-ink-700"><input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} />{t("Only at reorder point")} <Badge tone={due ? "amber" : "gray"}>{due}</Badge></label>
        <div className="ml-auto flex gap-2">
          {canManage && <Button variant="secondary" disabled={busy} onClick={fill}>{t("Fill from recommendations")}</Button>}
          {canManage && <Button disabled={busy} onClick={check}>{t("Check now")}</Button>}
        </div>
      </div>
      <div className="rounded-xl border border-ink-200 bg-white">
        <Table>
          <thead><tr className="align-bottom"><Th>{t("Supplier")}</Th><Th>{t("Product")}</Th><Th>{t("Category")}</Th><Th align="right">{t("Stock")}</Th><Th align="right" style={{ whiteSpace: "normal" }}>{t("Reorder point")}</Th><Th align="right" style={{ whiteSpace: "normal" }}>{t("Safety stock")}</Th><Th align="right" style={{ whiteSpace: "normal" }}>{t("Order qty")}</Th><Th>{t("E-mail")}</Th><Th style={{ whiteSpace: "normal" }}>{t("Active / Passive")}</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {shown.map((r) => <Row key={`${r.id}-${r.supplierId}-${r.reorderPoint}-${r.safetyStock}-${r.orderQty}-${r.ownEmail}`} r={r} suppliers={suppliers} canManage={canManage} onMsg={setMsg} />)}
            {!shown.length && <tr><Td colSpan={9} className="py-6 text-center text-ink-500">{rules.length ? t("No rule matches the filter.") : t("No rules yet. Use “Fill from recommendations” or add one below.")}</Td></tr>}
          </tbody>
        </Table>
      </div>
      {canManage && (
        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-900">{t("Add rule")}</h2>
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <div className="md:col-span-2"><Label htmlFor="ao-p">{t("Product")}</Label><ProductPicker id="ao-p" value={add.product} onChange={(p) => setAdd({ ...add, product: p })} /></div>
            <div><Label htmlFor="ao-s">{t("Supplier")}</Label><Select id="ao-s" value={add.supplierId} onChange={(e) => setAdd({ ...add, supplierId: e.target.value })}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
            <div><Label htmlFor="ao-r" hint={add.product?.stockUnit}>{t("Reorder point")}</Label><Input id="ao-r" inputMode="decimal" value={add.reorderPoint} onChange={(e) => setAdd({ ...add, reorderPoint: e.target.value })} /></div>
            <div><Label htmlFor="ao-ss" hint={add.product?.stockUnit}>{t("Safety stock")}</Label><Input id="ao-ss" inputMode="decimal" value={add.safetyStock} onChange={(e) => setAdd({ ...add, safetyStock: e.target.value })} /></div>
            <div><Label htmlFor="ao-o" hint={add.product?.stockUnit}>{t("Order qty")}</Label><Input id="ao-o" inputMode="decimal" value={add.orderQty} onChange={(e) => setAdd({ ...add, orderQty: e.target.value })} /></div>
            <div className="md:col-span-2"><Label htmlFor="ao-e" hint={t("empty = supplier's e-mail")}>{t("E-mail")}</Label><Input id="ao-e" type="email" placeholder={suppliers.find((s) => s.id === add.supplierId)?.email ?? ""} value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} /></div>
            <div className="flex items-end"><Button disabled={busy || !add.product || !add.supplierId} onClick={create}>{t("Add rule")}</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}
