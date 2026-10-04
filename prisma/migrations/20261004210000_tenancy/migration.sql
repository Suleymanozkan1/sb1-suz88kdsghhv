-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPlatform" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "UserInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "roleKey" TEXT NOT NULL,
    "hotelIds" TEXT[],
    "departmentIds" TEXT[],
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "monthlyCost" DECIMAL(20,6) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserInvite_tokenHash_key" ON "UserInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "UserInvite_organizationId_createdAt_idx" ON "UserInvite"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Employee_hotelId_departmentId_idx" ON "Employee"("hotelId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_hotelId_code_key" ON "Employee"("hotelId", "code");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInvite" ADD CONSTRAINT "UserInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Backfill: every audit row carries its organization (spec 28, 142) ──
ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_immutable;
UPDATE "AuditLog" a SET "organizationId" = h."organizationId" FROM "Hotel" h WHERE a."hotelId" = h.id AND a."organizationId" IS NULL;
UPDATE "AuditLog" a SET "organizationId" = u."organizationId" FROM "User" u WHERE a."userId" = u.id AND a."organizationId" IS NULL;
ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_immutable;

-- DB-level guarantee: the organization is derived from the hotel (or the acting user) and must agree with it
CREATE OR REPLACE FUNCTION audit_log_tenant() RETURNS trigger AS $$
DECLARE hotel_org TEXT;
BEGIN
  IF NEW."hotelId" IS NOT NULL THEN
    SELECT "organizationId" INTO hotel_org FROM "Hotel" WHERE id = NEW."hotelId";
    IF NEW."organizationId" IS NULL THEN
      NEW."organizationId" := hotel_org;
    ELSIF NEW."organizationId" <> hotel_org THEN
      RAISE EXCEPTION 'TENANT_MISMATCH: audit row organization differs from its hotel';
    END IF;
  END IF;
  IF NEW."organizationId" IS NULL AND NEW."userId" IS NOT NULL THEN
    SELECT "organizationId" INTO NEW."organizationId" FROM "User" WHERE id = NEW."userId";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_tenant BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION audit_log_tenant();

-- ── Roles: company administrators may create hotels; the template is renamed for clarity ──
UPDATE "Role" SET permissions = array_append(permissions, 'admin:hotels') WHERE key = 'admin' AND NOT ('admin:hotels' = ANY(permissions));
UPDATE "Role" SET name = 'Company Administrator' WHERE key = 'admin' AND name = 'System Administrator';
