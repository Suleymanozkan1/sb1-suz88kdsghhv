import Link from "next/link";
import { X } from "lucide-react";
import { Title } from "./title";
import { getT } from "@/i18n/server";

/** "Product: X ×" — the list is narrowed to one product (opened from a drill-down); the × link shows all again. */
export async function ProductChip({ name, clear }: { name: string; clear: string }) {
  const t = await getT();
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200">
      {t("Product")}: <Title>{name}</Title>
      <Link href={clear} aria-label={t("Show all products")} className="rounded hover:bg-brand-100"><X className="h-3.5 w-3.5" /></Link>
    </span>
  );
}
