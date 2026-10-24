-- CreateEnum
CREATE TYPE "BillingInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PlanRequestStatus" AS ENUM ('OPEN', 'DONE', 'REJECTED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "billingAddress" TEXT,
ADD COLUMN     "billingEmail" TEXT,
ADD COLUMN     "billingName" TEXT,
ADD COLUMN     "billingTaxId" TEXT,
ADD COLUMN     "paidThrough" TIMESTAMP(3),
ADD COLUMN     "trialEndsAt" TIMESTAMP(3) DEFAULT (now() + '30 days'::interval);

-- CreateTable
CREATE TABLE "BillingInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "hotelCount" INTEGER NOT NULL,
    "months" INTEGER NOT NULL,
    "unitPrice" DECIMAL(20,6) NOT NULL,
    "netAmount" DECIMAL(20,6) NOT NULL,
    "taxRate" DECIMAL(20,6) NOT NULL,
    "taxAmount" DECIMAL(20,6) NOT NULL,
    "total" DECIMAL(20,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "BillingInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "paidAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "note" TEXT,
    "voidReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanPrice" (
    "plan" "Plan" NOT NULL,
    "monthlyPerHotel" DECIMAL(20,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanPrice_pkey" PRIMARY KEY ("plan")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PlanRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "note" TEXT,
    "requestedById" TEXT NOT NULL,
    "status" "PlanRequestStatus" NOT NULL DEFAULT 'OPEN',
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_number_key" ON "BillingInvoice"("number");

-- CreateIndex
CREATE INDEX "BillingInvoice_organizationId_createdAt_idx" ON "BillingInvoice"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingInvoice_status_dueDate_idx" ON "BillingInvoice"("status", "dueDate");

-- CreateIndex
CREATE INDEX "PlanRequest_status_createdAt_idx" ON "PlanRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PlanRequest_organizationId_createdAt_idx" ON "PlanRequest"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CostTransaction_stockTxId_idx" ON "CostTransaction"("stockTxId");

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanRequest" ADD CONSTRAINT "PlanRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- List prices (monthly, per active hotel), the three scenarios of the 10/2026 audit. Edited in the platform console.
INSERT INTO "PlanPrice" ("plan", "monthlyPerHotel", "currency", "updatedAt") VALUES
  ('BASIC', 2500, 'TRY', now()),
  ('STANDARD', 5500, 'TRY', now()),
  ('PREMIUM', 10000, 'TRY', now())
ON CONFLICT ("plan") DO NOTHING;

-- Bank transfer details shown to tenants; empty until the operator fills them in.
INSERT INTO "PlatformSetting" ("key", "value", "updatedAt") VALUES
  ('billing', '{"bankName": "", "accountName": "", "iban": "", "taxRate": "0.20", "paymentTermDays": 14, "note": ""}', now())
ON CONFLICT ("key") DO NOTHING;
