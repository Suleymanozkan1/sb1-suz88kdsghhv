/** Audit UX-02: browser tab titles are translated (generateMetadata with pageTitle), and every title has a Turkish text. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TR } from "@/i18n/tr";
import { pageTitle } from "@/i18n/metadata";

let lang = "tr";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: lang }) }) }));

function pages(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? pages(path.join(dir, e.name)) : e.name === "page.tsx" ? [path.join(dir, e.name)] : []));
}
// the platform console and the installer keep their own titles (other owners; the installer is Turkish only)
const OWN_TITLES = /src[\\/]app[\\/](platform|setup)[\\/]/;

describe("page titles", () => {
  const files = pages(path.join("src", "app")).filter((f) => !OWN_TITLES.test(f));

  it("no page has a fixed English title any more", () => {
    expect(files.length).toBeGreaterThan(40);
    for (const f of files) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/export const metadata = \{ title:/);
  });

  it("every translated title (and description) has a Turkish text", () => {
    const keys = files.flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/pageTitle\(("[^"]+")(?:, ("[^"]+"))?\)/g)].flatMap((m) => [m[1], m[2]].filter(Boolean).map((s) => JSON.parse(s!) as string)));
    expect(keys).toContain("Subscription");
    expect(keys.filter((k) => TR[k] === undefined)).toEqual([]);
  });

  it("pageTitle translates with the user's language and stays English in English", async () => {
    expect(await pageTitle("Subscription")()).toEqual({ title: "Abonelik" });
    lang = "en";
    expect(await pageTitle("Subscription")()).toEqual({ title: "Subscription" });
  });
});
