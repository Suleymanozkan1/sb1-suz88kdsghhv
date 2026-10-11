-- POS item name kept on the sale line: reprocessing unmapped sales matches a recipe added later by this name when no
-- recipe carries the POS code (the import matches the same way)
ALTER TABLE "SaleLine" ADD COLUMN "itemName" TEXT;
