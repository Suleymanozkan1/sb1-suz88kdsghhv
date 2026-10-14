/**
 * Built-in how-to videos (feedback r3 §0.4): one short video per menu page, recorded from the demo data with
 * scripts/videos and served from public/videos/<slug>.mp4. An address the company enters in Administration →
 * Training videos replaces the page's built-in video.
 */
import { NAV } from "@/components/nav";

/** "/" → "dashboard", "/inventory/counts/results" → "inventory-counts-results" */
export const videoSlug = (href: string) => (href === "/" ? "dashboard" : href.slice(1).replace(/\//g, "-"));

export const BUILT_IN_VIDEOS: Readonly<Record<string, string>> = Object.fromEntries(NAV.map((n) => [n.href, `/videos/${videoSlug(n.href)}.mp4`]));

export function effectiveVideos(own: Record<string, string>): Record<string, string> {
  return { ...BUILT_IN_VIDEOS, ...own };
}
