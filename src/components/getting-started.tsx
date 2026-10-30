/** Dashboard card: the getting-started steps (src/server/services/onboarding.ts). Hidden once every step is done. */
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import type { OnboardingStep } from "@/server/services/onboarding";
import { getT } from "@/i18n/server";
import { cn } from "./ui";
import { canOpenHref } from "./nav";

export async function GettingStarted({ steps, done, total, permissions }: { steps: OnboardingStep[]; done: number; total: number; permissions: ReadonlySet<string> }) {
  if (done >= total) return null;
  const t = await getT();
  const next = steps.find((s) => !s.done);
  return (
    <section aria-labelledby="getting-started" className="mb-6 rounded-xl border border-brand-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="getting-started" className="text-base font-semibold text-ink-900">{t("Getting started")}</h2>
        <span className="text-sm text-ink-600">{t("{done} of {total} steps", { done, total })}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={t("Getting started")}>
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <p className="mt-3 text-sm text-ink-600">{t("The first theoretical-vs-actual variance needs these, in this order. Each step is checked from your data.")}</p>
      <ol className="mt-3 grid gap-2 md:grid-cols-2">
        {steps.map((s) => {
          // the action itself, and the page it is done on (e.g. Imports needs an import permission)
          const can = permissions.has(s.perm) && canOpenHref(s.href, permissions);
          const isNext = s === next;
          return (
            <li key={s.key} className={cn("flex gap-3 rounded-lg p-2.5", isNext && "bg-brand-50")}>
              {s.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-label={t("Done")} /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-ink-400" aria-label={t("Not done yet")} />}
              <div className="min-w-0 text-sm">
                {can && !s.done ? <Link href={s.href} className="font-medium text-brand-700 hover:underline">{t(s.title)}</Link> : <span className={cn("font-medium", s.done ? "text-ink-500 line-through decoration-ink-300" : "text-ink-900")}>{t(s.title)}</span>}
                {!s.done && <p className="text-ink-600">{t(s.hint)}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
