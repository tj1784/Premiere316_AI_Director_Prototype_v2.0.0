$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appUrl = "http://127.0.0.1:8789/"
$healthUrl = "http://127.0.0.1:8789/api/health"
$comfyUrl = "http://127.0.0.1:8190"
$comfyHealthUrl = "$comfyUrl/system_stats"
$engineLauncher = Join-Path $appRoot "BlokeyUI\start_premiere316_engine.ps1"

function Test-Premiere316 {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    return $health.app -eq "premiere316"
  } catch {
    return $false
  }
}

function Test-Premiere316ComfyUI {
  try {
    Invoke-RestMethod -Uri $comfyHealthUrl -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-Premiere316ComfyUI)) {
  if (-not (Test-Path -LiteralPath $engineLauncher)) {
    throw "The Premiere316 ComfyUI routing launcher is missing: $engineLauncher"
  }
  Start-Process -FilePath (Get-Command powershell.exe).Source `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$engineLauncher`"") `
    -WorkingDirectory (Split-Path -Parent $engineLauncher) `
    -WindowStyle Hidden
}

if (-not (Test-Premiere316)) {
  $node = (Get-Command node -ErrorAction Stop).Source
  $environment = @{
    PORT = "8789"
    COMFY_URL = $comfyUrl
  }
  foreach ($entry in $environment.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
  }
  Start-Process -FilePath $node -ArgumentList "server/index.js" -WorkingDirectory $appRoot -WindowStyle Hidden

  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Test-Premiere316) { break }
  }
}

if (-not (Test-Premiere316)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "Premiere316 could not start. Confirm Node.js is installed and port 8789 is available.",
    "Premiere316 AI Director",
    "OK",
    "Error"
  ) | Out-Null
  exit 1
}

Start-Process $appUrl
