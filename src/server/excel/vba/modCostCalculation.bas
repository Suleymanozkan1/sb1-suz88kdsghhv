'==============================================================================
' modCostCalculation :: Executive summary, cost detail, food/beverage cost, theoretical vs actual, unexplained variance, trends, P&L
' By design the cost calculations for this area run on the HotelCost server (one
' cost engine shared with the web application, spec 149). This module only lists
' the datasets of its area so modReport writes them in a predictable order.
'==============================================================================
Option Explicit

Public Function CostSections() As Variant
    CostSections = Array("costDetail", "executiveSummary", "monthlySummary", "foodCost", "beverageCost", "consumptionVariance", "unexplainedVariance", "theoreticalConsumption", "actualConsumption", "productSales", "topVariance", "topCostDrivers", "costTrend", "priceTrend", "pnl")
End Function
