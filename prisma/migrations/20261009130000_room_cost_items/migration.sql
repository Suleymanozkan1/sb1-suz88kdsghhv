-- AlterTable
ALTER TABLE "OccupancyImport" ADD COLUMN     "outOfService" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RoomCostItem" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomCostItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoomCostItem_hotelId_month_idx" ON "RoomCostItem"("hotelId", "month");

-- AddForeignKey
ALTER TABLE "RoomCostItem" ADD CONSTRAINT "RoomCostItem_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
