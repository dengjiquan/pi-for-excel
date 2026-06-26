param(
  [string]$WorkbookPath = "",
  [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ServiceProcessIds = @()
$ManagedPorts = @(3000, 3003, 3340)
$ProxyEnvironmentVariables = @(
  "ALLOWED_TARGET_HOSTS",
  "ALLOW_ALL_TARGET_HOSTS",
  "ALLOW_LOOPBACK_TARGETS",
  "ALLOW_PRIVATE_TARGETS"
)

function Write-Step {
  param([string]$Message)
  Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message)
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
    Write-Step ("Stopping previous process on port {0} (pid {1})" -f $Port, $processId)
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
      Write-Step ("{0} is ready on port {1}" -f $Name, $Port)
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
  Write-Step ("Started {0} (pid {1})" -f $Name, $process.Id)
}

function Start-ExcelApp {
  if ($WorkbookPath.Trim().Length -gt 0) {
    $resolvedWorkbook = Resolve-Path -LiteralPath $WorkbookPath -ErrorAction Stop
    Write-Step ("Opening Excel workbook: {0}" -f $resolvedWorkbook.Path)
    Start-Process -FilePath "excel.exe" -ArgumentList @($resolvedWorkbook.Path) | Out-Null
    return
  }

  Write-Step "Opening Excel"
  Start-Process -FilePath "excel.exe" | Out-Null
}

try {
  Write-Step ("Repo: {0}" -f $RepoRoot)
  Import-PersistentEnvironmentVariables

  foreach ($port in $ManagedPorts) {
    Stop-PortListeners -Port $port
  }

  Start-PiService -Name "Pi for Excel web app" -Command "npm run dev"
  Wait-Port -Port 3000 -Name "Pi for Excel web app"

  Start-PiService -Name "Pi for Excel proxy" -Command "`$env:HOST='127.0.0.1'; npm run proxy:https"
  Wait-Port -Port 3003 -Name "Pi for Excel proxy"

  # Python bridge (optional — skip gracefully if Python is not installed)
  $PythonBin = $null
  foreach ($candidate in @("python", "python3", "py")) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) {
      $PythonBin = $candidate
      break
    }
  }

  if ($PythonBin) {
    $escapedRoot = $RepoRoot.Replace("'", "''")
    $bridgeCommand = "`$env:PYTHON_BRIDGE_MODE='real'; `$env:PYTHON_BRIDGE_PYTHON_BIN='$PythonBin'; `$env:HOST='127.0.0.1'; Set-Location -LiteralPath '$escapedRoot'; node scripts/python-bridge-server.mjs --https"
    Start-PiService -Name "Pi for Excel python bridge" -Command $bridgeCommand
    Wait-Port -Port 3340 -Name "Pi for Excel python bridge"
  } else {
    Write-Step "Python not found — python bridge skipped (install Python to enable)"
  }

  if ($SelfTest) {
    Write-Step "Self-test passed. Excel will not be opened."
    return
  }

  if ((@(Get-Process -Name "EXCEL" -ErrorAction SilentlyContinue)).Count -gt 0) {
    Write-Step "Excel is already running. Services will stop after all Excel windows are closed."
  }

  Start-ExcelApp

  Write-Step "Waiting for Excel to close. Keep this window open."
  do {
    Start-Sleep -Seconds 3
  } while ((@(Get-Process -Name "EXCEL" -ErrorAction SilentlyContinue)).Count -gt 0)

  Write-Step "Excel closed."
}
finally {
  Write-Step "Stopping Pi for Excel services"

  foreach ($processId in $ServiceProcessIds) {
    Stop-ProcessTree -TargetProcessId ([int]$processId)
  }

  foreach ($port in $ManagedPorts) {
    Stop-PortListeners -Port $port
  }

  Write-Step "Done"
}
