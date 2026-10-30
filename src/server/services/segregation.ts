/**
 * Segregation of duties (audit BIZ-02): the person who created a purchase order, budget or recipe version cannot
 * approve it, unless the hotel allows self-approval (Admin, hotel settings; meant for small hotels with one manager).
 */
import { DomainError } from "@/domain/errors";
import type { Db } from "../db";
import type { Actor } from "../auth/actor";

/** Does the hotel let a record's creator approve it? (drives the Approve buttons; the services enforce the rule) */
export async function selfApprovalAllowed(db: Db, hotelId: string): Promise<boolean> {
  return (await db.hotel.findUnique({ where: { id: hotelId }, select: { allowSelfApproval: true } }))?.allowSelfApproval ?? false;
}

export async function assertNotOwnRecord(db: Db, actor: Actor, hotelId: string, createdById: string | null | undefined): Promise<void> {
  if (!createdById || createdById !== actor.userId) return;
  if (await selfApprovalAllowed(db, hotelId)) return;
  throw new DomainError("FORBIDDEN", "The person who created a record cannot approve it");
}
