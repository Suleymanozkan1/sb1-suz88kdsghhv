/**
 * Permission catalogue (spec §240–§244). Roles are configurable rows in the DB;
 * these are the defaults seeded for a new organization.
 */
export const PERMISSIONS = [
  "dashboard:view",
  "product:view",
  "product:manage",
  "supplier:view",
  "supplier:manage",
  "purchase:view",
  "purchase:manage",
  "purchase:approve",
  "purchase:prices",
  "inventory:view",
  "inventory:post",
  "inventory:receive",
  "inventory:count",
  "inventory:adjust",
  "recipe:view",
  "recipe:manage",
  "recipe:approve",
  "waste:view",
  "waste:record",
  "sales:import",
  "buffet:view",
  "buffet:manage",
  "minibar:view",
  "minibar:manage",
  "opex:view",
  "opex:manage",
  "rooms:view",
  "allocation:manage",
  "pms:import",
  "budget:view",
  "budget:manage",
  "budget:approve",
  "savings:manage",
  "cost:view",
  "variance:view",
  "approval:decide",
  "period:manage",
  "period:reopen",
  "period:close_override",
  "audit:view",
  "report:view",
  "report:export",
  "admin:users",
  "admin:hotels",
  // platform operator only: create / suspend tenants (organizations). Never granted by tenant roles.
  "platform:admin",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface RoleTemplate {
  key: string;
  name: string;
  allDepartments: boolean;
  permissions: Permission[];
}

const ALL = PERMISSIONS.filter((p) => p !== "platform:admin");
const READ_ONLY = PERMISSIONS.filter((p) => /:view$/.test(p) && p !== "audit:view");
const OPERATIONAL: Permission[] = [
  "dashboard:view",
  "product:view",
  "inventory:view",
  "inventory:post",
  "inventory:count",
  "recipe:view",
  "recipe:manage",
  "waste:view",
  "waste:record",
  "cost:view",
  "variance:view",
  "report:view",
];

export const ROLE_TEMPLATES: RoleTemplate[] = [
  { key: "admin", name: "Company Administrator", allDepartments: true, permissions: ALL },
  { key: "cost_controller", name: "Cost Controller", allDepartments: true, permissions: ALL.filter((p) => p !== "admin:users" && p !== "admin:hotels") },
  {
    key: "fb_manager",
    name: "F&B Manager",
    allDepartments: false,
    permissions: [...OPERATIONAL, "recipe:approve", "inventory:adjust", "approval:decide", "supplier:view", "purchase:view", "sales:import", "report:export", "audit:view", "buffet:view", "buffet:manage", "minibar:view", "minibar:manage", "opex:view", "budget:view", "savings:manage"],
  },
  {
    key: "accounting_manager",
    name: "Accounting Manager",
    allDepartments: true,
    permissions: ["dashboard:view", "product:view", "supplier:view", "purchase:view", "purchase:prices", "inventory:view", "recipe:view", "waste:view", "cost:view", "variance:view", "report:view", "report:export", "audit:view", "period:manage", "period:reopen", "period:close_override", "approval:decide", "sales:import", "buffet:view", "minibar:view", "opex:view", "opex:manage", "rooms:view", "allocation:manage", "pms:import", "budget:view", "budget:manage", "budget:approve", "savings:manage"],
  },
  {
    key: "purchasing_manager",
    name: "Purchasing Manager",
    allDepartments: true,
    permissions: ["dashboard:view", "product:view", "product:manage", "supplier:view", "supplier:manage", "purchase:view", "purchase:manage", "purchase:approve", "purchase:prices", "inventory:view", "inventory:post", "inventory:receive", "report:view"],
  },
  { key: "chef", name: "Chef", allDepartments: false, permissions: [...OPERATIONAL, "buffet:view", "buffet:manage"] },
  { key: "breakfast_chef", name: "Breakfast Chef", allDepartments: false, permissions: [...OPERATIONAL, "buffet:view", "buffet:manage"] },
  { key: "pastry_chef", name: "Pastry Chef", allDepartments: false, permissions: OPERATIONAL },
  { key: "rooms_division", name: "Rooms Division Manager", allDepartments: false, permissions: ["dashboard:view", "product:view", "inventory:view", "inventory:post", "inventory:count", "waste:view", "waste:record", "cost:view", "report:view", "opex:view", "opex:manage", "rooms:view", "pms:import", "minibar:view", "budget:view", "savings:manage"] },
  { key: "viewer", name: "Viewer (read-only)", allDepartments: true, permissions: READ_ONLY },
  { key: "warehouse", name: "Warehouse User", allDepartments: true, permissions: ["product:view", "inventory:view", "inventory:post", "inventory:receive", "inventory:count", "purchase:view", "waste:record", "waste:view", "minibar:view", "minibar:manage"] },
];

/** The platform operator's role. Lives only in the platform organization (which owns no hotels). */
export const SUPER_ADMIN_TEMPLATE: RoleTemplate = { key: "super_admin", name: "Platform Super Administrator", allDepartments: true, permissions: ["platform:admin"] };
