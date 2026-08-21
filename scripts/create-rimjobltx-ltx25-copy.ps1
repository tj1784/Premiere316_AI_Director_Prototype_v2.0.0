param(
    [string]$Source = "C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\workflows\Shared Imports\LTX\2.5\ltx25BasicWorkflowT2V_v10.json",
    [string]$Destination = "C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\workflows\Premiere316\RIMJOBLTX_LTX25_720x480_5s.json"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "Source workflow does not exist: $Source"
}

$workflow = Get-Content -LiteralPath $Source -Raw | ConvertFrom-Json -AsHashtable
$workflow.id = "02b0a3c5-6929-431a-8cad-2a6b5a1ba80e"
$workflow.revision = 0

$positivePrompt = @'
Photorealistic live-action biblical drama at night in the Garden of Gethsemane. Preserve the exact adult Jesus identity from the supplied first-frame image: same face, shoulder-length dark curly hair, full dark beard, brown eyes, white linen robe and natural body proportions. The camera begins from the supplied composition and continues as one coherent cinematic shot. Jesus moves naturally through the moonlit olive grove with restrained grief and prayerful urgency; subtle breathing, robe movement and realistic body mechanics. Ancient gnarled olive trees, exposed silver-gray roots, dark earth, scattered limestone, cool moonlight, faint Jerusalem glow in the distance. Natural synchronized ambient night sound and restrained dramatic atmosphere. No identity drift, no duplicate Jesus, no morphing face, no costume change, no modern objects, no text or subtitles.
'@

$negativePrompt = @'
identity drift, different face, duplicate person, face morphing, beard change, hair change, robe change, deformed hands, extra fingers, fused fingers, missing fingers, malformed feet, extra limbs, distorted anatomy, waxy skin, cartoon, CGI, illustration, blurry face, low detail, frame interpolation artifacts, flicker, stutter, abrupt camera cut, jump cut, subtitles, captions, watermark, logo, modern clothing, modern objects
'@

function Get-Node([int]$Id) {
    $node = $workflow.nodes | Where-Object { [int]$_.id -eq $Id }
    if ($null -eq $node) { throw "Missing expected root node $Id" }
    return $node
}

# Keep only the IMAGE TO VIDEO root lane enabled. The T2V lane is the mirrored
# lower half of the imported workflow and remains preserved but bypassed.
foreach ($node in $workflow.nodes) {
    $y = [double]$node.pos[1]
    $node.mode = if ($y -ge 5721.0) { 4 } else { 0 }
}

(Get-Node 5581).widgets_values = @(
    "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
    "default"
)
(Get-Node 5582).widgets_values = @(
    "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
    "ltxv",
    "default"
)
(Get-Node 5580).widgets_values = @("LTX\2.5\ltx-2.5-video-vae-bf16.safetensors")
(Get-Node 5579).widgets_values = @("LTX\2.5\ltx-2.5-audio-vae-bf16.safetensors")

# Exact test input and low-resolution test dimensions requested by the user.
(Get-Node 5713).widgets_values = @(
    "img_00026_.png",
    "Manual Input",
    "3:2",
    0.3456,
    720,
    480,
    "32",
    "lanczos",
    "Center Crop (Fill)",
    ""
)
(Get-Node 5714).widgets_values = @(
    "Manual Input",
    "3:2",
    0.3456,
    720,
    480,
    "32",
    "Center Crop (Fill)",
    "lanczos",
    0.5,
    0.5,
    1
)

(Get-Node 5036).widgets_values = @(5)
(Get-Node 5329).widgets_values = @(24)

$promptNode = Get-Node 5317
$promptNode.widgets_values = @(
    "",
    $positivePrompt.Trim(),
    "English",
    24,
    $true,
    $negativePrompt.Trim()
)

$outputNode = Get-Node 5729
$outputNode.widgets_values.frame_rate = 24
$outputNode.widgets_values.filename_prefix = "RIMJOBLTX_LTX25_720x480_5s"
$outputNode.widgets_values.save_output = $true

$destinationDirectory = Split-Path -Parent $Destination
if (-not (Test-Path -LiteralPath $destinationDirectory)) {
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
}

$json = $workflow | ConvertTo-Json -Depth 100 -Compress
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($Destination, $json, $utf8NoBom)

[pscustomobject]@{
    Source = $Source
    Destination = $Destination
    WorkflowId = $workflow.id
    EnabledRootNodes = @($workflow.nodes | Where-Object { [int]$_.mode -eq 0 }).Count
    BypassedRootNodes = @($workflow.nodes | Where-Object { [int]$_.mode -eq 4 }).Count
    NodeCount = $workflow.nodes.Count
    LinkCount = $workflow.links.Count
    SubgraphCount = $workflow.definitions.subgraphs.Count
} | ConvertTo-Json -Compress
