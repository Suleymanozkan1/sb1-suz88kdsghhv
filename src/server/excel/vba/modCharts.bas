'==============================================================================
' modCharts :: rebuilds dashboard charts on 50_DASHBOARD_CHARTS from report tables.
'==============================================================================
Option Explicit

Private Const XL_LINE As Long = 4
Private Const XL_COLUMN_CLUSTERED As Long = 51
Private Const XL_BAR_CLUSTERED As Long = 57
Private Const W As Double = 470
Private Const H As Double = 260

Public Sub RefreshCharts()
    Dim ws As Worksheet
    Dim i As Long
    Set ws = ThisWorkbook.Worksheets(S("50_DASHBOARD_CHARTS"))
    For i = ws.ChartObjects.Count To 1 Step -1
        ws.ChartObjects(i).Delete
    Next i
    For i = ws.Shapes.Count To 1 Step -1
        If Left$(ws.Shapes(i).Name, 4) = "txt_" Then ws.Shapes(i).Delete
    Next i
    LineChart ws, L("Cost Trend (actual vs theoretical)"), "tbl_costTrend", H("Month"), Array(H("Actual Cost"), H("Theoretical Cost")), 10, 60, False
    LineChart ws, L("Food Cost % Trend"), "tbl_costTrend", H("Month"), Array(H("Actual Cost %"), H("Theoretical Cost %")), 10 + W + 20, 60, True
    LineChart ws, L("Waste % Trend"), "tbl_costTrend", H("Month"), Array(H("Waste %")), 10, 60 + H + 20, True
    LineChart ws, L("Stock Value (month end)"), "tbl_costTrend", H("Month"), Array(H("Stock Value (month end)")), 10 + W + 20, 60 + H + 20, False
    BarChart ws, L("Department Cost"), "tbl_departmentCost", H("Department"), H("Total Cost"), 10, 60 + 2 * (H + 20), 15
    BarChart ws, L("Top Cost Drivers (PPV)"), "tbl_topCostDrivers", H("Product"), H("Cost Increase (PPV)"), 10 + W + 20, 60 + 2 * (H + 20), 10
    BarChart ws, L("Top Waste Products"), "tbl_topWaste", H("Product"), H("Waste Cost"), 10, 60 + 3 * (H + 20), 10
    PriceTrendChart ws, 10 + W + 20, 60 + 3 * (H + 20)
    NotAvailable ws, L("Room Cost / Occupied Night"), 10, 60 + 4 * (H + 20)
    LineChart ws, L("Buffet Cost / Cover"), "tbl_buffetCost", H("Date"), Array(H("Cost / Cover"), H("Waste / Cover")), 10 + W + 20, 60 + 4 * (H + 20), False
End Sub

Private Function HasData(ByVal lo As ListObject) As Boolean
    HasData = False
    If lo Is Nothing Then Exit Function
    If lo.DataBodyRange Is Nothing Then Exit Function
    HasData = Application.WorksheetFunction.CountA(lo.DataBodyRange) > 0
End Function

Private Sub LineChart(ByVal ws As Worksheet, ByVal title As String, ByVal tableName As String, ByVal xCol As String, _
                      ByVal yCols As Variant, ByVal x As Double, ByVal y As Double, ByVal isPct As Boolean)
    Dim lo As ListObject
    Dim ch As Chart
    Dim s As Variant
    Dim ser As Object
    On Error GoTo Fail
    Set lo = FindTable(tableName)
    If Not HasData(lo) Then
        NotAvailable ws, title & " " & L("(no data)"), x, y
        Exit Sub
    End If
    Set ch = ws.ChartObjects.Add(x, y, W, H).Chart
    ch.ChartType = XL_LINE
    For Each s In yCols
        Set ser = ch.SeriesCollection.NewSeries
        ser.Name = CStr(s)
        ser.Values = lo.ListColumns(CStr(s)).DataBodyRange
        ser.XValues = lo.ListColumns(xCol).DataBodyRange
    Next s
    ch.HasTitle = True
    ch.ChartTitle.Text = title
    If isPct Then ch.Axes(2).TickLabels.NumberFormat = "0.0%"
    Exit Sub
Fail:
    LogError "modCharts", title, "CHART", Err.Number & ": " & Err.Description, "WARNING"
End Sub

Private Sub BarChart(ByVal ws As Worksheet, ByVal title As String, ByVal tableName As String, ByVal labelCol As String, _
                     ByVal valueCol As String, ByVal x As Double, ByVal y As Double, ByVal topN As Long)
    Dim lo As ListObject
    Dim ch As Chart
    Dim ser As Object
    Dim n As Long
    On Error GoTo Fail
    Set lo = FindTable(tableName)
    If Not HasData(lo) Then
        NotAvailable ws, title & " " & L("(no data)"), x, y
        Exit Sub
    End If
    n = lo.ListRows.Count
    If n > topN Then n = topN
    Set ch = ws.ChartObjects.Add(x, y, W, H).Chart
    ch.ChartType = XL_BAR_CLUSTERED
    Set ser = ch.SeriesCollection.NewSeries
    ser.Name = valueCol
    ser.Values = lo.ListColumns(valueCol).DataBodyRange.Resize(n)
    ser.XValues = lo.ListColumns(labelCol).DataBodyRange.Resize(n)
    ch.HasTitle = True
    ch.ChartTitle.Text = title
    ch.HasLegend = False
    Exit Sub
Fail:
    LogError "modCharts", title, "CHART", Err.Number & ": " & Err.Description, "WARNING"
End Sub

' Long-format table (Month, Product, Unit Cost) -> one series per product.
Private Sub PriceTrendChart(ByVal ws As Worksheet, ByVal x As Double, ByVal y As Double)
    Dim lo As ListObject
    Dim ch As Chart
    Dim products As Object
    Dim r As Long
    Dim p As Variant
    Dim months As Object
    Dim vals() As Variant, xs() As Variant
    Dim i As Long
    Dim ser As Object
    On Error GoTo Fail
    Set lo = FindTable("tbl_priceTrend")
    If Not HasData(lo) Then
        NotAvailable ws, L("Ingredient Price Trend") & " " & L("(no data)"), x, y
        Exit Sub
    End If
    Set products = CreateObject("Scripting.Dictionary")
    For r = 1 To lo.ListRows.Count
        p = CStr(lo.DataBodyRange.Cells(r, 2).Value)
        If Not products.Exists(p) Then products.Add p, New Collection
        products(p).Add r
    Next r
    Set ch = ws.ChartObjects.Add(x, y, W, H).Chart
    ch.ChartType = XL_LINE
    For Each p In products.Keys
        ReDim vals(1 To products(p).Count)
        ReDim xs(1 To products(p).Count)
        For i = 1 To products(p).Count
            xs(i) = lo.DataBodyRange.Cells(products(p)(i), 1).Value
            vals(i) = lo.DataBodyRange.Cells(products(p)(i), 3).Value
        Next i
        Set ser = ch.SeriesCollection.NewSeries
        ser.Name = CStr(p)
        ser.Values = vals
        ser.XValues = xs
    Next p
    ch.HasTitle = True
    ch.ChartTitle.Text = L("Ingredient Price Trend (top spend)")
    Exit Sub
Fail:
    LogError "modCharts", "PriceTrend", "CHART", Err.Number & ": " & Err.Description, "WARNING"
End Sub

Private Sub NotAvailable(ByVal ws As Worksheet, ByVal title As String, ByVal x As Double, ByVal y As Double)
    Dim shp As Shape
    Set shp = ws.Shapes.AddTextbox(1, x, y, W, H)
    shp.Name = "txt_" & ws.Shapes.Count
    shp.TextFrame.Characters.Text = title & vbLf & vbLf & L("Module not yet available in HotelCost - no data is shown rather than estimated values.")
    shp.Line.ForeColor.RGB = RGB(213, 217, 226)
End Sub
