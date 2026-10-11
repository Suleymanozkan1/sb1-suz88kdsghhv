-- Repair for 20261009110000_fifo_recipes_products: the opening FIFO layer took the weighted-average cost rounded to
-- 6 decimals, so on a large position (e.g. 50 001 g) quantity x rounded cost can miss the balance value by more than
-- 0.01 and the integrity check reports a FIFO value mismatch. Where a position is still carried by its opening layer
-- alone, one unit is split off into an adjustment layer that holds the residual: the open layers then add up to the
-- balance value again. Ledger and balances are not touched. (Runs on fresh installs too, right after that migration.)
CREATE TEMP TABLE "_fifo_residual" AS
SELECT l."id" AS "layerId", l."hotelId", l."warehouseId", l."productId", l."sourceTxId", l."receivedAt", l."remainingQty", l."unitCost", b."value"
FROM "FifoLayer" l
JOIN "StockBalance" b ON b."warehouseId" = l."warehouseId" AND b."productId" = l."productId"
WHERE l."sourceTxId" LIKE 'opening:%'
  AND l."remainingQty" > 1
  AND b."quantity" = l."remainingQty"
  AND NOT EXISTS (SELECT 1 FROM "FifoLayer" o WHERE o."warehouseId" = l."warehouseId" AND o."productId" = l."productId" AND o."id" <> l."id" AND o."remainingQty" > 0)
  AND ABS(b."value" - l."remainingQty" * l."unitCost") > 0.01;

INSERT INTO "FifoLayer" ("id", "hotelId", "warehouseId", "productId", "sourceTxId", "receivedAt", "originalQty", "remainingQty", "unitCost")
SELECT 'c' || substr(md5('fifo-opening-residual:' || r."layerId"), 1, 24), r."hotelId", r."warehouseId", r."productId",
  'opening-residual:' || substr(r."sourceTxId", 9), r."receivedAt", 1, 1, r."value" - (r."remainingQty" - 1) * r."unitCost"
FROM "_fifo_residual" r;

UPDATE "FifoLayer" l SET "originalQty" = l."originalQty" - 1, "remainingQty" = l."remainingQty" - 1
FROM "_fifo_residual" r WHERE l."id" = r."layerId";
DROP TABLE "_fifo_residual";
