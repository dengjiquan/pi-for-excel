<#
.SYNOPSIS
  Recover pi-for-excel add-in config after an Office update switches the WEF profile.

.DESCRIPTION
  Office updates switch the WebView2 WEF profile path, abandoning the add-in's
  IndexedDB (API key / workbook rules) and OPFS (custom skills) data in the old
  profile; the active profile becomes empty, so all config appears "lost".
  This script copies the old profile's data to the active profile.

  It follows https_localhost_3000.indexeddb.leveldb to find each profile's storage
  root, picks the largest (source = old data) and the most recently modified
  (target = active profile), then copies IndexedDB\{leveldb,blob} + File System.
  Existing target data is preserved as .bak.

  NOTE: English-only output on purpose. Windows PowerShell 5.1 on a zh-CN system
  reads .ps1 as GBK, so UTF-8 Chinese/emoji would mojibake and break parsing.
  Pure ASCII is encoding-safe.

.PARAMETER DryRun
  Preview only; do not change anything.

.PARAMETER Force
  Skip the confirmation prompt.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\recover-wef-storage.ps1 -DryRun
  powershell -ExecutionPolicy Bypass -File scripts\recover-wef-storage.ps1
#>
param(
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$root = Join-Path $env:LOCALAPPDATA "Microsoft\Office\16.0\Wef\webview2"
$dbName = "https_localhost_3000.indexeddb.leveldb"

if (-not (Test-Path $root)) { Write-Host "ERROR: WEF dir not found: $root"; exit 1 }

Write-Host "Scanning profiles: $root"
$dbDirs = Get-ChildItem -Path $root -Recurse -Directory -Filter $dbName -ErrorAction SilentlyContinue

if (-not $dbDirs) {
  Write-Host "ERROR: No pi-for-excel add-in data found ($dbName)."
  Write-Host "  Did you ever configure it on https://localhost:3000?"
  exit 1
}

$candidates = @()
foreach ($d in $dbDirs) {
  $storageRoot = Split-Path (Split-Path $d.FullName -Parent) -Parent
  $size = (Get-ChildItem -Path $d.FullName -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
  if (-not $size) { $size = 0 }
  $candidates += [PSCustomObject]@{
    Size  = $size
    Mtime = (Get-Item $d.FullName).LastWriteTime
    Root  = $storageRoot
  }
}

Write-Host ""
Write-Host "Found $($candidates.Count) profile(s) with data:"
for ($i = 0; $i -lt $candidates.Count; $i++) {
  $c = $candidates[$i]
  $kb = [math]::Round($c.Size / 1KB)
  Write-Host ("  [{0}] {1} KB  {2}  {3}" -f $i, $kb, $c.Mtime.ToString('yyyy-MM-dd HH:mm'), $c.Root)
}

# source = largest size (old data); target = newest mtime (active profile)
$src = $candidates | Sort-Object Size -Descending | Select-Object -First 1
$dst = $candidates | Sort-Object Mtime -Descending | Select-Object -First 1

if ($candidates.Count -eq 1) {
  Write-Host ""
  Write-Host "Only one profile found; no old store to recover from (not switched yet, or already recovered)."
  exit 0
}

if ($src.Root -eq $dst.Root) {
  $kb = [math]::Round($src.Size / 1KB)
  Write-Host ""
  Write-Host "The largest profile is also the most recently active ($kb KB) - active profile already has data, nothing to recover."
  Write-Host "  If config is still missing, the cause is likely elsewhere."
  exit 0
}

$srcKb = [math]::Round($src.Size / 1KB)
$dstKb = [math]::Round($dst.Size / 1KB)
Write-Host ""
Write-Host "======================================================"
Write-Host " SOURCE (old store) : $srcKb KB"
Write-Host "   $($src.Root)"
Write-Host " TARGET (active)    : $dstKb KB"
Write-Host "   $($dst.Root)"
Write-Host "======================================================"

if ($DryRun) {
  Write-Host ""
  Write-Host "[dry-run] Would copy these 3 items source -> target (no changes made):"
  Write-Host "  - IndexedDB\https_localhost_3000.indexeddb.leveldb"
  Write-Host "  - IndexedDB\https_localhost_3000.indexeddb.blob (if present)"
  Write-Host "  - File System\ (OPFS, custom skills)"
  Write-Host "If TARGET above is not the currently active profile, double-check the path next time."
  exit 0
}

Write-Host ""
Write-Host "Checking Excel process..."
if (Get-Process -Name EXCEL -ErrorAction SilentlyContinue) {
  Write-Host "ERROR: EXCEL.EXE is running! Fully exit Excel first (else data may corrupt)."
  exit 1
}
Write-Host "OK: Excel not running"

if ($dstKb -gt 1) {
  Write-Host "WARN: target already has $dstKb KB (not empty); may have been recovered already. Existing data will be moved to .bak."
}

if (-not $Force) {
  Write-Host ""
  $ans = Read-Host "Copy old store to target profile? [y/N]"
  if ($ans -notmatch '^[yY]') { Write-Host "Cancelled."; exit 0 }
}

function Migrate {
  param($name, $rel)
  $sp = Join-Path $src.Root $rel
  $dp = Join-Path $dst.Root $rel
  if (-not (Test-Path $sp)) { Write-Host "  - source missing $name, skipped"; return }
  if (Test-Path $dp) {
    $bak = "$dp.bak"
    if (Test-Path $bak) { Remove-Item $bak -Recurse -Force }
    Move-Item $dp $bak
  }
  Copy-Item -Path $sp -Destination $dp -Recurse -Force
  $sz = [math]::Round(((Get-ChildItem -Path $dp -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum) / 1KB)
  Write-Host "  + $name -> $sz KB (old target data -> .bak)"
}

Write-Host ""
Write-Host "Migrating..."
Migrate "IndexedDB(leveldb)" "IndexedDB\https_localhost_3000.indexeddb.leveldb"
Migrate "IndexedDB(blob)"    "IndexedDB\https_localhost_3000.indexeddb.blob"
Migrate "OPFS(File System)"  "File System"

Write-Host ""
Write-Host "DONE! Reopen Excel + add-in; config should be fully back."
