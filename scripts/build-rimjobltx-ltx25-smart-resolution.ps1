[CmdletBinding()]
param(
    [string]$ComfyUrl = 'http://127.0.0.1:8188',
    [string]$SourceWorkflow = 'C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\workflows\Premiere316\RIMJOBLTX_LTX25_720x480_5s.json',
    [string]$OutputWorkflow = 'C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\workflows\Premiere316\LTX_LTX25_SMART_RESOLUTION_40s.json',
    [string]$BackupDirectory = 'C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\diagnostics\ltx25-workflow-backups',
    [int]$FinalWidth = 720,
    [int]$FinalHeight = 480,
    [int]$Seconds = 40,
    [int]$Fps = 24
)

$ErrorActionPreference = 'Stop'

function Get-RootNode {
    param([hashtable]$Graph, [int]$Id)
    $nodes = @($Graph.nodes | Where-Object { [int]$_.id -eq $Id })
    if ($nodes.Count -ne 1) {
        throw "Expected one root node $Id, found $($nodes.Count)."
    }
    return $nodes[0]
}

function Remove-RootNodeAndLinks {
    param([hashtable]$Graph, [int]$NodeId, [int[]]$LinkIds)

    $Graph.nodes = @($Graph.nodes | Where-Object { [int]$_.id -ne $NodeId })
    $Graph.links = @($Graph.links | Where-Object { [int]$_[0] -notin $LinkIds })
    foreach ($node in @($Graph.nodes)) {
        foreach ($input in @($node.inputs)) {
            if ($null -ne $input.link -and [int]$input.link -in $LinkIds) {
                $input.link = $null
            }
        }
        foreach ($output in @($node.outputs)) {
            if ($null -ne $output.links) {
                $output.links = @(
                    $output.links | Where-Object {
                        $null -eq $_ -or [int]$_ -notin $LinkIds
                    }
                )
            }
        }
    }
}

function Assert-QueueEmpty {
    param([string]$Url)
    try {
        $queue = Invoke-RestMethod -Uri "$Url/queue" -TimeoutSec 5
    } catch {
        return
    }
    if (@($queue.queue_running).Count -ne 0 -or @($queue.queue_pending).Count -ne 0) {
        throw 'Refusing to build while ComfyUI has a running or pending job.'
    }
}

foreach ($dimension in @(
    @{ Name = 'FinalWidth'; Value = $FinalWidth },
    @{ Name = 'FinalHeight'; Value = $FinalHeight }
)) {
    if ($dimension.Value -lt 256 -or $dimension.Value -gt 2048 -or $dimension.Value % 2 -ne 0) {
        throw "$($dimension.Name) must be an even integer from 256 through 2048."
    }
}
if ($Fps -lt 1 -or $Fps -gt 30) {
    throw 'Fps must be from 1 through 30.'
}
$frames = 1 + [math]::Floor(($Fps * $Seconds) / 8) * 8
if ($frames -lt 9 -or $frames -gt 993) {
    throw "The requested timing resolves to $frames frames; LTX audio requires 8*n+1 and at most 993."
}

Assert-QueueEmpty -Url $ComfyUrl
if (-not (Test-Path -LiteralPath $SourceWorkflow)) {
    throw "Source workflow does not exist: $SourceWorkflow"
}

$graph = Get-Content -LiteralPath $SourceWorkflow -Raw | ConvertFrom-Json -AsHashtable
if (@($graph.nodes | Where-Object { $_.type -eq 'LTX2_NAG' }).Count -ne 0) {
    throw 'The source workflow is not the NAG-safe LTX 2.5 graph.'
}
if (@($graph.nodes | Where-Object { [int]$_.id -eq 5836 }).Count -ne 0) {
    throw 'Reserved smart-resolution node ID 5836 is already in use.'
}
foreach ($linkId in 14650..14653) {
    if (@($graph.links | Where-Object { [int]$_[0] -eq $linkId }).Count -ne 0) {
        throw "Reserved smart-resolution link ID $linkId is already in use."
    }
}

$positivePrompt = @'
Create an exactly forty-second photorealistic live-action biblical epic as one completely uninterrupted 28 mm anamorphic shot, with no cut, hidden transition, lens change, camera teleportation, full-frame occlusion, or second falling character. Jesus is a tall, broad-shouldered, olive-skinned Mediterranean Jewish man with one unchanged recognizable face, deep-set dark-brown eyes, high cheekbones, a full dark beard, and complete shoulder-length dark wavy hair; he wears layered weathered white burial linen with restrained wounds, is barefoot, and holds one identical golden sword in his right hand. He remains upright, feet-first, calm, and sharply readable while wet black basalt, fractured obsidian, corroded iron, immense chains, ash, embers, black waterfalls, buried faces, and retreating shadows react violently around him; darkness dominates, lit only by a shrinking warm opening and concentrated divine gold. During seconds 0–5, from behind and above his right shoulder, he steps from a ruptured black-stone threshold and accelerates into the abyss as the ledge collapses and the camera dives after him. During seconds 5–11, the camera overtakes him beneath his right arm and settles three meters below in a low frontal tracking view; the opening vanishes, walls and chains streak past, and his sword leaves a narrow golden trail. During seconds 11–18, the shaft contracts around jagged ribs and a collapsing bridge; one slow connected helical move begins around his right side as he subtly angles through debris and the sword cleanly splits one fragment without interrupting his descent. During seconds 18–25, enormous chains snap across his path; Jesus makes one restrained sword sweep, severing them simultaneously, then lowers the blade as their ends crash into ruined arches and the camera completes its single arc below him. During seconds 25–32, the passage opens into a bottomless void; the camera pulls continuously to an extreme wide view of cliffs, suspended ruins, black waterfalls, and distant crimson fissures, holds the monumental scale for two seconds, then accelerates back toward Jesus from below. During seconds 32–36, the colossal chained Gates of Hades emerge beneath him as the camera drops first and skims backward over the obsidian floor; the gates shudder and surrounding shadows flee. During seconds 36–40, Jesus lands upright before the still-closed gates, releasing one circular golden pressure wave that fractures the floor and jolts the camera once before it stabilizes; his linen and hair settle, he raises his eyes, and in near silence says calmly, “I have conquered.” Violent wind, sub-bass, grinding stone, snapping chains, distant lamentation, a growing low male choir, and the sword's hum follow the action continuously; no duplicate Jesus, tumbling, face drift, costume change, sword change, bright hallway, cartoon lava, obscuring smoke, text, logo, or watermark.
'@
$negativePrompt = 'worst quality, inconsistent motion, blurry, jittery, distorted'
$sceneImage = 'ChatGPT Image Aug 4, 2026, 08_11_21 PM.png'

(Get-RootNode -Graph $graph -Id 5036).widgets_values = @($Seconds)
$promptGuide = Get-RootNode -Graph $graph -Id 5317
$promptGuide.widgets_values = @(
    $positivePrompt.Trim(),
    'English',
    $Fps,
    $true,
    $negativePrompt
)

# Use one visible scene guide. Character sheets belong in a dedicated IC-LoRA
# identity path, not as simultaneous frame-zero compositions.
$imageLoader = Get-RootNode -Graph $graph -Id 5713
$imageLoader.widgets_values[0] = $sceneImage
$imageLoader.widgets_values[1] = 'Keep Input Ratio'
$imageLoader.widgets_values[6] = '32'
$imageLoader.widgets_values[7] = 'lanczos'

foreach ($sequencerId in @(5722, 5727)) {
    $sequencer = Get-RootNode -Graph $graph -Id $sequencerId
    $sequencer.widgets_values = @(1, 'frames', $Fps, $true, $false, 0, 0, 1.0)
}

# Remove the optional partial preview. Its root output forced a monolithic,
# non-tiled decode of the entire stage-one video and made cancellation appear hung.
Remove-RootNodeAndLinks -Graph $graph -NodeId 5725 -LinkIds @(14517, 14518, 14539)

$resolutionNode = @{
    id = 5836
    type = 'LTX25ResolutionPlan'
    pos = @(-4776, 3310)
    size = @(420, 180)
    flags = @{}
    order = 83
    mode = 0
    inputs = @()
    outputs = @(
        @{ name = 'final_width'; type = 'INT'; links = @(14652) },
        @{ name = 'final_height'; type = 'INT'; links = @(14653) },
        @{ name = 'stage1_width'; type = 'INT'; links = @(14650) },
        @{ name = 'stage1_height'; type = 'INT'; links = @(14651) },
        @{ name = 'native_x2_width'; type = 'INT'; links = @() },
        @{ name = 'native_x2_height'; type = 'INT'; links = @() },
        @{ name = 'resolution_summary'; type = 'STRING'; links = @() }
    )
    title = 'FINAL SIZE -> SAFE LTX CANVAS -> EXACT OUTPUT'
    properties = @{
        'Node name for S&R' = 'LTX25ResolutionPlan'
        bundle_path = 'custom_nodes/ltx25_smart_controls/__init__.py'
    }
    widgets_values = @($FinalWidth, $FinalHeight)
    color = '#173c50'
    bgcolor = '#245e7b'
}
$graph.nodes += $resolutionNode

$resolutionSetup = Get-RootNode -Graph $graph -Id 5714
$resolutionSetup.inputs = @(
    $resolutionSetup.inputs[0],
    @{ name = 'width'; type = 'INT'; widget = @{ name = 'width' }; link = 14650 },
    @{ name = 'height'; type = 'INT'; widget = @{ name = 'height' }; link = 14651 }
)
$resolutionSetup.widgets_values[0] = 'Manual Input'
$resolutionSetup.widgets_values[5] = '32'
$resolutionSetup.widgets_values[6] = 'Center Crop (Fill)'
$resolutionSetup.widgets_values[7] = 'lanczos'

$finalScale = Get-RootNode -Graph $graph -Id 5835
$finalScale.inputs = @(
    $finalScale.inputs[0],
    @{ name = 'width'; type = 'INT'; widget = @{ name = 'width' }; link = 14652 },
    @{ name = 'height'; type = 'INT'; widget = @{ name = 'height' }; link = 14653 }
)
$finalScale.widgets_values = @('lanczos', $FinalWidth, $FinalHeight, 'center')

$graph.links += ,@(14650, 5836, 2, 5714, 1, 'INT')
$graph.links += ,@(14651, 5836, 3, 5714, 2, 'INT')
$graph.links += ,@(14652, 5836, 0, 5835, 1, 'INT')
$graph.links += ,@(14653, 5836, 1, 5835, 2, 'INT')
$graph.last_node_id = 5836
$graph.last_link_id = 14653
$graph.id = [guid]::NewGuid().ToString()
$graph.revision = 0

$saveNode = Get-RootNode -Graph $graph -Id 5729
$saveNode.title = 'RIMJOBLTX LTX 2.5 · EXACT FINAL RESOLUTION'
if ($saveNode.widgets_values -is [hashtable]) {
    $saveNode.widgets_values.filename_prefix = 'harrowing_ltx25_smart_resolution'
    $saveNode.widgets_values.frame_rate = $Fps
    $saveNode.widgets_values.Remove('videopreview')
}

$note = Get-RootNode -Graph $graph -Id 5045
$note.title = 'LTX-2.5 smart final-resolution repair'
$note.widgets_values = @(
    "Enter the exact delivered width and height in the blue FINAL SIZE node. " +
    "It resolves a safe 32-aligned stage-one canvas, preserves the native x2 " +
    "refinement, and resizes the decoded result to the exact requested pixels. " +
    "The partial AnimateDiff preview was removed because it forced a monolithic " +
    "full-duration VAE decode. Default: $FinalWidth x $FinalHeight, $Seconds s, " +
    "$frames frames at $Fps fps."
)

$nodeIds = @($graph.nodes | ForEach-Object { [int]$_.id })
$linkIds = @($graph.links | ForEach-Object { [int]$_[0] })
if (@($nodeIds | Group-Object | Where-Object Count -gt 1).Count -ne 0) {
    throw 'Duplicate root node IDs after repair.'
}
if (@($linkIds | Group-Object | Where-Object Count -gt 1).Count -ne 0) {
    throw 'Duplicate root link IDs after repair.'
}
foreach ($link in @($graph.links)) {
    if ($link.Count -lt 6 -or [int]$link[1] -notin $nodeIds -or [int]$link[3] -notin $nodeIds) {
        throw "Invalid root link: $($link | ConvertTo-Json -Compress)"
    }
}
foreach ($node in @($graph.nodes)) {
    foreach ($input in @($node.inputs)) {
        if ($null -ne $input.link -and [int]$input.link -notin $linkIds) {
            throw "Node $($node.id) input $($input.name) references missing link $($input.link)."
        }
    }
    foreach ($output in @($node.outputs)) {
        foreach ($linkId in @($output.links)) {
            if ($null -ne $linkId -and [int]$linkId -notin $linkIds) {
                throw "Node $($node.id) output $($output.name) references missing link $linkId."
            }
        }
    }
}
if (@($graph.nodes | Where-Object { [int]$_.id -eq 5725 }).Count -ne 0) {
    throw 'The partial preview node remains after repair.'
}

New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$sourceBackup = Join-Path $BackupDirectory "RIMJOBLTX_LTX25.source-$stamp.json"
Copy-Item -LiteralPath $SourceWorkflow -Destination $sourceBackup
if (Test-Path -LiteralPath $OutputWorkflow) {
    $outputBackup = Join-Path $BackupDirectory "RIMJOBLTX_LTX25.smart-resolution-before-$stamp.json"
    Copy-Item -LiteralPath $OutputWorkflow -Destination $outputBackup
}

$outputDirectory = Split-Path -Parent $OutputWorkflow
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$json = $graph | ConvertTo-Json -Depth 100 -Compress
$null = $json | ConvertFrom-Json -AsHashtable
[IO.File]::WriteAllText($OutputWorkflow, $json, [Text.UTF8Encoding]::new($false))

[pscustomobject]@{
    Workflow = $OutputWorkflow
    OriginalPreserved = $SourceWorkflow
    SourceBackup = $sourceBackup
    Nodes = @($graph.nodes).Count
    Links = @($graph.links).Count
    Final = "${FinalWidth}x${FinalHeight}"
    Stage1 = "$([math]::Ceiling($FinalWidth / 64.0) * 32)x$([math]::Ceiling($FinalHeight / 64.0) * 32)"
    Seconds = $Seconds
    Frames = $frames
    FPS = $Fps
    PreviewNodes = @($graph.nodes | Where-Object { [int]$_.id -eq 5725 }).Count
    SHA256 = (Get-FileHash -LiteralPath $OutputWorkflow -Algorithm SHA256).Hash
} | ConvertTo-Json -Compress
