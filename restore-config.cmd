@echo off
rem restore-config.cmd - Recover pi-for-excel add-in config after an Office update switches the WEF profile.
rem Double-click = interactive recovery (shows scan result, then asks y/N).
rem CLI with -DryRun = preview only:  restore-config.cmd -DryRun
rem (Named "restore-config", not "recover", to avoid clashing with the Windows built-in RECOVER.EXE.)
chcp 65001 >nul
cd /d "%~dp0"
echo === pi-for-excel add-in config recovery ===
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\recover-wef-storage.ps1" %*
echo.
echo Press any key to close this window...
pause >nul
