-- r3 §4: breakfast covers are kept in two numbers (package-included / sold separately). Existing breakfast days had
-- one total: it is taken as package-included, nothing sold separately, so the total stays the same.
UPDATE "BuffetSession"
SET "includedCovers" = "actualCovers", "paidCovers" = 0
WHERE "type" = 'BREAKFAST' AND "actualCovers" IS NOT NULL AND "includedCovers" IS NULL AND "paidCovers" IS NULL;
