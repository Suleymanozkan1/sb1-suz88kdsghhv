import { describe, expect, it } from "vitest";
import { ALL_DEPARTMENTS, MINIBAR_DEPARTMENT, navFlags, navItems } from "@/components/nav";

// The minibar page reads the Minibar department's stock: a department-scoped role without that department only got
// "No access to this department" from its menu entry (found by the mobile e2e menu walk for the F&B manager).
const perms = ["minibar:view", "dashboard:view"];
const hasMinibar = (flags: string[]) => navItems(perms, flags).some((n) => n.href === "/minibar");

describe("minibar menu entry follows the department scope", () => {
  it("is hidden from a department-scoped role without the Minibar department", () => {
    expect(hasMinibar(navFlags({ departmentIds: ["d1"] }, false))).toBe(false);
  });
  it("is shown when the role's departments include Minibar", () => {
    expect(hasMinibar(navFlags({ departmentIds: ["d1"] }, false, [MINIBAR_DEPARTMENT]))).toBe(true);
  });
  it("is shown to all-department roles", () => {
    expect(navFlags({ departmentIds: "ALL" }, false)).toContain(ALL_DEPARTMENTS);
    expect(hasMinibar(navFlags({ departmentIds: "ALL" }, false))).toBe(true);
  });
});
