"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";
import { BOARD_BASIS } from "@/lib/board-basis";

const TYPES = ["BREAKFAST", "LUNCH", "DINNER", "ALL_INCLUSIVE", "SPECIAL_EVENT", "BANQUET", "THEME_NIGHT", "HOLIDAY"];

type Defaults = { covers: number | null; coversSource: string | null; occupiedRooms: number | null; guests: number | null; occupancySource: string | null };

export function NewSession({ departments, warehouses }: { departments: { id: string; name: string }[]; warehouses: { id: string; name: string; departmentId: string | null }[] }) {
  const t = useT();
  const router = useRouter();
  const [dept, setDept] = useState(departments.find((d) => /breakfast|kahvaltı/i.test(d.name))?.id ?? departments[0]?.id ?? "");
  const [type, setType] = useState("BREAKFAST");
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [covers, setCovers] = useState("");
  const [rooms, setRooms] = useState("");
  const [guests, setGuests] = useState("");
  const [src, setSrc] = useState<Defaults | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // fields the user typed into for the current selection: a late default never overwrites them
  const edited = useRef({ covers: false, rooms: false, guests: false });
  const whs = [...warehouses].sort((a, b) => Number(b.departmentId === dept) - Number(a.departmentId === dept));

  // covers sold (Micros) and occupancy (Opera) fill in by themselves; still editable
  useEffect(() => {
    if (!dept || !day) return;
    let live = true;
    // a new date / outlet / meal starts empty: nothing from the previous selection can be submitted for it
    edited.current = { covers: false, rooms: false, guests: false };
    setSrc(null);
    setLoading(true);
    setCovers("");
    setRooms("");
    setGuests("");
    const v = (n: number | null) => (n === null ? "" : String(n));
    call<Defaults>("GET", `/api/buffet/defaults?date=${day}&departmentId=${dept}&type=${type}`)
      .then((d) => {
        if (!live) return;
        setSrc(d);
        if (!edited.current.covers) setCovers(v(d.covers));
        if (!edited.current.rooms) setRooms(v(d.occupiedRooms));
        if (!edited.current.guests) setGuests(v(d.guests));
      })
      .catch(() => live && setSrc(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [dept, day, type]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    const n = (v: string) => (v ? Number(v) : null);
    try {
      const s = await call<{ id: string }>("POST", "/api/buffet/sessions", { departmentId: dept, warehouseId: f.warehouseId, type, serviceDate: day, expectedCovers: n(covers), occupiedRooms: n(rooms), inHouseGuests: n(guests), boardBasis: f.boardBasis || null });
      router.push(`/buffet/${s.id}`);
    } catch (x) {
      setErr(x instanceof Error ? x.message : t("Failed"));
    }
  }
  const name = (s: string | null | undefined) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : "—");
  const hint = (value: number | null | undefined, source: string | null | undefined) => <p className="mt-1 text-[11px] text-ink-500">{value === null || value === undefined ? t("no data yet — enter by hand") : t("from {source}", { source: name(source) })}</p>;
  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-8" aria-busy={loading} data-testid="new-buffet-session">
      {err && <div className="md:col-span-8"><Alert>{err}</Alert></div>}
      <div><Label htmlFor="bs-type">{t("Meal")}</Label><Select id="bs-type" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((ty) => <option key={ty} value={ty}>{t(ty)}</option>)}</Select></div>
      <div><Label htmlFor="bs-date">{t("Date")}</Label><Input id="bs-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></div>
      <div><Label htmlFor="bs-dept">{t("Outlet")}</Label><Select id="bs-dept" value={dept} onChange={(e) => setDept(e.target.value)}>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
      <div><Label htmlFor="bs-wh">{t("Issue from")}</Label><Select id="bs-wh" name="warehouseId">{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></div>
      <div><Label htmlFor="bs-exp">{t("Covers sold")}</Label><Input id="bs-exp" inputMode="numeric" value={covers} onChange={(e) => { edited.current.covers = true; setCovers(e.target.value); }} />{hint(src?.covers, src?.coversSource)}</div>
      <div><Label htmlFor="bs-occ">{t("Occupied rooms")}</Label><Input id="bs-occ" inputMode="numeric" value={rooms} onChange={(e) => { edited.current.rooms = true; setRooms(e.target.value); }} />{hint(src?.occupiedRooms, src?.occupancySource)}</div>
      <div><Label htmlFor="bs-gst">{t("In-house guests")}</Label><Input id="bs-gst" inputMode="numeric" value={guests} onChange={(e) => { edited.current.guests = true; setGuests(e.target.value); }} />{hint(src?.guests, src?.occupancySource)}</div>
      <div className="md:col-span-2"><Label htmlFor="bs-bb">{t("Board basis")}</Label><Select id="bs-bb" name="boardBasis"><option value="">—</option>{BOARD_BASIS.map(([code, label]) => <option key={code} value={code}>{t(label)}</option>)}</Select></div>
      <div className="flex items-end"><Button type="submit">{t("Open session")}</Button></div>
    </form>
  );
}
