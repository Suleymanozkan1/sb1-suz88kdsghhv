Option Explicit

Private Sub Workbook_Open()
    On Error GoTo Fail
    EnsureControlButton
    ThisWorkbook.Worksheets(CONTROL_SHEET).Activate
    Exit Sub
Fail:
    ' Opening must never be blocked by cosmetic problems; the issue is recorded instead.
    LogError "ThisWorkbook", "Workbook_Open", "OPEN", Err.Number & ": " & Err.Description, "WARNING"
End Sub
