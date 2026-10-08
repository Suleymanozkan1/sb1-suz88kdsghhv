/** Route wrapper for the automation's endpoints: integration key instead of a session, JSON errors. */
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { DomainError } from "@/domain/errors";
import { prisma } from "../db";
import type { Actor } from "../auth/actor";
import { integrationActor } from "./ingest";

const MAX = 10 * 1024 * 1024;

export function botApi(fn: (c: { hotelId: string; actor: Actor; body: () => Promise<unknown>; query: URLSearchParams }) => Promise<unknown>) {
  return async (req: NextRequest) => {
    const who = await integrationActor(prisma, req.headers.get("authorization"));
    if (!who) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Invalid or revoked integration key" } }, { status: 401 });
    try {
      const out = await fn({
        ...who,
        query: req.nextUrl.searchParams,
        body: async () => {
          const text = await req.text();
          if (Buffer.byteLength(text) > MAX) throw Object.assign(new Error("Payload too large"), { status: 413 });
          try {
            return text ? JSON.parse(text) : {};
          } catch {
            throw new DomainError("VALIDATION", "Request body is not valid JSON");
          }
        },
      });
      return NextResponse.json(out);
    } catch (e) {
      if (e instanceof ZodError) return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid input", details: e.issues.map((i) => ({ path: i.path, message: i.message })) } }, { status: 400 });
      if (e instanceof DomainError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.code === "NOT_FOUND" ? 404 : 400 });
      const status = (e as { status?: number }).status;
      if (status === 413) return NextResponse.json({ error: { code: "TOO_LARGE", message: "Payload too large" } }, { status });
      console.error("[integrations] unhandled", e);
      return NextResponse.json({ error: { code: "INTERNAL", message: "Unexpected error" } }, { status: 500 });
    }
  };
}
