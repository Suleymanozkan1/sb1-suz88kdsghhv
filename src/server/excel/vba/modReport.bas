'==============================================================================
' modReport :: bulk writer. Each export section maps 1:1 to an Excel Table named
' "tbl_<sectionKey>". Data is written as one 2-D array per table (no cell loops).
'==============================================================================
Option Explicit

' Sheet names are in the workbook's language (S() is replaced when the workbook is built).
Public Function CONTROL_SHEET() As String
    CONTROL_SHEET = S("01_CONTROL")
End Function

Public Function FindTable(ByVal tableName As String) As ListObject
    Dim ws As Worksheet
    Dim lo As ListObject
    For Each ws In ThisWorkbook.Worksheets
        For Each lo In ws.ListObjects
            If StrComp(lo.Name, tableName, vbTextCompare) = 0 Then
                Set FindTable = lo
                Exit Function
            End If
        Next lo
    Next ws
    Set FindTable = Nothing
End Function

' Area order mirrors the workbook structure; remaining sections are written generically.
Public Function WriteAllSections(ByVal payload As Object) As Long
    Dim done As Object
    Dim areas As Variant
    Dim area As Variant
    Dim k As Variant
    Dim n As Long
    Set done = CreateObject("Scripting.Dictionary")
    areas = Array(CostSections(), RecipeSections(), InventorySections(), WasteSections(), _
                  BuffetSections(), MinibarSections(), RoomSections(), DepartmentSections())
    For Each area In areas
        For Each k In area
            If payload("sections").Exists(CStr(k)) And Not done.Exists(CStr(k)) Then
                n = n + WriteSection(CStr(k), payload("sections")(CStr(k)))
                done(CStr(k)) = True
            End If
        Next k
    Next area
    For Each k In payload("sections").Keys
        If Not done.Exists(CStr(k)) Then
            n = n + WriteSection(CStr(k), payload("sections")(CStr(k)))
            done(CStr(k)) = True
        End If
    Next k
    WriteAllSections = n
End Function

Public Function WriteSection(ByVal key As String, ByVal sec As Object) As Long
    Dim lo As ListObject
    Dim heads As Variant
    Dim c As Long
    Dim nRows As Long
    Dim statusCell As Range
    Dim note As String

    Set lo = FindTable("tbl_" & key)
    If lo Is Nothing Then
        LogError "modReport", key, "MISSING_TABLE", L("Workbook has no table") & " tbl_" & key & " " & L("(export is newer than workbook?)"), "WARNING"
        Exit Function
    End If
    heads = sec("headers")
    If lo.ListColumns.Count <> sec("cols") Then
        LogError "modReport", key, "SCHEMA", L("Column count differs") & ": " & L("workbook") & " " & lo.ListColumns.Count & ", " & L("export") & " " & sec("cols"), "HIGH"
        Exit Function
    End If
    For c = 1 To sec("cols")
        If lo.ListColumns(c).Name <> heads(c) Then
            LogError "modReport", key, "SCHEMA", L("Column") & " " & c & ": " & L("workbook") & " '" & lo.ListColumns(c).Name & "', " & L("export") & " '" & heads(c) & "'", "HIGH"
            Exit Function
        End If
    Next c

    nRows = sec("rows")
    ' Duplicate protection: the table is cleared before writing, so a refresh never appends twice.
    If Not lo.DataBodyRange Is Nothing Then lo.DataBodyRange.ClearContents
    If nRows = 0 Then
        lo.Resize lo.HeaderRowRange.Resize(2)
    Else
        lo.Resize lo.HeaderRowRange.Resize(nRows + 1)
        lo.DataBodyRange.Value = sec("data")
    End If

    Set statusCell = lo.HeaderRowRange.Cells(1, 1).Offset(-2, 0)
    note = CStr(sec("note"))
    statusCell.Value = L("Data status") & ": " & sec("status") & IIf(Len(note) > 0, " - " & note, "") & "  |  " & L("rows") & ": " & nRows
    If sec("status") = L("NOT_AVAILABLE") Then statusCell.Font.Color = RGB(180, 83, 9) Else statusCell.Font.Color = RGB(80, 92, 120)
    WriteSection = nRows
End Function

' Full rebuild: clears generated tables only. Manual notes, CONTROL inputs, run log
' and error history are preserved (safe refresh).
Public Sub ClearGeneratedTables()
    Dim ws As Worksheet
    Dim lo As ListObject
    For Each ws In ThisWorkbook.Worksheets
        For Each lo In ws.ListObjects
            If Left$(lo.Name, 4) = "tbl_" And Not IsStaticTable(lo.Name) Then
                If Not lo.DataBodyRange Is Nothing Then lo.DataBodyRange.ClearContents
                lo.Resize lo.HeaderRowRange.Resize(2)
            End If
        Next lo
    Next ws
End Sub

' Tables that are not datasets: logs, formula checks, lists, documentation.
Private Function IsStaticTable(ByVal n As String) As Boolean
    Select Case LCase$(n)
        Case "tbl_runlog", "tbl_errors", "tbl_excelchecks", "tbl_formulas", "tbl_sourcemap"
            IsStaticTable = True
        Case Else
            IsStaticTable = (LCase$(Left$(n, 7)) = "tbl_lst")
    End Select
End Function

Public Sub WriteMetadata(ByVal payload As Object)
    Dim m As Object
    Set m = payload("meta")
    SetCtl "ctl_Hotel", m("hotel")
    SetCtl "ctl_Currency", m("currency")
    SetCtl "ctl_PeriodLabel", m("periodLabel")
    SetCtl "ctl_GeneratedAt", m("generatedAt")
    SetCtl "ctl_GeneratedBy", m("generatedBy") & " (" & L("Excel user") & ": " & Application.UserName & ")"
    SetCtl "ctl_DataThrough", m("dataThrough")
    SetCtl "ctl_ExportId", payload("exportId")
    SetCtl "ctl_ExportVersion", payload("exportVersion")
    SetCtl "ctl_AppVersion", m("appVersion")
    SetCtl "ctl_ContentHash", m("contentHash")
    SetCtl "ctl_WorkbookVersion", WORKBOOK_VERSION
End Sub

Public Function CompletionSummary(ByVal payload As Object) As String
    Dim keys As Variant, labels As Variant
    Dim i As Long
    Dim s As String
    If payload Is Nothing Then
        CompletionSummary = L("No data was written.") & " " & L("See") & " " & S("48_EXPORT_ERRORS") & "."
        Exit Function
    End If
    keys = Array("costDetail", "rawStockTransactions", "actualConsumption", "waste", "recipeSummary", "rawSales", "inventoryValue")
    labels = Array(L("cost records"), L("stock transactions"), L("consumption records"), L("waste records"), L("recipes"), L("sales lines"), L("stock positions"))
    For i = 0 To UBound(keys)
        If payload("sections").Exists(keys(i)) Then
            s = s & ChrW(&H2714) & " " & Format$(payload("sections")(keys(i))("rows"), "#,##0") & " " & labels(i) & vbCrLf
        End If
    Next i
    s = s & vbCrLf & L("Data quality") & ": " & CStr(CtlValue("ctl_ScoreDataQuality")) & "%" & vbCrLf & _
        L("Reconciliation") & ": " & CStr(CtlValue("ctl_ScoreRecon")) & vbCrLf & _
        L("Warnings") & ": " & gWarnings & vbCrLf & L("Errors") & ": " & gErrors
    CompletionSummary = s
End Function
