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
  // soft-delete an unposted stock count: company administrator (general management) only
  "count:delete",
  "recipe:view",
  "recipe:manage",
  "recipe:approve",
  "waste:view",
  "waste:record",
  // Ödenmez ve İkram: view the comps page / record, delete and manage the reason list
  "comp:view",
  "comp:manage",
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
  /** what the role is for, shown under the role choice in Administration (English key, translated) */
  description?: string;
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
  { key: "admin", name: "Company Administrator", description: "Everything in the company: users, hotels, settings and every module.", allDepartments: true, permissions: ALL },
  { key: "cost_controller", name: "Cost Controller", description: "Every cost module of all departments, including period closing and approvals; no user or hotel management.", allDepartments: true, permissions: ALL.filter((p) => p !== "admin:users" && p !== "admin:hotels" && p !== "count:delete") },
  {
    key: "fb_manager",
    name: "F&B Manager",
    description: "Food and beverage departments: costs, recipes and their approval, stock, waste, breakfast, minibar and approvals.",
    allDepartments: false,
    permissions: [...OPERATIONAL, "recipe:approve", "inventory:adjust", "approval:decide", "supplier:view", "purchase:view", "sales:import", "report:export", "audit:view", "buffet:view", "buffet:manage", "minibar:view", "minibar:manage", "opex:view", "budget:view", "savings:manage", "comp:view", "comp:manage"],
  },
  {
    key: "accounting_manager",
    name: "Accounting Manager",
    description: "Cost periods, budget, operating costs, allocation and reports of all departments; no stock entry.",
    allDepartments: true,
    permissions: ["dashboard:view", "product:view", "supplier:view", "purchase:view", "purchase:prices", "inventory:view", "recipe:view", "waste:view", "cost:view", "variance:view", "report:view", "report:export", "audit:view", "period:manage", "period:reopen", "period:close_override", "approval:decide", "sales:import", "buffet:view", "minibar:view", "opex:view", "opex:manage", "rooms:view", "allocation:manage", "pms:import", "budget:view", "budget:manage", "budget:approve", "savings:manage", "comp:view"],
  },
  {
    key: "purchasing_manager",
    name: "Purchasing Manager",
    description: "Suppliers, prices, purchase orders, goods receipts and products.",
    allDepartments: true,
    permissions: ["dashboard:view", "product:view", "product:manage", "supplier:view", "supplier:manage", "purchase:view", "purchase:manage", "purchase:approve", "purchase:prices", "inventory:view", "inventory:post", "inventory:receive", "report:view"],
  },
  { key: "chef", name: "Chef", description: "Kitchen and outlets of their departments: recipes, stock movements and counts, waste, breakfast, theoretical vs actual and reports.", allDepartments: false, permissions: [...OPERATIONAL, "buffet:view", "buffet:manage"] },
  // Narrower than the chef (audit UX-03): breakfast is controlled per cover in the Breakfast module, not against POS
  // sales, so no theoretical vs actual and no menu engineering. Report access stays for the Control Calendar, where
  // the breakfast chef signs off the weekly buffet cost review (services/calendar.ts BUFFET_REVIEW).
  {
    key: "breakfast_chef",
    name: "Breakfast Chef",
    description: "Breakfast and buffet of their departments: breakfast days and counts, breakfast recipes, requisitions from the store, stock counts and waste. No theoretical vs actual or menu engineering.",
    allDepartments: false,
    permissions: ["dashboard:view", "product:view", "inventory:view", "inventory:post", "inventory:count", "recipe:view", "recipe:manage", "waste:view", "waste:record", "report:view", "buffet:view", "buffet:manage"],
  },
  { key: "pastry_chef", name: "Pastry Chef", description: "Pastry of their departments: recipes, stock movements and counts, waste, theoretical vs actual and reports.", allDepartments: false, permissions: OPERATIONAL },
  { key: "rooms_division", name: "Rooms Division Manager", description: "Rooms, housekeeping and laundry: room cost, operating costs, minibar, stock and waste of their departments.", allDepartments: false, permissions: ["dashboard:view", "product:view", "inventory:view", "inventory:post", "inventory:count", "waste:view", "waste:record", "cost:view", "report:view", "opex:view", "opex:manage", "rooms:view", "pms:import", "minibar:view", "budget:view", "savings:manage"] },
  { key: "viewer", name: "Viewer (read-only)", description: "Sees every module of all departments, changes nothing.", allDepartments: true, permissions: READ_ONLY },
  { key: "warehouse", name: "Warehouse User", description: "Stores: goods receipts, transfers, issues, counts and minibar refills.", allDepartments: true, permissions: ["product:view", "inventory:view", "inventory:post", "inventory:receive", "inventory:count", "purchase:view", "waste:record", "waste:view", "minibar:view", "minibar:manage"] },
];

/** The platform operator's role. Lives only in the platform organization (which owns no hotels). */
export const SUPER_ADMIN_TEMPLATE: RoleTemplate = { key: "super_admin", name: "Platform Super Administrator", allDepartments: true, permissions: ["platform:admin"] };
