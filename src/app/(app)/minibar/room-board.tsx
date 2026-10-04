"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select, Table, Td, Th, cn } from "@/components/ui";
import { call } from "@/lib/client";

interface Room { id: string; number: string; roomType: string; floor: string | null; complete: boolean; missing: string; items: { productId: string; product: string; par: string; qty: string }[] }

export function RoomBoard({ rooms, canManage }: { rooms: Room[]; canManage: boolean }) {
  const [sel, setSel] = useState<string | null>(null);
  const room = rooms.find((r) => r.id === sel) ?? null;
  const floors = [...new Set(rooms.map((r) => r.floor ?? "—"))];
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <p className="text-xs text-ink-500"><span className="mr-3 inline-block h-2 w-2 rounded-full bg-brand-500" /> stocked to par <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" /> needs restock</p>
        {floors.map((f) => (
          <div key={f}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Floor {f}</p>
            <div className="flex flex-wrap gap-1.5">
              {rooms.filter((r) => (r.floor ?? "—") === f).map((r) => (
                <button key={r.id} onClick={() => setSel(r.id)} aria-pressed={sel === r.id} title={`${r.roomType}${r.complete ? "" : ` · ${r.missing} items missing`}`} className={cn("w-14 rounded-md border px-1 py-1.5 text-xs font-medium tabular-nums", r.complete ? "border-brand-200 bg-brand-50 text-brand-800" : "border-amber-300 bg-amber-50 text-amber-900", sel === r.id && "ring-2 ring-brand-600")}>
                  {r.number}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div>{room ? <RoomPanel key={room.id} room={room} canManage={canManage} /> : <p className="text-sm text-ink-500">Select a room.</p>}</div>
    </div>
  );
}

function RoomPanel({ room, canManage }: { room: Room; canManage: boolean }) {
  const router = useRouter();
  const [type, setType] = useState<"CONSUMED" | "RESTOCK" | "RETURNED" | "WASTE" | "COUNT">("CONSUMED");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [folio, setFolio] = useState("");
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const today = new Date().toISOString();
  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "green", text: ok });
      setVals({});
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Failed" });
    }
  }
  const items = room.items.map((i) => ({ productId: i.productId, quantity: vals[i.productId] ?? "" })).filter((i) => i.quantity !== "" && (type === "COUNT" || Number(i.quantity) > 0));
  return (
    <div className="space-y-3 rounded-lg border border-ink-200 p-3">
      <p className="font-semibold">Room {room.number} <span className="font-normal text-ink-500">· {room.roomType}</span></p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Table>
        <thead><tr><Th>Item</Th><Th align="right">In room</Th><Th align="right">Par</Th>{canManage && <Th align="right">{type === "COUNT" ? "Counted" : "Qty"}</Th>}</tr></thead>
        <tbody className="divide-y divide-ink-100">
          {room.items.map((i) => (
            <tr key={i.productId}>
              <Td>{i.product}</Td><Td align="right">{Number(i.qty)}</Td><Td align="right">{Number(i.par)}</Td>
              {canManage && <Td align="right"><Input aria-label={`${type} ${i.product}`} className="w-16 text-right" inputMode="decimal" value={vals[i.productId] ?? ""} onChange={(e) => setVals({ ...vals, [i.productId]: e.target.value })} /></Td>}
            </tr>
          ))}
        </tbody>
      </Table>
      {canManage && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="mb-type">Action</Label><Select id="mb-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="CONSUMED">Consumption (charged)</option><option value="RESTOCK">Restock</option><option value="RETURNED">Return to store</option><option value="WASTE">Waste / damaged</option><option value="COUNT">Physical count</option></Select></div>
            {type === "CONSUMED" && <div><Label htmlFor="mb-folio">Folio</Label><Input id="mb-folio" value={folio} onChange={(e) => setFolio(e.target.value)} /></div>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!items.length} onClick={() => run(() => (type === "COUNT" ? call("POST", "/api/minibar/count", { roomId: room.id, countedAt: today, lines: items.map((i) => ({ productId: i.productId, countedQty: i.quantity })) }) : call("POST", "/api/minibar/movements", { roomId: room.id, type, movedAt: today, folioRef: folio || null, items, idempotencyKey: crypto.randomUUID() })), "Posted")}>Post</Button>
            <Button size="sm" variant="secondary" onClick={() => run(() => call("POST", "/api/minibar/movements", { roomId: room.id, toPar: true, movedAt: today }), "Restocked to par")}>Restock to par</Button>
          </div>
        </div>
      )}
    </div>
  );
}
