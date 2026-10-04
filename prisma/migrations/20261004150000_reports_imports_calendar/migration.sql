-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "sourceRow" INTEGER;

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "mappingVersion" TEXT NOT NULL DEFAULT 'v1',
ADD COLUMN     "sourceFormat" TEXT NOT NULL DEFAULT 'CSV';

-- AlterTable
ALTER TABLE "OccupancyImport" ADD COLUMN     "sourceRow" INTEGER;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "importId" TEXT;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "params" JSONB,
ADD COLUMN     "periodFrom" TIMESTAMP(3),
ADD COLUMN     "periodHash" TEXT,
ADD COLUMN     "periodTo" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "sourceRow" INTEGER;

-- AlterTable
ALTER TABLE "SupplierPrice" ADD COLUMN     "importId" TEXT,
ADD COLUMN     "sourceRow" INTEGER;

-- CreateTable
CREATE TABLE "CalendarTask" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "recurrence" TEXT NOT NULL,
    "weekday" INTEGER,
    "monthDay" INTEGER,
    "ownerRole" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarCompletion" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedById" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "CalendarCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarTask_hotelId_active_idx" ON "CalendarTask"("hotelId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarCompletion_taskId_dueDate_key" ON "CalendarCompletion"("taskId", "dueDate");

-- CreateIndex
CREATE INDEX "Report_hotelId_reportType_generatedAt_idx" ON "Report"("hotelId", "reportType", "generatedAt");

-- AddForeignKey
ALTER TABLE "CalendarTask" ADD CONSTRAINT "CalendarTask_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarCompletion" ADD CONSTRAINT "CalendarCompletion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CalendarTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

