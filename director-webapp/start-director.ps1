param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$appRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$repoRoot = [IO.Path]::GetFullPath((Split-Path -Parent $appRoot))
$stateRoot = Join-Path $appRoot 'state'
$stdoutLog = Join-Path $stateRoot 'director.stdout.log'
$stderrLog = Join-Path $stateRoot 'director.stderr.log'
$url = 'http://127.0.0.1:8791'

New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null

$alreadyRunning = $false
try {
  $response = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2
  $alreadyRunning = $null -ne $response
} catch {
  $alreadyRunning = $false
}

if (-not $alreadyRunning) {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  Start-Process -FilePath $node `
    -ArgumentList @((Join-Path $appRoot 'server.mjs')) `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog | Out-Null

  $deadline = (Get-Date).AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 250
    try {
      $response = Invoke-RestMethod -Uri "$url/api/workspace" -TimeoutSec 2
      if ($null -ne $response) { $alreadyRunning = $true }
    } catch {
      $alreadyRunning = $false
    }
  } while (-not $alreadyRunning -and (Get-Date) -lt $deadline)

  if (-not $alreadyRunning) {
    $detail = if (Test-Path -LiteralPath $stderrLog) { Get-Content -LiteralPath $stderrLog -Raw } else { 'No server error log was written.' }
    throw "LTX 2.5 Director did not start on port 8791.`n$detail"
  }
}

if (-not $NoBrowser) {
  Start-Process $url | Out-Null
}

Write-Host "LTX 2.5 Director is ready: $url"
