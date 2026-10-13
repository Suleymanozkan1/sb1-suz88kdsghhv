"use client";

/**
 * Page help (feedback r3 §0.3 / §0.4): the page description sits behind an info icon next to the title, and a
 * "How to use?" button opens the page's short training video. Videos are set per page in Administration →
 * Training videos (organization-wide); a page without one shows no button.
 */
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Info, PlayCircle, X } from "lucide-react";
import { useT } from "@/i18n/client";
import type { ReactNode } from "react";

const VideosContext = createContext<Record<string, string>>({});

export function TrainingVideosProvider({ videos, children }: { videos: Record<string, string>; children: ReactNode }) {
  return <VideosContext.Provider value={videos}>{children}</VideosContext.Provider>;
}

/** The video of the current page: exact path first, else the longest configured prefix (/recipes covers /recipes/abc). */
export function videoFor(videos: Record<string, string>, path: string): string | null {
  if (videos[path]) return videos[path]!;
  let best: string | null = null;
  for (const key of Object.keys(videos)) {
    if (key !== "/" && (path === key || path.startsWith(`${key}/`)) && (!best || key.length > best.length)) best = key;
  }
  return best ? videos[best]! : null;
}

/** YouTube / Vimeo page links become their embed URL; anything else is played as a video file. */
export function embedUrl(url: string): { kind: "iframe" | "video"; src: string } {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return { kind: "iframe", src: `https://www.youtube.com/embed/${u.pathname.slice(1)}` };
    if (host.endsWith("youtube.com")) {
      const id = u.searchParams.get("v") ?? u.pathname.split("/").filter(Boolean).pop();
      return { kind: "iframe", src: u.pathname.startsWith("/embed/") ? url : `https://www.youtube.com/embed/${id}` };
    }
    if (host === "vimeo.com") return { kind: "iframe", src: `https://player.vimeo.com/video/${u.pathname.split("/").filter(Boolean).pop()}` };
    if (host === "player.vimeo.com") return { kind: "iframe", src: url };
  } catch {
    /* not a URL: treated as a file path */
  }
  return { kind: "video", src: url };
}

/** Info icon next to the page title: hover or focus shows the page description; a tap opens it (a tap focuses too, so it never toggles closed), a tap outside or Escape closes it. */
export function PageInfo({ children }: { children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("touchstart", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex align-middle" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={t("About this page")} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={() => setOpen(true)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} className="rounded-full p-0.5 text-ink-400 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <Info className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <span id={id} role="tooltip" className="absolute left-0 top-full z-30 mt-1 w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-ink-200 bg-white p-3 text-sm font-normal leading-relaxed text-ink-700 shadow-lg">
          {children}
        </span>
      )}
    </span>
  );
}

/** "How to use?" button of the current page; nothing when no video is configured for it. */
export function HelpVideo() {
  const t = useT();
  const videos = useContext(VideosContext);
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const url = videoFor(videos, path);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);
  if (!url) return null;
  const v = embedUrl(url);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50">
        <PlayCircle className="h-3.5 w-3.5" aria-hidden /> {t("How to use?")}
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={t("How to use?")} className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 p-4" onClick={() => setOpen(false)}>
          <div className="relative w-full max-w-3xl rounded-xl bg-white p-2 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label={t("Close")} onClick={() => setOpen(false)} className="absolute -right-3 -top-3 rounded-full bg-white p-1 text-ink-700 shadow ring-1 ring-ink-200 hover:bg-ink-50"><X className="h-4 w-4" /></button>
            <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
              {v.kind === "iframe"
                ? <iframe src={v.src} title={t("How to use?")} className="h-full w-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
                : <video src={v.src} controls autoPlay className="h-full w-full" />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
