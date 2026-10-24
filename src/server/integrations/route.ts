/** Route wrapper for the automation's endpoints: integration key instead of a session, JSON errors. */
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { DomainError } from "@/domain/errors";
import { prisma } from "../db";
import { readJson, requestIdOf } from "../http/handler";
import type { Actor } from "../auth/actor";
import { accessHas, hotelAccess } from "../plans";
import { errorFields, log } from "../log";
import { integrationActor } from "./ingest";

const MAX = 10 * 1024 * 1024;

const STATUS: Partial<Record<string, number>> = { NOT_FOUND: 404, PLAN_REQUIRED: 403, PAYMENT_REQUIRED: 402 };

export function botApi(fn: (c: { hotelId: string; actor: Actor; body: () => Promise<unknown>; query: URLSearchParams }) => Promise<unknown>) {
  return async (req: NextRequest) => {
    const requestId = requestIdOf(req);
    const who = await integrationActor(prisma, req.headers.get("authorization"));
    if (!who) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Invalid or revoked integration key" } }, { status: 401 });
    try {
      // the automation is a STANDARD feature, and an expired subscription is read-only for the bot as well
      const access = await hotelAccess(prisma, who.hotelId);
      if (!accessHas(access, "integrations")) throw new DomainError("PLAN_REQUIRED", "This feature is part of the STANDARD plan");
      if (access.readOnly && req.method !== "GET") throw new DomainError("PAYMENT_REQUIRED", "The subscription has expired: data is read-only until payment");
      const out = await fn({
        ...who,
        query: req.nextUrl.searchParams,
        body: () => readJson(req, MAX),
      });
      return NextResponse.json(out);
    } catch (e) {
      if (e instanceof ZodError) return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid input", details: e.issues.map((i) => ({ path: i.path, message: i.message })) } }, { status: 400 });
      if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: STATUS[e.code] ?? 400 });
      const status = (e as { status?: number }).status;
      if (status === 413) return NextResponse.json({ error: { code: "TOO_LARGE", message: "Payload too large" } }, { status });
      log.error("integrations unhandled error", { requestId, path: req.nextUrl.pathname, hotelId: who.hotelId, ...errorFields(e) });
      return NextResponse.json({ error: { code: "INTERNAL", message: "Unexpected error", requestId } }, { status: 500 });
    }
  };
}
