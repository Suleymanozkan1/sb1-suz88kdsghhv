"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { call } from "@/lib/client";

type Opt = { id: string; name: string };

function useSubmit(ok: string) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, reset?: () => void) {
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      setMsg({ tone: "green", text: ok });
      reset?.();
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }
  return { msg, busy, run };
}

export function ExpenseForm({ categories, departments, assets, rooms }: { categories: Record<string, readonly string[]>; departments: Opt[]; assets: Opt[]; rooms: Opt[] }) {
  const [cat, setCat] = useState("HOUSEKEEPING");
  const { msg, busy, run } = useSubmit("Expense posted to the cost ledger");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    await run(() => call("POST", "/api/opex/expenses", { expenseDate: f.expenseDate, departmentId: f.departmentId || null, category: cat, subCategory: f.subCategory || null, description: f.description, amount: f.amount, taxAmount: f.taxAmount || null, quantity: f.quantity || null, unit: f.unit || null, supplierName: f.supplierName || null, invoiceNo: f.invoiceNo || null, assetId: f.assetId || null, roomId: f.roomId || null }), () => form.reset());
  }
  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-6">
      {msg && <div className="md:col-span-6"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div><Label htmlFor="ex-date">Date</Label><Input id="ex-date" name="expenseDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
      <div><Label htmlFor="ex-cat">Category</Label><Select id="ex-cat" value={cat} onChange={(e) => setCat(e.target.value)}>{Object.keys(categories).map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}</Select></div>
      <div><Label htmlFor="ex-sub">Sub-category</Label><Select id="ex-sub" name="subCategory" key={cat}><option value="">—</option>{categories[cat]!.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</Select></div>
      <div><Label htmlFor="ex-dept">Department</Label><Select id="ex-dept" name="departmentId"><option value="">Hotel level (to allocate)</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
      <div className="md:col-span-2"><Label htmlFor="ex-desc">Description</Label><Input id="ex-desc" name="description" required minLength={2} /></div>
      <div><Label htmlFor="ex-amount">Net amount</Label><Input id="ex-amount" name="amount" inputMode="decimal" required /></div>
      <div><Label htmlFor="ex-tax">Tax</Label><Input id="ex-tax" name="taxAmount" inputMode="decimal" /></div>
      <div><Label htmlFor="ex-qty">Quantity</Label><Input id="ex-qty" name="quantity" inputMode="decimal" /></div>
      <div><Label htmlFor="ex-unit">Unit</Label><Input id="ex-unit" name="unit" placeholder="kWh, m3, kg, hour" /></div>
      <div><Label htmlFor="ex-sup">Supplier</Label><Input id="ex-sup" name="supplierName" /></div>
      <div><Label htmlFor="ex-inv">Invoice no</Label><Input id="ex-inv" name="invoiceNo" /></div>
      <div><Label htmlFor="ex-asset">Asset</Label><Select id="ex-asset" name="assetId"><option value="">—</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></div>
      <div><Label htmlFor="ex-room">Room</Label><Select id="ex-room" name="roomId"><option value="">—</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></div>
      <div className="flex items-end md:col-span-2"><Button type="submit" disabled={busy}>{busy ? "Posting…" : "Post expense"}</Button></div>
    </form>
  );
}

export function ReverseButton({ url, label = "Reverse" }: { url: string; label?: string }) {
  const { msg, busy, run } = useSubmit("Reversed");
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
        const reason = window.prompt("Reason (audited):");
        if (reason) void run(() => call("POST", url, { reason }));
      }}>{label}</Button>
      {msg?.tone === "red" && <span className="text-xs text-red-700">{msg.text}</span>}
    </span>
  );
}

export function MeterReadingForm({ meters }: { meters: Opt[] }) {
  const { msg, busy, run } = useSubmit("Reading saved");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    await run(() => call("POST", "/api/opex/meters/readings", f), () => form.reset());
  }
  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-4">
      {msg && <div className="md:col-span-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div><Label htmlFor="mr-meter">Meter</Label><Select id="mr-meter" name="meterId">{meters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></div>
      <div><Label htmlFor="mr-date">Date</Label><Input id="mr-date" name="readingDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
      <div><Label htmlFor="mr-value">Cumulative reading</Label><Input id="mr-value" name="value" inputMode="decimal" required /></div>
      <div className="flex items-end"><Button type="submit" disabled={busy || !meters.length}>Save reading</Button></div>
    </form>
  );
}

export function LaundryForm() {
  const { msg, busy, run } = useSubmit("Laundry volume saved");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    await run(() => call("POST", "/api/opex/laundry", f));
  }
  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-5">
      {msg && <div className="md:col-span-5"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div><Label htmlFor="ll-date">Date</Label><Input id="ll-date" name="logDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
      <div><Label htmlFor="ll-src">Source</Label><Select id="ll-src" name="source">{["ROOMS", "F_AND_B", "SPA", "GUEST", "STAFF"].map((s) => <option key={s}>{s}</option>)}</Select></div>
      <div><Label htmlFor="ll-kg">kg</Label><Input id="ll-kg" name="kg" inputMode="decimal" required /></div>
      <div><Label htmlFor="ll-pcs">Pieces</Label><Input id="ll-pcs" name="pieces" inputMode="numeric" required /></div>
      <div className="flex items-end"><Button type="submit" disabled={busy}>Save volume</Button></div>
    </form>
  );
}

export function AssetForm({ kinds, departments }: { kinds: readonly string[]; departments: Opt[] }) {
  const { msg, busy, run } = useSubmit("Asset created");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    await run(() => call("POST", "/api/opex/assets", { ...f, departmentId: f.departmentId || null, location: f.location || null }), () => form.reset());
  }
  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-6">
      {msg && <div className="md:col-span-6"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div><Label htmlFor="as-code">Code</Label><Input id="as-code" name="code" required /></div>
      <div className="md:col-span-2"><Label htmlFor="as-name">Asset name</Label><Input id="as-name" name="name" required /></div>
      <div><Label htmlFor="as-kind">Kind</Label><Select id="as-kind" name="kind">{kinds.map((k) => <option key={k}>{k}</option>)}</Select></div>
      <div><Label htmlFor="as-dept">Department</Label><Select id="as-dept" name="departmentId"><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
      <div className="flex items-end"><Button type="submit" disabled={busy}>Add asset</Button></div>
    </form>
  );
}

export function MeterForm({ utilities, departments }: { utilities: readonly string[]; departments: Opt[] }) {
  const { msg, busy, run } = useSubmit("Meter created");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    await run(() => call("POST", "/api/opex/meters", { ...f, departmentId: f.departmentId || null, area: f.area || null }), () => form.reset());
  }
  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-6">
      {msg && <div className="md:col-span-6"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div><Label htmlFor="me-code">Code</Label><Input id="me-code" name="code" required /></div>
      <div className="md:col-span-2"><Label htmlFor="me-name">Meter name</Label><Input id="me-name" name="name" required /></div>
      <div><Label htmlFor="me-util">Utility</Label><Select id="me-util" name="utility">{utilities.map((k) => <option key={k}>{k}</option>)}</Select></div>
      <div><Label htmlFor="me-unit">Unit</Label><Input id="me-unit" name="unit" defaultValue="kWh" required /></div>
      <div><Label htmlFor="me-dept">Department</Label><Select id="me-dept" name="departmentId"><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
      <div className="flex items-end"><Button type="submit" disabled={busy}>Add meter</Button></div>
    </form>
  );
}
