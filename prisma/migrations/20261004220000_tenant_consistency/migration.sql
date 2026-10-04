-- Tenant integrity at database level (spec 5, 24): a hotel-scoped row may only reference rows of the
-- SAME hotel. Application services check this first (clean errors); these triggers make a cross-tenant
-- link impossible even for a buggy service, a script or a manual SQL session.

CREATE OR REPLACE FUNCTION hc_same_hotel() RETURNS trigger AS $$
DECLARE
  j jsonb := to_jsonb(NEW);
  row_hotel text := j->>'hotelId';
  i int := 0;
  col text; tbl text; ref_id text; ref_hotel text;
BEGIN
  WHILE i < TG_NARGS LOOP
    col := TG_ARGV[i]; tbl := TG_ARGV[i + 1]; i := i + 2;
    ref_id := j->>col;
    CONTINUE WHEN ref_id IS NULL;
    EXECUTE format('SELECT "hotelId" FROM %I WHERE id = $1', tbl) INTO ref_hotel USING ref_id;
    IF ref_hotel IS NOT NULL AND ref_hotel IS DISTINCT FROM row_hotel THEN
      RAISE EXCEPTION 'TENANT_MISMATCH: %.% references a % of another hotel', TG_TABLE_NAME, col, tbl;
    END IF;
  END LOOP;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- child rows without their own hotelId: the hotel comes from the parent document
CREATE OR REPLACE FUNCTION hc_child_same_hotel() RETURNS trigger AS $$
DECLARE
  j jsonb := to_jsonb(NEW);
  parent_hotel text;
  i int := 2;
  col text; tbl text; ref_id text; ref_hotel text;
BEGIN
  EXECUTE format('SELECT "hotelId" FROM %I WHERE id = $1', TG_ARGV[1]) INTO parent_hotel USING j->>TG_ARGV[0];
  WHILE i < TG_NARGS LOOP
    col := TG_ARGV[i]; tbl := TG_ARGV[i + 1]; i := i + 2;
    ref_id := j->>col;
    CONTINUE WHEN ref_id IS NULL;
    EXECUTE format('SELECT "hotelId" FROM %I WHERE id = $1', tbl) INTO ref_hotel USING ref_id;
    IF ref_hotel IS NOT NULL AND ref_hotel IS DISTINCT FROM parent_hotel THEN
      RAISE EXCEPTION 'TENANT_MISMATCH: %.% references a % of another hotel', TG_TABLE_NAME, col, tbl;
    END IF;
  END LOOP;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- recipe lines: the hotel is the recipe's (line -> version -> recipe)
CREATE OR REPLACE FUNCTION hc_recipe_line_same_hotel() RETURNS trigger AS $$
DECLARE recipe_hotel text; ref_hotel text;
BEGIN
  SELECT r."hotelId" INTO recipe_hotel FROM "RecipeVersion" v JOIN "Recipe" r ON r.id = v."recipeId" WHERE v.id = NEW."versionId";
  IF NEW."productId" IS NOT NULL THEN
    SELECT "hotelId" INTO ref_hotel FROM "Product" WHERE id = NEW."productId";
    IF ref_hotel IS DISTINCT FROM recipe_hotel THEN RAISE EXCEPTION 'TENANT_MISMATCH: RecipeIngredient.productId references a Product of another hotel'; END IF;
  END IF;
  IF NEW."subRecipeId" IS NOT NULL THEN
    SELECT "hotelId" INTO ref_hotel FROM "Recipe" WHERE id = NEW."subRecipeId";
    IF ref_hotel IS DISTINCT FROM recipe_hotel THEN RAISE EXCEPTION 'TENANT_MISMATCH: RecipeIngredient.subRecipeId references a Recipe of another hotel'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- department rights: the department must be in a hotel of the user's own organization
CREATE OR REPLACE FUNCTION hc_dept_access_same_org() RETURNS trigger AS $$
DECLARE user_org text; dept_org text;
BEGIN
  SELECT "organizationId" INTO user_org FROM "User" WHERE id = NEW."userId";
  SELECT h."organizationId" INTO dept_org FROM "Department" d JOIN "Hotel" h ON h.id = d."hotelId" WHERE d.id = NEW."departmentId";
  IF user_org IS DISTINCT FROM dept_org THEN RAISE EXCEPTION 'TENANT_MISMATCH: department access across organizations'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- hotel access: a user may only be assigned to hotels of their own organization
CREATE OR REPLACE FUNCTION hc_hotel_access_same_org() RETURNS trigger AS $$
DECLARE user_org text; hotel_org text;
BEGIN
  SELECT "organizationId" INTO user_org FROM "User" WHERE id = NEW."userId";
  SELECT "organizationId" INTO hotel_org FROM "Hotel" WHERE id = NEW."hotelId";
  IF user_org IS DISTINCT FROM hotel_org THEN RAISE EXCEPTION 'TENANT_MISMATCH: hotel access across organizations'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "departmentId" ON "Asset" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('departmentId', 'Department');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "departmentId", "warehouseId" ON "BuffetSession" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('departmentId', 'Department', 'warehouseId', 'Warehouse');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "departmentId", "parentId" ON "CostCenter" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('departmentId', 'Department', 'parentId', 'CostCenter');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "periodId" ON "CostSnapshot" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('periodId', 'CostPeriod');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "costCenterId", "departmentId", "periodId", "stockTxId" ON "CostTransaction" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('costCenterId', 'CostCenter', 'departmentId', 'Department', 'periodId', 'CostPeriod', 'stockTxId', 'StockTransaction');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "parentId" ON "Department" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('parentId', 'Department');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "departmentId" ON "Employee" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('departmentId', 'Department');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "assetId", "departmentId", "importId", "roomId" ON "Expense" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('assetId', 'Asset', 'departmentId', 'Department', 'importId', 'ImportBatch', 'roomId', 'Room');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "productId", "warehouseId" ON "FifoLayer" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('productId', 'Product', 'warehouseId', 'Warehouse');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "orderId", "supplierId", "warehouseId" ON "GoodsReceipt" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('orderId', 'PurchaseOrder', 'supplierId', 'Supplier', 'warehouseId', 'Warehouse');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "supplierId" ON "Invoice" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('supplierId', 'Supplier');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "departmentId" ON "Meter" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('departmentId', 'Department');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "productId", "roomId" ON "MinibarMovement" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('productId', 'Product', 'roomId', 'Room');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "productId", "roomId" ON "MinibarPar" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('productId', 'Product', 'roomId', 'Room');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "importId" ON "OccupancyImport" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('importId', 'ImportBatch');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "categoryId", "defaultSupplierId" ON "Product" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('categoryId', 'ProductCategory', 'defaultSupplierId', 'Supplier');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "parentId" ON "ProductCategory" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('parentId', 'ProductCategory');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "supplierId" ON "PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('supplierId', 'Supplier');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "departmentId", "outputProductId" ON "Recipe" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('departmentId', 'Department', 'outputProductId', 'Product');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "importId", "roomId" ON "Reservation" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('importId', 'ImportBatch', 'roomId', 'Room');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "departmentId", "importId", "recipeId" ON "SaleLine" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('departmentId', 'Department', 'importId', 'SalesImport', 'recipeId', 'Recipe');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "productId", "warehouseId" ON "StockBalance" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('productId', 'Product', 'warehouseId', 'Warehouse');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "warehouseId" ON "StockCount" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('warehouseId', 'Warehouse');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "departmentId", "periodId", "productId", "reversesId", "warehouseId" ON "StockTransaction" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('departmentId', 'Department', 'periodId', 'CostPeriod', 'productId', 'Product', 'reversesId', 'StockTransaction', 'warehouseId', 'Warehouse');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "productId", "supplierId" ON "SupplierPrice" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('productId', 'Product', 'supplierId', 'Supplier');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "departmentId" ON "Warehouse" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('departmentId', 'Department');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "departmentId", "productId", "warehouseId" ON "WasteRecord" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('departmentId', 'Department', 'productId', 'Product', 'warehouseId', 'Warehouse');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "hotelId", "productId" ON "YieldRecord" FOR EACH ROW EXECUTE FUNCTION hc_same_hotel('productId', 'Product');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "sessionId", "productId", "recipeId" ON "BuffetLine" FOR EACH ROW EXECUTE FUNCTION hc_child_same_hotel('sessionId', 'BuffetSession', 'productId', 'Product', 'recipeId', 'Recipe');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "receiptId", "productId" ON "GoodsReceiptItem" FOR EACH ROW EXECUTE FUNCTION hc_child_same_hotel('receiptId', 'GoodsReceipt', 'productId', 'Product');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "invoiceId", "productId" ON "InvoiceItem" FOR EACH ROW EXECUTE FUNCTION hc_child_same_hotel('invoiceId', 'Invoice', 'productId', 'Product');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "orderId", "productId" ON "PurchaseOrderItem" FOR EACH ROW EXECUTE FUNCTION hc_child_same_hotel('orderId', 'PurchaseOrder', 'productId', 'Product');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "requestId", "productId" ON "PurchaseRequestItem" FOR EACH ROW EXECUTE FUNCTION hc_child_same_hotel('requestId', 'PurchaseRequest', 'productId', 'Product');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "countId", "productId" ON "StockCountLine" FOR EACH ROW EXECUTE FUNCTION hc_child_same_hotel('countId', 'StockCount', 'productId', 'Product');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "budgetId", "departmentId" ON "BudgetLine" FOR EACH ROW EXECUTE FUNCTION hc_child_same_hotel('budgetId', 'Budget', 'departmentId', 'Department');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "layerId", "txId" ON "FifoConsumption" FOR EACH ROW EXECUTE FUNCTION hc_child_same_hotel('layerId', 'FifoLayer', 'txId', 'StockTransaction');
CREATE TRIGGER hc_same_hotel BEFORE INSERT OR UPDATE OF "versionId", "productId", "subRecipeId" ON "RecipeIngredient" FOR EACH ROW EXECUTE FUNCTION hc_recipe_line_same_hotel();
CREATE TRIGGER hc_same_org BEFORE INSERT OR UPDATE ON "UserDepartmentAccess" FOR EACH ROW EXECUTE FUNCTION hc_dept_access_same_org();
CREATE TRIGGER hc_same_org BEFORE INSERT OR UPDATE ON "UserHotelAccess" FOR EACH ROW EXECUTE FUNCTION hc_hotel_access_same_org();
