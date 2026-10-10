'==============================================================================
' modRoomCost :: Room, housekeeping, laundry, labor, energy, engineering (server-calculated, Phase 3)
' By design the cost calculations for this area run on the HotelCost server (one
' cost engine shared with the web application, spec 149). This module only lists
' the datasets of its area so modReport writes them in a predictable order.
'==============================================================================
Option Explicit

Public Function RoomSections() As Variant
    RoomSections = Array("roomCost", "roomTypeCost", "roomFloorCost", "housekeepingCost", "laundryCost", "linenCost", "laborCost", "energyCost", "meterReadings", "engineeringCost", "assetCost")
End Function
