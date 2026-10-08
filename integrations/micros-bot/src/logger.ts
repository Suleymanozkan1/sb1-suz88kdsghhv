/**
 * Tiny logger: console + optional per-run log files. Every line passes through `redact()`, which removes the
 * configured secrets (passwords, API key) so they can never end up in a log or a run report.
 */
import fs from "node:fs";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let secrets: string[] = [];
let minLevel: Level = "info";
const fileSinks = new Set<string>();
let silent = false;

export function configureLogger(opts: { secrets?: string[]; level?: Level; silent?: boolean }): void {
  if (opts.secrets) secrets = [...new Set(opts.secrets.filter((s) => s && s.length >= 3))].sort((a, b) => b.length - a.length);
  if (opts.level) minLevel = opts.level;
  if (opts.silent !== undefined) silent = opts.silent;
}

export function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join("***");
  // Bearer tokens that are not in the configured list still get masked
  return out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{6,}/g, "$1***");
}

export function addLogFile(file: string): () => void {
  fileSinks.add(file);
  return () => fileSinks.delete(file);
}

function write(level: Level, msg: string, extra?: unknown): void {
  if (ORDER[level] < ORDER[minLevel]) return;
  let text = msg;
  if (extra !== undefined) text += " " + (extra instanceof Error ? extra.message : typeof extra === "string" ? extra : JSON.stringify(extra));
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${redact(text)}`;
  if (!silent) (level === "error" || level === "warn" ? console.error : console.log)(line);
  for (const file of fileSinks) {
    try {
      fs.appendFileSync(file, line + "\n");
    } catch {
      /* a broken log file must not stop the run */
    }
  }
}

export const log = {
  debug: (m: string, e?: unknown) => write("debug", m, e),
  info: (m: string, e?: unknown) => write("info", m, e),
  warn: (m: string, e?: unknown) => write("warn", m, e),
  error: (m: string, e?: unknown) => write("error", m, e),
};
