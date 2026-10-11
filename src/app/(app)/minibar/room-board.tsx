"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select, Table, Td, Th, cn } from "@/components/ui";
import { call } from "@/lib/client";
import { parseNum } from "@/lib/format";
import { useT } from "@/i18n/client";
import { Title } from "@/components/title";

interface Room { id: string; number: string; roomType: string; floor: string | null; complete: boolean; missing: string; occupied: boolean | null; items: { productId: string; product: string; par: string; qty: string }[] }

export function RoomBoard({ rooms, canManage }: { rooms: Room[]; canManage: boolean }) {
  const t = useT();
  const [sel, setSel] = useState<string | null>(null);
  const room = rooms.find((r) => r.id === sel) ?? null;
  // Opera's list of rooms sold last night: only those minibars need checking (no list → no marks, no filter)
  const known = rooms.some((r) => r.occupied !== null);
  const [onlyOccupied, setOnlyOccupied] = useState(false);
  const shown = known && onlyOccupied ? rooms.filter((r) => r.occupied) : rooms;
  const floors = [...new Set(shown.map((r) => r.floor ?? "—"))];
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <p className="text-xs text-ink-500"><span className="mr-3 inline-block h-2 w-2 rounded-full bg-brand-500" /> {t("stocked to par")} <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" /> {t("needs restock")}{known && <><span className="ml-3 mr-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-600" /> {t("occupied last night")}</>}</p>
        {known && <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={onlyOccupied} onChange={(e) => setOnlyOccupied(e.target.checked)} /> {t("Show occupied rooms only")}</label>}
        {floors.map((f) => (
          <div key={f}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{t("Floor {f}", { f })}</p>
            <div className="flex flex-wrap gap-1.5">
              {shown.filter((r) => (r.floor ?? "—") === f).map((r) => (
                <button key={r.id} onClick={() => setSel(r.id)} aria-pressed={sel === r.id} title={`${r.roomType}${r.occupied ? ` · ${t("occupied")}` : ""}${r.complete ? "" : ` · ${t("{n} items missing", { n: r.missing })}`}`} className={cn("relative w-14 rounded-md border px-1 py-1.5 text-xs font-medium tabular-nums", r.complete ? "border-brand-200 bg-brand-50 text-brand-800" : "border-amber-300 bg-amber-50 text-amber-900", sel === r.id && "ring-2 ring-brand-600")}>
                  {r.number}
                  {r.occupied && <span aria-label={t("occupied")} className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-sky-600" />}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div>{room ? <RoomPanel key={room.id} room={room} canManage={canManage} /> : <p className="text-sm text-ink-500">{t("Select a room.")}</p>}</div>
    </div>
  );
}

function RoomPanel({ room, canManage }: { room: Room; canManage: boolean }) {
  const t = useT();
  const router = useRouter();
  const [type, setType] = useState<"CONSUMED" | "RESTOCK" | "RETURNED" | "WASTE" | "COUNT">("CONSUMED");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [folio, setFolio] = useState("");
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // one key per entry: a double click or a retry after a lost response posts the movement once
  const idem = useRef(crypto.randomUUID());
  const today = new Date().toISOString();
  async function run(fn: () => Promise<unknown>, ok: (r: unknown) => string) {
    setMsg(null);
    setBusy(true);
    try {
      const r = await fn();
      setMsg({ tone: "green", text: ok(r) });
      setVals({});
      idem.current = crypto.randomUUID();
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : t("Failed") });
    } finally {
      setBusy(false);
    }
  }
  const items = room.items.map((i) => ({ productId: i.productId, quantity: (vals[i.productId] ?? "").trim() })).filter((i) => i.quantity !== "" && (type === "COUNT" ? parseNum(i.quantity) >= 0 : parseNum(i.quantity) > 0));
  return (
    <div className="space-y-3 rounded-lg border border-ink-200 p-3">
      <p className="font-semibold">{t("Room {n}", { n: room.number })} <span className="font-normal text-ink-500">· {room.roomType}</span></p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Table>
        <thead><tr><Th>{t("Item")}</Th><Th align="right">{t("In room")}</Th><Th align="right">{t("Par")}</Th>{canManage && <Th align="right">{type === "COUNT" ? t("Counted") : t("Qty")}</Th>}</tr></thead>
        <tbody className="divide-y divide-ink-100">
          {room.items.map((i) => (
            <tr key={i.productId}>
              <Td><Title>{i.product}</Title></Td><Td align="right">{Number(i.qty)}</Td><Td align="right">{Number(i.par)}</Td>
              {canManage && <Td align="right"><Input aria-label={`${t(type)} ${i.product}`} className="w-16 text-right" inputMode="decimal" value={vals[i.productId] ?? ""} onChange={(e) => { setVals({ ...vals, [i.productId]: e.target.value }); idem.current = crypto.randomUUID(); }} /></Td>}
            </tr>
          ))}
        </tbody>
      </Table>
      {canManage && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="mb-type">{t("Action")}</Label><Select id="mb-type" value={type} onChange={(e) => { setType(e.target.value as typeof type); idem.current = crypto.randomUUID(); }}><option value="CONSUMED">{t("Consumption (charged)")}</option><option value="RESTOCK">{t("Restock")}</option><option value="RETURNED">{t("Return to store")}</option><option value="WASTE">{t("Waste / damaged")}</option><option value="COUNT">{t("Physical count")}</option></Select></div>
            {type === "CONSUMED" && <div><Label htmlFor="mb-folio">{t("Folio")}</Label><Input id="mb-folio" value={folio} onChange={(e) => { setFolio(e.target.value); idem.current = crypto.randomUUID(); }} /></div>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !items.length} onClick={() => run(() => (type === "COUNT" ? call("POST", "/api/minibar/count", { roomId: room.id, countedAt: today, lines: items.map((i) => ({ productId: i.productId, countedQty: i.quantity })), idempotencyKey: idem.current }) : call("POST", "/api/minibar/movements", { roomId: room.id, type, movedAt: today, folioRef: folio || null, items, idempotencyKey: idem.current })), () => t("Posted"))}>{t("Post")}</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => call("POST", "/api/minibar/movements", { roomId: room.id, toPar: true, movedAt: today }), (r) => (Array.isArray(r) && !r.length ? t("Already at par — nothing to restock") : t("Restocked to par")))}>{t("Restock to par")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
