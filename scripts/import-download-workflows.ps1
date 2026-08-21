[CmdletBinding()]
param(
    [string]$DownloadsRoot = 'C:\Users\Blokey\Downloads',
    [string]$SharedWorkflowsRoot = 'C:\ComfyUI\ComfyUI_Shared_Folders\workflows',
    [string]$ManifestRoot = 'C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\diagnostics\model-maintenance'
)

$ErrorActionPreference = 'Stop'

function Get-ComfyWorkflowKind {
    param([Parameter(Mandatory)][string]$LiteralPath)

    try {
        $document = Get-Content -LiteralPath $LiteralPath -Raw | ConvertFrom-Json -AsHashtable
    }
    catch {
        return $null
    }

    if ($document -is [hashtable] -and $document.ContainsKey('nodes') -and $document.nodes -is [System.Collections.IEnumerable]) {
        return 'Visual'
    }

    if ($document -is [hashtable] -and $document.Count -gt 0) {
        $values = @($document.Values)
        $apiNodes = @($values | Where-Object { $_ -is [hashtable] -and $_.ContainsKey('class_type') })
        if ($apiNodes.Count -eq $values.Count) {
            return 'API'
        }
    }

    return $null
}

if (-not (Test-Path -LiteralPath $DownloadsRoot -PathType Container)) {
    throw "Downloads directory does not exist: $DownloadsRoot"
}

$destinationRoot = Join-Path $SharedWorkflowsRoot 'Downloads Imported'
$visualRoot = Join-Path $destinationRoot 'Visual'
$apiRoot = Join-Path $destinationRoot 'API'
New-Item -ItemType Directory -Path $visualRoot, $apiRoot, $ManifestRoot -Force | Out-Null

$existingByHash = @{}
Get-ChildItem -LiteralPath $SharedWorkflowsRoot -Recurse -File -Filter '*.json' | ForEach-Object {
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    if (-not $existingByHash.ContainsKey($hash)) {
        $existingByHash[$hash] = $_.FullName
    }
}

$records = [System.Collections.Generic.List[object]]::new()
$sources = @(Get-ChildItem -LiteralPath $DownloadsRoot -File -Filter '*.json' | Sort-Object Name)

foreach ($source in $sources) {
    $kind = Get-ComfyWorkflowKind -LiteralPath $source.FullName
    if (-not $kind) {
        continue
    }

    $hash = (Get-FileHash -LiteralPath $source.FullName -Algorithm SHA256).Hash
    if ($existingByHash.ContainsKey($hash)) {
        $keeper = $existingByHash[$hash]
        Remove-Item -LiteralPath $source.FullName
        $records.Add([pscustomobject]@{
            Action = 'DeletedExactDuplicate'
            Kind = $kind
            Source = $source.FullName
            Destination = $keeper
            Bytes = $source.Length
            SHA256 = $hash
        })
        continue
    }

    $kindRoot = if ($kind -eq 'API') { $apiRoot } else { $visualRoot }
    $destination = Join-Path $kindRoot $source.Name
    if (Test-Path -LiteralPath $destination) {
        $destination = Join-Path $kindRoot (('{0}__{1}{2}' -f $source.BaseName, $hash.Substring(0, 10), $source.Extension))
    }

    Move-Item -LiteralPath $source.FullName -Destination $destination
    $moved = Get-Item -LiteralPath $destination
    if ($moved.Length -ne $source.Length) {
        throw "Byte-count mismatch after moving $($source.FullName)"
    }

    $existingByHash[$hash] = $destination
    $records.Add([pscustomobject]@{
        Action = 'Moved'
        Kind = $kind
        Source = $source.FullName
        Destination = $destination
        Bytes = $source.Length
        SHA256 = $hash
    })
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$manifest = Join-Path $ManifestRoot "download-workflow-import-$stamp.csv"
$records | Export-Csv -LiteralPath $manifest -NoTypeInformation -Encoding utf8

$remaining = @(
    Get-ChildItem -LiteralPath $DownloadsRoot -File -Filter '*.json' |
        Where-Object { Get-ComfyWorkflowKind -LiteralPath $_.FullName }
)

[pscustomobject]@{
    Moved = @($records | Where-Object Action -eq 'Moved').Count
    ExactDuplicatesDeleted = @($records | Where-Object Action -eq 'DeletedExactDuplicate').Count
    RemainingStandaloneComfyWorkflowsInDownloads = $remaining.Count
    Manifest = $manifest
    DestinationRoot = $destinationRoot
} | ConvertTo-Json -Compress
