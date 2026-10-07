-- A recipe quantity is the raw quantity the kitchen uses (105 g raw octopus for 70 g on the plate).
-- Yield %, standard waste %, production loss % and per-batch other costs counted the loss twice and are no
-- longer used by the cost engine. Neutralise the stored values so nothing old can come back into a calculation.
-- Frozen cost snapshots of approved versions are re-costed by `npm run recipes:refreeze` (run on deploy).

UPDATE "Product" SET "yieldPct" = 100 WHERE "yieldPct" <> 100;

-- approved recipe lines are frozen by a trigger: this one-off correction bypasses it on purpose
ALTER TABLE "RecipeIngredient" DISABLE TRIGGER recipe_line_frozen;
UPDATE "RecipeIngredient" SET "yieldPct" = NULL, "wastePct" = 0 WHERE "yieldPct" IS NOT NULL OR "wastePct" <> 0;
ALTER TABLE "RecipeIngredient" ENABLE TRIGGER recipe_line_frozen;

UPDATE "RecipeVersion"
SET "productionLossPct" = 0, "packagingCost" = 0, "laborCost" = 0, "energyCost" = 0, "otherCost" = 0
WHERE "productionLossPct" <> 0 OR "packagingCost" <> 0 OR "laborCost" <> 0 OR "energyCost" <> 0 OR "otherCost" <> 0;
