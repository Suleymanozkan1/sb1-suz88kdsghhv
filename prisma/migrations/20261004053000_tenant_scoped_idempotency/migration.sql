-- DropIndex
DROP INDEX "GoodsReceipt_idempotencyKey_key";

-- DropIndex
DROP INDEX "StockTransaction_idempotencyKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_hotelId_idempotencyKey_key" ON "GoodsReceipt"("hotelId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransaction_hotelId_idempotencyKey_key" ON "StockTransaction"("hotelId", "idempotencyKey");

