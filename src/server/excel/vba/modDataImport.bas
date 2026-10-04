'==============================================================================
' modDataImport :: authenticated HTTPS fetch of the versioned export contract.
' Transport format: TSV rendering of exportVersion 1.x (no JSON library needed).
' Numbers arrive as invariant decimal strings and are converted with Val(),
' which is locale-independent (works with Turkish decimal comma settings).
'==============================================================================
Option Explicit

Private mToken As String

Public Function ApiToken() As String
    If Len(mToken) = 0 Then mToken = Environ$("HOTELCOST_TOKEN")
    If Len(mToken) = 0 Then
        mToken = InputBox("Paste your HotelCost API token (web app > Excel Export > Create token)." & vbCrLf & _
                          "It is kept in memory only and is never saved in this workbook.", "HotelCost API token")
    End If
    ApiToken = Trim$(mToken)
End Function

Public Sub ForgetToken()
    mToken = vbNullString
End Sub

Public Function BuildExportUrl() As String
    Dim baseUrl As String
    baseUrl = Trim$(CStr(CtlValue("ctl_ApiUrl")))
    If Right$(baseUrl, 1) = "/" Then baseUrl = Left$(baseUrl, Len(baseUrl) - 1)
    BuildExportUrl = baseUrl & "/api/export/full-cost?format=tsv" & _
        "&hotelId=" & UrlEncode(CStr(CtlValue("ctl_HotelId"))) & _
        "&from=" & Format$(CtlValue("ctl_StartDate"), "yyyy-mm-dd") & _
        "&to=" & Format$(CtlValue("ctl_EndDate"), "yyyy-mm-dd") & _
        "&departmentId=" & UrlEncode(SelectedDepartmentId()) & _
        "&warehouseId=" & UrlEncode(LookupId("tbl_lstWarehouses", CStr(CtlValue("ctl_Warehouse")))) & _
        "&group=" & UrlEncode(CategoryParam(CStr(CtlValue("ctl_Category"))))
End Function

' Department wins; if Department is "All" the Outlet selection is used.
Public Function SelectedDepartmentId() As String
    SelectedDepartmentId = LookupId("tbl_lstDepartments", CStr(CtlValue("ctl_Department")))
    If Len(SelectedDepartmentId) = 0 Then SelectedDepartmentId = LookupId("tbl_lstDepartments", CStr(CtlValue("ctl_Outlet")))
End Function

Private Function CategoryParam(ByVal v As String) As String
    If UCase$(v) = "ALL" Or Len(v) = 0 Then CategoryParam = "" Else CategoryParam = UCase$(v)
End Function

' Lookup "name -> id" in a two-column hidden list table (name, id). "All" -> "".
Public Function LookupId(ByVal tableName As String, ByVal displayName As String) As String
    Dim lo As ListObject
    Dim r As Long
    LookupId = ""
    If Len(displayName) = 0 Or LCase$(Left$(displayName, 3)) = "all" Then Exit Function
    Set lo = FindTable(tableName)
    If lo Is Nothing Then Exit Function
    If lo.DataBodyRange Is Nothing Then Exit Function
    For r = 1 To lo.DataBodyRange.Rows.Count
        If CStr(lo.DataBodyRange.Cells(r, 1).Value) = displayName Then
            LookupId = CStr(lo.DataBodyRange.Cells(r, 2).Value)
            Exit Function
        End If
    Next r
End Function

Public Function UrlEncode(ByVal s As String) As String
    Dim i As Long
    Dim c As String
    Dim code As Long
    Dim out As String
    For i = 1 To Len(s)
        c = Mid$(s, i, 1)
        code = AscW(c)
        If (code >= 48 And code <= 57) Or (code >= 65 And code <= 90) Or (code >= 97 And code <= 122) Or c = "-" Or c = "_" Or c = "." Or c = "~" Then
            out = out & c
        Else
            out = out & "%" & Right$("0" & Hex$(code And &HFF), 2)
        End If
    Next i
    UrlEncode = out
End Function

' Single attempt; returns True on transport success (any HTTP status).
Private Function TryGet(ByVal url As String, ByVal token As String, ByRef httpStatus As Long, ByRef body As String, ByRef errText As String) As Boolean
    Dim http As Object
    On Error GoTo Fail
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.setTimeouts 10000, 10000, 120000, 300000
    http.Open "GET", url, False
    http.setRequestHeader "Authorization", "Bearer " & token
    http.setRequestHeader "Accept", "text/tab-separated-values"
    http.send
    httpStatus = http.Status
    body = http.responseText
    TryGet = True
    Exit Function
Fail:
    errText = Err.Number & ": " & Err.Description
    TryGet = False
End Function

' GET with safe retry/backoff for transient failures (network, 429, 5xx). 401/403/4xx fail fast.
Public Function HttpGetText(ByVal url As String) As String
    Dim attempt As Long
    Dim st As Long
    Dim body As String
    Dim errText As String
    Dim token As String
    token = ApiToken()
    If Len(token) = 0 Then Err.Raise vbObjectError + 401, "HttpGetText", "No API token provided."
    For attempt = 1 To 4
        st = 0: body = "": errText = ""
        If TryGet(url, token, st, body, errText) Then
            If st = 200 Then
                HttpGetText = body
                Exit Function
            ElseIf st = 401 Or st = 403 Then
                ForgetToken
                Err.Raise vbObjectError + st, "HttpGetText", "Access denied (HTTP " & st & "). Check the API token and your export permission."
            ElseIf st <> 429 And st < 500 Then
                Err.Raise vbObjectError + st, "HttpGetText", "HotelCost API returned HTTP " & st & ": " & Left$(body, 300)
            End If
            errText = "HTTP " & st
        End If
        LogError "modDataImport", "attempt " & attempt, "NETWORK", errText, "WARNING"
        If attempt < 4 Then Application.Wait Now + TimeSerial(0, 0, 2 ^ attempt)
    Next attempt
    Err.Raise vbObjectError + 503, "HttpGetText", "HotelCost API unreachable after 4 attempts (" & errText & ")."
End Function

' Parses the TSV contract into a Dictionary:
'   ("meta") -> Dictionary key->value ; ("summary") -> Dictionary key->Array(value,status,note)
'   ("checks") -> Collection of Array(6) ; ("sections") -> Dictionary key -> Dictionary(status,note,rows,cols,types,data)
Public Function FetchFullCost() As Object
    Set FetchFullCost = ParseExport(HttpGetText(BuildExportUrl()))
End Function

Public Function ParseExport(ByVal text As String) As Object
    Dim result As Object, meta As Object, summary As Object, sections As Object, checks As Collection
    Dim lines() As String
    Dim i As Long, mode As String
    Dim f() As String
    Dim sec As Object
    Dim nRows As Long, nCols As Long, r As Long, c As Long
    Dim colSpec() As String, types() As String, heads() As String, keys() As String
    Dim data() As Variant

    Set result = CreateObject("Scripting.Dictionary")
    Set meta = CreateObject("Scripting.Dictionary")
    Set summary = CreateObject("Scripting.Dictionary")
    Set sections = CreateObject("Scripting.Dictionary")
    Set checks = New Collection
    text = Replace(text, vbCr, "")
    lines = Split(text, vbLf)
    If UBound(lines) < 0 Then Err.Raise vbObjectError + 1, "ParseExport", "Empty export"
    f = Split(lines(0), vbTab)
    If f(0) <> "##EXPORT" Then Err.Raise vbObjectError + 2, "ParseExport", "Not a HotelCost export (missing ##EXPORT header)"
    result("exportVersion") = f(1)
    result("exportId") = f(2)

    i = 1
    Do While i <= UBound(lines)
        If Left$(lines(i), 2) = "##" Then
            f = Split(lines(i), vbTab)
            mode = f(0)
            If mode = "##END" Then
                result("complete") = True
                Exit Do
            ElseIf mode = "##SECTION" Then
                Set sec = CreateObject("Scripting.Dictionary")
                sec("key") = f(1)
                sec("status") = f(2)
                nRows = CLng(f(3))
                If UBound(f) >= 4 Then sec("note") = f(4) Else sec("note") = ""
                i = i + 1
                colSpec = Split(lines(i), vbTab)
                nCols = UBound(colSpec) + 1
                ReDim types(1 To nCols)
                ReDim heads(1 To nCols)
                ReDim keys(1 To nCols)
                For c = 1 To nCols
                    f = Split(colSpec(c - 1), ":", 3)
                    keys(c) = f(0)
                    types(c) = f(1)
                    heads(c) = f(2)
                Next c
                sec("rows") = nRows
                sec("cols") = nCols
                sec("types") = types
                sec("headers") = heads
                sec("keys") = keys
                If nRows > 0 Then
                    ReDim data(1 To nRows, 1 To nCols)
                    For r = 1 To nRows
                        If i + r > UBound(lines) Then Err.Raise vbObjectError + 3, "ParseExport", "Truncated section " & sec("key")
                        f = Split(lines(i + r), vbTab)
                        If UBound(f) + 1 <> nCols Then Err.Raise vbObjectError + 4, "ParseExport", "Column count mismatch in " & sec("key") & " row " & r
                        For c = 1 To nCols
                            data(r, c) = ConvertCell(f(c - 1), types(c))
                        Next c
                    Next r
                    sec("data") = data
                End If
                sections(sec("key")) = sec
                i = i + nRows
            End If
        ElseIf Len(lines(i)) > 0 Then
            f = Split(lines(i), vbTab)
            Select Case mode
                Case "##META"
                    meta(f(0)) = f(1)
                Case "##SUMMARY"
                    summary(f(0)) = Array(f(1), f(2), f(3))
                Case "##CHECKS"
                    checks.Add f
            End Select
        End If
        i = i + 1
    Loop
    If Not result.Exists("complete") Then Err.Raise vbObjectError + 5, "ParseExport", "Export truncated (no ##END marker) - incomplete data is never written."
    Set result("meta") = meta
    Set result("summary") = summary
    Set result("sections") = sections
    Set result("checks") = checks
    Set ParseExport = result
End Function

Public Function ConvertCell(ByVal s As String, ByVal colType As String) As Variant
    If Len(s) = 0 Then
        ConvertCell = Empty
        Exit Function
    End If
    Select Case colType
        Case "int", "qty", "money", "unitcost", "pct"
            ConvertCell = Val(s)
        Case "date"
            ConvertCell = DateSerial(CInt(Mid$(s, 1, 4)), CInt(Mid$(s, 6, 2)), CInt(Mid$(s, 9, 2)))
        Case "datetime"
            ConvertCell = DateSerial(CInt(Mid$(s, 1, 4)), CInt(Mid$(s, 6, 2)), CInt(Mid$(s, 9, 2))) + _
                          TimeSerial(CInt(Mid$(s, 12, 2)), CInt(Mid$(s, 15, 2)), CInt(Mid$(s, 18, 2)))
        Case Else
            ' neutralise spreadsheet formula injection from source data
            If InStr(1, "=+-@", Left$(s, 1)) > 0 Then ConvertCell = "'" & s Else ConvertCell = s
    End Select
End Function
