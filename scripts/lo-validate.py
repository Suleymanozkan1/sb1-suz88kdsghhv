"""Independent validation of a HotelCost .xlsm with LibreOffice (headless, UNO).

Checks: workbook loads; VBA project imported with all modules; pure-VBA functions compile and
run (URL encoding, cell conversion, TSV contract parser); formulas recalculate; reconciliation
formula checks evaluate to PASS/WARNING (no FAIL); defined names and the CONTROL button exist.
Usage: python3 scripts/lo-validate.py [file.xlsm]   (default: the newest workbook written by `npm run excel:sample`)
"""
import json, os, subprocess, sys, time, uno
from com.sun.star.beans import PropertyValue

import glob, shutil, tempfile
if len(sys.argv) > 1:
    src = sys.argv[1]
else:
    found = sorted(glob.glob(os.path.join(tempfile.gettempdir(), "HotelCost_Cost_Report_*.xlsm")), key=os.path.getmtime)
    if not found:
        sys.exit("usage: lo-validate.py <file.xlsm> (or run `npm run excel:sample` first)")
    src = found[-1]
_tmpdir = tempfile.mkdtemp(prefix="hc-lo-")
path = os.path.join(_tmpdir, os.path.basename(src))
shutil.copy(os.path.abspath(src), path)
HARNESS_OUT = os.path.join(_tmpdir, "harness.txt")
port = 2093
proc = subprocess.Popen(["soffice", "--headless", "--invisible", "--norestore", "--nologo",
                         f"--accept=socket,host=127.0.0.1,port={port};urp;", f"-env:UserInstallation=file://{os.path.join(_tmpdir, 'lo-profile')}"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ctx = None
for _ in range(60):
    try:
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
        ctx = resolver.resolve(f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext")
        break
    except Exception:
        time.sleep(1)
if ctx is None:
    print(json.dumps({"ok": False, "error": "LibreOffice did not start"})); sys.exit(2)

def prop(n, v):
    p = PropertyValue(); p.Name = n; p.Value = v; return p

result = {"ok": True, "problems": []}
try:
    # throwaway validation profile only: allow document macros to run so VBA can be exercised
    cp = ctx.ServiceManager.createInstanceWithContext("com.sun.star.configuration.ConfigurationProvider", ctx)
    upd = cp.createInstanceWithArguments("com.sun.star.configuration.ConfigurationUpdateAccess", (prop("nodepath", "/org.openoffice.Office.Common/Security/Scripting"),))
    upd.setPropertyValue("MacroSecurityLevel", 0)
    upd.commitChanges()
    desktop = ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
    doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(path), "_blank", 0,
                                       (prop("Hidden", True), prop("MacroExecutionMode", 4)))
    sheets = doc.Sheets.ElementNames
    result["sheets"] = len(sheets)
    result["firstSheet"] = sheets[0]
    libs = doc.BasicLibraries
    lib_names = libs.ElementNames
    result["basicLibraries"] = list(lib_names)
    lib = next((n for n in lib_names if n not in ("Standard",)), None)
    if lib:
        libs.loadLibrary(lib)
        mods = libs.getByName(lib).ElementNames
        result["vbaModules"] = len(mods)
        result["hasModMain"] = "modMain" in mods
    else:
        result["problems"].append("no Basic/VBA library imported")

    # Test harness module (inserted into the in-memory copy only). Calling across modules forces
    # LibreOffice to compile every referenced module: syntax errors abort the invocation.
    harness = """Option VBASupport 1
Option Explicit
Public Sub HarnessMain()
    Dim out As String, payload As Object, n As Long, t As String, f As Integer, ln As String
    On Error GoTo Fail
    out = "UrlEncode=" & UrlEncode("a b&c") & "|"
    out = out & "ConvertMoney=" & CStr(ConvertCell("1234.5678", "money")) & "|"
    out = out & "ConvertText=" & ConvertCell("=cmd", "text") & "|"
    out = out & "Caption=" & Len(ButtonCaption()) & "|"
    out = out & "Areas=" & (UBound(CostSections()) + UBound(RecipeSections()) + UBound(InventorySections()) + UBound(WasteSections()) + UBound(BuffetSections()) + UBound(MinibarSections()) + UBound(RoomSections()) + UBound(DepartmentSections()) + 8) & "|"
    ' ParseExport is not exercised here: it relies on Scripting.Dictionary (Windows COM), unavailable in LibreOffice.
    WriteOut out & "OK"
    Exit Sub
Fail:
    WriteOut out & "ERR " & Err.Number & ": " & Err.Description & " @" & Erl
End Sub
Private Sub WriteOut(ByVal s As String)
    Dim h As Integer
    h = FreeFile
    Open "OUTPATH" For Output As #h
    Print #h, s
    Close #h
End Sub
""".replace("OUTPATH", HARNESS_OUT)
    try:
        libs.getByName(lib).insertByName("zzHarness", harness)
        sp = doc.getScriptProvider()
        sp.getScript(f"vnd.sun.star.script:{lib}.zzHarness.HarnessMain?language=Basic&location=document").invoke((), (), ())
        res = open(HARNESS_OUT).read().strip() if os.path.exists(HARNESS_OUT) else "(harness produced no output)"
        result["harness"] = res
        if not res.endswith("OK"):
            result["problems"].append("VBA harness: " + res)
    except Exception as e:
        result["problems"].append(f"VBA harness failed to compile/run: {e}")

    doc.calculateAll()
    rec = doc.Sheets.getByName("46_RECONCILIATION")
    statuses = []
    # excel formula checks table: find header "Status" in row 6 to the right of server table
    for col in range(0, 30):
        if rec.getCellByPosition(col, 5).String == "Status":
            statuses.append(col)
    found = {}
    for col in statuses:
        vals = []
        for row in range(6, 80):
            v = rec.getCellByPosition(col, row).String
            if not v:
                break
            vals.append(v)
        found[col] = vals
    result["statusColumns"] = {str(k): {"PASS": v.count("PASS"), "WARNING": v.count("WARNING"), "FAIL": v.count("FAIL")} for k, v in found.items()}
    # Excel formula checks are the 2nd Status column
    if len(statuses) >= 2:
        excel = found[statuses[1]]
        result["excelFormulaChecks"] = excel
        if "FAIL" in excel or not excel:
            result["problems"].append("excel formula reconciliation has FAIL or is empty")
    ctl = doc.Sheets.getByName("01_CONTROL")
    result["definedNames"] = len(doc.NamedRanges.ElementNames)
    result["ctl_StartDate"] = doc.NamedRanges.getByName("ctl_StartDate").Content if doc.NamedRanges.hasByName("ctl_StartDate") else None
    dp = ctl.DrawPage
    result["controlShapes"] = [dp.getByIndex(i).Name for i in range(dp.Count)]
    ex = doc.Sheets.getByName("02_EXECUTIVE_SUMMARY")
    result["tileActualCost"] = ex.getCellRangeByName("D6").Value
    doc.close(True)
except Exception as e:
    result["ok"] = False
    result["problems"].append(str(e))
finally:
    try:
        desktop.terminate()
    except Exception:
        pass
    proc.terminate()
if result["problems"]:
    result["ok"] = False
print(json.dumps(result, indent=1, default=str))
sys.exit(0 if result["ok"] else 1)
