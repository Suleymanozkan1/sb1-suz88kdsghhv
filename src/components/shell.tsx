"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, Boxes, FileSpreadsheet, UtensilsCrossed, Wine, Building2, ChefHat, ClipboardCheck, ClipboardList, FileSearch, Gauge, LogOut, Menu, Package, Receipt, ShieldCheck, ShoppingCart, Trash2, Upload, CalendarClock, X, Truck, BedDouble, Wrench, Split, FileUp,
} from "lucide-react";
import { cn } from "./ui";
import { call } from "@/lib/client";

const NAV = [
  { href: "/", label: "Dashboard", icon: Gauge, perm: "dashboard:view" },
  { href: "/variance", label: "Theoretical vs Actual", icon: BarChart3, perm: "variance:view" },
  { href: "/inventory", label: "Inventory", icon: Boxes, perm: "inventory:view" },
  { href: "/inventory/ledger", label: "Stock Ledger", icon: ClipboardList, perm: "inventory:view" },
  { href: "/inventory/counts", label: "Stock Counts", icon: ClipboardCheck, perm: "inventory:count" },
  { href: "/purchasing", label: "Purchasing", icon: ShoppingCart, perm: "purchase:view" },
  { href: "/purchasing/orders", label: "Order Suggestions", icon: Truck, perm: "purchase:view" },
  { href: "/products", label: "Products", icon: Package, perm: "product:view" },
  { href: "/recipes", label: "Recipes", icon: ChefHat, perm: "recipe:view" },
  { href: "/waste", label: "Waste", icon: Trash2, perm: "waste:view" },
  { href: "/buffet", label: "Buffet", icon: UtensilsCrossed, perm: "buffet:view" },
  { href: "/minibar", label: "Minibar", icon: Wine, perm: "minibar:view" },
  { href: "/rooms", label: "Room Cost", icon: BedDouble, perm: "rooms:view" },
  { href: "/operations", label: "Operating Costs", icon: Wrench, perm: "opex:view" },
  { href: "/allocation", label: "Cost Allocation", icon: Split, perm: "opex:view" },
  { href: "/imports", label: "Imports", icon: FileUp, perm: "opex:view" },
  { href: "/sales", label: "Sales Import", icon: Upload, perm: "sales:import" },
  { href: "/approvals", label: "Approvals", icon: Receipt, perm: "dashboard:view" },
  { href: "/periods", label: "Cost Periods", icon: CalendarClock, perm: "period:manage" },
  { href: "/data-quality", label: "Data Quality", icon: ShieldCheck, perm: "dashboard:view" },
  { href: "/excel", label: "Excel Export", icon: FileSpreadsheet, perm: "report:export" },
  { href: "/audit", label: "Audit Trail", icon: FileSearch, perm: "audit:view" },
];

export function Shell({ user, hotels, hotelId, permissions, pendingApprovals, children }: { user: { name: string; role: string }; hotels: { id: string; name: string }[]; hotelId: string; permissions: string[]; pendingApprovals: number; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => permissions.includes(n.perm));
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || (path.startsWith(`${href}/`) && !items.some((i) => i.href !== href && i.href.startsWith(href) && path.startsWith(i.href))));

  async function switchHotel(id: string) {
    await call("POST", "/api/auth/hotel", { hotelId: id });
    router.refresh();
  }
  async function signOut() {
    await call("POST", "/api/auth/logout");
    router.replace("/login");
    router.refresh();
  }

  const nav = (
    <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
      {items.map((n) => (
        <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={isActive(n.href) ? "page" : undefined} className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition", isActive(n.href) ? "bg-brand-600/15 text-white" : "text-ink-300 hover:bg-white/5 hover:text-white")}>
          <n.icon className={cn("h-4 w-4", isActive(n.href) ? "text-brand-300" : "text-ink-400")} aria-hidden />
          <span className="flex-1">{n.label}</span>
          {n.href === "/approvals" && pendingApprovals > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-ink-950">{pendingApprovals}</span>}
        </Link>
      ))}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-ink-950">
      <div className="flex items-center gap-2 px-5 py-5 text-base font-semibold text-white">
        <Building2 className="h-5 w-5 text-brand-400" aria-hidden /> HotelCost
      </div>
      <div className="px-3">
        <label htmlFor="hotel" className="sr-only">Hotel</label>
        <select id="hotel" value={hotelId} onChange={(e) => switchHotel(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500">
          {hotels.map((h) => (
            <option key={h.id} value={h.id} className="text-ink-900">{h.name}</option>
          ))}
        </select>
      </div>
      {nav}
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{user.name}</p>
            <p className="truncate text-xs text-ink-400">{user.role}</p>
          </div>
          <button onClick={signOut} className="rounded-md p-1.5 text-ink-400 hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink-950/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72">{sidebar}</div>
          <button className="absolute right-3 top-3 rounded-md bg-white p-1.5" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-ink-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 hover:bg-ink-100" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold">HotelCost</span>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
