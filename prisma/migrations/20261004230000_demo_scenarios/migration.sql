-- CreateTable
CREATE TABLE "DemoScenario" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hotelId" TEXT,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expectedDetection" TEXT,
    "entityType" TEXT,
    "entityIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoScenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DemoScenario_organizationId_status_idx" ON "DemoScenario"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DemoScenario_hotelId_idx" ON "DemoScenario"("hotelId");

