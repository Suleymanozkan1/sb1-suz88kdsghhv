-- Reorder point and safety stock moved from the product card to the automatic-ordering rules
-- ("Otomatik sipariş"), the only place they are edited and read now. Every product that still carries
-- product-level thresholds and has no rule gets a PAUSED rule with those thresholds, so stock status and
-- order recommendations stay as they were and become editable. Nothing is ever ordered from these rules
-- until someone activates them.
--
-- A rule needs a supplier: products without a default supplier (of the same hotel) are left out.
-- The product columns are kept (no longer read) so the step can be checked or redone.
INSERT INTO "AutoOrderRule" ("id", "hotelId", "supplierId", "productId", "reorderPoint", "safetyStock", "orderQty", "active", "createdAt", "updatedAt")
SELECT
  'c' || substr(md5(random()::text || clock_timestamp()::text || p."id"), 1, 24),
  p."hotelId",
  p."defaultSupplierId",
  p."id",
  -- a rule always has a reorder point; with only a safety stock, ordering at the safety stock keeps the old status
  COALESCE(p."reorderPoint", p."safetyStock"),
  p."safetyStock",
  -- order quantity must be positive: fill up to the maximum stock, else one reorder point's worth (at least 1)
  CASE
    WHEN p."maxStock" > COALESCE(p."reorderPoint", p."safetyStock") THEN p."maxStock" - COALESCE(p."reorderPoint", p."safetyStock")
    ELSE GREATEST(COALESCE(p."reorderPoint", p."safetyStock"), 1)
  END,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Product" p
JOIN "Supplier" s ON s."id" = p."defaultSupplierId" AND s."hotelId" = p."hotelId"
WHERE (COALESCE(p."reorderPoint", 0) <> 0 OR COALESCE(p."safetyStock", 0) <> 0)
  AND NOT EXISTS (SELECT 1 FROM "AutoOrderRule" r WHERE r."hotelId" = p."hotelId" AND r."productId" = p."id");
