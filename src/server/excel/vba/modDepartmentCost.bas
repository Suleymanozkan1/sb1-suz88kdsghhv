'==============================================================================
' modDepartmentCost :: Department, outlet, cost center, allocation, budget, forecast, saving, missing data
' By design the cost calculations for this area run on the HotelCost server (one
' cost engine shared with the web application, spec 149). This module only lists
' the datasets of its area so modReport writes them in a predictable order.
'==============================================================================
Option Explicit

Public Function DepartmentSections() As Variant
    DepartmentSections = Array("departmentCost", "outletCost", "costCenter", "costAllocation", "budgetVariance", "forecast", "costSaving", "menuEngineering", "missingData", "rawSales")
End Function
