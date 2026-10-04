"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { call } from "@/lib/client";

export function CreateAction({ opportunity }: { opportunity: { key: string; driver: string; title: string; current: string; saving: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Create action</Button>;
  return (
    <form className="mt-2 grid gap-2 rounded-lg border border-ink-200 bg-white p-3 md:grid-cols-4" onSubmit={async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
      try {
        await call("POST", "/api/savings/actions", { driver: opportunity.driver, problem: opportunity.title, rootCause: f.rootCause || null, action: f.action, ownerName: f.ownerName, baselineCost: opportunity.current, targetSaving: f.targetSaving, dueDate: f.dueDate, opportunityKey: opportunity.key });
        setOpen(false);
        router.refresh();
      } catch (x) {
        setErr(x instanceof Error ? x.message : "Failed");
      }
    }}>
      {err && <div className="md:col-span-4"><Alert>{err}</Alert></div>}
      <div className="md:col-span-2"><Label htmlFor={`a-${opportunity.key}`}>Action</Label><Input id={`a-${opportunity.key}`} name="action" required minLength={3} /></div>
      <div className="md:col-span-2"><Label htmlFor={`rc-${opportunity.key}`}>Root cause</Label><Input id={`rc-${opportunity.key}`} name="rootCause" /></div>
      <div><Label htmlFor={`o-${opportunity.key}`}>Owner</Label><Input id={`o-${opportunity.key}`} name="ownerName" required /></div>
      <div><Label htmlFor={`t-${opportunity.key}`}>Target saving</Label><Input id={`t-${opportunity.key}`} name="targetSaving" defaultValue={Number(opportunity.saving).toFixed(0)} required /></div>
      <div><Label htmlFor={`d-${opportunity.key}`}>Due date</Label><Input id={`d-${opportunity.key}`} name="dueDate" type="date" required defaultValue={new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)} /></div>
      <div className="flex items-end gap-2"><Button type="submit" size="sm">Save</Button><Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

export function UpdateAction({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [next, setNext] = useState(status === "OPEN" ? "IN_PROGRESS" : "DONE");
  const [actual, setActual] = useState("");
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Select aria-label="New status" value={next} onChange={(e) => setNext(e.target.value)} className="w-32">{["IN_PROGRESS", "DONE", "CANCELLED"].map((s) => <option key={s}>{s}</option>)}</Select>
      <Input aria-label="Realized saving" placeholder="realized" inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} className="w-24" />
      <Button size="sm" variant="secondary" onClick={async () => {
        setErr(null);
        try {
          await call("PATCH", `/api/savings/actions/${id}`, { status: next, ...(actual ? { actualSaving: actual } : {}) });
          router.refresh();
        } catch (x) {
          setErr(x instanceof Error ? x.message : "Failed");
        }
      }}>Update</Button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </span>
  );
}
