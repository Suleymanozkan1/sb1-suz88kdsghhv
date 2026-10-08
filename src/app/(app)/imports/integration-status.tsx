import { Alert } from "@/components/ui";
import { getT } from "@/i18n/server";
import type { integrationHealth } from "@/server/integrations/ingest";

type Health = Awaited<ReturnType<typeof integrationHealth>>;
type T = (k: string, v?: Record<string, string | number>) => string;

/** The bot writes its messages in English ("checks FAILED: login failed (Micros): …"): translated part by part. */
export function botMessage(message: string, t: T): string {
  return message.split(/(; | \| )/).map((p) => (p === "; " || p === " | " ? p : t(p))).join("");
}

/** Lines like "Checks: 412 received, 410 new, 2 already sent, 0 errors" from a run's stats. */
export function runSummary(stats: unknown, t: T): string[] {
  if (!stats || typeof stats !== "object") return [];
  return Object.entries(stats as Record<string, { received: number; accepted: number; duplicates: number; errors?: Array<{ message: string }> }>).map(([kind, s]) =>
    t("{kind}: {received} received, {accepted} new, {duplicates} already sent, {errors} errors", { kind: t(`ingest:${kind}`), received: s.received, accepted: s.accepted, duplicates: s.duplicates, errors: s.errors?.length ?? 0 }) +
      (s.errors?.length ? ` — ${s.errors.slice(0, 3).map((e) => t(e.message)).join("; ")}${s.errors.length > 3 ? " …" : ""}` : ""),
  );
}

/** Warning when the automation failed or did not deliver the last closed business day. Nothing when it is not used. */
export async function IntegrationBanner({ health, link = false }: { health: Health; link?: boolean }) {
  const t = await getT();
  if (health.status === "OFF" || health.status === "OK") return null;
  const more = link ? <> <a href="/imports" className="font-medium underline">{t("Open the automation log")}</a></> : null;
  return (
    <div className="mb-4">
      {health.status === "FAILED" ? (
        <Alert>{t("The last automation run failed: {message}", { message: health.lastRun?.message ? botMessage(health.lastRun.message, t) : t("no message") })} {t("Check the log; you can start it again with “Run now”.")}{more}</Alert>
      ) : health.status === "PARTIAL" ? (
        <Alert tone="amber">{t("The last automation run delivered the data, but {n} record(s) were not accepted (unknown outlet, product or unit). See the log.", { n: health.rejected })}{more}</Alert>
      ) : (
        <Alert tone="amber">{t("No data received yet from the automation for business day {day}.", { day: health.expectedDay ?? "" })}{more}</Alert>
      )}
    </div>
  );
}
