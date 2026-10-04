'==============================================================================
' modPivot :: rebuilds the pivot tables on 55_PIVOTS from the report tables.
'==============================================================================
Option Explicit

Private Const XL_DATABASE As Long = 1
Private Const XL_ROW_FIELD As Long = 1
Private Const XL_SUM As Long = -4157
Private Const PIVOT_SHEET As String = "55_PIVOTS"

Public Sub RefreshPivots()
    Dim ws As Worksheet
    Dim pt As PivotTable
    Set ws = ThisWorkbook.Worksheets(PIVOT_SHEET)
    For Each pt In ws.PivotTables
        pt.TableRange2.Clear
    Next pt
    ws.Range("A6:AZ2000").Clear
    MakePivot ws, "tbl_costDetail", ws.Range("A8"), "pvtDepartmentCost", "Department", "Total Cost", "Department Cost"
    MakePivot ws, "tbl_costDetail", ws.Range("E8"), "pvtCategoryCost", "Category", "Total Cost", "Category Cost"
    MakePivot ws, "tbl_costDetail", ws.Range("I8"), "pvtSupplierCost", "Supplier", "Total Cost", "Supplier Cost"
    MakePivot ws, "tbl_costDetail", ws.Range("M8"), "pvtProductCost", "Product", "Total Cost", "Product Cost"
    MakePivot ws, "tbl_waste", ws.Range("Q8"), "pvtWaste", "Waste Type", "Waste Cost", "Waste by Type"
    MakePivot ws, "tbl_inventoryValue", ws.Range("U8"), "pvtStock", "Category", "Stock Value", "Stock Value by Category"
    MakePivot ws, "tbl_recipeSummary", ws.Range("Y8"), "pvtRecipeCost", "Type", "Total Cost / Batch", "Recipe Cost by Type"
    MakePivot ws, "tbl_buffetCost", ws.Range("AC8"), "pvtBuffetCost", "Meal", "Food Cost", "Buffet Cost by Meal"
    MakePivot ws, "tbl_minibarCost", ws.Range("AG8"), "pvtMinibarCost", "Room", "Cost", "Minibar Cost by Room"
    ws.Range("AK7").Value = "Room cost pivot: module not yet available (NOT_AVAILABLE)."
    ws.Range("AK7").Font.Italic = True
End Sub

Private Sub MakePivot(ByVal ws As Worksheet, ByVal src As String, ByVal dest As Range, ByVal pivotName As String, _
                      ByVal rowField As String, ByVal dataField As String, ByVal title As String)
    Dim lo As ListObject
    Dim pc As PivotCache
    Dim pt As PivotTable
    On Error GoTo Fail
    Set lo = FindTable(src)
    If lo Is Nothing Then Exit Sub
    dest.Offset(-1, 0).Value = title
    dest.Offset(-1, 0).Font.Bold = True
    Set pc = ThisWorkbook.PivotCaches.Create(SourceType:=XL_DATABASE, SourceData:=src)
    Set pt = pc.CreatePivotTable(TableDestination:=dest, TableName:=pivotName)
    pt.PivotFields(rowField).Orientation = XL_ROW_FIELD
    pt.AddDataField pt.PivotFields(dataField), "Sum of " & dataField, XL_SUM
    pt.DataBodyRange.NumberFormat = "#,##0.00"
    pt.RefreshTable
    Exit Sub
Fail:
    LogError "modPivot", pivotName, "PIVOT", Err.Number & ": " & Err.Description, "WARNING"
End Sub
