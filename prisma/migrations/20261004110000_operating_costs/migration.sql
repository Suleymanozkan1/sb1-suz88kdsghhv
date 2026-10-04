-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WasteType" ADD VALUE 'LOST';
ALTER TYPE "WasteType" ADD VALUE 'DISCARDED';

-- AlterTable
ALTER TABLE "CostAllocationRule" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "sourceDepartmentId" TEXT,
ADD COLUMN     "sourceSubCategory" TEXT,
ADD COLUMN     "validFrom" TIMESTAMP(3),
ADD COLUMN     "validTo" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "headcount" INTEGER,
ADD COLUMN     "sqm" DECIMAL(20,6);

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "assetId" TEXT,
ADD COLUMN     "costTxId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "importId" TEXT,
ADD COLUMN     "invoiceNo" TEXT,
ADD COLUMN     "periodId" TEXT,
ADD COLUMN     "quantity" DECIMAL(20,6),
ADD COLUMN     "reverseReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedById" TEXT,
ADD COLUMN     "roomId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'POSTED',
ADD COLUMN     "subCategory" TEXT,
ADD COLUMN     "supplierName" TEXT,
ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "OccupancyImport" ADD COLUMN     "importId" TEXT,
ADD COLUMN     "outOfOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "departmentId" TEXT,
    "location" TEXT,
    "installedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meter" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "utility" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "departmentId" TEXT,
    "area" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Meter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "readingDate" DATE NOT NULL,
    "value" DECIMAL(20,6) NOT NULL,
    "importId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaundryLog" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "logDate" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "kg" DECIMAL(20,6) NOT NULL,
    "pieces" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaundryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "roomId" TEXT,
    "roomType" TEXT NOT NULL,
    "arrival" DATE NOT NULL,
    "departure" DATE NOT NULL,
    "nights" INTEGER NOT NULL,
    "guests" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "boardBasis" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CHECKED_OUT',
    "grossRoomRevenue" DECIMAL(20,6) NOT NULL,
    "commission" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "paymentFee" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "otherDistribution" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "importId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "postedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "summary" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolledBackAt" TIMESTAMP(3),
    "rolledBackById" TEXT,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationRun" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "lines" JSONB NOT NULL,
    "totalAllocated" DECIMAL(20,6) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reverseReason" TEXT,

    CONSTRAINT "AllocationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_hotelId_code_key" ON "Asset"("hotelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Meter_hotelId_code_key" ON "Meter"("hotelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MeterReading_meterId_readingDate_key" ON "MeterReading"("meterId", "readingDate");

-- CreateIndex
CREATE UNIQUE INDEX "LaundryLog_hotelId_logDate_source_key" ON "LaundryLog"("hotelId", "logDate", "source");

-- CreateIndex
CREATE INDEX "Reservation_hotelId_arrival_departure_idx" ON "Reservation"("hotelId", "arrival", "departure");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_hotelId_externalId_key" ON "Reservation"("hotelId", "externalId");

-- CreateIndex
CREATE INDEX "ImportBatch_hotelId_kind_fileHash_idx" ON "ImportBatch"("hotelId", "kind", "fileHash");

-- CreateIndex
CREATE INDEX "AllocationRun_hotelId_periodId_status_idx" ON "AllocationRun"("hotelId", "periodId", "status");

-- CreateIndex
CREATE INDEX "Expense_hotelId_expenseDate_idx" ON "Expense"("hotelId", "expenseDate");

-- CreateIndex
CREATE INDEX "Expense_hotelId_categoryGroup_expenseDate_idx" ON "Expense"("hotelId", "categoryGroup", "expenseDate");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meter" ADD CONSTRAINT "Meter_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meter" ADD CONSTRAINT "Meter_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "Meter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaundryLog" ADD CONSTRAINT "LaundryLog_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationRun" ADD CONSTRAINT "AllocationRun_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccupancyImport" ADD CONSTRAINT "OccupancyImport_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Posted expenses are financial records (spec 187, 236): never deleted; the only allowed update is
-- linking the cost ledger row once and marking the expense REVERSED (the reversal itself is a ledger row).
CREATE OR REPLACE FUNCTION hotelcost_expense_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LEDGER_IMMUTABLE: expenses cannot be deleted; reverse them instead' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."amount" <> OLD."amount" OR NEW."taxAmount" <> OLD."taxAmount" OR NEW."expenseDate" <> OLD."expenseDate"
     OR NEW."categoryGroup" <> OLD."categoryGroup" OR NEW."departmentId" IS DISTINCT FROM OLD."departmentId"
     OR NEW."hotelId" <> OLD."hotelId" OR (OLD."costTxId" IS NOT NULL AND NEW."costTxId" IS DISTINCT FROM OLD."costTxId")
     OR (OLD."status" = 'REVERSED') THEN
    RAISE EXCEPTION 'LEDGER_IMMUTABLE: posted expenses cannot be edited; reverse and re-enter' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expense_guard
  BEFORE UPDATE OR DELETE ON "Expense"
  FOR EACH ROW EXECUTE FUNCTION hotelcost_expense_guard();
