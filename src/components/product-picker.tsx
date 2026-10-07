"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { call } from "@/lib/client";
import { cn } from "./ui";
import { useT } from "@/i18n/client";

export interface PickedProduct {
  id: string;
  name: string;
  sku: string;
  stockUnit: string;
  purchaseUnit: string;
  recipeUnit: string;
  barcode?: string | null;
  category?: { name: string; group: string };
  conversions?: { fromUnit: string; toUnit: string; factor: string }[];
}

/** Server-side search by name, stock code, brand or category. */
export function ProductPicker({ value, onChange, placeholder, id }: { value: PickedProduct | null; onChange: (p: PickedProduct | null) => void; placeholder?: string; id?: string }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickedProduct[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        setItems(await call<PickedProduct[]>("GET", `/api/products?active=1&limit=15&q=${encodeURIComponent(q)}`));
        setActive(0);
      } catch {
        setItems([]);
      }
    }, 150);
  }, [q, open]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-sm">
        <span className="truncate"><span className="font-medium">{value.name}</span> <span className="text-ink-400">{value.sku} · {value.stockUnit}</span></span>
        <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => onChange(null)}>{t("Change")}</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" aria-hidden />
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === "Enter" && items[active]) { e.preventDefault(); onChange(items[active]!); setQ(""); setOpen(false); }
        }}
        placeholder={placeholder ?? t("Search name or stock code…")}
        className="block w-full rounded-lg border border-ink-200 bg-white py-2 pl-8 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-ink-200 bg-white py-1 text-sm shadow-lg">
          {items.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active} onMouseDown={() => { onChange(p); setQ(""); setOpen(false); }} className={cn("cursor-pointer px-3 py-1.5", i === active ? "bg-brand-50" : "hover:bg-ink-50")}>
              <span className="font-medium">{p.name}</span> <span className="text-xs text-ink-400">{p.sku} · {p.category?.name} · {p.stockUnit}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function unitsFor(p: PickedProduct | null): string[] {
  if (!p) return [];
  const MASS = ["g", "kg"], VOL = ["ml", "cl", "l"], CNT = ["pc"];
  const base = MASS.includes(p.stockUnit) ? MASS : VOL.includes(p.stockUnit) ? VOL : CNT.includes(p.stockUnit) ? CNT : [p.stockUnit];
  const extra = (p.conversions ?? []).flatMap((c) => [c.fromUnit, c.toUnit]);
  return [...new Set([p.stockUnit, p.purchaseUnit, p.recipeUnit, ...base, ...extra])];
}
