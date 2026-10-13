"use client";

/**
 * The one filter bar of every list page (feedback r3 §0.1 / §0.2): a plain GET form, so nothing changes until the user
 * presses "Filter", the URL stays shareable and the export buttons pick the same filters up from it. Date ranges are
 * filled by default with the first day of the current month and today.
 */
import { Button, Input, Label, cn } from "./ui";
import { useT } from "@/i18n/client";
import type { ReactNode } from "react";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Default range: first day of the current month … today (local date of the browser). */
export function defaultDates(now = new Date()) {
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
}

export function FilterBar({ children, from, to, dates = true, hidden, className, after }: {
  /** extra fields (warehouse, status, group …), placed after the dates */
  children?: ReactNode;
  from?: string;
  to?: string;
  /** false: no date range on this page */
  dates?: boolean;
  /** values kept as they are (current tab, view …) */
  hidden?: Record<string, string | undefined>;
  className?: string;
  /** after the button (e.g. a "Clear" link) */
  after?: ReactNode;
}) {
  const t = useT();
  const d = defaultDates();
  return (
    <form method="get" className={cn("flex flex-wrap items-end gap-2", className)}>
      {hidden && Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {dates && (
        <>
          <div>
            <Label htmlFor="fb-from">{t("From")}</Label>
            <Input id="fb-from" name="from" type="date" defaultValue={from || d.from} className="w-40" />
          </div>
          <div>
            <Label htmlFor="fb-to">{t("To")}</Label>
            <Input id="fb-to" name="to" type="date" defaultValue={to || d.to} className="w-40" />
          </div>
        </>
      )}
      {children}
      <FilterButton />
      {after}
    </form>
  );
}

/** The "Filter" submit button, for filter forms that cannot use FilterBar itself (client-side pickers). */
export function FilterButton() {
  const t = useT();
  return <Button type="submit">{t("Filter")}</Button>;
}
