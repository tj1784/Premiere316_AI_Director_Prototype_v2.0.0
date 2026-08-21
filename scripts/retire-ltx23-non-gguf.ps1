$ErrorActionPreference = 'Stop'

$sharedRoot = [IO.Path]::GetFullPath('C:\ComfyUI\ComfyUI_Shared_Folders\models')
$queue = Invoke-RestMethod 'http://127.0.0.1:8188/queue'
if (@($queue.queue_running).Count -ne 0 -or @($queue.queue_pending).Count -ne 0) {
  throw 'ComfyUI queue is not idle.'
}

$extensions = @('.safetensors', '.ckpt', '.pt', '.pth', '.bin')
$allFiles = Get-ChildItem -LiteralPath $sharedRoot -File -Recurse -Force |
  Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() }
$candidates = @($allFiles |
  Where-Object {
    $_.FullName -notmatch '(?i)\\loras\\faceID\\' -and
    (
      $_.FullName -match '(?i)\\LTX\\2\.3\\' -or
      $_.Name -match '(?i)(ltx[-_. ]?2[-_. ]?3|ltx2[-_. ]?3|ltx23|ltx2310eros|LTX23)'
    )
  } |
  Sort-Object FullName)

if ($candidates.Count -lt 1 -or $candidates.Count -gt 76) {
  throw "Unsafe current candidate count $($candidates.Count)."
}

$logicalBytes = ($candidates | Measure-Object Length -Sum).Sum
$manifestDir = 'C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\diagnostics\model-maintenance'
New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$manifestPath = Join-Path $manifestDir "ltx23-retirement-$stamp.csv"
$candidates |
  Select-Object @{Name = 'Action'; Expression = { 'deleted-ltx23-non-gguf' } }, FullName, Length, LastWriteTime |
  Export-Csv -LiteralPath $manifestPath -NoTypeInformation -Encoding utf8

foreach ($file in $candidates) {
  $resolved = [IO.Path]::GetFullPath($file.FullName)
  if (-not $resolved.StartsWith($sharedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing path outside shared root: $resolved"
  }
  if ($file.Extension -ieq '.gguf') {
    throw "Refusing to delete GGUF: $resolved"
  }
  Remove-Item -LiteralPath $resolved
}

$remaining = @(Get-ChildItem -LiteralPath $sharedRoot -File -Recurse -Force |
  Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() } |
  Where-Object {
    $_.FullName -notmatch '(?i)\\loras\\faceID\\' -and
    (
      $_.FullName -match '(?i)\\LTX\\2\.3\\' -or
      $_.Name -match '(?i)(ltx[-_. ]?2[-_. ]?3|ltx2[-_. ]?3|ltx23|ltx2310eros|LTX23)'
    )
  })
$preservedGgufs = @(Get-ChildItem -LiteralPath $sharedRoot -File -Recurse -Force -Filter '*.gguf' |
  Where-Object { $_.FullName -match '(?i)\\LTX\\' -or $_.Name -match '(?i)eros' })
$drive = Get-PSDrive C

[pscustomobject]@{
  DeletedNow = $candidates.Count
  DeletedLogicalBytes = $logicalBytes
  RemainingNonGgufLtx23 = $remaining.Count
  PreservedLtxGgufs = $preservedGgufs.Count
  Manifest = $manifestPath
  FreeGiB = [math]::Round($drive.Free / 1GB, 2)
} | ConvertTo-Json -Compress
