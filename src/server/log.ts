/**
 * Structured logging: one JSON object per line on stdout/stderr, which every host (Vercel, Docker, systemd, the
 * Windows service wrapper) already collects. Before this the only production signal was a bare console.error on
 * unhandled API errors; latency, 5xx rates and failed background jobs were invisible.
 *
 *  - LOG_LEVEL = debug | info | warn | error (default info; "silent" in unit tests).
 *  - ERROR_WEBHOOK_URL (optional): errors are also POSTed as JSON — a Slack/Teams/Discord incoming webhook or any
 *    endpoint. No paid service is required. At most one post per distinct message per minute, so a failure loop
 *    cannot flood the channel; the post never blocks or fails the request that logged it.
 *
 * Fields that could carry secrets are never logged: callers pass ids, never bodies, tokens or passwords.
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function threshold(): number {
  const v = (process.env.LOG_LEVEL ?? (process.env.VITEST ? "silent" : "info")).toLowerCase();
  return ORDER[v as Level] ?? ORDER.info;
}

export type LogFields = Record<string, unknown>;

/** Error → plain fields (message, name, code, first stack lines); anything else as a string. */
export function errorFields(e: unknown): LogFields {
  if (e instanceof Error) {
    return { error: e.message, errorName: e.name, ...((e as { code?: unknown }).code !== undefined ? { errorCode: (e as { code?: unknown }).code } : {}), stack: e.stack?.split("\n").slice(0, 8).join("\n") };
  }
  return { error: String(e) };
}

/** E-mail addresses and runs of 6+ digits (IBAN, tax number, phone) replaced before anything leaves the server. */
export function maskPersonal(s: string): string {
  return s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[e-mail]").replace(/(?:TR)?\d[\d ]{5,}\d/gi, "[number]");
}


const lastPost = new Map<string, number>();
const POST_EVERY_MS = 60_000;

function notify(entry: LogFields) {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  const key = String(entry.msg) + "|" + String(entry.error ?? "");
  const now = Date.now();
  if ((lastPost.get(key) ?? 0) > now - POST_EVERY_MS) return;
  lastPost.set(key, now);
  if (lastPost.size > 500) lastPost.clear();
  // a third-party channel gets no personal data: e-mail addresses and long digit runs (IBAN, tax id, phone) are
  // masked, the message is cut short, and no stack or extra fields are sent (audit v2, O11)
  const error = entry.error ? maskPersonal(String(entry.error)).slice(0, 300) : "";
  const text = `HotelCost ${process.env.HOTELCOST_ENV ?? process.env.NODE_ENV ?? ""}: ${entry.msg}${error ? ` — ${error}` : ""}${entry.requestId ? ` (request ${String(entry.requestId)})` : ""}`;
  // `text` is what Slack/Teams/Discord-compatible webhooks display
  void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, content: text, level: entry.level, msg: entry.msg, requestId: entry.requestId ?? null }), signal: AbortSignal.timeout(5000) }).catch(() => undefined);
}

function write(level: Level, msg: string, fields?: LogFields) {
  if (ORDER[level] < threshold()) {
    if (level === "error") notify({ level, msg, ...fields });
    return;
  }
  const entry = { level, time: new Date().toISOString(), msg, ...fields };
  const line = JSON.stringify(entry, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
  if (level === "error") notify(entry);
}

export const log = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};
