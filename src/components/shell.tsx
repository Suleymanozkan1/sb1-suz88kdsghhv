"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, KeyRound, Lock, LogOut, Menu, X } from "lucide-react";
import { cn } from "./ui";
import { navItems, NAV_GROUPS } from "./nav";
import { ApiError, call } from "@/lib/client";
import { setLocaleCookie, useLocale, useT } from "@/i18n/client";
import type { Locale } from "@/i18n/core";


export function Shell({ user, hotels, hotelId, permissions, navFlags = [], pendingApprovals, locked = [], children }: { user: { name: string; role: string }; hotels: { id: string; name: string }[]; hotelId: string; permissions: string[]; navFlags?: string[]; pendingApprovals: number; /** package features the tenant does not have */ locked?: string[]; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const t = useT();
  const locale = useLocale();
  const items = navItems(permissions, navFlags);
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || (path.startsWith(`${href}/`) && !items.some((i) => i.href !== href && i.href.startsWith(href) && path.startsWith(i.href))));

  const [busy, setBusy] = useState(false);
  async function switchHotel(id: string) {
    setBusy(true);
    try {
      await call("POST", "/api/auth/hotel", { hotelId: id });
      router.refresh();
    } catch (e) {
      window.alert(`${t("Could not switch hotel")}: ${e instanceof Error ? e.message : t("Failed")}`);
    } finally {
      setBusy(false);
    }
  }
  function switchLanguage(l: Locale) {
    setLocaleCookie(l);
    router.refresh();
  }
  async function signOut() {
    setBusy(true);
    try {
      await call("POST", "/api/auth/logout");
    } catch (e) {
      // the session may already be gone (expired, revoked): go to the sign-in page either way
      if (!(e instanceof ApiError && e.status === 401)) {
        window.alert(`${t("Sign-out failed")}: ${e instanceof Error ? e.message : t("Failed")}`);
        setBusy(false);
        return;
      }
    }
    router.replace("/login");
    router.refresh();
  }

  const off = new Set(locked);
  const nav = (
    <nav aria-label={t("Main")} className="flex-1 overflow-y-auto px-3 py-3">
      {NAV_GROUPS.map((g) => {
        const entries = items.filter((n) => n.group === g.key);
        if (!entries.length) return null;
        return (
          <div key={g.key} className="mb-3">
            <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-300">{t(g.label)}</p>
            <div className="space-y-0.5">
              {entries.map((n) => {
                const isLocked = n.feature !== undefined && off.has(n.feature);
                return (
                  <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={isActive(n.href) ? "page" : undefined} title={isLocked ? t("Not in your package") : undefined} className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition", isActive(n.href) ? "bg-brand-600/15 text-white" : isLocked ? "text-ink-300 hover:bg-white/5 hover:text-white" : "text-ink-300 hover:bg-white/5 hover:text-white")}>
                    <n.icon className={cn("h-4 w-4", isActive(n.href) ? "text-brand-300" : isLocked ? "text-ink-400" : "text-ink-300")} aria-hidden />
                    <span className="flex-1">{t(n.label)}</span>
                    {isLocked && <Lock className="h-3.5 w-3.5 text-ink-400" aria-label={t("Not in your package")} />}
                    {n.href === "/approvals" && pendingApprovals > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-ink-950">{pendingApprovals}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-ink-950">
      <div className="flex items-center gap-2 px-5 py-5 text-base font-semibold text-white">
        <Building2 className="h-5 w-5 text-brand-400" aria-hidden /> HotelCost
      </div>
      <div className="px-3">
        <label htmlFor="hotel" className="sr-only">{t("Hotel")}</label>
        <select id="hotel" value={hotelId} disabled={busy} onChange={(e) => void switchHotel(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500">
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
            <p className="truncate text-xs text-ink-300">{t(user.role)}</p>
          </div>
          <label htmlFor="lang" className="sr-only">{t("Language")}</label>
          <select id="lang" value={locale} onChange={(e) => switchLanguage(e.target.value as Locale)} className="rounded-md border border-white/10 bg-white/5 px-1.5 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="tr" className="text-ink-900">TR</option>
            <option value="en" className="text-ink-900">EN</option>
          </select>
          <Link href="/account/password" className="rounded-md p-1.5 text-ink-300 hover:bg-white/10 hover:text-white" aria-label={t("Change password")} title={t("Change password")}>
            <KeyRound className="h-4 w-4" />
          </Link>
          <button onClick={() => void signOut()} disabled={busy} className="rounded-md p-1.5 text-ink-300 hover:bg-white/10 hover:text-white" aria-label={t("Sign out")} title={t("Sign out")}>
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
          <button className="absolute right-3 top-3 rounded-md bg-white p-1.5" onClick={() => setOpen(false)} aria-label={t("Close menu")}>
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-ink-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 hover:bg-ink-100" aria-label={t("Open menu")}>
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold">HotelCost</span>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
