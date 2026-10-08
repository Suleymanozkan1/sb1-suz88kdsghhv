import type { T } from "@/i18n/core";
import type { XCol, XTable, XType, XValue } from "../types";

type Kind = "money" | "pct" | "int" | "qty" | "text";
/** One KPI tile: a label and its value in exactly one of the typed columns. */
export type Metric = { label: string } & Partial<Record<Kind, XValue>>;

const ORDER: Kind[] = ["money", "pct", "int", "qty", "text"];

/**
 * KPI tiles as a "Metric / value" table. Values keep their type (money, %, count…): one typed column per kind
 * that occurs, so Excel gets real numbers. Column headers can be overridden per kind.
 */
export function metricTable(t: T, rows: Metric[], opts: { title?: string; headers?: Partial<Record<Kind, string>> } = {}): XTable {
  const kinds = ORDER.filter((k) => rows.some((r) => r[k] !== undefined));
  const defaults: Record<Kind, string> = { money: t("Amount"), pct: "%", int: t("Count"), qty: t("Quantity"), text: t("Status") };
  const columns: XCol[] = [
    { key: "label", header: t("Metric") },
    ...kinds.map((k) => ({ key: k, header: opts.headers?.[k] ?? (kinds.length === 1 && k === "money" ? t("Value") : defaults[k]), type: (k === "text" ? "text" : k) as XType })),
  ];
  return { title: opts.title, columns, rows: rows.map((r) => ({ ...r })) };
}
