/** Helpers for server-rendered pages. */
import { redirect } from "next/navigation";
import { currentActor, currentHotelId } from "./auth/session";
import type { Actor } from "./auth/actor";
import type { Permission } from "./auth/permissions";
import { prisma } from "./db";
import { isDomainError } from "@/domain/errors";
import { translateMessage } from "@/i18n/core";
import { getLocale } from "@/i18n/server";

export async function pageContext(): Promise<{ actor: Actor; hotelId: string; hotel: { id: string; name: string; baseCurrency: string; timezone: string; businessDayCutoff: string } }> {
  const actor = await currentActor();
  const hotelId = await currentHotelId();
  if (!actor || !hotelId) redirect("/login");
  const hotel = await prisma.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { id: true, name: true, baseCurrency: true, timezone: true, businessDayCutoff: true } });
  return { actor, hotelId, hotel };
}

/** Run a service call; FORBIDDEN becomes a friendly message instead of a crash. */
export async function guarded<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (isDomainError(e)) return { ok: false, error: translateMessage(await getLocale(), e.message) };
    throw e;
  }
}

/** A real calendar day "YYYY-MM-DD" (anything else, e.g. a hand-edited URL, falls back to the default range). */
function isDay(v: string | undefined): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function monthRange(sp: { from?: string; to?: string }) {
  const now = new Date();
  const from = isDay(sp.from) ? new Date(`${sp.from}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = isDay(sp.to) ? new Date(new Date(`${sp.to}T00:00:00Z`).getTime() + 86400000) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { from, to, fromStr: from.toISOString().slice(0, 10), toStr: new Date(to.getTime() - 86400000).toISOString().slice(0, 10) };
}

/**
 * Page-level permission gate. A user who opens a page outside their role (typed URL, old bookmark) gets the
 * friendly "no permission" page instead of a server error. Services still authorize every call on their own.
 */
export function requirePageAccess(actor: Actor, perm: Permission, hotelId: string): void {
  if (!actor.permissions.has(perm) || !actor.hotelIds.includes(hotelId)) redirect(`/forbidden?need=${encodeURIComponent(perm)}`);
}
