"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Table, Td, Th, cn } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

export interface SupplierRow { id: string; code: string; name: string; address: string | null; email: string | null; phone: string | null; leadTimeDays: number | null; active: boolean; rules: number }
type Form = { name: string; address: string; email: string; phone: string; leadTimeDays: string };
const toForm = (s?: SupplierRow): Form => ({ name: s?.name ?? "", address: s?.address ?? "", email: s?.email ?? "", phone: s?.phone ?? "", leadTimeDays: s?.leadTimeDays?.toString() ?? "" });
const toBody = (f: Form) => ({ name: f.name, address: f.address || null, email: f.email, phone: f.phone || null, leadTimeDays: f.leadTimeDays === "" ? null : Number(f.leadTimeDays) });

function Row({ s, canManage, onMsg }: { s: SupplierRow; canManage: boolean; onMsg: (m: string | null) => void }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState(toForm(s));
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(toForm(s));
  async function patch(body: unknown) {
    setBusy(true);
    onMsg(null);
    try {
      await call("PATCH", `/api/suppliers/${s.id}`, body);
      router.refresh();
    } catch (e) {
      onMsg(`${s.name}: ${e instanceof Error ? e.message : t("Failed")}`);
    } finally {
      setBusy(false);
    }
  }
  const cell = (k: keyof Form, w: string, label: string, type = "text", right = false) => (
    <div className={w}><Input aria-label={label} type={type} className={cn("px-2 py-1", right && "text-right")} disabled={!canManage} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  );
  return (
    <tr className={cn(!s.active && "text-ink-400")}>
      <Td className="text-xs text-ink-500">{s.code}</Td>
      <Td>{cell("name", "w-44", t("Company name"))}</Td>
      <Td>{cell("address", "w-52", t("Address"))}</Td>
      <Td>{cell("email", "w-44", t("E-mail"), "email")}</Td>
      <Td>{cell("phone", "w-24", t("Phone"))}</Td>
      <Td align="right">{cell("leadTimeDays", "ml-auto w-16", t("Lead time (days)"), "text", true)}</Td>
      <Td align="right">{s.rules}</Td>
      <Td>
        <div className="flex items-center gap-2">
          {dirty && canManage && <Button size="sm" disabled={busy || !f.name.trim()} onClick={() => patch(toBody(f))}>{t("Save")}</Button>}
          {canManage && <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ active: !s.active })}>{s.active ? t("Deactivate") : t("Activate")}</Button>}
        </div>
      </Td>
    </tr>
  );
}

/** Suppliers for ordering: company name, address and e-mail (the order e-mail goes here unless the rule has its own). */
export function Suppliers({ suppliers, canManage }: { suppliers: SupplierRow[]; canManage: boolean }) {
  const t = useT();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [f, setF] = useState<Form>(toForm());
  const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true);
    setMsg(null);
    setOk(null);
    try {
      const s = await call<{ code: string; name: string }>("POST", "/api/suppliers", toBody(f));
      setOk(t("{name} added ({code}).", { name: s.name, code: s.code }));
      setF(toForm());
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t("Failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      {msg && <Alert>{msg}</Alert>}
      {ok && <Alert tone="green">{ok}</Alert>}
      <div className="rounded-xl border border-ink-200 bg-white">
        <Table>
          <thead><tr className="align-bottom"><Th>{t("Code")}</Th><Th>{t("Company name")}</Th><Th>{t("Address")}</Th><Th>{t("E-mail")}</Th><Th>{t("Phone")}</Th><Th align="right" style={{ whiteSpace: "normal" }}>{t("Lead time (days)")}</Th><Th align="right">{t("Rules")}</Th><Th /></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {suppliers.map((s) => <Row key={`${s.id}-${s.name}-${s.address}-${s.email}-${s.phone}-${s.leadTimeDays}`} s={s} canManage={canManage} onMsg={setMsg} />)}
            {!suppliers.length && <tr><Td colSpan={8} className="py-6 text-center text-ink-500">{t("No suppliers yet")}</Td></tr>}
          </tbody>
        </Table>
      </div>
      {canManage && (
        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-900">{t("New supplier")}</h2>
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <div><Label htmlFor="sp-n">{t("Company name")}</Label><Input id="sp-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="md:col-span-2"><Label htmlFor="sp-a">{t("Address")}</Label><Input id="sp-a" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
            <div><Label htmlFor="sp-e">{t("E-mail")}</Label><Input id="sp-e" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            <div><Label htmlFor="sp-p">{t("Phone")}</Label><Input id="sp-p" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
            <div className="flex items-end"><Button disabled={busy || !f.name.trim()} onClick={add}>{t("Add supplier")}</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}
