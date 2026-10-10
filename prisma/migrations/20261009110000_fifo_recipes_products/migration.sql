-- Feedback round 2, products & recipes.
--
-- 1) Costing method: FIFO for every product (was weighted average). A weighted-average position has no stock
--    layers, so FIFO starts from ONE opening layer per warehouse x product holding the current balance at its
--    current average cost (value / quantity): the stock on hand is consumed first, at the value it is carried at,
--    and every later receipt becomes its own layer behind it. The ledger and balances are not touched.
--    The layer is dated at the position's first movement, so a later (even back-dated) receipt queues behind it.
--    Positions at zero or below get no layer (the FIFO ledger settles negative stock at the next receipt).
--    Products that already used FIFO keep their layers.
INSERT INTO "FifoLayer" ("id", "hotelId", "warehouseId", "productId", "sourceTxId", "receivedAt", "originalQty", "remainingQty", "unitCost")
SELECT
  'c' || substr(md5('fifo-opening:' || b."id"), 1, 24),
  b."hotelId",
  b."warehouseId",
  b."productId",
  'opening:' || b."id",
  COALESCE(
    (SELECT MIN(t."txDate") FROM "StockTransaction" t WHERE t."warehouseId" = b."warehouseId" AND t."productId" = b."productId"),
    b."lastTxAt",
    CURRENT_TIMESTAMP
  ),
  b."quantity",
  b."quantity",
  ROUND(b."value" / b."quantity", 6)
FROM "StockBalance" b
JOIN "Product" p ON p."id" = b."productId"
WHERE p."costingMethod" = 'WEIGHTED_AVERAGE' AND b."quantity" > 0;

UPDATE "Product" SET "costingMethod" = 'FIFO' WHERE "costingMethod" = 'WEIGHTED_AVERAGE';
ALTER TABLE "Product" ALTER COLUMN "costingMethod" SET DEFAULT 'FIFO';

-- 2) Recipes: last-change date (list / detail and the date filter) and soft delete.
--    Existing recipes: changed when their latest version was created or approved.
ALTER TABLE "Recipe" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Recipe" ADD COLUMN "deletedAt" TIMESTAMP(3);
UPDATE "Recipe" r SET "updatedAt" = GREATEST(
  r."createdAt",
  COALESCE((SELECT MAX(GREATEST(v."createdAt", COALESCE(v."approvedAt", v."createdAt"))) FROM "RecipeVersion" v WHERE v."recipeId" = r."id"), r."createdAt")
);

-- 3) Products: chart-of-accounts code on categories (optional) and the last "Pull products" from Micros.
ALTER TABLE "ProductCategory" ADD COLUMN "accountCode" TEXT;
ALTER TABLE "Hotel" ADD COLUMN "productsPulledAt" TIMESTAMP(3);
ALTER TABLE "IntegrationRequest" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'DAY';
