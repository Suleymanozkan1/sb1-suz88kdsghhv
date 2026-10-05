'==============================================================================
' HotelCost - Full Cost Report workbook :: modMain
' Entry points. All cost figures are calculated by the HotelCost server (one cost
' engine shared with the web application). This VBA project only fetches the
' authenticated export, writes it into tables, refreshes pivots/charts and runs
' reconciliation. It never stores credentials in the workbook.
'==============================================================================
Option Explicit

Public Const WORKBOOK_VERSION As String = "1.0.0"
Public Const EXPORT_SCHEMA_MAJOR As String = "1"

Public gRunId As String
Public gWarnings As Long
Public gErrors As Long
Public gRecords As Long

Private Const XL_CALC_MANUAL As Long = -4135

' Main button: "TUM COST RAPORLARINI OLUSTUR" / "GENERATE FULL COST REPORT"
Public Sub GenerateFullCostReport()
    Dim mode As String
    mode = Trim$(CStr(CtlValue("ctl_RefreshMode")))
    RunPipeline (mode = L("Full Rebuild"))
End Sub

Public Sub RefreshCurrentPeriod()
    RunPipeline False
End Sub

Public Sub FullRebuild()
    RunPipeline True
End Sub

Private Sub RunPipeline(ByVal fullRebuild As Boolean)
    Dim t0 As Date
    Dim payload As Object
    Dim stage As String
    Dim prevCalc As Long
    Dim prevEvents As Boolean
    Dim finalStatus As String

    gRunId = Format$(Now, "yyyymmdd-hhnnss")
    gWarnings = 0
    gErrors = 0
    gRecords = 0
    t0 = Now
    prevCalc = Application.Calculation
    prevEvents = Application.EnableEvents

    On Error GoTo Fail
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.Calculation = XL_CALC_MANUAL

    stage = L("Read & validate control parameters")
    Status stage
    If Not ValidateParameters() Then
        finalStatus = L("EXPORT FAILED")
        GoTo Finish
    End If

    stage = L("Fetch data from HotelCost API")
    Status stage
    Set payload = FetchFullCost()

    stage = L("Validate raw data")
    Status stage
    If Not ValidateExport(payload) Then
        finalStatus = L("EXPORT FAILED")
        GoTo Finish
    End If

    UnprotectAll
    If fullRebuild Then
        stage = L("Full rebuild: clear generated tables")
        Status stage
        ClearGeneratedTables
    End If

    stage = L("Write raw data, calculations and reports")
    Status stage
    gRecords = WriteAllSections(payload)
    WriteMetadata payload

    stage = L("Refresh pivot tables")
    Status stage
    RefreshPivots

    stage = L("Refresh charts")
    Status stage
    RefreshCharts

    stage = L("Run reconciliation")
    Status stage
    Application.Calculate
    RunReconciliation payload

    stage = L("Format workbook")
    Status stage
    FormatWorkbook
    ProtectAll

    If gErrors > 0 Then
        finalStatus = L("EXPORT FAILED")
    ElseIf gWarnings > 0 Then
        finalStatus = L("EXPORT COMPLETED WITH WARNINGS")
    Else
        finalStatus = L("EXPORT COMPLETED SUCCESSFULLY")
    End If
    GoTo Finish

Fail:
    LogError "modMain", stage, "RUNTIME", Err.Number & ": " & Err.Description, "CRITICAL"
    finalStatus = L("EXPORT FAILED")
    Resume Finish

Finish:
    On Error Resume Next
    ' Never leave Excel in a broken state (spec 83): restore application settings.
    Application.Calculation = prevCalc
    Application.EnableEvents = prevEvents
    Application.ScreenUpdating = True
    Application.StatusBar = False
    On Error GoTo 0
    MarkRunStatus finalStatus
    LogRun t0, finalStatus, gRecords
    ThisWorkbook.Worksheets(CONTROL_SHEET).Activate
    MsgBox finalStatus & vbCrLf & vbCrLf & CompletionSummary(payload), _
        IIf(finalStatus = L("EXPORT FAILED"), vbCritical, IIf(gWarnings > 0, vbExclamation, vbInformation)), "HotelCost"
End Sub

Public Sub ExportManagementPdf()
    Dim names As Variant
    Dim target As String
    Dim folder As String
    On Error GoTo Fail
    names = Array(CONTROL_SHEET, S("02_EXECUTIVE_SUMMARY"), S("04_FOOD_COST"), S("05_BEVERAGE_COST"), S("09_CONSUMPTION_VARIANCE"), _
                  S("11_WASTE_SUMMARY"), S("34_DEPARTMENT_COST"), S("45_UNEXPLAINED_VARIANCE"), S("46_RECONCILIATION"), S("53_DASHBOARD_CHARTS"))
    folder = ThisWorkbook.Path
    If Len(folder) = 0 Then folder = Environ$("TEMP")
    target = folder & Application.PathSeparator & L("HotelCost_Management_Report_") & _
             Format$(CtlValue("ctl_StartDate"), "yyyy_mm") & ".pdf"
    ThisWorkbook.Worksheets(names).Select
    ActiveSheet.ExportAsFixedFormat 0, target, 0, True, False, , , True
    ThisWorkbook.Worksheets(CONTROL_SHEET).Select
    Exit Sub
Fail:
    LogError "modMain", "ExportManagementPdf", "PDF", Err.Number & ": " & Err.Description, "HIGH"
    MsgBox L("PDF export failed") & ": " & Err.Description, vbCritical, "HotelCost"
End Sub

Public Function CtlValue(ByVal rangeName As String) As Variant
    CtlValue = ThisWorkbook.Names(rangeName).RefersToRange.Value
End Function

Public Sub SetCtl(ByVal rangeName As String, ByVal v As Variant)
    ThisWorkbook.Names(rangeName).RefersToRange.Value = v
End Sub

Public Sub Status(ByVal msg As String)
    Application.StatusBar = "HotelCost: " & msg & " ..."
    DoEvents
End Sub
