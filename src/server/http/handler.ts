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
import { actorFromToken, isApiToken, SESSION_COOKIE, HOTEL_COOKIE } from "../auth/session";
import { errorFields, log } from "../log";
import { prisma } from "../db";
import { accessHas, FEATURES, featureForPath, organizationAccess, type Feature } from "../plans";
import { canonicalPath } from "@/lib/features";

/** Public address for links in e-mails: PUBLIC_BASE_URL, else the host the request came to. */
export function publicBaseUrl(req: NextRequest): string {
  return (process.env.PUBLIC_BASE_URL ?? `${req.nextUrl.protocol}//${req.headers.get("x-forwarded-host") ?? req.headers.get("host")}`).replace(/\/$/, "");
}

/** A caller-supplied request id is kept only if it looks like one (it is echoed into logs and a header). */
export function requestIdOf(req: Request): string {
  const given = req.headers.get("x-request-id")?.trim();
  return given && /^[A-Za-z0-9._-]{8,100}$/.test(given) ? given : crypto.randomUUID();
}

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
  PLAN_REQUIRED: 403,
  PAYMENT_REQUIRED: 402,
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
/** Anonymous endpoints (login, invitation, setup) take a few short fields. */
export const SMALL_BODY = 64 * 1024;

const tooLarge = (limit: number) => Object.assign(new Error("Payload too large"), { status: 413, limit });

/**
 * Reads at most `max` bytes of the body. The declared length can be absent (chunked upload) or wrong, so the bytes are
 * counted as they arrive and the stream is cancelled at the limit instead of being buffered whole and measured afterwards.
 */
export async function readBodyText(req: Request, max: number): Promise<string> {
  if (Number(req.headers.get("content-length") ?? 0) > max) throw tooLarge(max);
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(max);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** JSON body read through readBodyText; an empty body is `{}`. */
export async function readJson(req: Request, max = MAX_BODY): Promise<unknown> {
  const text = await readBodyText(req, max);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new DomainError("VALIDATION", "Request body is not valid JSON");
  }
}

/**
 * Client address for per-source rate limits. The left-most X-Forwarded-For entry is whatever the client sent, so it is
 * never used. On Vercel the edge sets x-real-ip (and rewrites X-Forwarded-For). Elsewhere the right-most entry is the
 * peer seen by the nearest reverse proxy, or by Next itself when the client sent none; TRUSTED_PROXY_HOPS skips further proxies.
 */
export function clientIp(req: Request): string {
  if (process.env.VERCEL) {
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  const hops = Math.max(0, Math.trunc(Number(process.env.TRUSTED_PROXY_HOPS ?? 0)) || 0);
  const parts = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // Route handlers get no socket address, so without a reverse proxy that REPLACES the header a client can choose
  // the value used here (the per-account login limit still holds). A chain longer than the declared proxies means
  // either an undeclared proxy or a forged header: say so once, the fix is deployment configuration.
  if (parts.length > hops + 1 && !warnedXff) {
    warnedXff = true;
    log.warn("X-Forwarded-For has more entries than TRUSTED_PROXY_HOPS allows; run behind a reverse proxy that overwrites the header and set TRUSTED_PROXY_HOPS", { entries: parts.length, trustedProxyHops: hops });
  }
  return parts[Math.max(0, parts.length - 1 - hops)] ?? "local";
}
let warnedXff = false;

/** The only route a personal API token (Excel refresh) may call, read-only. */
const API_TOKEN_ROUTES = new Set(["/api/export/full-cost"]);

/** Locale of an API request (language cookie, else the default). */
export const requestLocale = (req: NextRequest): Locale => normalizeLocale(req.cookies.get(LANG_COOKIE)?.value) ?? defaultLocale();

export function errorResponse(e: unknown, locale: Locale = "en", ctx: { requestId?: string; path?: string } = {}) {
  const tm = (m: string) => translateMessage(locale, m);
  if ((e as { status?: number } | null)?.status === 413) {
    const limit = (e as { limit?: number }).limit;
    return NextResponse.json({ error: { code: "PAYLOAD_TOO_LARGE", message: tm(limit && limit !== MAX_BODY ? "Request body is too large" : "Request body exceeds 5 MB") } }, { status: 413 });
  }
  if (isDomainError(e)) {
    const retry = e.code === "RATE_LIMITED" ? (e.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds : undefined;
    return NextResponse.json({ error: { code: e.code, message: tm(e.message), details: toJson(e.details ?? null) } }, { status: STATUS[e.code], headers: retry ? { "retry-after": String(retry) } : undefined });
  }
  if (e instanceof ZodError) return NextResponse.json({ error: { code: "VALIDATION", message: tm("Invalid input"), details: e.issues.map((i) => ({ ...i, message: tm(i.message) })) } }, { status: 422 });
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return NextResponse.json({ error: { code: "DUPLICATE", message: tm("Duplicate record") } }, { status: 409 });
    if (e.code === "P2025") return NextResponse.json({ error: { code: "NOT_FOUND", message: tm("Not found") } }, { status: 404 });
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("TENANT_MISMATCH")) return NextResponse.json({ error: { code: "FORBIDDEN", message: tm("Referenced record belongs to another hotel") } }, { status: 403 });
  if (msg.includes("LEDGER_IMMUTABLE") || msg.includes("RECIPE_VERSION_FROZEN") || msg.includes("BUDGET_FROZEN")) return NextResponse.json({ error: { code: "IMMUTABLE", message: msg.split("\n").pop() } }, { status: 409 });
  log.error("api unhandled error", { ...ctx, ...errorFields(e) });
  // the request id lets support find this exact failure in the logs without exposing any internals
  return NextResponse.json({ error: { code: "INTERNAL", message: tm("Unexpected error"), ...(ctx.requestId ? { requestId: ctx.requestId } : {}) } }, { status: 500 });
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
export function api(fn: (ctx: Ctx) => Promise<unknown>, opts: { perm?: Permission; feature?: Feature } = {}) {
  return async (req: NextRequest, rc: RouteCtx) => {
    const started = performance.now();
    const requestId = requestIdOf(req);
    const path = req.nextUrl.pathname;
    const meta: { userId?: string; hotelId?: string } = {};
    let res: Response;
    try {
      res = await handle(fn, opts, req, rc, meta);
    } catch (e) {
      res = errorResponse(e, requestLocale(req), { requestId, path, ...meta });
    }
    try {
      res.headers.set("x-request-id", requestId);
    } catch {
      // a response with immutable headers (rare: a proxied fetch) simply goes out without the id
    }
    log.info("api", { method: req.method, path, status: res.status, ms: Math.trunc(performance.now() - started), requestId, ...meta });
    return res;
  };
}

/**
 * Writes that stay possible on an expired (read-only) subscription: signing in/out and switching hotel, paying,
 * the platform console, and exporting one's own data — a tenant is never locked out of its numbers.
 */
const READ_ONLY_EXEMPT = ["/api/auth/", "/api/billing/", "/api/platform/", "/api/export/", "/api/table-export/", "/api/reports/"];

async function handle(fn: (ctx: Ctx) => Promise<unknown>, opts: { perm?: Permission; feature?: Feature }, req: NextRequest, rc: RouteCtx, meta: { userId?: string; hotelId?: string }): Promise<Response> {
  const writing = req.method !== "GET" && req.method !== "HEAD";
  if (writing && !sameOrigin(req)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: translateMessage(requestLocale(req), "Cross-origin request rejected") } }, { status: 403 });
  }
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? bearer;
  const actor = await actorFromToken(token);
  if (!actor) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: translateMessage(requestLocale(req), "Sign in required") } }, { status: 401 });
  meta.userId = actor.userId;
  // a personal API token only reads the Excel export: it cannot change data or mint its own successors
  if (isApiToken(token) && (req.method !== "GET" || !API_TOKEN_ROUTES.has(req.nextUrl.pathname))) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: translateMessage(requestLocale(req), "An API token can only be used for the Excel export") } }, { status: 403 });
  }
  const query = req.nextUrl.searchParams;
  // Hotel comes from explicit query/header or the cookie; services re-check access (IDOR).
  // A cookie left over from another user or a hotel since lost / suspended is ignored, like currentHotelId().
  const cookieHotel = req.cookies.get(HOTEL_COOKIE)?.value;
  const hotelId = query.get("hotelId") ?? req.headers.get("x-hotel-id") ?? (cookieHotel && actor.hotelIds.includes(cookieHotel) ? cookieHotel : actor.hotelIds[0]) ?? "";
  meta.hotelId = hotelId || undefined;
  if (opts.perm) {
    if (!actor.permissions.has(opts.perm)) throw new DomainError("FORBIDDEN", `Missing permission: ${opts.perm}`);
    if (opts.perm !== "platform:admin") requireHotel(actor, hotelId);
  }
  // package and subscription: one place for every route (src/server/plans.ts)
  const path = req.nextUrl.pathname;
  // a path that cannot be decoded is not a route of ours (and must not slip past the gate below)
  if (canonicalPath(path) === null) throw new DomainError("NOT_FOUND", "Not found");
  const feature = opts.feature ?? featureForPath(path);
  const exempt = READ_ONLY_EXEMPT.some((p) => (canonicalPath(path) ?? "").startsWith(p));
  if (feature || (writing && !exempt)) {
    const access = await organizationAccess(prisma, actor.organizationId);
    if (feature && !accessHas(access, feature)) throw new DomainError("PLAN_REQUIRED", `This feature is part of the ${FEATURES[feature]} plan`, { feature, plan: FEATURES[feature] });
    if (writing && !exempt && access.readOnly) throw new DomainError("PAYMENT_REQUIRED", "The subscription has expired: data is read-only until payment");
  }
  const params = (await rc?.params) ?? {};
  const result = await fn({
    actor,
    hotelId,
    req,
    params,
    query,
    body: () => readJson(req, MAX_BODY),
  });
  if (result instanceof Response) return result;
  return NextResponse.json(toJson(result));
}

export function dateParam(q: URLSearchParams, key: string, fallback: Date): Date {
  const v = q.get(key);
  if (!v) return fallback;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? fallback : d;
}
