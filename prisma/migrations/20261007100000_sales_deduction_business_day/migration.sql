-- Sales deduct recipe ingredients from stock; the hotel's business day ends at night audit (default 03:30).
ALTER TABLE "Hotel" ADD COLUMN "autoDeductSales" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Hotel" ADD COLUMN "businessDayCutoff" TEXT NOT NULL DEFAULT '03:30';
