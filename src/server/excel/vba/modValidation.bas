'==============================================================================
' modValidation :: control parameters and raw export validation.
'==============================================================================
Option Explicit

Public Function ValidateParameters() As Boolean
    Dim url As String
    Dim d1 As Variant, d2 As Variant
    ValidateParameters = False
    url = LCase$(Trim$(CStr(CtlValue("ctl_ApiUrl"))))
    If Not (Left$(url, 8) = "https://" Or Left$(url, 16) = "http://localhost" Or Left$(url, 16) = "http://127.0.0.1") Then
        LogError "modValidation", "ctl_ApiUrl", "PARAMETER", "API URL must use HTTPS (or localhost for testing).", "CRITICAL"
        Exit Function
    End If
    If Len(Trim$(CStr(CtlValue("ctl_HotelId")))) = 0 Then
        LogError "modValidation", "ctl_HotelId", "PARAMETER", "Hotel is missing.", "CRITICAL"
        Exit Function
    End If
    d1 = CtlValue("ctl_StartDate")
    d2 = CtlValue("ctl_EndDate")
    If Not IsDate(d1) Or Not IsDate(d2) Then
        LogError "modValidation", "dates", "PARAMETER", "Start and end date must be valid dates.", "CRITICAL"
        Exit Function
    End If
    If CDate(d2) < CDate(d1) Then
        LogError "modValidation", "dates", "PARAMETER", "End date is before start date.", "CRITICAL"
        Exit Function
    End If
    If CDate(d2) - CDate(d1) > 366 Then
        LogError "modValidation", "dates", "PARAMETER", "Period longer than 366 days is not supported in one workbook.", "CRITICAL"
        Exit Function
    End If
    ValidateParameters = True
End Function

Public Function ValidateExport(ByVal payload As Object) As Boolean
    Dim meta As Object
    Dim required As Variant
    Dim k As Variant
    ValidateExport = False
    If Split(payload("exportVersion"), ".")(0) <> EXPORT_SCHEMA_MAJOR Then
        LogError "modValidation", "exportVersion", "SCHEMA", "Export schema " & payload("exportVersion") & " is not supported by workbook " & WORKBOOK_VERSION & ". Download a new workbook.", "CRITICAL"
        Exit Function
    End If
    Set meta = payload("meta")
    If meta("hotelId") <> CStr(CtlValue("ctl_HotelId")) Then
        LogError "modValidation", "hotelId", "SCHEMA", "Export hotel does not match the CONTROL sheet hotel.", "CRITICAL"
        Exit Function
    End If
    required = Array("executiveSummary", "costDetail", "consumptionVariance", "monthlyStock", "recipeCost", "waste", "inventoryValue", "departmentCost")
    For Each k In required
        If Not payload("sections").Exists(CStr(k)) Then
            LogError "modValidation", CStr(k), "SCHEMA", "Required section missing from export.", "CRITICAL"
            Exit Function
        End If
    Next k
    ValidateExport = True
End Function
