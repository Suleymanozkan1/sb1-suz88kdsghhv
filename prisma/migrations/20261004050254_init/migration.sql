-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'SOFT_CLOSED', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "UnitDimension" AS ENUM ('MASS', 'VOLUME', 'COUNT', 'LENGTH', 'TIME');

-- CreateEnum
CREATE TYPE "CostingMethod" AS ENUM ('WEIGHTED_AVERAGE', 'FIFO', 'STANDARD', 'LAST_PURCHASE', 'CONTRACT');

-- CreateEnum
CREATE TYPE "StockTxType" AS ENUM ('OPENING', 'PURCHASE', 'TRANSFER_IN', 'TRANSFER_OUT', 'CONSUMPTION', 'WASTE', 'PRODUCTION_IN', 'PRODUCTION_OUT', 'RETURN', 'ADJUSTMENT', 'COUNT_ADJUSTMENT', 'STAFF_MEAL', 'COMPLIMENTARY', 'REVERSAL');

-- CreateEnum
CREATE TYPE "CostNature" AS ENUM ('DIRECT', 'ALLOCATED');

-- CreateEnum
CREATE TYPE "CostType" AS ENUM ('DIRECT', 'INDIRECT', 'FIXED', 'VARIABLE', 'SEMI_VARIABLE', 'OPERATING', 'NON_OPERATING', 'CAPEX', 'OPEX');

-- CreateEnum
CREATE TYPE "RecipeType" AS ENUM ('RESTAURANT', 'CAFE', 'BAR', 'BREAKFAST', 'PASTRY', 'BANQUET', 'ROOM_SERVICE', 'MINIBAR', 'STAFF_MEAL', 'COMPLIMENTARY', 'PRODUCTION', 'SEMI_FINISHED');

-- CreateEnum
CREATE TYPE "RecipeVersionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WasteType" AS ENUM ('EXPIRED', 'SPOILED', 'DAMAGED', 'BROKEN', 'BURNED', 'OVERCOOKED', 'PREPARATION', 'TRIMMING', 'PEELING', 'OVERPRODUCTION', 'BUFFET_LEFTOVER', 'PLATE_WASTE', 'RETURNED_FOOD', 'DROPPED', 'SPILLED', 'STORAGE_DAMAGE', 'TEMPERATURE_LOSS', 'QUALITY_REJECTION', 'UNKNOWN', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('STOCK_DELETE', 'STOCK_ADJUSTMENT', 'WASTE', 'COST_OVERRIDE', 'RECIPE_APPROVAL', 'PERIOD_REOPEN', 'SUPPLIER_COST_OVERRIDE');

-- CreateEnum
CREATE TYPE "POStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "LandedAllocationMethod" AS ENUM ('BY_VALUE', 'BY_QUANTITY', 'BY_WEIGHT', 'MANUAL');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('CRITICAL_STOCK', 'EXPIRED_STOCK', 'UNEXPLAINED_VARIANCE', 'HIGH_WASTE', 'HIGH_RECIPE_COST', 'LOW_MARGIN', 'PRICE_INCREASE', 'YIELD_DETERIORATION', 'OVER_PORTIONING', 'OVERSTOCK', 'DEAD_STOCK', 'BUDGET_OVERRUN', 'MISSING_RECIPE', 'MISSING_COST', 'MISSING_STOCK_COUNT', 'SUPPLIER_PRICE_ANOMALY');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED');

-- CreateEnum
CREATE TYPE "CalcStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'PENDING_REPROCESS');

-- CreateEnum
CREATE TYPE "DataOrigin" AS ENUM ('ACTUAL', 'THEORETICAL', 'ESTIMATED', 'FORECAST', 'IMPORTED', 'MANUAL');

-- CreateEnum
CREATE TYPE "CostCenterKind" AS ENUM ('HOTEL', 'DEPARTMENT', 'SUBDEPARTMENT', 'OUTLET', 'KITCHEN', 'WAREHOUSE', 'ROOM', 'FLOOR', 'SERVICE_POINT', 'COST_CENTER');

-- CreateEnum
CREATE TYPE "BuffetType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'ALL_INCLUSIVE', 'SPECIAL_EVENT', 'BANQUET', 'THEME_NIGHT', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "LeftoverClass" AS ENUM ('SAFE_REUSE', 'MUST_DISCARD', 'RETURNED_TO_KITCHEN', 'REFRIGERATED', 'STAFF_MEAL', 'WASTE');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hotel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'TRY',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "totalRooms" INTEGER NOT NULL DEFAULT 0,
    "priceAlertPct" DECIMAL(20,6) NOT NULL DEFAULT 10,
    "wasteApprovalValue" DECIMAL(20,6) NOT NULL DEFAULT 1000,
    "adjustmentApprovalValue" DECIMAL(20,6) NOT NULL DEFAULT 1000,
    "marginTargetPct" DECIMAL(20,6) NOT NULL DEFAULT 65,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hotel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isOutlet" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "departmentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CostCenterKind" NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Currency" (
    "code" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "quoteCode" TEXT NOT NULL,
    "rate" DECIMAL(20,8) NOT NULL,
    "rateDate" DATE NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "allDepartments" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[],

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserHotelAccess" (
    "userId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,

    CONSTRAINT "UserHotelAccess_pkey" PRIMARY KEY ("userId","hotelId")
);

-- CreateTable
CREATE TABLE "UserDepartmentAccess" (
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,

    CONSTRAINT "UserDepartmentAccess_pkey" PRIMARY KEY ("userId","departmentId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostPeriod" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,

    CONSTRAINT "CostPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dimension" "UnitDimension" NOT NULL,
    "toBase" DECIMAL(20,9),

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitConversion" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fromUnit" TEXT NOT NULL,
    "toUnit" TEXT NOT NULL,
    "factor" DECIMAL(20,9) NOT NULL,
    "note" TEXT,

    CONSTRAINT "UnitConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "group" TEXT NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "barcode" TEXT,
    "brand" TEXT,
    "categoryId" TEXT NOT NULL,
    "defaultSupplierId" TEXT,
    "purchaseUnit" TEXT NOT NULL,
    "stockUnit" TEXT NOT NULL,
    "recipeUnit" TEXT NOT NULL,
    "taxRatePct" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "costingMethod" "CostingMethod" NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
    "standardCost" DECIMAL(20,6),
    "minStock" DECIMAL(20,6),
    "maxStock" DECIMAL(20,6),
    "reorderPoint" DECIMAL(20,6),
    "safetyStock" DECIMAL(20,6),
    "leadTimeDays" INTEGER,
    "shelfLifeDays" INTEGER,
    "yieldPct" DECIMAL(20,6) NOT NULL DEFAULT 100,
    "isStockItem" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxNumber" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "leadTimeDays" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPrice" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "priceDate" TIMESTAMP(3) NOT NULL,
    "purchaseUnit" TEXT NOT NULL,
    "packPrice" DECIMAL(20,6) NOT NULL,
    "unitPrice" DECIMAL(20,6) NOT NULL,
    "previousUnitPrice" DECIMAL(20,6),
    "changePct" DECIMAL(20,6),
    "quantity" DECIMAL(20,6),
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "invoiceNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedById" TEXT NOT NULL,
    "departmentId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "PurchaseRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "POStatus" NOT NULL DEFAULT 'DRAFT',
    "orderDate" TIMESTAMP(3) NOT NULL,
    "expectedDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(20,6) NOT NULL,
    "receivedQty" DECIMAL(20,6) NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "orderId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "invoiceNo" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "exchangeRate" DECIMAL(20,8) NOT NULL DEFAULT 1,
    "freight" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "shipping" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "customs" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "handling" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "otherCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "allocationMethod" "LandedAllocationMethod" NOT NULL DEFAULT 'BY_VALUE',
    "netTotal" DECIMAL(20,6) NOT NULL,
    "taxTotal" DECIMAL(20,6) NOT NULL,
    "landedTotal" DECIMAL(20,6) NOT NULL,
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT NOT NULL,
    "idempotencyKey" TEXT,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptItem" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "poItemId" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "stockQty" DECIMAL(20,6) NOT NULL,
    "unitPrice" DECIMAL(20,6) NOT NULL,
    "discount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "taxRatePct" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(20,6) NOT NULL,
    "taxAmount" DECIMAL(20,6) NOT NULL,
    "landedExtra" DECIMAL(20,6) NOT NULL,
    "landedAmount" DECIMAL(20,6) NOT NULL,
    "landedUnitCost" DECIMAL(20,6) NOT NULL,
    "manualAllocation" DECIMAL(20,6),
    "weight" DECIMAL(20,6),
    "expiryDate" TIMESTAMP(3),
    "lotNo" TEXT,

    CONSTRAINT "GoodsReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "netTotal" DECIMAL(20,6) NOT NULL,
    "taxTotal" DECIMAL(20,6) NOT NULL,
    "grossTotal" DECIMAL(20,6) NOT NULL,
    "receiptIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(20,6) NOT NULL,
    "taxRatePct" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(20,6) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "departmentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransaction" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "departmentId" TEXT,
    "productId" TEXT NOT NULL,
    "type" "StockTxType" NOT NULL,
    "txDate" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unitCost" DECIMAL(20,6) NOT NULL,
    "totalCost" DECIMAL(20,6) NOT NULL,
    "balanceQtyAfter" DECIMAL(20,6) NOT NULL,
    "balanceValueAfter" DECIMAL(20,6) NOT NULL,
    "avgCostAfter" DECIMAL(20,6) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "reversesId" TEXT,
    "transferGroup" TEXT,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "origin" "DataOrigin" NOT NULL DEFAULT 'ACTUAL',
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "value" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "avgCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "lastTxAt" TIMESTAMP(3),
    "lastCountAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FifoLayer" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceTxId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "originalQty" DECIMAL(20,6) NOT NULL,
    "remainingQty" DECIMAL(20,6) NOT NULL,
    "unitCost" DECIMAL(20,6) NOT NULL,
    "expiryDate" TIMESTAMP(3),

    CONSTRAINT "FifoLayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FifoConsumption" (
    "id" TEXT NOT NULL,
    "layerId" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unitCost" DECIMAL(20,6) NOT NULL,

    CONSTRAINT "FifoConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "countDate" TIMESTAMP(3) NOT NULL,
    "status" "CountStatus" NOT NULL DEFAULT 'DRAFT',
    "countedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "systemQty" DECIMAL(20,6) NOT NULL,
    "countedQty" DECIMAL(20,6) NOT NULL,
    "varianceQty" DECIMAL(20,6) NOT NULL,
    "unitCost" DECIMAL(20,6) NOT NULL,
    "varianceValue" DECIMAL(20,6) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostTransaction" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "txDate" TIMESTAMP(3) NOT NULL,
    "departmentId" TEXT,
    "costCenterId" TEXT,
    "categoryGroup" TEXT NOT NULL,
    "categoryId" TEXT,
    "costType" "CostType" NOT NULL DEFAULT 'VARIABLE',
    "nature" "CostNature" NOT NULL DEFAULT 'DIRECT',
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "quantity" DECIMAL(20,6),
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "productId" TEXT,
    "recipeId" TEXT,
    "stockTxId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "reversesId" TEXT,
    "userId" TEXT NOT NULL,
    "origin" "DataOrigin" NOT NULL DEFAULT 'ACTUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostSnapshot" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "dataVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalculationRun" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodId" TEXT,
    "status" "CalcStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "userId" TEXT NOT NULL,
    "details" JSONB,

    CONSTRAINT "CalculationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "departmentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "RecipeType" NOT NULL,
    "outputProductId" TEXT,
    "posCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeVersion" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RecipeVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "batchYieldQty" DECIMAL(20,6) NOT NULL,
    "yieldUnit" TEXT NOT NULL,
    "portions" DECIMAL(20,6) NOT NULL,
    "portionSize" DECIMAL(20,6),
    "portionUnit" TEXT,
    "sellingPrice" DECIMAL(20,6),
    "packagingCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "laborCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "energyCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "otherCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "productionLossPct" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "costSnapshot" JSONB,
    "batchCost" DECIMAL(20,6),
    "ingredientCost" DECIMAL(20,6),
    "portionCost" DECIMAL(20,6),

    CONSTRAINT "RecipeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeIngredient" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "subRecipeId" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "yieldPct" DECIMAL(20,6),
    "wastePct" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "RecipeIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesImport" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fileName" TEXT,
    "fileHash" TEXT,
    "mappingVersion" TEXT,
    "importedById" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "importId" TEXT,
    "sourceRow" INTEGER,
    "externalId" TEXT NOT NULL,
    "saleDate" TIMESTAMP(3) NOT NULL,
    "departmentId" TEXT NOT NULL,
    "recipeId" TEXT,
    "recipeVersionId" TEXT,
    "posCode" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "netRevenue" DECIMAL(20,6) NOT NULL,
    "theoreticalUnitCost" DECIMAL(20,6),
    "theoreticalCost" DECIMAL(20,6),
    "consumptionPosted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YieldRecord" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "recordDate" TIMESTAMP(3) NOT NULL,
    "apQty" DECIMAL(20,6) NOT NULL,
    "trimQty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "prepLossQty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "cookingLossQty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "epQty" DECIMAL(20,6) NOT NULL,
    "yieldPct" DECIMAL(20,6) NOT NULL,
    "expectedYieldPct" DECIMAL(20,6) NOT NULL,
    "unitCost" DECIMAL(20,6) NOT NULL,
    "varianceCost" DECIMAL(20,6) NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "YieldRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WasteRecord" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "wasteType" "WasteType" NOT NULL,
    "wasteDate" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "stockQty" DECIMAL(20,6) NOT NULL,
    "unitCost" DECIMAL(20,6),
    "costValue" DECIMAL(20,6),
    "reason" TEXT,
    "notes" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "userId" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "stockTxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WasteRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionBatch" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "recipeVersionId" TEXT NOT NULL,
    "productionDate" TIMESTAMP(3) NOT NULL,
    "operatorId" TEXT NOT NULL,
    "plannedQty" DECIMAL(20,6) NOT NULL,
    "outputQty" DECIMAL(20,6) NOT NULL,
    "inputCost" DECIMAL(20,6) NOT NULL,
    "outputUnitCost" DECIMAL(20,6) NOT NULL,
    "lossQty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'POSTED',

    CONSTRAINT "ProductionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "payload" JSONB,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "resultRef" TEXT,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "source" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "data" JSONB,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "roomType" TEXT NOT NULL,
    "floor" TEXT,
    "area" TEXT,
    "sqm" DECIMAL(20,6),

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuffetSession" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "type" "BuffetType" NOT NULL,
    "serviceDate" DATE NOT NULL,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "expectedCovers" INTEGER,
    "actualCovers" INTEGER,
    "boardBasis" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "BuffetSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuffetLine" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "productId" TEXT,
    "recipeId" TEXT,
    "category" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitCost" DECIMAL(20,6),
    "leftoverClass" "LeftoverClass",
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuffetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "departmentId" TEXT,
    "costCenterId" TEXT,
    "categoryGroup" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "taxAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "costType" "CostType" NOT NULL DEFAULT 'OPEX',
    "source" TEXT NOT NULL,
    "externalId" TEXT,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostAllocationRule" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceCategoryGroup" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "targets" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CostAllocationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "departmentId" TEXT,
    "categoryGroup" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "targetPct" DECIMAL(20,6),

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OccupancyImport" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "availableRooms" INTEGER NOT NULL,
    "occupiedRooms" INTEGER NOT NULL,
    "guests" INTEGER NOT NULL,
    "roomRevenue" DECIMAL(20,6) NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "OccupancyImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "periodId" TEXT,
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataVersion" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Hotel_organizationId_code_key" ON "Hotel"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Department_hotelId_code_key" ON "Department"("hotelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_hotelId_code_key" ON "CostCenter"("hotelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_currencyCode_quoteCode_rateDate_key" ON "ExchangeRate"("currencyCode", "quoteCode", "rateDate");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_organizationId_key_key" ON "Role"("organizationId", "key");

-- CreateIndex
CREATE INDEX "CostPeriod_hotelId_startDate_endDate_idx" ON "CostPeriod"("hotelId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "CostPeriod_hotelId_code_key" ON "CostPeriod"("hotelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_code_key" ON "Unit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "UnitConversion_productId_fromUnit_toUnit_key" ON "UnitConversion"("productId", "fromUnit", "toUnit");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_hotelId_code_key" ON "ProductCategory"("hotelId", "code");

-- CreateIndex
CREATE INDEX "Product_hotelId_name_idx" ON "Product"("hotelId", "name");

-- CreateIndex
CREATE INDEX "Product_hotelId_barcode_idx" ON "Product"("hotelId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Product_hotelId_sku_key" ON "Product"("hotelId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_hotelId_code_key" ON "Supplier"("hotelId", "code");

-- CreateIndex
CREATE INDEX "SupplierPrice_hotelId_productId_priceDate_idx" ON "SupplierPrice"("hotelId", "productId", "priceDate");

-- CreateIndex
CREATE INDEX "SupplierPrice_supplierId_productId_priceDate_idx" ON "SupplierPrice"("supplierId", "productId", "priceDate");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_hotelId_number_key" ON "PurchaseRequest"("hotelId", "number");

-- CreateIndex
CREATE INDEX "PurchaseOrder_hotelId_status_idx" ON "PurchaseOrder"("hotelId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_hotelId_number_key" ON "PurchaseOrder"("hotelId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_idempotencyKey_key" ON "GoodsReceipt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GoodsReceipt_hotelId_receiptDate_idx" ON "GoodsReceipt"("hotelId", "receiptDate");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_hotelId_number_key" ON "GoodsReceipt"("hotelId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_hotelId_supplierId_number_key" ON "Invoice"("hotelId", "supplierId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_hotelId_code_key" ON "Warehouse"("hotelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransaction_reversesId_key" ON "StockTransaction"("reversesId");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransaction_idempotencyKey_key" ON "StockTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StockTransaction_hotelId_productId_txDate_idx" ON "StockTransaction"("hotelId", "productId", "txDate");

-- CreateIndex
CREATE INDEX "StockTransaction_hotelId_periodId_type_idx" ON "StockTransaction"("hotelId", "periodId", "type");

-- CreateIndex
CREATE INDEX "StockTransaction_warehouseId_productId_txDate_idx" ON "StockTransaction"("warehouseId", "productId", "txDate");

-- CreateIndex
CREATE INDEX "StockTransaction_sourceType_sourceId_idx" ON "StockTransaction"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "StockBalance_hotelId_productId_idx" ON "StockBalance"("hotelId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_warehouseId_productId_key" ON "StockBalance"("warehouseId", "productId");

-- CreateIndex
CREATE INDEX "FifoLayer_warehouseId_productId_receivedAt_idx" ON "FifoLayer"("warehouseId", "productId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_hotelId_number_key" ON "StockCount"("hotelId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "CostTransaction_reversesId_key" ON "CostTransaction"("reversesId");

-- CreateIndex
CREATE INDEX "CostTransaction_hotelId_periodId_kind_idx" ON "CostTransaction"("hotelId", "periodId", "kind");

-- CreateIndex
CREATE INDEX "CostTransaction_hotelId_departmentId_txDate_idx" ON "CostTransaction"("hotelId", "departmentId", "txDate");

-- CreateIndex
CREATE INDEX "CostSnapshot_hotelId_periodId_kind_idx" ON "CostSnapshot"("hotelId", "periodId", "kind");

-- CreateIndex
CREATE INDEX "Recipe_hotelId_posCode_idx" ON "Recipe"("hotelId", "posCode");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_hotelId_code_key" ON "Recipe"("hotelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeVersion_recipeId_version_key" ON "RecipeVersion"("recipeId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SalesImport_hotelId_fileHash_key" ON "SalesImport"("hotelId", "fileHash");

-- CreateIndex
CREATE INDEX "SaleLine_hotelId_saleDate_idx" ON "SaleLine"("hotelId", "saleDate");

-- CreateIndex
CREATE INDEX "SaleLine_hotelId_departmentId_saleDate_idx" ON "SaleLine"("hotelId", "departmentId", "saleDate");

-- CreateIndex
CREATE UNIQUE INDEX "SaleLine_hotelId_externalId_key" ON "SaleLine"("hotelId", "externalId");

-- CreateIndex
CREATE INDEX "WasteRecord_hotelId_wasteDate_idx" ON "WasteRecord"("hotelId", "wasteDate");

-- CreateIndex
CREATE INDEX "WasteRecord_hotelId_departmentId_wasteDate_idx" ON "WasteRecord"("hotelId", "departmentId", "wasteDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatch_hotelId_batchNo_key" ON "ProductionBatch"("hotelId", "batchNo");

-- CreateIndex
CREATE INDEX "Approval_hotelId_status_idx" ON "Approval"("hotelId", "status");

-- CreateIndex
CREATE INDEX "Approval_entityType_entityId_idx" ON "Approval"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_hotelId_createdAt_idx" ON "AuditLog"("hotelId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Alert_hotelId_acknowledged_createdAt_idx" ON "Alert"("hotelId", "acknowledged", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Room_hotelId_number_key" ON "Room"("hotelId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_hotelId_source_externalId_key" ON "Expense"("hotelId", "source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_hotelId_year_name_key" ON "Budget"("hotelId", "year", "name");

-- CreateIndex
CREATE UNIQUE INDEX "OccupancyImport_hotelId_businessDate_key" ON "OccupancyImport"("hotelId", "businessDate");

-- AddForeignKey
ALTER TABLE "Hotel" ADD CONSTRAINT "Hotel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Currency" ADD CONSTRAINT "Currency_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHotelAccess" ADD CONSTRAINT "UserHotelAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHotelAccess" ADD CONSTRAINT "UserHotelAccess_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDepartmentAccess" ADD CONSTRAINT "UserDepartmentAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDepartmentAccess" ADD CONSTRAINT "UserDepartmentAccess_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostPeriod" ADD CONSTRAINT "CostPeriod_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_defaultSupplierId_fkey" FOREIGN KEY ("defaultSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPrice" ADD CONSTRAINT "SupplierPrice_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPrice" ADD CONSTRAINT "SupplierPrice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPrice" ADD CONSTRAINT "SupplierPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestItem" ADD CONSTRAINT "PurchaseRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestItem" ADD CONSTRAINT "PurchaseRequestItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "CostPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "StockTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FifoLayer" ADD CONSTRAINT "FifoLayer_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FifoLayer" ADD CONSTRAINT "FifoLayer_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FifoLayer" ADD CONSTRAINT "FifoLayer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FifoConsumption" ADD CONSTRAINT "FifoConsumption_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "FifoLayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FifoConsumption" ADD CONSTRAINT "FifoConsumption_txId_fkey" FOREIGN KEY ("txId") REFERENCES "StockTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostTransaction" ADD CONSTRAINT "CostTransaction_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostTransaction" ADD CONSTRAINT "CostTransaction_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "CostPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostTransaction" ADD CONSTRAINT "CostTransaction_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostTransaction" ADD CONSTRAINT "CostTransaction_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostTransaction" ADD CONSTRAINT "CostTransaction_stockTxId_fkey" FOREIGN KEY ("stockTxId") REFERENCES "StockTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostSnapshot" ADD CONSTRAINT "CostSnapshot_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostSnapshot" ADD CONSTRAINT "CostSnapshot_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "CostPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationRun" ADD CONSTRAINT "CalculationRun_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_outputProductId_fkey" FOREIGN KEY ("outputProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeVersion" ADD CONSTRAINT "RecipeVersion_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RecipeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_subRecipeId_fkey" FOREIGN KEY ("subRecipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesImport" ADD CONSTRAINT "SalesImport_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SalesImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_recipeVersionId_fkey" FOREIGN KEY ("recipeVersionId") REFERENCES "RecipeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YieldRecord" ADD CONSTRAINT "YieldRecord_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YieldRecord" ADD CONSTRAINT "YieldRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteRecord" ADD CONSTRAINT "WasteRecord_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteRecord" ADD CONSTRAINT "WasteRecord_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteRecord" ADD CONSTRAINT "WasteRecord_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteRecord" ADD CONSTRAINT "WasteRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuffetSession" ADD CONSTRAINT "BuffetSession_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuffetLine" ADD CONSTRAINT "BuffetLine_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BuffetSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocationRule" ADD CONSTRAINT "CostAllocationRule_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccupancyImport" ADD CONSTRAINT "OccupancyImport_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
