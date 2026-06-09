@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-excel-with-pi.ps1" %*

if errorlevel 1 (
  echo.
  echo Pi for Excel startup failed. Please send the message above to Codex.
  pause
)
