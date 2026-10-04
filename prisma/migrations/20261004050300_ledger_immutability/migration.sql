-- Ledger immutability (spec §183, §187, §236).
-- Posted stock and cost ledger rows can never be updated or deleted.
-- Corrections are new REVERSAL rows that reference the original.

CREATE OR REPLACE FUNCTION hotelcost_forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LEDGER_IMMUTABLE: % rows are append-only; post a reversal instead', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_tx_immutable
  BEFORE UPDATE OR DELETE ON "StockTransaction"
  FOR EACH ROW EXECUTE FUNCTION hotelcost_forbid_ledger_mutation();

CREATE TRIGGER cost_tx_immutable
  BEFORE UPDATE OR DELETE ON "CostTransaction"
  FOR EACH ROW EXECUTE FUNCTION hotelcost_forbid_ledger_mutation();

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION hotelcost_forbid_ledger_mutation();

-- Approved recipe versions are frozen: lines cannot change once approved.
CREATE OR REPLACE FUNCTION hotelcost_forbid_frozen_recipe_change() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM "RecipeVersion" WHERE id = COALESCE(OLD."versionId", NEW."versionId");
  IF st IN ('APPROVED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'RECIPE_VERSION_FROZEN: approved recipe versions cannot be modified; create a new version'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recipe_line_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON "RecipeIngredient"
  FOR EACH ROW EXECUTE FUNCTION hotelcost_forbid_frozen_recipe_change();

-- Quantities in balances may never go below zero unless explicitly allowed by the service
-- (negative stock is surfaced in the data-quality center rather than silently blocked at DB level).
