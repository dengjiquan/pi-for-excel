@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-excel-watcher.ps1"

if errorlevel 1 (
  echo.
  echo Pi for Excel watcher install failed. Please send the message above to Codex.
  pause
)
