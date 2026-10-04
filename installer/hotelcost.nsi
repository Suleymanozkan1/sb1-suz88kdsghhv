; HotelCost Windows installer (NSIS 3, Modern UI 2).
; Built by installer/build-windows.sh: makensis -DVERSION=x -DSRC=<layout dir> -DOUTFILE=<exe> installer/hotelcost.nsi
Unicode true
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "x64.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
Name "HotelCost ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\HotelCost"
InstallDirRegKey HKLM "Software\HotelCost" "InstallDir"
RequestExecutionLevel admin
BrandingText "HotelCost - hotel cost control"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "HotelCost"
VIAddVersionKey "FileDescription" "HotelCost installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "HotelCost"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "HotelCost ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "This installs the HotelCost cost-control platform on this computer:$\r$\n$\r$\n  - PostgreSQL 16 database (local service)$\r$\n  - HotelCost web application (service, port 3000)$\r$\n$\r$\nAt the end a console window asks for your company, first hotel and administrator account. Upgrading keeps your data."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open HotelCost (http://localhost:3000)"
!define MUI_FINISHPAGE_RUN_FUNCTION OpenApp
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\README.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Show the README"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Turkish"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "HotelCost requires 64-bit Windows 10 / Server 2016 or later."
    Abort
  ${EndIf}
  SetRegView 64
FunctionEnd

Function OpenApp
  ExecShell "open" "http://localhost:3000"
FunctionEnd

Section "HotelCost" SecMain
  SectionIn RO
  SetShellVarContext all
  ; upgrade: stop the running services before files are replaced
  IfFileExists "$INSTDIR\app\setup.cjs" 0 +3
    DetailPrint "Stopping running HotelCost services..."
    nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\app\setup.cjs" stop'

  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"

  WriteRegStr HKLM "Software\HotelCost" "InstallDir" "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\HotelCost" "DisplayName" "HotelCost"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\HotelCost" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\HotelCost" "Publisher" "HotelCost"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\HotelCost" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\HotelCost" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\HotelCost" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\HotelCost" "NoRepair" 1

  ; Windows Firewall: the web application on private / domain networks only
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="HotelCost web"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="HotelCost web" dir=in action=allow protocol=TCP localport=3000 profile=private,domain'

  CreateDirectory "$SMPROGRAMS\HotelCost"
  CreateShortcut "$SMPROGRAMS\HotelCost\HotelCost.lnk" "$INSTDIR\HotelCost-open.cmd" "" "$SYSDIR\shell32.dll" 13
  CreateShortcut "$SMPROGRAMS\HotelCost\HotelCost - Backup.lnk" "$INSTDIR\HotelCost-backup.cmd"
  CreateShortcut "$SMPROGRAMS\HotelCost\HotelCost - Demo data.lnk" "$INSTDIR\HotelCost-demo.cmd"
  CreateShortcut "$SMPROGRAMS\HotelCost\HotelCost - Start.lnk" "$INSTDIR\HotelCost-start.cmd"
  CreateShortcut "$SMPROGRAMS\HotelCost\HotelCost - Stop.lnk" "$INSTDIR\HotelCost-stop.cmd"
  CreateShortcut "$SMPROGRAMS\HotelCost\HotelCost - Status.lnk" "$INSTDIR\HotelCost-status.cmd"
  CreateShortcut "$SMPROGRAMS\HotelCost\README.lnk" "$INSTDIR\README.txt"
  CreateShortcut "$SMPROGRAMS\HotelCost\Uninstall HotelCost.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\HotelCost.lnk" "$INSTDIR\HotelCost-open.cmd" "" "$SYSDIR\shell32.dll" 13

  ; database cluster, migrations, first company (interactive console) and services
  DetailPrint "Setting up the database and services (a console window asks for your company details)..."
  ExecWait '"$SYSDIR\cmd.exe" /c title HotelCost setup & "$INSTDIR\node\node.exe" "$INSTDIR\app\setup.cjs" install --no-browser || (echo. & echo Setup failed - see the message above. & pause & exit /b 1)' $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "HotelCost setup reported an error (code $0).$\r$\nFix the cause shown in the console and run 'HotelCost - Start' or reinstall. Your data is kept in C:\ProgramData\HotelCost."
  ${EndIf}
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  SetRegView 64
  MessageBox MB_YESNO|MB_ICONQUESTION "Also delete ALL HotelCost data (database, backups, logs in C:\ProgramData\HotelCost)?$\r$\n$\r$\nChoose No to keep the data for a later reinstall." IDYES purge
    nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\app\setup.cjs" uninstall'
    Goto removed
  purge:
    nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\app\setup.cjs" uninstall --purge'
  removed:
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="HotelCost web"'
  Delete "$DESKTOP\HotelCost.lnk"
  RMDir /r "$SMPROGRAMS\HotelCost"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\HotelCost"
  DeleteRegKey HKLM "Software\HotelCost"
SectionEnd
