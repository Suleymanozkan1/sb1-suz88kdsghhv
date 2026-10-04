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

Public Sub FormatWorkbook()
    Dim ws As Worksheet
    Dim lo As ListObject
    Dim c As Range
    For Each ws In ThisWorkbook.Worksheets
        If ws.Visible = -1 Then
            For Each lo In ws.ListObjects
                lo.Range.Columns.AutoFit
                For Each c In lo.HeaderRowRange.Cells
                    If c.ColumnWidth > 60 Then c.ColumnWidth = 60
                    If c.ColumnWidth < 10 Then c.ColumnWidth = 10
                Next c
            Next lo
        End If
    Next ws
End Sub

Public Function ButtonCaption() As String
    ' "TUM COST RAPORLARINI OLUSTUR" with Turkish letters (U+00DC, U+015E)
    ButtonCaption = "T" & ChrW(&HDC) & "M COST RAPORLARINI OLU" & ChrW(&H15E) & "TUR" & vbLf & "GENERATE FULL COST REPORT"
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
