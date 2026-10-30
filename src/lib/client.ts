"use client";

import { normalizeLocale, translate } from "@/i18n/core";
import { fieldLabelKey } from "./field-labels";

/**
 * A validation path ("lines.0.quantity") as the user reads it: "Line 1, Quantity" in their language (audit FE-08).
 * The language is the page's (<html lang>, set by the root layout from the user's choice).
 */
export function fieldPath(path: ReadonlyArray<string | number>, locale = typeof document === "undefined" ? null : normalizeLocale(document.documentElement.lang)): string {
  const l = locale ?? "tr";
  const isIndex = (p: string | number | undefined) => typeof p === "number" || /^\d+$/.test(String(p ?? ""));
  const parts: string[] = [];
  path.forEach((p, i) => {
    if (isIndex(p)) parts.push(translate(l, "Line {n}", { n: Number(p) + 1 }));
    // the list itself ("lines") is implied by the "Line 2" that follows it
    else if (!isIndex(path[i + 1])) parts.push(translate(l, fieldLabelKey(String(p).replace(/(.)Id$/, "$1"))));
  });
  return parts.join(", ");
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function call<T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = data?.error ?? {};
    let msg: string = err.message ?? `Request failed (${res.status})`;
    if (err.code === "VALIDATION" && Array.isArray(err.details) && err.details.length) {
      msg = `${msg}: ${err.details.map((d: { path?: (string | number)[]; message: string }) => (d.path?.length ? `${fieldPath(d.path)}: ${d.message}` : d.message)).join("; ")}`;
    }
    throw new ApiError(msg, err.code ?? "ERROR", res.status, err.details);
  }
  return data as T;
}
