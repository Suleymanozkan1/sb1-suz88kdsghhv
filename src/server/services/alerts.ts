import type { AlertSeverity, AlertType, Prisma } from "@prisma/client";
import type { Db } from "../db";

export async function raiseAlert(
  db: Db,
  a: { hotelId: string; type: AlertType; severity: AlertSeverity; title: string; message: string; entityType?: string; entityId?: string; data?: unknown },
) {
  return db.alert.create({
    data: {
      hotelId: a.hotelId,
      type: a.type,
      severity: a.severity,
      title: a.title,
      message: a.message,
      entityType: a.entityType,
      entityId: a.entityId,
      data: a.data === undefined ? undefined : (JSON.parse(JSON.stringify(a.data)) as Prisma.InputJsonValue),
    },
  });
}
