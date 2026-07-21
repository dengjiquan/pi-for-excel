param(
  [int]$PollSeconds = 1,
  [int]$ShutdownGraceSeconds = 5
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ManagedPorts = @(3000, 3003, 3340)
$ServiceProcessIds = @()
$ServicesRunning = $false
$LogDir = Join-Path $env:LOCALAPPDATA "PiForExcel"
$LogPath = Join-Path $LogDir "watcher.log"
$ProxyEnvironmentVariables = @(
  "ALLOWED_TARGET_HOSTS",
  "ALLOW_ALL_TARGET_HOSTS",
  "ALLOW_LOOPBACK_TARGETS",
  "ALLOW_PRIVATE_TARGETS"
)

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Write-Log {
  param([string]$Message)
  Add-Content -LiteralPath $LogPath -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)
}

function Import-PersistentEnvironmentVariables {
  foreach ($name in $ProxyEnvironmentVariables) {
    $value = [Environment]::GetEnvironmentVariable($name, "User")
    if ([string]::IsNullOrWhiteSpace($value)) {
      $value = [Environment]::GetEnvironmentVariable($name, "Machine")
    }

    if ([string]::IsNullOrWhiteSpace($value)) {
      Remove-Item -LiteralPath ("Env:{0}" -f $name) -ErrorAction SilentlyContinue
      continue
    }

    Set-Item -LiteralPath ("Env:{0}" -f $name) -Value $value
  }
}

function Get-PortListenerProcessIds {
  param([int]$Port)

  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  return @(
    $listeners |
      Where-Object { $_.OwningProcess -and $_.OwningProcess -ne 0 } |
      Select-Object -ExpandProperty OwningProcess -Unique
  )
}

function Stop-ProcessTree {
  param([int]$TargetProcessId)

  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$TargetProcessId" -ErrorAction SilentlyContinue)
  foreach ($child in $children) {
    Stop-ProcessTree -TargetProcessId ([int]$child.ProcessId)
  }

  Stop-Process -Id $TargetProcessId -Force -ErrorAction SilentlyContinue
}

function Stop-PortListeners {
  param([int]$Port)

  foreach ($processId in (Get-PortListenerProcessIds -Port $Port)) {
    Write-Log ("Stopping process on port {0} (pid {1})" -f $Port, $processId)
    Stop-ProcessTree -TargetProcessId ([int]$processId)
  }
}

function Wait-Port {
  param(
    [int]$Port,
    [string]$Name,
    [int]$TimeoutSeconds = 60
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if ((Get-PortListenerProcessIds -Port $Port).Count -gt 0) {
      Write-Log ("{0} ready on port {1}" -f $Name, $Port)
      return
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  throw ("Timed out waiting for {0} on port {1}" -f $Name, $Port)
}

function Start-PiService {
  param(
    [string]$Name,
    [string]$Command
  )

  $escapedRepoRoot = $RepoRoot.Replace("'", "''")
  $serviceCommand = "Set-Location -LiteralPath '$escapedRepoRoot'; $Command"
  $process = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $serviceCommand) `
    -WindowStyle Hidden `
    -PassThru

  $script:ServiceProcessIds += $process.Id
  Write-Log ("Started {0} (pid {1})" -f $Name, $process.Id)
}

function Start-PiServices {
  if ($script:ServicesRunning) {
    return
  }

  Write-Log "Excel detected; starting Pi for Excel services"
  Import-PersistentEnvironmentVariables

  foreach ($port in $ManagedPorts) {
    Stop-PortListeners -Port $port
  }

  Start-PiService -Name "Pi for Excel web app" -Command "npm run dev"
  Wait-Port -Port 3000 -Name "Pi for Excel web app"

  # ponytail: local dev serves the taskpane on :3000 (npm run dev = vite --port 3000),
  # but upstream's cors-proxy default only trusts :3141. Trust both so the
  # proxy-status probe isn't 403'd as a disallowed origin (→ false "Proxy not running").
  Start-PiService -Name "Pi for Excel proxy" -Command "`$env:HOST='127.0.0.1'; `$env:ALLOW_LOOPBACK_TARGETS='1'; `$env:ALLOWED_ORIGINS='https://localhost:3000,https://localhost:3141'; npm run proxy:https"
  Wait-Port -Port 3003 -Name "Pi for Excel proxy"

  # Python bridge (optional — skip gracefully if Python is not installed)
  $PythonBin = $null
  $pythonCandidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python310\python.exe"),
    "python3",
    "python",
    "py"
  )
  foreach ($candidate in $pythonCandidates) {
    if ((Test-Path -LiteralPath $candidate) -or (Get-Command $candidate -ErrorAction SilentlyContinue)) {
      $PythonBin = $candidate
      break
    }
  }

  if ($PythonBin) {
    $escapedRoot = $RepoRoot.Replace("'", "''")
    $bridgeCommand = "`$env:PYTHON_BRIDGE_MODE='real'; `$env:PYTHON_BRIDGE_PYTHON_BIN='$PythonBin'; `$env:HOST='127.0.0.1'; `$env:ALLOWED_ORIGINS='https://localhost:3000,https://localhost:3141'; Set-Location -LiteralPath '$escapedRoot'; node scripts/python-bridge-server.mjs --https"
    Start-PiService -Name "Pi for Excel python bridge" -Command $bridgeCommand
    Wait-Port -Port 3340 -Name "Pi for Excel python bridge"
  } else {
    Write-Log "Python not found — python bridge skipped"
  }

  $script:ServicesRunning = $true
  Write-Log "Pi for Excel services are running"
}

function Stop-PiServices {
  if (-not $script:ServicesRunning -and $script:ServiceProcessIds.Count -eq 0) {
    return
  }

  Write-Log "Excel closed; stopping Pi for Excel services"

  foreach ($processId in $script:ServiceProcessIds) {
    Stop-ProcessTree -TargetProcessId ([int]$processId)
  }

  foreach ($port in $ManagedPorts) {
    Stop-PortListeners -Port $port
  }

  $script:ServiceProcessIds = @()
  $script:ServicesRunning = $false
  Write-Log "Pi for Excel services stopped"
}

function Test-ExcelRunning {
  return ((@(Get-Process -Name "EXCEL" -ErrorAction SilentlyContinue)).Count -gt 0)
}

try {
  Write-Log ("Watcher started. Repo: {0}" -f $RepoRoot)

  while ($true) {
    if (Test-ExcelRunning) {
      try {
        Start-PiServices
      }
      catch {
        Write-Log ("Failed to start services: {0}" -f $_.Exception.Message)
        Stop-PiServices
        Start-Sleep -Seconds 5
      }
    }
    elseif ($ServicesRunning) {
      Start-Sleep -Seconds $ShutdownGraceSeconds
      if (-not (Test-ExcelRunning)) {
        Stop-PiServices
      }
    }

    Start-Sleep -Seconds $PollSeconds
  }
}
finally {
  Stop-PiServices
  Write-Log "Watcher stopped"
}
