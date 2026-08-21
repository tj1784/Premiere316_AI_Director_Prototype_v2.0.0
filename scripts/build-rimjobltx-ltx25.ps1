[CmdletBinding()]
param(
    [string]$BaseWorkflow = 'C:\ComfyUI\ComfyUI_Shared_Folders\workflows\LTX\2.5\ltx25BasicWorkflowT2V_v10.json',
    [string]$LegacyWorkflow = 'C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\workflows\RIMJOBLTX.json',
    [string]$Destination = 'C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\workflows\Premiere316\RIMJOBLTX_LTX25_720x480_5s.json'
)

$ErrorActionPreference = 'Stop'
$script:OriginalDestinationExisted = Test-Path -LiteralPath $Destination

function Get-Node {
    param([hashtable]$Workflow, [int]$Id)
    $node = @($Workflow.nodes | Where-Object { $_.id -eq $Id })
    if ($node.Count -ne 1) {
        throw "Expected one node $Id, found $($node.Count)"
    }
    return $node[0]
}

function Remove-RootNodeAndLinks {
    param(
        [hashtable]$Workflow,
        [int]$NodeId,
        [int[]]$LinkIds
    )

    $Workflow.nodes = @($Workflow.nodes | Where-Object { [int]$_.id -ne $NodeId })
    $Workflow.links = @($Workflow.links | Where-Object { [int]$_[0] -notin $LinkIds })

    foreach ($node in @($Workflow.nodes)) {
        foreach ($input in @($node.inputs)) {
            if ($null -ne $input.link -and [int]$input.link -in $LinkIds) {
                $input.link = $null
            }
        }
        foreach ($output in @($node.outputs)) {
            if ($null -ne $output.links) {
                $output.links = @($output.links | Where-Object {
                    $null -eq $_ -or [int]$_ -notin $LinkIds
                })
            }
        }
    }
}

$base = Get-Content -LiteralPath $BaseWorkflow -Raw | ConvertFrom-Json -AsHashtable
$legacy = Get-Content -LiteralPath $LegacyWorkflow -Raw | ConvertFrom-Json -AsHashtable

$legacyOuter = Get-Node -Workflow $legacy -Id 320
$legacyPrompt = [string]$legacyOuter.widgets_values[0]
$legacySceneImage = [string](Get-Node -Workflow $legacy -Id 328).widgets_values[0]
$legacyActorImage = [string](Get-Node -Workflow $legacy -Id 331).widgets_values[0]

# Keep the native LTX 2.5 I2V branch enabled and the duplicate T2V branch bypassed.
foreach ($node in @($base.nodes)) {
    if ($node.pos[1] -lt 5500) {
        if ($node.mode -eq 4) { $node.mode = 0 }
    }
    else {
        $node.mode = 4
    }
}

# KJNodes' experimental LTX2_NAG node is not safe with the LTX 2.5 INT8
# ConvRot connector on this runtime. Remove it from both I2V/T2V branches and
# route the selected model directly into each first sampler subgraph.
$activeModelLink = @($base.links | Where-Object { [int]$_[0] -eq 14172 })
if ($activeModelLink.Count -ne 1 -or [int]$activeModelLink[0][1] -ne 5387) {
    throw 'Expected active model link 14172 from GetNode 5387.'
}
$activeModelLink[0][3] = 5723
$activeModelLink[0][4] = 2
Remove-RootNodeAndLinks -Workflow $base -NodeId 5004 -LinkIds @(14006, 14007, 14538)
@((Get-Node -Workflow $base -Id 5723).inputs | Where-Object name -eq 'model')[0].link = 14172

$inactiveModelLink = @($base.links | Where-Object { [int]$_[0] -eq 14593 })
if ($inactiveModelLink.Count -ne 1 -or [int]$inactiveModelLink[0][1] -ne 5791) {
    throw 'Expected inactive model link 14593 from GetNode 5791.'
}
$inactiveModelLink[0][3] = 5827
$inactiveModelLink[0][4] = 2
Remove-RootNodeAndLinks -Workflow $base -NodeId 5816 -LinkIds @(14594, 14595, 14614)
@((Get-Node -Workflow $base -Id 5827).inputs | Where-Object name -eq 'model')[0].link = 14593

# Exact LTX 2.5 model components downloaded into the category roots.
(Get-Node -Workflow $base -Id 5581).widgets_values = @(
    'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors',
    'default'
)
(Get-Node -Workflow $base -Id 5582).widgets_values = @(
    'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
    'ltxv',
    'default'
)
(Get-Node -Workflow $base -Id 5580).widgets_values = @('LTX\2.5\ltx-2.5-video-vae-bf16.safetensors')
(Get-Node -Workflow $base -Id 5579).widgets_values = @('LTX\2.5\ltx-2.5-audio-vae-bf16.safetensors')

# The downloaded template retained two stale LTX 2.3 upscaler defaults inside
# reusable subgraph definitions. They are part of the 2.5 topology and must use
# the 2.5 latent upscaler even when their containing branch is initially hidden.
foreach ($subgraph in @($base.definitions.subgraphs)) {
    foreach ($node in @($subgraph.nodes)) {
        if ($node.type -eq 'LatentUpscaleModelLoader') {
            $node.widgets_values = @('LTX\2.5\ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors')
        }
    }
}

# Keep the disabled T2V branch internally valid so Workflow Overview does not
# report missing selectors merely because those nodes are bypassed.
(Get-Node -Workflow $base -Id 5800).widgets_values = @('LTX\2.5\ltx-2.5-video-vae-bf16.safetensors')
(Get-Node -Workflow $base -Id 5799).widgets_values = @('LTX\2.5\ltx-2.5-audio-vae-bf16.safetensors')

# Reuse the active RIMJOBLTX image and prompt. DenoMultiImageLoader accepts a
# newline-delimited image list; the same image remains the scene/actor anchor.
$imageLoader = Get-Node -Workflow $base -Id 5713
$imageLoader.widgets_values[0] = $legacySceneImage
$imageLoader.widgets_values[1] = 'Manual Input'
$imageLoader.widgets_values[2] = '3:2'
$imageLoader.widgets_values[3] = 0.098304
$imageLoader.widgets_values[4] = 384
$imageLoader.widgets_values[5] = 256
$imageLoader.widgets_values[6] = '32'
$imageLoader.widgets_values[7] = 'lanczos'
$imageLoader.widgets_values[8] = 'Center Crop (Fill)'

$resolution = Get-Node -Workflow $base -Id 5714
$resolution.widgets_values[0] = 'Manual Input'
$resolution.widgets_values[1] = '3:2'
$resolution.widgets_values[2] = 0.098304
$resolution.widgets_values[3] = 384
$resolution.widgets_values[4] = 256
$resolution.widgets_values[5] = '32'
$resolution.widgets_values[6] = 'Center Crop (Fill)'

$prompt = Get-Node -Workflow $base -Id 5317
$prompt.widgets_values = @(
    $legacyPrompt,
    'English',
    24,
    $true,
    'scene cut, character replacement, identity drift, duplicate person, extra limbs, malformed hands, malformed feet, blurry face, subtitles, watermark'
)

(Get-Node -Workflow $base -Id 5329).widgets_values = @(24.0)
(Get-Node -Workflow $base -Id 5036).widgets_values = @(5)
(Get-Node -Workflow $base -Id 5720).widgets_values = @(384, 256, 121, 1)
(Get-Node -Workflow $base -Id 5721).widgets_values = @(121, 24, 1)
(Get-Node -Workflow $base -Id 5726).widgets_values = @('LTX\2.5\ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors')

$saveNode = Get-Node -Workflow $base -Id 5729
$saveNode.title = 'RIMJOBLTX LTX 2.5 · Final'
if ($saveNode.widgets_values -is [hashtable]) {
    $saveNode.widgets_values.filename_prefix = 'RIMJOBLTX_LTX25'
    $saveNode.widgets_values.frame_rate = 24
}

# The native workflow refines at 2x latent resolution. Generate on a model-safe
# 384x256 grid (which refines to 768x512), then proportionally downscale the
# decoded frames to the exact requested 720x480 delivery size.
$decodeNode = Get-Node -Workflow $base -Id 5728
$decodeToSave = @($base.links | Where-Object {
    $_[1] -eq 5728 -and $_[2] -eq 0 -and $_[3] -eq 5729 -and $_[4] -eq 0
})
if ($decodeToSave.Count -ne 1) {
    throw "Expected one decoded-image link into node 5729, found $($decodeToSave.Count)"
}
$decodeLink = $decodeToSave[0]
$scaleNodeId = 5835
if (@($base.nodes | Where-Object id -eq $scaleNodeId).Count -ne 0) {
    throw "Reserved ImageScale node ID $scaleNodeId is already in use"
}
$scaleToSaveLinkId = 14647
if (@($base.links | Where-Object { $_[0] -eq $scaleToSaveLinkId }).Count -ne 0) {
    throw "Reserved ImageScale link ID $scaleToSaveLinkId is already in use"
}
$decodeLink[3] = $scaleNodeId
$decodeLink[4] = 0
$scaleNode = @{
    id = $scaleNodeId
    type = 'ImageScale'
    pos = @(9820, 3420)
    size = @(270, 130)
    flags = @{}
    order = ((@($base.nodes | ForEach-Object order | Measure-Object -Maximum).Maximum) + 1)
    mode = 0
    inputs = @(@{ name = 'image'; type = 'IMAGE'; link = $decodeLink[0] })
    outputs = @(@{ name = 'IMAGE'; type = 'IMAGE'; links = @($scaleToSaveLinkId) })
    properties = @{
        cnr_id = 'comfy-core'
        ver = '0.30.2'
        'Node name for S&R' = 'ImageScale'
    }
    widgets_values = @('lanczos', 720, 480, 'center')
}
$base.nodes += $scaleNode
$base.links += ,@($scaleToSaveLinkId, $scaleNodeId, 0, 5729, 0, 'IMAGE')
@($saveNode.inputs | Where-Object name -eq 'images')[0].link = $scaleToSaveLinkId
$base.last_node_id = [math]::Max([int]$base.last_node_id, $scaleNodeId)
$base.last_link_id = [math]::Max([int]$base.last_link_id, $scaleToSaveLinkId)

$base.id = [guid]::NewGuid().ToString()
$base.revision = 0
$base.extra.workspace_info.id = [guid]::NewGuid().ToString('N')
$base.extra.ds.scale = 0.75
$base.extra.ds.offset = @(
    4100,
    -3000
)

# Leave a concise provenance note without changing executable topology.
$note = Get-Node -Workflow $base -Id 5045
$note.title = 'RIMJOBLTX LTX 2.5 · NAG-safe migration'
$note.widgets_values = @("Migrated from RIMJOBLTX.json. Native LTX 2.5 I2V branch, 384x256 first stage, 768x512 refinement, exact 720x480 decoded delivery, 5 seconds at 24 fps. LTX2_NAG is removed from both branches because the experimental node is incompatible with the INT8 ConvRot connector on this runtime. Scene image: $legacySceneImage. Actor image in legacy graph: $legacyActorImage. The deleted LTX 2.3 content LoRAs were intentionally not substituted into the 2.5 model.")

# Structural checks before writing.
$ids = @($base.nodes | ForEach-Object { [string]$_.id })
if (@($ids | Group-Object | Where-Object Count -gt 1).Count -ne 0) {
    throw 'Duplicate root node IDs in repaired workflow'
}
if (@($base.nodes | Where-Object type -eq 'LTX2_NAG').Count -ne 0) {
    throw 'An LTX2_NAG root node remains in the rebuilt workflow'
}

foreach ($link in @($base.links)) {
    if ($link.Count -lt 6) { throw "Malformed link: $($link | ConvertTo-Json -Compress)" }
    if ([string]$link[1] -notin $ids -or [string]$link[3] -notin $ids) {
        throw "Root link references a missing node: $($link | ConvertTo-Json -Compress)"
    }
}

$parent = Split-Path -Parent $Destination
New-Item -ItemType Directory -Path $parent -Force | Out-Null
if ($script:OriginalDestinationExisted) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Copy-Item -LiteralPath $Destination -Destination "$Destination.before-$stamp.bak"
}

$json = $base | ConvertTo-Json -Depth 100 -Compress
$null = $json | ConvertFrom-Json -AsHashtable
[IO.File]::WriteAllText($Destination, $json, [Text.UTF8Encoding]::new($false))

[pscustomobject]@{
    Destination = $Destination
    WorkflowId = $base.id
    Nodes = @($base.nodes).Count
    Links = @($base.links).Count
    Subgraphs = @($base.definitions.subgraphs).Count
    SceneImage = $legacySceneImage
    ActorImage = $legacyActorImage
    PromptCharacters = $legacyPrompt.Length
} | ConvertTo-Json -Compress
