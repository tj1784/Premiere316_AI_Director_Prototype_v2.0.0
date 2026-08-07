param(
  [Parameter(Mandatory = $true)]
  [int]$OldProcessId
)

$ErrorActionPreference = "Stop"
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$healthUrl = "http://127.0.0.1:8789/api/health"
$stdoutLog = Join-Path $appRoot "premiere316-server.stdout.log"
$stderrLog = Join-Path $appRoot "premiere316-server.stderr.log"

for ($attempt = 0; $attempt -lt 80; $attempt++) {
  if (-not (Get-Process -Id $OldProcessId -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 250
}

$node = (Get-Command node -ErrorAction Stop).Source
$env:PORT = "8789"
$env:COMFY_URL = "http://127.0.0.1:8190"
Start-Process -FilePath $node `
  -ArgumentList "server/index.js" `
  -WorkingDirectory $appRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog

for ($attempt = 0; $attempt -lt 120; $attempt++) {
  Start-Sleep -Milliseconds 250
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.app -eq "premiere316") { exit 0 }
  } catch {}
}

exit 1
