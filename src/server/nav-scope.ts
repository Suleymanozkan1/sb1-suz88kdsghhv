/** Menu flags that depend on the user's departments in this hotel (see NavItem.scopeFlag). */
import type { Actor } from "./auth/actor";
import type { Db } from "./db";
import { MINIBAR_DEPARTMENT } from "@/components/nav";
import { MINIBAR_DEPT } from "./services/minibar";

export async function departmentNavFlags(db: Db, actor: Actor, hotelId: string): Promise<string[]> {
  if (actor.departmentIds === "ALL") return [];
  // the minibar page reads the Minibar department's stock: a role scoped to other departments only gets "no access"
  const mini = await db.department.findFirst({ where: { hotelId, code: MINIBAR_DEPT }, select: { id: true } });
  return mini && actor.departmentIds.includes(mini.id) ? [MINIBAR_DEPARTMENT] : [];
}
