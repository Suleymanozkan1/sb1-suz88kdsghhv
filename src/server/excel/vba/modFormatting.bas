'==============================================================================
' modFormatting :: protection, layout and the CONTROL button.
'==============================================================================
Option Explicit

Public Sub UnprotectAll()
    Dim ws As Worksheet
    For Each ws In ThisWorkbook.Worksheets
        ws.Unprotect ""
    Next ws
End Sub

' Report, raw and calculation sheets are protected (no password: this prevents accidental
' edits, it is not a security boundary). Filtering and pivots stay usable.
Public Sub ProtectAll()
    Dim ws As Worksheet
    For Each ws In ThisWorkbook.Worksheets
        ws.Protect Password:="", DrawingObjects:=True, Contents:=True, UserInterfaceOnly:=True, _
                   AllowFiltering:=True, AllowSorting:=True, AllowUsingPivotTables:=True, AllowFormattingColumns:=True
    Next ws
End Sub

' Every table column fits its header (plus the filter button) and its values, never narrower than the
' prefilled layout (the KPI tiles share columns with the summary table); text longer than 60 characters
' wraps instead of being cut off. The header row wraps and grows when a header needs two lines.
Public Sub FormatWorkbook()
    Dim ws As Worksheet
    Dim lo As ListObject
    Dim lc As ListColumn
    Dim before As Double
    Dim fitted As Double
    For Each ws In ThisWorkbook.Worksheets
        If ws.Visible = -1 Then
            For Each lo In ws.ListObjects
                For Each lc In lo.ListColumns
                    before = lc.Range.ColumnWidth
                    lc.Range.Columns.AutoFit
                    fitted = lc.Range.ColumnWidth + 2
                    If fitted < before Then fitted = before
                    If fitted < 8 Then fitted = 8
                    If fitted > 60 Then
                        fitted = 60
                        lc.Range.WrapText = True
                    End If
                    lc.Range.ColumnWidth = fitted
                Next lc
                lo.HeaderRowRange.WrapText = True
                lo.HeaderRowRange.Font.Bold = True
                lo.HeaderRowRange.Rows.AutoFit
            Next lo
        End If
    Next ws
End Sub

Public Function ButtonCaption() As String
    ButtonCaption = L("GENERATE FULL COST REPORT")
End Function

' The packaged workbook already contains the button; this re-creates it if a user deleted it.
Public Sub EnsureControlButton()
    Dim ws As Worksheet
    Dim shp As Shape
    Dim exists As Boolean
    Set ws = ThisWorkbook.Worksheets(CONTROL_SHEET)
    For Each shp In ws.Shapes
        If shp.Name = "btnGenerate" Or shp.OnAction Like "*GenerateFullCostReport" Then exists = True
    Next shp
    If exists Then Exit Sub
    ws.Unprotect ""
    Set shp = ws.Shapes.AddShape(5, ws.Range("F4").Left, ws.Range("F4").Top, 330, 70)
    shp.Name = "btnGenerate"
    shp.OnAction = "GenerateFullCostReport"
    shp.Fill.ForeColor.RGB = RGB(21, 132, 89)
    shp.Line.Visible = False
    With shp.TextFrame2.TextRange
        .Text = ButtonCaption()
        .Font.Bold = True
        .Font.Size = 14
        .Font.Fill.ForeColor.RGB = RGB(255, 255, 255)
        .ParagraphFormat.Alignment = 2
    End With
    shp.TextFrame2.VerticalAnchor = 3
End Sub
