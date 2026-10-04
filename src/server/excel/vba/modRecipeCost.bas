'==============================================================================
' modRecipeCost :: Recipe cost explosion, recipe summary, recipe trend, yield, portion control
' By design the cost calculations for this area run on the HotelCost server (one
' cost engine shared with the web application, spec 149). This module only lists
' the datasets of its area so modReport writes them in a predictable order.
'==============================================================================
Option Explicit

Public Function RecipeSections() As Variant
    RecipeSections = Array("recipeSummary", "recipeCost", "recipeTrend", "yield", "portionVariance")
End Function
