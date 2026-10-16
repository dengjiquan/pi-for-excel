' Launches the Pi for Excel watcher with zero console flash.
' wscript is a GUI-subsystem host, so unlike powershell.exe -WindowStyle Hidden
' (which flashes a console window before hiding itself) nothing is ever visible.
Dim scriptDir, shell
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptDir & "\watch-excel-pi-services.ps1""", 0, False
