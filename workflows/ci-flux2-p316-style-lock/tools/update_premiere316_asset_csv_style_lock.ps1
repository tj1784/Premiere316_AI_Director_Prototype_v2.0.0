param(
  [Parameter(Mandatory=$true)][string]$InputCsv,
  [Parameter(Mandatory=$true)][string]$OutputCsv,
  [string]$Manifest
)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$arguments = @("$ScriptDir\update_premiere316_asset_csv_style_lock.py", "--input", $InputCsv, "--output", $OutputCsv)
if ($Manifest) { $arguments += @("--manifest", $Manifest) }
python @arguments
