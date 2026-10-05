"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

const TYPES = ["BREAKFAST", "LUNCH", "DINNER", "ALL_INCLUSIVE", "SPECIAL_EVENT", "BANQUET", "THEME_NIGHT", "HOLIDAY"];

export function NewSession({ departments, warehouses }: { departments: { id: string; name: string }[]; warehouses: { id: string; name: string; departmentId: string | null }[] }) {
  const t = useT();
  const router = useRouter();
  const [dept, setDept] = useState(departments.find((d) => /breakfast/i.test(d.name))?.id ?? departments[0]?.id ?? "");
  const [err, setErr] = useState<string | null>(null);
  const whs = [...warehouses].sort((a, b) => Number(b.departmentId === dept) - Number(a.departmentId === dept));
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    const n = (k: string) => (f[k] ? Number(f[k]) : null);
    try {
      const s = await call<{ id: string }>("POST", "/api/buffet/sessions", { departmentId: dept, warehouseId: f.warehouseId, type: f.type, serviceDate: f.serviceDate, expectedCovers: n("expectedCovers"), occupiedRooms: n("occupiedRooms"), inHouseGuests: n("inHouseGuests"), boardBasis: f.boardBasis || null });
      router.push(`/buffet/${s.id}`);
    } catch (x) {
      setErr(x instanceof Error ? x.message : t("Failed"));
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-8">
      {err && <div className="md:col-span-8"><Alert>{err}</Alert></div>}
      <div><Label htmlFor="bs-type">{t("Meal")}</Label><Select id="bs-type" name="type">{TYPES.map((ty) => <option key={ty} value={ty}>{t(ty)}</option>)}</Select></div>
      <div><Label htmlFor="bs-date">{t("Date")}</Label><Input id="bs-date" name="serviceDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
      <div><Label htmlFor="bs-dept">{t("Outlet")}</Label><Select id="bs-dept" value={dept} onChange={(e) => setDept(e.target.value)}>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
      <div><Label htmlFor="bs-wh">{t("Issue from")}</Label><Select id="bs-wh" name="warehouseId">{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></div>
      <div><Label htmlFor="bs-exp">{t("Expected covers")}</Label><Input id="bs-exp" name="expectedCovers" inputMode="numeric" /></div>
      <div><Label htmlFor="bs-occ">{t("Occupied rooms")}</Label><Input id="bs-occ" name="occupiedRooms" inputMode="numeric" /></div>
      <div><Label htmlFor="bs-bb">{t("Board basis")}</Label><Select id="bs-bb" name="boardBasis"><option value="">—</option>{["BB", "HB", "FB", "AI", "RO"].map((b) => <option key={b}>{b}</option>)}</Select></div>
      <div className="flex items-end"><Button type="submit">{t("Open session")}</Button></div>
    </form>
  );
}
