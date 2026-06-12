$ErrorActionPreference = "SilentlyContinue"

$TaskName = "Pi for Excel Watcher"
$WatcherPath = Join-Path $PSScriptRoot "watch-excel-pi-services.ps1"
$StartupShortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "Pi for Excel Watcher.lnk"

Stop-ScheduledTask -TaskName $TaskName
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Remove-Item -LiteralPath $StartupShortcutPath -Force

$watcherProcesses = Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($WatcherPath) }

foreach ($process in $watcherProcesses) {
  Stop-Process -Id ([int]$process.ProcessId) -Force
}

foreach ($port in @(3000, 3003, 3340)) {
  $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen)
  foreach ($listener in $listeners) {
    Stop-Process -Id ([int]$listener.OwningProcess) -Force
  }
}

Write-Host "Uninstalled: $TaskName"
