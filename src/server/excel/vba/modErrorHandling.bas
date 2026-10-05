'==============================================================================
' modErrorHandling :: EXPORT_ERRORS and RUN_LOG. Errors are recorded, never hidden.
'==============================================================================
Option Explicit

Public Sub LogError(ByVal moduleName As String, ByVal record As String, ByVal errType As String, ByVal description As String, ByVal severity As String)
    Dim lo As ListObject
    Dim rw As ListRow
    If severity = "CRITICAL" Or severity = "HIGH" Then gErrors = gErrors + 1 Else gWarnings = gWarnings + 1
    Set lo = FindTable("tbl_errors")
    If lo Is Nothing Then Exit Sub
    lo.Parent.Unprotect ""
    Set rw = lo.ListRows.Add
    rw.Range.Value = Array(Now, gRunId, moduleName, record, CodeText(errType), description, CodeText(severity))
End Sub

' Error types and severities are codes in the macro and words in the log.
Private Function CodeText(ByVal code As String) As String
    Select Case code
        Case "CRITICAL": CodeText = L("CRITICAL")
        Case "HIGH": CodeText = L("HIGH")
        Case "WARNING": CodeText = L("WARNING")
        Case "PARAMETER": CodeText = L("PARAMETER")
        Case "SCHEMA": CodeText = L("SCHEMA")
        Case "NETWORK": CodeText = L("NETWORK")
        Case "RUNTIME": CodeText = L("RUNTIME")
        Case "RECONCILIATION": CodeText = L("RECONCILIATION")
        Case "MISSING_TABLE": CodeText = L("MISSING_TABLE")
        Case "CHART": CodeText = L("CHART")
        Case "PIVOT": CodeText = L("PIVOT")
        Case "OPEN": CodeText = L("OPEN")
        Case Else: CodeText = code
    End Select
End Function

Public Sub LogRun(ByVal startedAt As Date, ByVal runStatus As String, ByVal records As Long)
    Dim lo As ListObject
    Dim rw As ListRow
    Set lo = FindTable("tbl_runLog")
    If lo Is Nothing Then Exit Sub
    lo.Parent.Unprotect ""
    Set rw = lo.ListRows.Add
    rw.Range.Value = Array(gRunId, Date, Application.UserName, CStr(CtlValue("ctl_Hotel")), CStr(CtlValue("ctl_PeriodLabel")), _
                           startedAt, Now, runStatus, records, gErrors, gWarnings)
End Sub

Public Sub MarkRunStatus(ByVal runStatus As String)
    Dim c As Range
    Set c = ThisWorkbook.Names("ctl_RunStatus").RefersToRange
    c.Parent.Unprotect ""
    c.Value = runStatus & "  (" & Format$(Now, "yyyy-mm-dd hh:nn") & ")"
    Select Case runStatus
        Case L("EXPORT COMPLETED SUCCESSFULLY"): c.Interior.Color = RGB(214, 245, 227)
        Case L("EXPORT COMPLETED WITH WARNINGS"): c.Interior.Color = RGB(254, 243, 199)
        Case Else: c.Interior.Color = RGB(254, 226, 226)
    End Select
End Sub
