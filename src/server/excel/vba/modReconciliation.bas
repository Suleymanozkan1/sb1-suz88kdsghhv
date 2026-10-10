'==============================================================================
' modReconciliation :: export QA after every run (spec 78, 129-131, 144-145).
'  1. server-side checks (same engine as the app) -> tbl_serverChecks
'  2. workbook formula checks (tbl_excelChecks, live formulas over the tables)
'  3. VBA checks: row counts vs export, duplicate trace ids -> tbl_vbaChecks
'==============================================================================
Option Explicit

Public Sub RunReconciliation(ByVal payload As Object)
    Dim lo As ListObject
    Dim data() As Variant
    Dim chk As Variant
    Dim i As Long
    Dim nFail As Long, nWarn As Long
    Dim vba As Collection
    Dim k As Variant
    Dim sec As Object
    Dim t As ListObject
    Dim actual As Long

    ' 1) server checks
    Set lo = FindTable("tbl_serverChecks")
    If Not lo Is Nothing And payload("checks").Count > 0 Then
        ReDim data(1 To payload("checks").Count, 1 To 6)
        i = 0
        For Each chk In payload("checks")
            i = i + 1
            data(i, 1) = chk(0)
            data(i, 2) = ConvertCell(chk(1), "money")
            data(i, 3) = ConvertCell(chk(2), "money")
            data(i, 4) = ConvertCell(chk(3), "money")
            data(i, 5) = chk(4)
            data(i, 6) = chk(5)
            If chk(4) = L("FAIL") Then nFail = nFail + 1
            If chk(4) = L("WARNING") Then nWarn = nWarn + 1
        Next chk
        If Not lo.DataBodyRange Is Nothing Then lo.DataBodyRange.ClearContents
        lo.Resize lo.HeaderRowRange.Resize(payload("checks").Count + 1)
        lo.DataBodyRange.Value = data
    End If

    ' 3) VBA checks: every table has exactly the rows the export declared; no duplicate trace ids
    Set vba = New Collection
    For Each k In payload("sections").Keys
        Set sec = payload("sections")(k)
        Set t = FindTable("tbl_" & k)
        If Not t Is Nothing Then
            If sec("rows") = 0 Then actual = 0 Else actual = t.ListRows.Count
            vba.Add Array(L("Row count") & " " & k, sec("rows"), actual, IIf(actual = sec("rows"), L("PASS"), L("FAIL")))
        End If
    Next k
    vba.Add DuplicateCheck("tbl_costDetail", H("Trace ID"))
    vba.Add DuplicateCheck("tbl_rawStockTransactions", H("Transaction ID"))
    Set lo = FindTable("tbl_vbaChecks")
    If Not lo Is Nothing Then
        ReDim data(1 To vba.Count, 1 To 4)
        For i = 1 To vba.Count
            data(i, 1) = vba(i)(0): data(i, 2) = vba(i)(1): data(i, 3) = vba(i)(2): data(i, 4) = vba(i)(3)
            If vba(i)(3) = L("FAIL") Then nFail = nFail + 1
        Next i
        If Not lo.DataBodyRange Is Nothing Then lo.DataBodyRange.ClearContents
        lo.Resize lo.HeaderRowRange.Resize(vba.Count + 1)
        lo.DataBodyRange.Value = data
    End If

    ' 2) workbook formula checks
    Application.Calculate
    Set lo = FindTable("tbl_excelChecks")
    If Not lo Is Nothing Then
        If Not lo.DataBodyRange Is Nothing Then
            For i = 1 To lo.ListRows.Count
                Select Case CStr(lo.ListColumns(H("Status")).DataBodyRange.Cells(i, 1).Value)
                    Case L("FAIL"): nFail = nFail + 1
                    Case L("WARNING"): nWarn = nWarn + 1
                End Select
            Next i
        End If
    End If

    If nFail > 0 Then LogError "modReconciliation", "checks", "RECONCILIATION", nFail & " " & L("reconciliation check(s) failed - see") & " " & S("43_RECONCILIATION"), "HIGH"
    SetCtl "ctl_ScoreDataQuality", payload("meta")("dataQuality")
    SetCtl "ctl_ScoreRecon", IIf(nFail > 0, L("FAIL"), IIf(nWarn > 0, L("WARNING"), L("PASS")))
    SetCtl "ctl_ScoreWarnings", nWarn
    SetCtl "ctl_ScoreErrors", nFail
    gWarnings = gWarnings + nWarn
End Sub

Private Function DuplicateCheck(ByVal tableName As String, ByVal colName As String) As Variant
    Dim lo As ListObject
    Dim seen As Object
    Dim v As Variant
    Dim r As Long, dup As Long
    Set lo = FindTable(tableName)
    If lo Is Nothing Then
        DuplicateCheck = Array(L("Duplicates") & " " & tableName, 0, 0, L("WARNING"))
        Exit Function
    End If
    Set seen = CreateObject("Scripting.Dictionary")
    If Not lo.DataBodyRange Is Nothing Then
        v = lo.ListColumns(colName).DataBodyRange.Value
        If IsArray(v) Then
            For r = 1 To UBound(v, 1)
                If Len(CStr(v(r, 1))) > 0 Then
                    If seen.Exists(CStr(v(r, 1))) Then dup = dup + 1 Else seen.Add CStr(v(r, 1)), True
                End If
            Next r
        End If
    End If
    DuplicateCheck = Array(L("Duplicates") & ": " & colName & " (" & tableName & ")", 0, dup, IIf(dup = 0, L("PASS"), L("FAIL")))
End Function
