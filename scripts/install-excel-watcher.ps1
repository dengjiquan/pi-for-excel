$ErrorActionPreference = "Stop"

$TaskName = "Pi for Excel Watcher"
$SilentLauncherPath = Join-Path $PSScriptRoot "watch-excel-pi-silent.vbs"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$StartupShortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "Pi for Excel Watcher.lnk"
# wscript wrapper: powershell -WindowStyle Hidden still flashes a console at logon,
# which looks like a mystery terminal and gets the entry disabled in Task Manager.
$watcherArguments = """" + $SilentLauncherPath + """"

$action = New-ScheduledTaskAction `
  -Execute "wscript.exe" `
  -Argument $watcherArguments

$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Days 30)

try {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Starts Pi for Excel local services when Excel is running, and stops them when Excel closes." `
    -Force | Out-Null

  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Installed and started scheduled task: $TaskName"
}
catch {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($StartupShortcutPath)
  $shortcut.TargetPath = "wscript.exe"
  $shortcut.Arguments = $watcherArguments
  $shortcut.WorkingDirectory = $RepoRoot
  $shortcut.WindowStyle = 7
  $shortcut.Description = "Pi for Excel background watcher"
  $shortcut.Save()

  Start-Process -FilePath "wscript.exe" -ArgumentList $watcherArguments

  Write-Host "Scheduled task was not allowed, so Startup-folder watcher was installed instead."
  Write-Host "Startup shortcut: $StartupShortcutPath"
}

Write-Host "Log: $env:LOCALAPPDATA\PiForExcel\watcher.log"
