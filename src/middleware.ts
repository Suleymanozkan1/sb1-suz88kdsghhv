/**
 * Content-Security-Policy with a per-request nonce.
 *
 * The policy used to allow `script-src 'unsafe-inline'`, which turns any future HTML-injection bug into script
 * execution. Next.js reads the nonce from the request's CSP header and puts it on every script it renders, so
 * inline scripts now run only when the server itself emitted them. 'strict-dynamic' lets those trusted scripts load
 * the app's chunks. Every page renders dynamically already (the root layout reads the language cookie), which a
 * nonce requires: a statically cached page would carry a stale nonce.
 *
 * The other security headers stay in next.config.ts (they are static).
 */
import { NextResponse, type NextRequest } from "next/server";

export function buildCsp(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    // 'unsafe-eval' only for the dev server (React Refresh); production bundles run without it
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self' https:",
    "frame-src https://www.youtube.com https://player.vimeo.com",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** SaaS installations show the product page to visitors without a session (a self-hosted hotel keeps its sign-in page). */
const landingEnabled = () => process.env.PUBLIC_LANDING === "1";

export function middleware(req: NextRequest) {
  if (landingEnabled() && req.nextUrl.pathname === "/" && !req.cookies.get("hc_session")) {
    return NextResponse.redirect(new URL("/welcome", req.url));
  }
  // Edge runtime: no Buffer
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  // pages only: API responses are JSON/files and static assets carry no inline script
  matcher: [
    {
      source: "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?|ttf|mp4|webm)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
