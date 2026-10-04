-- CreateEnum
CREATE TYPE "MinibarMovementType" AS ENUM ('RESTOCK', 'CONSUMED', 'RETURNED', 'WASTE', 'COUNT');

-- AlterTable
ALTER TABLE "BuffetLine" ADD COLUMN     "note" TEXT,
ADD COLUMN     "recipeVersionId" TEXT,
ADD COLUMN     "refillNo" INTEGER,
ADD COLUMN     "sourceLineId" TEXT,
ADD COLUMN     "stockQty" DECIMAL(20,6),
ADD COLUMN     "totalCost" DECIMAL(20,6),
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "BuffetSession" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdById" TEXT NOT NULL,
ADD COLUMN     "inHouseGuests" INTEGER,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "occupiedRooms" INTEGER,
ADD COLUMN     "warehouseId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "MinibarPar" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "roomType" TEXT,
    "roomId" TEXT,
    "productId" TEXT NOT NULL,
    "parQty" DECIMAL(20,6) NOT NULL,
    "sellingPrice" DECIMAL(20,6) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MinibarPar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MinibarMovement" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "MinibarMovementType" NOT NULL,
    "movedAt" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unitCost" DECIMAL(20,6) NOT NULL,
    "totalCost" DECIMAL(20,6) NOT NULL,
    "revenue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "expectedQty" DECIMAL(20,6),
    "stockTxId" TEXT,
    "folioRef" TEXT,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MinibarMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MinibarPar_hotelId_roomType_roomId_productId_key" ON "MinibarPar"("hotelId", "roomType", "roomId", "productId");

-- CreateIndex
CREATE INDEX "MinibarMovement_hotelId_roomId_movedAt_idx" ON "MinibarMovement"("hotelId", "roomId", "movedAt");

-- CreateIndex
CREATE INDEX "MinibarMovement_hotelId_movedAt_type_idx" ON "MinibarMovement"("hotelId", "movedAt", "type");

-- CreateIndex
CREATE UNIQUE INDEX "MinibarMovement_hotelId_idempotencyKey_key" ON "MinibarMovement"("hotelId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "BuffetLine_sessionId_kind_idx" ON "BuffetLine"("sessionId", "kind");

-- CreateIndex
CREATE INDEX "BuffetSession_hotelId_serviceDate_idx" ON "BuffetSession"("hotelId", "serviceDate");

-- CreateIndex
CREATE INDEX "BuffetSession_hotelId_departmentId_serviceDate_idx" ON "BuffetSession"("hotelId", "departmentId", "serviceDate");

-- AddForeignKey
ALTER TABLE "BuffetSession" ADD CONSTRAINT "BuffetSession_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuffetSession" ADD CONSTRAINT "BuffetSession_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuffetLine" ADD CONSTRAINT "BuffetLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuffetLine" ADD CONSTRAINT "BuffetLine_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinibarPar" ADD CONSTRAINT "MinibarPar_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinibarPar" ADD CONSTRAINT "MinibarPar_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinibarPar" ADD CONSTRAINT "MinibarPar_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinibarMovement" ADD CONSTRAINT "MinibarMovement_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinibarMovement" ADD CONSTRAINT "MinibarMovement_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinibarMovement" ADD CONSTRAINT "MinibarMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

