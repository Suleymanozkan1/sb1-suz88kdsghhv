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
    rw.Range.Value = Array(Now, gRunId, moduleName, record, errType, description, severity)
End Sub

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
        Case "EXPORT COMPLETED SUCCESSFULLY": c.Interior.Color = RGB(214, 245, 227)
        Case "EXPORT COMPLETED WITH WARNINGS": c.Interior.Color = RGB(254, 243, 199)
        Case Else: c.Interior.Color = RGB(254, 226, 226)
    End Select
End Sub
