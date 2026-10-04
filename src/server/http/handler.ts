/**
 * Route-handler wrapper: authentication, CSRF origin check, JSON parsing,
 * and uniform error mapping. Authorization itself is enforced inside services.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { isDomainError, type DomainErrorCode } from "@/domain/errors";
import { Decimal } from "@/domain/money";
import type { Actor } from "../auth/actor";
import { actorFromToken, SESSION_COOKIE, HOTEL_COOKIE } from "../auth/session";

const STATUS: Record<DomainErrorCode, number> = {
  VALIDATION: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  UNAUTHENTICATED: 401,
  CONFLICT: 409,
  PERIOD_CLOSED: 423,
  INSUFFICIENT_STOCK: 409,
  UOM_CONVERSION: 422,
  RECIPE_CYCLE: 422,
  MISSING_COST: 422,
  APPROVAL_REQUIRED: 202,
  IMMUTABLE: 409,
  DUPLICATE: 409,
};

/** JSON replacer: Decimal → string (never float), Map → object. */
export function toJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (v instanceof Decimal) return v.toString();
      if (v && typeof v === "object" && v.constructor?.name === "Decimal" && typeof v.toFixed === "function") return v.toString();
      if (v instanceof Map) return Object.fromEntries(v);
      if (typeof v === "bigint") return v.toString();
      return v;
    }),
  );
}

export function errorResponse(e: unknown) {
  if (isDomainError(e)) return NextResponse.json({ error: { code: e.code, message: e.message, details: toJson(e.details ?? null) } }, { status: STATUS[e.code] });
  if (e instanceof ZodError) return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid input", details: e.issues } }, { status: 422 });
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return NextResponse.json({ error: { code: "DUPLICATE", message: "Duplicate record" } }, { status: 409 });
    if (e.code === "P2025") return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("LEDGER_IMMUTABLE") || msg.includes("RECIPE_VERSION_FROZEN") || msg.includes("BUDGET_FROZEN")) return NextResponse.json({ error: { code: "IMMUTABLE", message: msg.split("\n").pop() } }, { status: 409 });
  console.error("[api] unhandled", e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Unexpected error" } }, { status: 500 });
}

/** Mutations must come from our own origin (CSRF defence in depth on top of SameSite cookies). */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export interface Ctx {
  actor: Actor;
  hotelId: string;
  req: NextRequest;
  params: Record<string, string>;
  body: () => Promise<unknown>;
  query: URLSearchParams;
}

type RouteCtx = { params: Promise<Record<string, string>> };

export function api(fn: (ctx: Ctx) => Promise<unknown>) {
  return async (req: NextRequest, rc: RouteCtx) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
        return NextResponse.json({ error: { code: "FORBIDDEN", message: "Cross-origin request rejected" } }, { status: 403 });
      }
      const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      const actor = await actorFromToken(req.cookies.get(SESSION_COOKIE)?.value ?? bearer);
      if (!actor) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } }, { status: 401 });
      const query = req.nextUrl.searchParams;
      // Hotel comes from explicit query/header or the cookie; services re-check access (IDOR).
      const hotelId = query.get("hotelId") ?? req.headers.get("x-hotel-id") ?? req.cookies.get(HOTEL_COOKIE)?.value ?? actor.hotelIds[0] ?? "";
      const params = (await rc?.params) ?? {};
      const result = await fn({
        actor,
        hotelId,
        req,
        params,
        query,
        body: async () => {
          const len = Number(req.headers.get("content-length") ?? 0);
          if (len > 5 * 1024 * 1024) throw Object.assign(new Error("Payload too large"), { status: 413 });
          return req.json();
        },
      });
      if (result instanceof NextResponse) return result;
      return NextResponse.json(toJson(result));
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function dateParam(q: URLSearchParams, key: string, fallback: Date): Date {
  const v = q.get(key);
  if (!v) return fallback;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? fallback : d;
}
