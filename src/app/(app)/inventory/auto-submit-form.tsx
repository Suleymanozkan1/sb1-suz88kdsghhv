"use client";

/**
 * GET filter form that applies itself on every change (feedback r2 §1: no "Filter" button to forget). Still a plain
 * form, so the URL stays shareable and the export buttons pick the same filters up from it.
 */
export function AutoSubmitForm({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <form method="get" className={className} onChange={(e) => {
      const el: EventTarget = e.target;
      // a date being typed is "valid" from its first year digit (0002-…): wait for a full year
      if (el instanceof HTMLInputElement && el.type === "date" && !/^(19|20)\d\d-/.test(el.value)) return;
      e.currentTarget.requestSubmit();
    }}>{children}</form>
  );
}
