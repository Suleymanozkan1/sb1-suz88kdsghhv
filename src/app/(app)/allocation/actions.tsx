"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { call } from "@/lib/client";

type Opt = { id: string; name: string };

export function RuleForm({ categories, drivers, departments }: { categories: Record<string, readonly string[]>; drivers: Record<string, string>; departments: Opt[] }) {
  const router = useRouter();
  const [cat, setCat] = useState("ENERGY");
  const [driver, setDriver] = useState("REVENUE");
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    setMsg(null);
    try {
      await call("POST", "/api/allocation/rules", { name: f.name, sourceCategoryGroup: cat, sourceSubCategory: f.sourceSubCategory || null, sourceDepartmentId: f.sourceDepartmentId || null, driver, priority: Number(f.priority || 100), targets: Object.entries(targets).filter(([, w]) => w !== "").map(([departmentId, w]) => ({ departmentId, weight: driver === "FIXED" ? w : null })) });
      setMsg({ tone: "green", text: "Rule created — preview the period below before posting." });
      setTargets({});
      router.refresh();
    } catch (x) {
      setMsg({ tone: "red", text: x instanceof Error ? x.message : "Failed" });
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-3 md:grid-cols-6">
        <div className="md:col-span-2"><Label htmlFor="ar-name">Rule name</Label><Input id="ar-name" name="name" required minLength={3} placeholder="Electricity by sub-meter" /></div>
        <div><Label htmlFor="ar-cat">Source category</Label><Select id="ar-cat" value={cat} onChange={(e) => setCat(e.target.value)}><option value="ALL">ALL</option>{Object.keys(categories).map((c) => <option key={c}>{c}</option>)}</Select></div>
        <div><Label htmlFor="ar-sub">Sub-category</Label><Select id="ar-sub" name="sourceSubCategory" key={cat}><option value="">All</option>{(categories[cat] ?? []).map((s) => <option key={s}>{s}</option>)}</Select></div>
        <div><Label htmlFor="ar-src">Source department</Label><Select id="ar-src" name="sourceDepartmentId"><option value="">Hotel level (unassigned)</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
        <div><Label htmlFor="ar-driver">Driver</Label><Select id="ar-driver" value={driver} onChange={(e) => setDriver(e.target.value)}>{Object.entries(drivers).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></div>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink-700">Destinations {driver === "FIXED" ? "(weight per department)" : "(tick to include)"}</legend>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {departments.map((d) => (
            <label key={d.id} className="flex items-center gap-2 rounded border border-ink-200 px-2 py-1.5 text-sm">
              {driver === "FIXED" ? (
                <Input aria-label={`Weight ${d.name}`} className="w-16" inputMode="decimal" value={targets[d.id] ?? ""} onChange={(e) => setTargets({ ...targets, [d.id]: e.target.value })} />
              ) : (
                <input type="checkbox" aria-label={`Include ${d.name}`} checked={d.id in targets} onChange={(e) => { const n = { ...targets }; if (e.target.checked) n[d.id] = "1"; else delete n[d.id]; setTargets(n); }} />
              )}
              {d.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-end gap-3"><div className="w-28"><Label htmlFor="ar-prio">Priority</Label><Input id="ar-prio" name="priority" inputMode="numeric" defaultValue="100" /></div><Button type="submit">Create rule</Button></div>
    </form>
  );
}

export function RuleToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  return <Button size="sm" variant="ghost" onClick={async () => { await call("PATCH", `/api/allocation/rules/${id}`, { active: !active }); router.refresh(); }}>{active ? "Disable" : "Enable"}</Button>;
}

export function PostAllocation({ periodId, disabled }: { periodId: string; disabled: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-3">
      {err && <Alert>{err}</Alert>}
      <Button disabled={disabled || busy} onClick={async () => {
        if (!window.confirm("Post this allocation to the cost ledger? It can be reversed, never edited.")) return;
        setBusy(true);
        setErr(null);
        try {
          await call("POST", "/api/allocation/runs", { periodId });
          router.refresh();
        } catch (x) {
          setErr(x instanceof Error ? x.message : "Failed");
        } finally {
          setBusy(false);
        }
      }}>{busy ? "Posting…" : "Post allocation"}</Button>
    </div>
  );
}
