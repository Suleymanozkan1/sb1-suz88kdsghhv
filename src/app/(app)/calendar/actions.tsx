"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { call } from "@/lib/client";

export function DoneButton({ taskId, dueDate }: { taskId: string; dueDate: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant="secondary" onClick={async () => {
        const note = window.prompt("Note (optional):") ?? undefined;
        try {
          await call("POST", "/api/calendar/complete", { taskId, dueDate, note: note || null });
          router.refresh();
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Failed");
        }
      }}>Mark done</Button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </span>
  );
}

export function NewTask() {
  const router = useRouter();
  const [rec, setRec] = useState("WEEKLY");
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
      try {
        await call("POST", "/api/calendar/tasks", { title: f.title, recurrence: rec, weekday: rec === "WEEKLY" ? f.weekday : null, monthDay: rec === "MONTHLY" ? f.monthDay : null, ownerRole: f.ownerRole || null });
        setMsg({ tone: "green", text: "Task added" });
        router.refresh();
      } catch (x) {
        setMsg({ tone: "red", text: x instanceof Error ? x.message : "Failed" });
      }
    }}>
      {msg && <div className="w-full"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div><Label htmlFor="ct-title">Control task</Label><Input id="ct-title" name="title" required minLength={3} placeholder="Bar spirits spot check" /></div>
      <div><Label htmlFor="ct-rec">Recurrence</Label><Select id="ct-rec" value={rec} onChange={(e) => setRec(e.target.value)}><option>WEEKLY</option><option>MONTHLY</option></Select></div>
      {rec === "WEEKLY" ? <div><Label htmlFor="ct-wd">Weekday</Label><Select id="ct-wd" name="weekday">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</Select></div> : <div><Label htmlFor="ct-md" hint="0 = last day">Day of month</Label><Input id="ct-md" name="monthDay" defaultValue="0" className="w-20" /></div>}
      <div><Label htmlFor="ct-owner">Owner role</Label><Input id="ct-owner" name="ownerRole" className="w-40" /></div>
      <Button type="submit">Add task</Button>
    </form>
  );
}
