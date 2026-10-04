'==============================================================================
' modBuffet :: Buffet cost (module NOT_AVAILABLE until Phase 2; headers only)
' By design the cost calculations for this area run on the HotelCost server (one
' cost engine shared with the web application, spec 149). This module only lists
' the datasets of its area so modReport writes them in a predictable order.
'==============================================================================
Option Explicit

Public Function BuffetSections() As Variant
    BuffetSections = Array("buffetCost", "buffetSummary", "buffetProduct")
End Function
