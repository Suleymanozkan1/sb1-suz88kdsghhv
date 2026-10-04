'==============================================================================
' modRoomCost :: Room, housekeeping, laundry, labor, energy, engineering (NOT_AVAILABLE until Phase 3)
' By design the cost calculations for this area run on the HotelCost server (one
' cost engine shared with the web application, spec 149). This module only lists
' the datasets of its area so modReport writes them in a predictable order.
'==============================================================================
Option Explicit

Public Function RoomSections() As Variant
    RoomSections = Array("roomCost", "roomTypeCost", "housekeepingCost", "laundryCost", "laborCost", "energyCost", "engineeringCost")
End Function
