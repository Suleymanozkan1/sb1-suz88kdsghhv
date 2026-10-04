/** Helpers for server-rendered pages. */
import { redirect } from "next/navigation";
import { currentActor, currentHotelId } from "./auth/session";
import type { Actor } from "./auth/actor";
import { prisma } from "./db";
import { isDomainError } from "@/domain/errors";

export async function pageContext(): Promise<{ actor: Actor; hotelId: string; hotel: { id: string; name: string; baseCurrency: string } }> {
  const actor = await currentActor();
  const hotelId = await currentHotelId();
  if (!actor || !hotelId) redirect("/login");
  const hotel = await prisma.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { id: true, name: true, baseCurrency: true } });
  return { actor, hotelId, hotel };
}

/** Run a service call; FORBIDDEN becomes a friendly message instead of a crash. */
export async function guarded<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (isDomainError(e)) return { ok: false, error: e.message };
    throw e;
  }
}

export function monthRange(sp: { from?: string; to?: string }) {
  const now = new Date();
  const from = sp.from ? new Date(`${sp.from}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = sp.to ? new Date(new Date(`${sp.to}T00:00:00Z`).getTime() + 86400000) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { from, to, fromStr: from.toISOString().slice(0, 10), toStr: new Date(to.getTime() - 86400000).toISOString().slice(0, 10) };
}
