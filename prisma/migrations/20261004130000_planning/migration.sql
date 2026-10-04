-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "CostTarget" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "departmentId" TEXT,
    "target" DECIMAL(20,6) NOT NULL,
    "warnAt" DECIMAL(20,6),
    "direction" TEXT NOT NULL DEFAULT 'MAX',
    "validFrom" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingAction" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "rootCause" TEXT,
    "action" TEXT NOT NULL,
    "departmentId" TEXT,
    "ownerName" TEXT NOT NULL,
    "ownerId" TEXT,
    "baselineCost" DECIMAL(20,6),
    "targetSaving" DECIMAL(20,6) NOT NULL,
    "actualSaving" DECIMAL(20,6),
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "opportunityKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "SavingAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostTarget_hotelId_metric_active_idx" ON "CostTarget"("hotelId", "metric", "active");

-- CreateIndex
CREATE INDEX "SavingAction_hotelId_status_idx" ON "SavingAction"("hotelId", "status");

-- CreateIndex
CREATE INDEX "BudgetLine_budgetId_month_idx" ON "BudgetLine"("budgetId", "month");

-- AddForeignKey
ALTER TABLE "CostTarget" ADD CONSTRAINT "CostTarget_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingAction" ADD CONSTRAINT "SavingAction_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- An approved budget is frozen (spec 192–194): its lines cannot be inserted, changed or deleted;
-- a revision is a new budget. Budget rows themselves may only move DRAFT → APPROVED → SUPERSEDED.
CREATE OR REPLACE FUNCTION hotelcost_budget_line_frozen() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM "Budget" WHERE id = COALESCE(NEW."budgetId", OLD."budgetId");
  IF st IN ('APPROVED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'BUDGET_FROZEN: approved budgets cannot be modified; create a revision' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER budget_line_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON "BudgetLine"
  FOR EACH ROW EXECUTE FUNCTION hotelcost_budget_line_frozen();

CREATE OR REPLACE FUNCTION hotelcost_budget_status_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'BUDGET_FROZEN: approved budgets cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" <> 'DRAFT' AND (NEW."status" = 'DRAFT' OR NEW."year" <> OLD."year" OR NEW."hotelId" <> OLD."hotelId") THEN
    RAISE EXCEPTION 'BUDGET_FROZEN: an approved budget cannot return to draft' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER budget_status_guard
  BEFORE UPDATE OR DELETE ON "Budget"
  FOR EACH ROW EXECUTE FUNCTION hotelcost_budget_status_guard();
