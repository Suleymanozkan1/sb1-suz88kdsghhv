import { clsx } from "clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

export function cn(...a: Parameters<typeof clsx>) {
  return clsx(...a);
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-950">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cn("rounded-xl border border-ink-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-800">{title}</h2>
          {actions}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default", badge }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "bad" | "warn"; badge?: ReactNode }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
        {badge}
      </div>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums", tone === "good" && "text-brand-700", tone === "bad" && "text-red-700", tone === "warn" && "text-amber-700", tone === "default" && "text-ink-950")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

const badgeTones = {
  gray: "bg-ink-100 text-ink-700 ring-ink-200",
  green: "bg-brand-50 text-brand-700 ring-brand-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};
export type Tone = keyof typeof badgeTones;

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: Tone }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", badgeTones[tone])}>{children}</span>;
}

export function Button({ variant = "primary", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md" }) {
  return (
    <button
      {...p}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variant === "primary" && "bg-brand-600 text-white hover:bg-brand-700",
        variant === "secondary" && "border border-ink-200 bg-white text-ink-800 hover:bg-ink-50",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        variant === "ghost" && "text-ink-700 hover:bg-ink-100",
        className,
      )}
    />
  );
}

export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-ink-700">
      {children}
      {hint && <span className="ml-1 font-normal text-ink-400">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn("block w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-ink-50", className)} />;
}

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...p} className={cn("block w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20", className)}>
      {children}
    </select>
  );
}

export function Table({ children, className, label = "Scrollable table" }: { children: ReactNode; className?: string; label?: string }) {
  // focusable scroll container: wide tables can be scrolled with the keyboard (WCAG 2.1.1)
  return (
    <div className={cn("overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500", className)} tabIndex={0} role="region" aria-label={label}>
      <table className="min-w-full divide-y divide-ink-100 text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, align = "left", ...p }: ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return <th scope="col" {...p} className={cn("whitespace-nowrap bg-ink-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500", align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left", className)} />;
}

export function Td({ className, align = "left", ...p }: TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return <td {...p} className={cn("whitespace-nowrap px-3 py-2 text-ink-800", align === "right" && "text-right tabular-nums", align === "center" && "text-center", className)} />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-ink-200 px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-500">{children}</div>}
    </div>
  );
}

export function Alert({ tone = "red", children }: { tone?: "red" | "amber" | "green" | "blue"; children: ReactNode }) {
  return (
    <div
      role={tone === "red" ? "alert" : "status"}
      className={cn("rounded-lg border px-3 py-2 text-sm", tone === "red" && "border-red-200 bg-red-50 text-red-800", tone === "amber" && "border-amber-200 bg-amber-50 text-amber-900", tone === "green" && "border-brand-200 bg-brand-50 text-brand-800", tone === "blue" && "border-sky-200 bg-sky-50 text-sky-800")}
    >
      {children}
    </div>
  );
}

export const levelTone: Record<string, Tone> = { NORMAL: "green", LOW: "amber", CRITICAL: "red", OUT_OF_STOCK: "red", OVERSTOCK: "violet" };
export const severityTone: Record<string, Tone> = { INFO: "blue", WARNING: "amber", HIGH: "red", CRITICAL: "red" };
