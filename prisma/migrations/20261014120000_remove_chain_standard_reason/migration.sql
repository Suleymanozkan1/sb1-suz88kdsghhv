-- The default hospitality reason "Zincir standardı (zincire faturalanır)" is no longer offered: removed where unused,
-- set inactive where records already refer to it (their history keeps the reason).
DELETE FROM "CompReason" r
WHERE r."name" = 'Zincir standardı (zincire faturalanır)'
  AND NOT EXISTS (SELECT 1 FROM "CompRecord" c WHERE c."reasonId" = r."id");

UPDATE "CompReason" SET "active" = false
WHERE "name" = 'Zincir standardı (zincire faturalanır)';
