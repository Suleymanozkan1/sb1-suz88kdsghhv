-- Integrity hardening (audit 10/2026).
--
-- 1. Database session time zone = UTC.
--    The whole application computes calendar days in UTC (Date.UTC everywhere), but raw SQL compares DATE columns
--    ("CostPeriod"."endDate", "SupplierPrice"."priceDate", ...) with timestamp parameters, and PostgreSQL converts
--    DATE to timestamptz in the SESSION time zone. On a server whose time zone is not UTC (the Windows installer's
--    PostgreSQL defaults to the machine's zone, e.g. Europe/Istanbul) the last day of a month fell outside its own
--    period: a posting dated the 31st of a reopened month was refused as "before the closed period". CI runs in UTC,
--    so the tests never saw it. Pinning the database to UTC fixes the whole class at once. A migration role that does
--    not own the database cannot do this; it then only warns, and /api/health reports the zone.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'HotelCost: database time zone not changed (not the owner). Run: ALTER DATABASE % SET timezone TO ''UTC''', current_database();
END $$;

-- 2. Append-only guarantees that do not depend on the application's database privileges.
--    Demo purges used to run ALTER TABLE ... DISABLE TRIGGER, which only works for the table owner: the application
--    therefore had to run as owner, and the immutability of REAL ledgers rested on application code. Now a delete is
--    let through only when BOTH hold:
--      a) the transaction asked for it:   set_config('hotelcost.demo_purge', 'on', true)
--      b) the row belongs to a demo organization (which can never be created from a real one, see 3.)
--    so even code that sets the flag cannot remove a real tenant's ledger rows.
CREATE OR REPLACE FUNCTION hotelcost_demo_purge_row(tbl text, r jsonb) RETURNS boolean AS $$
DECLARE org text;
BEGIN
  IF coalesce(current_setting('hotelcost.demo_purge', true), '') <> 'on' THEN
    RETURN false;
  END IF;
  IF r ->> 'hotelId' IS NOT NULL THEN
    SELECT "organizationId" INTO org FROM "Hotel" WHERE id = r ->> 'hotelId';
  ELSIF r ->> 'organizationId' IS NOT NULL THEN
    org := r ->> 'organizationId';
  ELSIF tbl = 'RecipeIngredient' THEN
    SELECT h."organizationId" INTO org FROM "RecipeVersion" v JOIN "Recipe" rc ON rc.id = v."recipeId" JOIN "Hotel" h ON h.id = rc."hotelId" WHERE v.id = r ->> 'versionId';
  ELSIF tbl = 'BudgetLine' THEN
    SELECT h."organizationId" INTO org FROM "Budget" b JOIN "Hotel" h ON h.id = b."hotelId" WHERE b.id = r ->> 'budgetId';
  END IF;
  RETURN org IS NOT NULL AND EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = org AND o."isDemo" AND NOT o."isPlatform");
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION hotelcost_forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND TG_LEVEL = 'ROW' AND hotelcost_demo_purge_row(TG_TABLE_NAME, to_jsonb(OLD)) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'LEDGER_IMMUTABLE: % rows are append-only; post a reversal instead', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION hotelcost_forbid_frozen_recipe_change() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  IF TG_OP = 'DELETE' AND hotelcost_demo_purge_row(TG_TABLE_NAME, to_jsonb(OLD)) THEN
    RETURN OLD;
  END IF;
  SELECT status INTO st FROM "RecipeVersion" WHERE id = COALESCE(OLD."versionId", NEW."versionId");
  IF st IN ('APPROVED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'RECIPE_VERSION_FROZEN: approved recipe versions cannot be modified; create a new version'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION hotelcost_expense_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF hotelcost_demo_purge_row(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'LEDGER_IMMUTABLE: expenses cannot be deleted; reverse them instead' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."amount" <> OLD."amount" OR NEW."taxAmount" <> OLD."taxAmount" OR NEW."expenseDate" <> OLD."expenseDate"
     OR NEW."categoryGroup" <> OLD."categoryGroup" OR NEW."departmentId" IS DISTINCT FROM OLD."departmentId"
     OR NEW."hotelId" <> OLD."hotelId" OR (OLD."costTxId" IS NOT NULL AND NEW."costTxId" IS DISTINCT FROM OLD."costTxId")
     OR (OLD."status" = 'REVERSED') THEN
    RAISE EXCEPTION 'LEDGER_IMMUTABLE: posted expenses cannot be edited; reverse and re-enter' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION hotelcost_budget_line_frozen() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  IF TG_OP = 'DELETE' AND hotelcost_demo_purge_row(TG_TABLE_NAME, to_jsonb(OLD)) THEN
    RETURN OLD;
  END IF;
  SELECT status INTO st FROM "Budget" WHERE id = COALESCE(NEW."budgetId", OLD."budgetId");
  IF st IN ('APPROVED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'BUDGET_FROZEN: approved budgets cannot be modified; create a revision' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION hotelcost_budget_status_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" <> 'DRAFT' THEN
    IF hotelcost_demo_purge_row(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'BUDGET_FROZEN: approved budgets cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" <> 'DRAFT' AND (NEW."status" = 'DRAFT' OR NEW."year" <> OLD."year" OR NEW."hotelId" <> OLD."hotelId") THEN
    RAISE EXCEPTION 'BUDGET_FROZEN: an approved budget cannot return to draft' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- TRUNCATE skips row triggers: refuse it on the append-only tables (statement-level trigger).
CREATE TRIGGER stock_tx_no_truncate BEFORE TRUNCATE ON "StockTransaction" FOR EACH STATEMENT EXECUTE FUNCTION hotelcost_forbid_ledger_mutation();
CREATE TRIGGER cost_tx_no_truncate BEFORE TRUNCATE ON "CostTransaction" FOR EACH STATEMENT EXECUTE FUNCTION hotelcost_forbid_ledger_mutation();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "AuditLog" FOR EACH STATEMENT EXECUTE FUNCTION hotelcost_forbid_ledger_mutation();
CREATE TRIGGER expense_no_truncate BEFORE TRUNCATE ON "Expense" FOR EACH STATEMENT EXECUTE FUNCTION hotelcost_forbid_ledger_mutation();

-- 3. The demo escape hatch must not be reachable from a real tenant: a real organization never becomes a demo (or
--    platform) one, is never deleted, and a hotel never moves to another organization.
CREATE OR REPLACE FUNCTION hotelcost_org_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT OLD."isDemo" THEN
      RAISE EXCEPTION 'ORG_IMMUTABLE: real organizations are suspended, never deleted' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW."isDemo" AND NOT OLD."isDemo") OR NEW."isPlatform" <> OLD."isPlatform" THEN
    RAISE EXCEPTION 'ORG_IMMUTABLE: the demo / platform flags of an organization are fixed at creation' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organization_guard BEFORE UPDATE OR DELETE ON "Organization" FOR EACH ROW EXECUTE FUNCTION hotelcost_org_guard();

CREATE OR REPLACE FUNCTION hotelcost_hotel_org_fixed() RETURNS trigger AS $$
BEGIN
  IF NEW."organizationId" <> OLD."organizationId" THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: a hotel cannot move to another organization' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER hotel_org_fixed BEFORE UPDATE ON "Hotel" FOR EACH ROW EXECUTE FUNCTION hotelcost_hotel_org_fixed();

-- 4. Payment notices: amounts and identity are fixed once issued; OPEN → PAID or OPEN → VOID, then final.
CREATE OR REPLACE FUNCTION hotelcost_billing_invoice_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF hotelcost_demo_purge_row(TG_TABLE_NAME, to_jsonb(OLD)) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'LEDGER_IMMUTABLE: payment notices are voided, never deleted' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."number" <> OLD."number" OR NEW."organizationId" <> OLD."organizationId" OR NEW."plan" <> OLD."plan"
     OR NEW."hotelCount" <> OLD."hotelCount" OR NEW."months" <> OLD."months" OR NEW."unitPrice" <> OLD."unitPrice"
     OR NEW."netAmount" <> OLD."netAmount" OR NEW."taxRate" <> OLD."taxRate" OR NEW."taxAmount" <> OLD."taxAmount"
     OR NEW."total" <> OLD."total" OR NEW."currency" <> OLD."currency" OR NEW."periodStart" <> OLD."periodStart"
     OR NEW."periodEnd" <> OLD."periodEnd" THEN
    RAISE EXCEPTION 'LEDGER_IMMUTABLE: an issued payment notice cannot be changed; void it and issue a new one' USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" <> 'OPEN' THEN
    RAISE EXCEPTION 'LEDGER_IMMUTABLE: a % payment notice is final', OLD."status" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER billing_invoice_guard BEFORE UPDATE OR DELETE ON "BillingInvoice" FOR EACH ROW EXECUTE FUNCTION hotelcost_billing_invoice_guard();
CREATE TRIGGER billing_invoice_no_truncate BEFORE TRUNCATE ON "BillingInvoice" FOR EACH STATEMENT EXECUTE FUNCTION hotelcost_forbid_ledger_mutation();
