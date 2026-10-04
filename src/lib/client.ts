"use client";

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

export async function call<T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = data?.error ?? {};
    let msg: string = err.message ?? `Request failed (${res.status})`;
    if (err.code === "VALIDATION" && Array.isArray(err.details) && err.details.length) {
      msg = `${msg}: ${err.details.map((d: { path?: (string | number)[]; message: string }) => `${d.path?.join(".") ?? ""} ${d.message}`.trim()).join("; ")}`;
    }
    throw new ApiError(msg, err.code ?? "ERROR", res.status, err.details);
  }
  return data as T;
}
