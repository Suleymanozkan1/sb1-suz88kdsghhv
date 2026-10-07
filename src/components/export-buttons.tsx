"use client";

import { FileDown, FileSpreadsheet } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useT } from "@/i18n/client";

/**
 * PDF + Excel of the current page. The file uses the filters on screen: the page's query string is passed on
 * (plus `params` for filters a page keeps outside the URL).
 */
export function ExportButtons({ report, params }: { report: string; params?: Record<string, string | undefined> }) {
  const t = useT();
  const sp = useSearchParams();
  const q = new URLSearchParams(sp?.toString() ?? "");
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === "") q.delete(k);
    else q.set(k, v);
  }
  q.delete("page");
  const href = (format: string) => {
    const x = new URLSearchParams(q);
    x.set("format", format);
    return `/api/table-export/${report}?${x}`;
  };
  const cls = "inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-800 hover:bg-ink-50";
  return (
    <span className="flex items-center gap-2" data-export={report}>
      <a href={href("pdf")} className={cls} title={t("Download as PDF (with the filters on screen)")} download>
        <FileDown className="h-4 w-4" /> PDF
      </a>
      <a href={href("xlsx")} className={cls} title={t("Download as Excel (with the filters on screen)")} download>
        <FileSpreadsheet className="h-4 w-4" /> Excel
      </a>
    </span>
  );
}
