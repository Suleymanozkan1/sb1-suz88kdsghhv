-- Stock counts, feedback round 2 (spec 4):
--  * every count goes through approval; a rejected count returns to DRAFT with the approver's note
--  * soft delete of unposted counts (the row stays for audit, it is never shown again)
--  * configurable approvers per warehouse (role keys); no row = any role with approval:decide
--  * new permission "count:delete" for the company administrator role

ALTER TABLE "StockCount" ADD COLUMN "rejectionNote" TEXT;
ALTER TABLE "StockCount" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "StockCount" ADD COLUMN "deletedById" TEXT;

-- CreateTable
CREATE TABLE "CountApprover" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CountApprover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CountApprover_warehouseId_roleKey_key" ON "CountApprover"("warehouseId", "roleKey");
CREATE INDEX "CountApprover_hotelId_idx" ON "CountApprover"("hotelId");

-- AddForeignKey
ALTER TABLE "CountApprover" ADD CONSTRAINT "CountApprover_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CountApprover" ADD CONSTRAINT "CountApprover_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- tenant integrity: the warehouse must belong to the same hotel
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "warehouseId" ON "CountApprover" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('warehouseId', 'Warehouse');

-- deleting a count is reserved for the company administrator (general management)
UPDATE "Role" SET permissions = array_append(permissions, 'count:delete') WHERE key = 'admin' AND NOT ('count:delete' = ANY(permissions));
