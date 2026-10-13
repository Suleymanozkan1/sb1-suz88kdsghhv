-- Round 3 (12.10 feedback): training videos per page, breakfast package/extra covers, Ödenmez / İkram.
-- CreateEnum
CREATE TYPE "CompKind" AS ENUM ('ON_HOUSE', 'HOSPITALITY');

-- AlterTable
ALTER TABLE "BuffetSession" ADD COLUMN     "includedCovers" INTEGER,
ADD COLUMN     "paidCovers" INTEGER;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "trainingVideos" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "CompReason" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "kind" "CompKind" NOT NULL,
    "name" TEXT NOT NULL,
    "noteRequired" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompRecord" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "kind" "CompKind" NOT NULL,
    "businessDate" DATE NOT NULL,
    "departmentId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "reasonId" TEXT,
    "person" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "totalCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompLine" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "recipeId" TEXT,
    "recipeVersionId" TEXT,
    "productId" TEXT,
    "posCode" TEXT,
    "itemName" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unitCost" DECIMAL(20,6),
    "totalCost" DECIMAL(20,6),
    "stockTxId" TEXT,

    CONSTRAINT "CompLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompReason_hotelId_kind_name_key" ON "CompReason"("hotelId", "kind", "name");

-- CreateIndex
CREATE INDEX "CompRecord_hotelId_businessDate_idx" ON "CompRecord"("hotelId", "businessDate");

-- CreateIndex
CREATE INDEX "CompRecord_hotelId_departmentId_businessDate_idx" ON "CompRecord"("hotelId", "departmentId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "CompRecord_hotelId_externalId_key" ON "CompRecord"("hotelId", "externalId");

-- CreateIndex
CREATE INDEX "CompLine_recordId_idx" ON "CompLine"("recordId");

-- AddForeignKey
ALTER TABLE "CompReason" ADD CONSTRAINT "CompReason_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompRecord" ADD CONSTRAINT "CompRecord_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompRecord" ADD CONSTRAINT "CompRecord_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompRecord" ADD CONSTRAINT "CompRecord_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompRecord" ADD CONSTRAINT "CompRecord_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "CompReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompLine" ADD CONSTRAINT "CompLine_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "CompRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompLine" ADD CONSTRAINT "CompLine_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompLine" ADD CONSTRAINT "CompLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- tenant consistency (see 20261004220000_tenant_consistency): a comp record's department, store and reason belong to its hotel
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "departmentId", "warehouseId", "reasonId" ON "CompRecord" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('departmentId', 'Department', 'warehouseId', 'Warehouse', 'reasonId', 'CompReason');
