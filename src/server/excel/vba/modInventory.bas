'==============================================================================
' modInventory :: Inventory value, monthly stock, counts, critical/aging stock, reorder, purchasing, supplier prices, PPV, raw ledger
' By design the cost calculations for this area run on the HotelCost server (one
' cost engine shared with the web application, spec 149). This module only lists
' the datasets of its area so modReport writes them in a predictable order.
'==============================================================================
Option Explicit

Public Function InventorySections() As Variant
    InventorySections = Array("inventoryValue", "monthlyStock", "stockVariance", "criticalStock", "stockAging", "reorder", "purchaseCost", "supplierPrice", "ppv", "rawProducts", "rawStockTransactions")
End Function
