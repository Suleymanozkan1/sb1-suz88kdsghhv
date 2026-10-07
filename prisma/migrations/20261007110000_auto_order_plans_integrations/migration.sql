-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('BASIC', 'STANDARD', 'PREMIUM');

-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'BASIC';

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "address" TEXT;

-- CreateTable
CREATE TABLE "AutoOrderRule" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "reorderPoint" DECIMAL(20,6) NOT NULL,
    "safetyStock" DECIMAL(20,6),
    "orderQty" DECIMAL(20,6) NOT NULL,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastOrderedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoOrderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoOrderSend" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantity" DECIMAL(20,6) NOT NULL,
    "stockQty" DECIMAL(20,6) NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "AutoOrderSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverCount" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "departmentId" TEXT NOT NULL,
    "meal" TEXT NOT NULL,
    "covers" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationKey" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationRun" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "businessDay" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "stats" JSONB,
    "requestId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationRequest" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "businessDay" TEXT,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutoOrderRule_hotelId_active_idx" ON "AutoOrderRule"("hotelId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AutoOrderRule_hotelId_productId_key" ON "AutoOrderRule"("hotelId", "productId");

-- CreateIndex
CREATE INDEX "AutoOrderSend_hotelId_sentAt_idx" ON "AutoOrderSend"("hotelId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoverCount_hotelId_businessDate_departmentId_meal_key" ON "CoverCount"("hotelId", "businessDate", "departmentId", "meal");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationKey_keyHash_key" ON "IntegrationKey"("keyHash");

-- CreateIndex
CREATE INDEX "IntegrationKey_hotelId_idx" ON "IntegrationKey"("hotelId");

-- CreateIndex
CREATE INDEX "IntegrationRun_hotelId_startedAt_idx" ON "IntegrationRun"("hotelId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationRun_hotelId_runId_key" ON "IntegrationRun"("hotelId", "runId");

-- CreateIndex
CREATE INDEX "IntegrationRequest_hotelId_pickedAt_idx" ON "IntegrationRequest"("hotelId", "pickedAt");

-- AddForeignKey
ALTER TABLE "AutoOrderRule" ADD CONSTRAINT "AutoOrderRule_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoOrderRule" ADD CONSTRAINT "AutoOrderRule_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoOrderRule" ADD CONSTRAINT "AutoOrderRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoOrderSend" ADD CONSTRAINT "AutoOrderSend_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutoOrderRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

