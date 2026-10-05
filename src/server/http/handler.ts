/**
 * Route-handler wrapper: authentication, CSRF origin check, JSON parsing,
 * and uniform error mapping. Authorization itself is enforced inside services.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { DomainError, isDomainError, type DomainErrorCode } from "@/domain/errors";
import { Decimal } from "@/domain/money";
import { requireHotel, type Actor } from "../auth/actor";
import type { Permission } from "../auth/permissions";
import { defaultLocale, LANG_COOKIE, normalizeLocale, translateMessage, type Locale } from "@/i18n/core";
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
  RATE_LIMITED: 429,
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

const MAX_BODY = 5 * 1024 * 1024;

/** Locale of an API request (language cookie, else the default). */
export const requestLocale = (req: NextRequest): Locale => normalizeLocale(req.cookies.get(LANG_COOKIE)?.value) ?? defaultLocale();

export function errorResponse(e: unknown, locale: Locale = "en") {
  const tm = (m: string) => translateMessage(locale, m);
  if ((e as { status?: number } | null)?.status === 413) return NextResponse.json({ error: { code: "PAYLOAD_TOO_LARGE", message: tm("Request body exceeds 5 MB") } }, { status: 413 });
  if (isDomainError(e)) {
    const retry = e.code === "RATE_LIMITED" ? (e.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds : undefined;
    return NextResponse.json({ error: { code: e.code, message: tm(e.message), details: toJson(e.details ?? null) } }, { status: STATUS[e.code], headers: retry ? { "retry-after": String(retry) } : undefined });
  }
  if (e instanceof ZodError) return NextResponse.json({ error: { code: "VALIDATION", message: tm("Invalid input"), details: e.issues } }, { status: 422 });
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return NextResponse.json({ error: { code: "DUPLICATE", message: tm("Duplicate record") } }, { status: 409 });
    if (e.code === "P2025") return NextResponse.json({ error: { code: "NOT_FOUND", message: tm("Not found") } }, { status: 404 });
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("TENANT_MISMATCH")) return NextResponse.json({ error: { code: "FORBIDDEN", message: tm("Referenced record belongs to another hotel") } }, { status: 403 });
  if (msg.includes("LEDGER_IMMUTABLE") || msg.includes("RECIPE_VERSION_FROZEN") || msg.includes("BUDGET_FROZEN")) return NextResponse.json({ error: { code: "IMMUTABLE", message: msg.split("\n").pop() } }, { status: 409 });
  console.error("[api] unhandled", e);
  return NextResponse.json({ error: { code: "INTERNAL", message: tm("Unexpected error") } }, { status: 500 });
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

/**
 * `perm`: checked (with hotel access) before the handler reads the body, so a caller without the right
 * is refused with 403 whatever it sends. Services still authorize on their own; this only orders the checks.
 */
export function api(fn: (ctx: Ctx) => Promise<unknown>, opts: { perm?: Permission } = {}) {
  return async (req: NextRequest, rc: RouteCtx) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
        return NextResponse.json({ error: { code: "FORBIDDEN", message: translateMessage(requestLocale(req), "Cross-origin request rejected") } }, { status: 403 });
      }
      const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      const actor = await actorFromToken(req.cookies.get(SESSION_COOKIE)?.value ?? bearer);
      if (!actor) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: translateMessage(requestLocale(req), "Sign in required") } }, { status: 401 });
      const query = req.nextUrl.searchParams;
      // Hotel comes from explicit query/header or the cookie; services re-check access (IDOR).
      const hotelId = query.get("hotelId") ?? req.headers.get("x-hotel-id") ?? req.cookies.get(HOTEL_COOKIE)?.value ?? actor.hotelIds[0] ?? "";
      if (opts.perm) {
        if (!actor.permissions.has(opts.perm)) throw new DomainError("FORBIDDEN", `Missing permission: ${opts.perm}`);
        if (opts.perm !== "platform:admin") requireHotel(actor, hotelId);
      }
      const params = (await rc?.params) ?? {};
      const result = await fn({
        actor,
        hotelId,
        req,
        params,
        query,
        body: async () => {
          // the declared length can be absent or wrong (chunked uploads): measure what actually arrived
          const len = Number(req.headers.get("content-length") ?? 0);
          if (len > MAX_BODY) throw Object.assign(new Error("Payload too large"), { status: 413 });
          const text = await req.text();
          if (Buffer.byteLength(text) > MAX_BODY) throw Object.assign(new Error("Payload too large"), { status: 413 });
          try {
            return text ? JSON.parse(text) : {};
          } catch {
            throw new DomainError("VALIDATION", "Request body is not valid JSON");
          }
        },
      });
      if (result instanceof NextResponse) return result;
      return NextResponse.json(toJson(result));
    } catch (e) {
      return errorResponse(e, requestLocale(req));
    }
  };
}

export function dateParam(q: URLSearchParams, key: string, fallback: Date): Date {
  const v = q.get(key);
  if (!v) return fallback;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? fallback : d;
}
