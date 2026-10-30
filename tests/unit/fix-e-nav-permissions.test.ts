/**
 * Audit UX-03: a menu entry must never lead to a "no permission" page. The permission each page actually requires
 * is read from its source (requirePageAccess, and the authorize() of the services its guarded() calls), so a page
 * that changes its guard without the menu (or the other way round) fails here.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canOpenHref, IMPORTS_PAGE_PERMISSIONS, NAV, navItems } from "@/components/nav";
import { ROLE_TEMPLATES, type Permission } from "@/server/auth/permissions";

const APP = path.join("src", "app", "(app)");
const pageFile = (href: string) => path.join(APP, href === "/" ? "" : href, "page.tsx");
const read = (f: string) => fs.readFileSync(f, "utf8");

/** Pages whose access is computed (not a plain permission): the dashboard falls back to a start page, approvals also open for count approvers. */
const COMPUTED = new Set(["/", "/approvals"]);

/** requirePageAccess(actor, "x:y", hotelId) literals of a page: all of them are required. */
function pageGuards(src: string): Permission[] {
  return [...src.matchAll(/requirePageAccess\(actor, "([a-z_]+:[a-z_]+)"/g)].map((m) => m[1] as Permission);
}

/** The first authorize(actor, "…") of each service function a page runs through guarded(() => fn(…)). */
function serviceGuards(src: string): Array<{ fn: string; perm: Permission }> {
  const out: Array<{ fn: string; perm: Permission }> = [];
  const imports = new Map<string, string>();
  for (const m of src.matchAll(/import \{([^}]+)\} from "@\/server\/services\/([a-z-]+)"/g)) for (const n of m[1]!.split(",")) imports.set(n.trim().replace(/^type /, ""), m[2]!);
  for (const m of src.matchAll(/guarded\(\(\) => (\w+)\(/g)) {
    const mod = imports.get(m[1]!);
    if (!mod) continue;
    const svc = read(path.join("src", "server", "services", `${mod}.ts`));
    const at = svc.search(new RegExp(`export (async )?function ${m[1]}\\b`));
    if (at < 0) continue;
    const body = svc.slice(at, at + 1500).split(/\nexport /)[0]!;
    const a = /authorize\(actor, "([a-z_]+:[a-z_]+)"/.exec(body);
    if (a) out.push({ fn: m[1]!, perm: a[1] as Permission });
  }
  return out;
}

const list = (p: Permission | readonly Permission[]): readonly Permission[] => (typeof p === "string" ? [p] : p);

describe("menu entries follow the permission their page requires", () => {
  it("every menu page guards itself with exactly the menu entry's permission", () => {
    for (const n of NAV.filter((x) => !COMPUTED.has(x.href))) {
      const src = read(pageFile(n.href));
      if (typeof n.perm === "string") expect(new Set(pageGuards(src)), n.href).toEqual(new Set([n.perm, ...(n.alsoNeeds ?? [])]));
      else expect(src, n.href).toMatch(/requirePageAccess\(actor, IMPORTS_PAGE_PERMISSIONS, hotelId\)/);
    }
  });

  it("the services a menu page loads need nothing the menu entry does not ask for", () => {
    let checked = 0;
    for (const n of NAV.filter((x) => !COMPUTED.has(x.href))) {
      const needed = new Set<Permission>([...list(n.perm), ...(n.alsoNeeds ?? [])]);
      for (const g of serviceGuards(read(pageFile(n.href)))) {
        expect(needed.has(g.perm), `${n.href} → ${g.fn} needs ${g.perm}`).toBe(true);
        checked++;
      }
    }
    // the source scan really finds the services (not a vacuous pass)
    expect(checked).toBeGreaterThan(20);
  });

  it("Imports is offered for exactly the import permissions of the import service, or the automation", () => {
    const svc = read(path.join("src", "server", "services", "imports.ts"));
    const block = /IMPORT_PERMISSION: Record<ImportKind, Permission> = \{([^}]+)\}/.exec(svc)![1]!;
    const kinds = new Set([...block.matchAll(/"([a-z_]+:[a-z_]+)"/g)].map((m) => m[1]));
    expect(new Set(IMPORTS_PAGE_PERMISSIONS)).toEqual(new Set([...kinds, "sales:import"]));
  });

  it.each(ROLE_TEMPLATES.map((t) => [t.key, t] as const))("%s: every visible menu entry opens", (_key, t) => {
    const has = new Set<string>(t.permissions);
    for (const n of navItems(t.permissions)) {
      if (n.href === "/") { expect(has.has("dashboard:view")).toBe(true); continue; }
      // canOpenApprovals: dashboard viewers and approvers (count approvers come in through the "approvals" flag)
      if (n.href === "/approvals") { expect(has.has("dashboard:view") || has.has("approval:decide")).toBe(true); continue; }
      const src = read(pageFile(n.href));
      for (const p of pageGuards(src)) expect(has.has(p), `${t.key} sees ${n.href} without ${p}`).toBe(true);
      if (typeof n.perm !== "string") expect(n.perm.some((p) => has.has(p)), `${t.key} sees ${n.href}`).toBe(true);
    }
  });
});

describe("role menus (UX-03)", () => {
  const menu = (key: string) => navItems(ROLE_TEMPLATES.find((t) => t.key === key)!.permissions).map((n) => n.href);

  it("chefs and pastry chefs no longer see Imports (they may import nothing)", () => {
    for (const key of ["chef", "breakfast_chef", "pastry_chef"]) expect(menu(key), key).not.toContain("/imports");
    expect(menu("accounting_manager")).toContain("/imports");
    expect(menu("purchasing_manager")).toContain("/imports");
  });

  it("the breakfast chef has a breakfast menu, narrower than the chef's", () => {
    const chef = menu("chef");
    const bc = menu("breakfast_chef");
    expect(bc).toEqual(expect.arrayContaining(["/", "/buffet", "/inventory", "/inventory/counts", "/recipes", "/waste", "/calendar"]));
    for (const href of ["/variance", "/menu-engineering"]) {
      expect(chef).toContain(href);
      expect(bc).not.toContain(href);
    }
    expect(bc.every((h) => chef.includes(h))).toBe(true);
    expect(ROLE_TEMPLATES.find((t) => t.key === "breakfast_chef")!.description).toMatch(/Breakfast/);
  });

  it("getting-started links need the page and the action: a chef gets no link to Imports", () => {
    const chef = ROLE_TEMPLATES.find((t) => t.key === "chef")!.permissions;
    expect(canOpenHref("/imports", chef)).toBe(false);
    expect(canOpenHref("/recipes", chef)).toBe(true);
    expect(canOpenHref("/imports", ROLE_TEMPLATES.find((t) => t.key === "purchasing_manager")!.permissions)).toBe(true);
    expect(canOpenHref("/not-a-menu-page", [])).toBe(true);
  });
});
