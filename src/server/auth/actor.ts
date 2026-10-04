/**
 * The authenticated principal, resolved server-side for every request.
 * Every service call receives an Actor and re-checks authorization itself (spec §273):
 * hiding a button in the UI is never the control.
 */
import { DomainError } from "@/domain/errors";
import type { Permission } from "./permissions";

export interface Actor {
  userId: string;
  organizationId: string;
  name: string;
  email: string;
  roleKey: string;
  roleName: string;
  permissions: ReadonlySet<string>;
  hotelIds: readonly string[];
  /** "ALL" for roles with allDepartments; otherwise explicit department ids */
  departmentIds: readonly string[] | "ALL";
}

export function can(actor: Actor, perm: Permission): boolean {
  return actor.permissions.has(perm);
}

export function requirePermission(actor: Actor, perm: Permission): void {
  if (!actor.permissions.has(perm)) throw new DomainError("FORBIDDEN", `Missing permission: ${perm}`);
}

/** Tenant isolation: a user can never touch a hotel they are not assigned to (IDOR, spec §274). */
export function requireHotel(actor: Actor, hotelId: string): void {
  if (!actor.hotelIds.includes(hotelId)) throw new DomainError("FORBIDDEN", "No access to this hotel");
}

/** Department isolation (spec §242). `null` department = hotel-level record: only all-department roles. */
export function requireDepartment(actor: Actor, departmentId: string | null | undefined): void {
  if (actor.departmentIds === "ALL") return;
  if (!departmentId || !actor.departmentIds.includes(departmentId)) {
    throw new DomainError("FORBIDDEN", "No access to this department");
  }
}

export function canDepartment(actor: Actor, departmentId: string | null | undefined): boolean {
  try {
    requireDepartment(actor, departmentId);
    return true;
  } catch {
    return false;
  }
}

/** Prisma where-fragment restricting department-scoped rows. */
export function departmentScope(actor: Actor, field = "departmentId"): Record<string, unknown> {
  if (actor.departmentIds === "ALL") return {};
  return { [field]: { in: [...actor.departmentIds] } };
}

export function authorize(actor: Actor, perm: Permission, scope: { hotelId: string; departmentId?: string | null }): void {
  requirePermission(actor, perm);
  requireHotel(actor, scope.hotelId);
  if (scope.departmentId !== undefined) requireDepartment(actor, scope.departmentId);
}
