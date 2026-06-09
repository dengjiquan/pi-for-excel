$ErrorActionPreference = "Stop"

$TaskName = "Pi for Excel Watcher"
$WatcherPath = Join-Path $PSScriptRoot "watch-excel-pi-services.ps1"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$StartupShortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "Pi for Excel Watcher.lnk"
$watcherArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$WatcherPath"""

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
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
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = $watcherArguments
  $shortcut.WorkingDirectory = $RepoRoot
  $shortcut.WindowStyle = 7
  $shortcut.Description = "Pi for Excel background watcher"
  $shortcut.Save()

  Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $WatcherPath) `
    -WindowStyle Hidden

  Write-Host "Scheduled task was not allowed, so Startup-folder watcher was installed instead."
  Write-Host "Startup shortcut: $StartupShortcutPath"
}

Write-Host "Log: $env:LOCALAPPDATA\PiForExcel\watcher.log"
