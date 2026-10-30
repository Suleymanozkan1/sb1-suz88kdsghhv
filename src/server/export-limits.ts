/**
 * Interim guard for the heavy exports (the .xlsm workbook, the full-cost JSON / TSV, background export jobs) on
 * Vercel, where a function response is capped at 4.5 MB: the files are returned whole from the function, so a long
 * range fails there with an opaque 413 from the platform. Until the files go to object storage behind a signed link:
 *
 *  - the date range of one export is capped at EXPORT_MAX_MONTHS months (default 2; the environment variable of the
 *    same name overrides it, 0 or "off" lifts the cap), with a message telling the user to choose a shorter range;
 *  - a file that still comes out larger than RESPONSE_LIMIT_BYTES is refused with a clear message instead.
 *
 * Self-hosted installations (no VERCEL in the environment) are not limited.
 */
import { DomainError } from "@/domain/errors";

/** Months one heavy export may cover on Vercel unless EXPORT_MAX_MONTHS says otherwise. */
export const EXPORT_MAX_MONTHS = 2;
/** Largest export body sent from a Vercel function: the platform limit is 4.5 MB, headers and framing need the rest. */
export const RESPONSE_LIMIT_BYTES = Math.trunc(4.3 * 1024 * 1024);

type Env = Record<string, string | undefined>;

/** The month cap in force, or null when exports are not limited (not on Vercel, or switched off). */
export function exportMaxMonths(env: Env = process.env): number | null {
  if (!env.VERCEL) return null;
  const raw = (env.EXPORT_MAX_MONTHS ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "0") return null;
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : EXPORT_MAX_MONTHS;
}

/** `from` + n calendar months (UTC); a day the target month lacks runs over into the next (31 Dec + 2 = 3 Mar). */
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));

/** Refuses an export range longer than the cap; `to` is exclusive (parseExportParams: the day after the end date). */
export function assertExportRange(p: { from: Date; to: Date }, env: Env = process.env): void {
  const max = exportMaxMonths(env);
  if (max === null) return;
  if (p.to.getTime() > addMonths(p.from, max).getTime()) {
    throw new DomainError("VALIDATION", `Choose a date range of at most ${max} months for this export: longer ranges are too large to download here`, { maxMonths: max });
  }
}

/** Refuses an export body that the platform would reject anyway (on Vercel only). */
export function assertResponseSize(bytes: number, env: Env = process.env): void {
  if (!env.VERCEL || bytes <= RESPONSE_LIMIT_BYTES) return;
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  throw new DomainError("VALIDATION", `This export is ${mb(bytes)} MB, more than the ${mb(RESPONSE_LIMIT_BYTES)} MB that can be downloaded here: choose a shorter date range or a single department`, { bytes, limit: RESPONSE_LIMIT_BYTES });
}
