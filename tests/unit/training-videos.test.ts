import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV } from "@/components/nav";
import { BUILT_IN_VIDEOS, effectiveVideos, videoSlug } from "@/lib/training-videos";
import { embedUrl, videoFor } from "@/components/page-help";

describe("built-in training videos (r3 §0.4)", () => {
  it("every menu page has its recorded video in public/videos", () => {
    const missing = NAV.filter((n) => !n.noVideo).map((n) => n.href).filter((h) => !fs.existsSync(path.join("public", BUILT_IN_VIDEOS[h]!)));
    expect(missing).toEqual([]);
  });
  it("a page marked noVideo gets no built-in video button (no link to a file that does not exist)", () => {
    for (const n of NAV.filter((x) => x.noVideo)) expect(BUILT_IN_VIDEOS[n.href]).toBeUndefined();
  });
  it("slugs are stable file names", () => {
    expect(videoSlug("/")).toBe("dashboard");
    expect(videoSlug("/inventory/counts/results")).toBe("inventory-counts-results");
  });
  it("a company's own address replaces the built-in one; sub-pages fall back to their menu page", () => {
    const v = effectiveVideos({ "/recipes": "https://youtu.be/abc" });
    expect(videoFor(v, "/recipes/xyz")).toBe("https://youtu.be/abc");
    expect(videoFor(v, "/inventory/ledger")).toBe("/videos/inventory-ledger.mp4");
    expect(embedUrl("/videos/inventory.mp4")).toEqual({ kind: "video", src: "/videos/inventory.mp4" });
  });
});
