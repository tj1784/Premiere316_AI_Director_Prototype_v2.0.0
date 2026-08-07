param(
  [Parameter(Mandatory = $true)]
  [int]$OldProcessId
)

$ErrorActionPreference = "Stop"
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$helper = Join-Path $appRoot "restart_premiere316_app.ps1"
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source

Start-Process -FilePath $powershell `
  -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$helper`"",
    "-OldProcessId", $OldProcessId
  ) `
  -WorkingDirectory $appRoot `
  -WindowStyle Hidden
