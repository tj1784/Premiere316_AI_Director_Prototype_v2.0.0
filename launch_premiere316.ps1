$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appUrl = "http://127.0.0.1:8789/"
$healthUrl = "http://127.0.0.1:8789/api/health"
$bundledComfyUrl = "http://127.0.0.1:8190"
$comfyUrl = $bundledComfyUrl
$settingsPath = Join-Path $appRoot "config\premiere316.local.json"

function Test-BundledComfyUrl {
  param([string]$Url)
  try {
    $uri = [uri]$Url
    $hostName = ([string]$uri.DnsSafeHost).Trim([char[]]"[]").ToLowerInvariant()
    $isLocalHost = $hostName -in @("localhost", "127.0.0.1", "::1")
    $isRootPath = [string]::IsNullOrEmpty($uri.AbsolutePath) -or $uri.AbsolutePath -eq "/"
    return $uri.Scheme -eq "http" `
      -and $isLocalHost `
      -and $uri.Port -eq 8190 `
      -and $isRootPath `
      -and [string]::IsNullOrEmpty($uri.Query) `
      -and [string]::IsNullOrEmpty($uri.Fragment)
  } catch {
    return $false
  }
}

if (Test-Path -LiteralPath $settingsPath) {
  try {
    $savedSettings = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
    $candidateUrl = [string]$savedSettings.comfyUrl
    $candidateUri = [uri]$candidateUrl
    if ($candidateUri.Scheme -in @("http", "https") -and $candidateUri.Host) {
      $comfyUrl = $candidateUrl.TrimEnd("/")
    }
  } catch {
    Write-Warning "Ignoring invalid Premiere316 ComfyUI setting at $settingsPath"
  }
}
$comfyHealthUrl = "$comfyUrl/system_stats"
$isBundledComfy = Test-BundledComfyUrl $comfyUrl
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

if ($isBundledComfy -and -not (Test-Premiere316ComfyUI)) {
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
