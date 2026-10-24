/**
 * One line above every page about the subscription, only when it matters: the last two weeks of the trial or of
 * the paid period, an overdue payment, or read-only mode. A paid tenant with time left sees nothing.
 */
import Link from "next/link";
import type { AccessState } from "@/domain/billing";
import { getT } from "@/i18n/server";
import { cn } from "./ui";

export async function SubscriptionBanner({ state, daysLeft, admin }: { state: AccessState; daysLeft: number | null; admin: boolean }) {
  const t = await getT();
  const days = daysLeft ?? 0;
  let text: string | null = null;
  let tone: "blue" | "amber" | "red" = "blue";
  if (state === "TRIAL" && days <= 14) text = t("Free trial: {n} days left. Every feature is open until then.", { n: days });
  else if (state === "ACTIVE" && days <= 14) {
    text = t("Your paid period ends in {n} days.", { n: days });
    tone = "amber";
  } else if (state === "PAST_DUE") {
    text = t("Your trial or paid period has ended: {n} days left before your data becomes read-only.", { n: days });
    tone = "amber";
  } else if (state === "EXPIRED") {
    text = t("Your subscription has ended. Your data is safe and can be viewed and exported, but new entries are paused until payment.");
    tone = "red";
  }
  if (!text) return null;
  return (
    <div role="status" className={cn("mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-sm", tone === "blue" && "border-blue-200 bg-blue-50 text-blue-900", tone === "amber" && "border-amber-200 bg-amber-50 text-amber-900", tone === "red" && "border-red-200 bg-red-50 text-red-900")}>
      <span>{text}</span>
      {admin ? <Link href="/billing" className="font-medium underline underline-offset-2">{t("Subscription & payment")}</Link> : <span className="text-xs opacity-80">{t("Your company administrator manages the subscription.")}</span>}
    </div>
  );
}
