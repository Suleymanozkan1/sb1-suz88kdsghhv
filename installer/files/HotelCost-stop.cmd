@echo off
"%~dp0node\node.exe" "%~dp0app\setup.cjs" stop %*
pause
