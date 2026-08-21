[CmdletBinding()]
param(
    [string]$ComfyUrl = 'http://127.0.0.1:8188',
    [string]$PromptId = 'b206a0a7-d7ab-41b6-b230-0b898a3c2af1',
    [string]$Destination = 'C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\workflows\Premiere316\RIMJOBLTX_LTX25_720x480_5s.json',
    [string]$BackupDirectory = 'C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\diagnostics\ltx25-workflow-backups'
)

$ErrorActionPreference = 'Stop'

function Get-Node {
    param([hashtable]$Workflow, [int]$Id)
    $node = @($Workflow.nodes | Where-Object { [int]$_.id -eq $Id })
    if ($node.Count -ne 1) {
        throw "Expected one root node $Id, found $($node.Count)"
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
                $output.links = @($output.links | Where-Object { [int]$_ -notin $LinkIds })
            }
        }
    }
}

$queue = Invoke-RestMethod -Uri "$ComfyUrl/queue" -TimeoutSec 15
if (@($queue.queue_running).Count -ne 0 -or @($queue.queue_pending).Count -ne 0) {
    throw 'Refusing to rewrite the active workflow while ComfyUI has running or pending jobs.'
}

$historyRaw = (Invoke-WebRequest -UseBasicParsing -Uri "$ComfyUrl/history/$PromptId" -TimeoutSec 30).Content
$history = $historyRaw | ConvertFrom-Json -AsHashtable
if (-not $history.ContainsKey($PromptId)) {
    throw "Prompt $PromptId is no longer present in ComfyUI history."
}

$record = $history[$PromptId]
$workflow = $record.prompt[3].extra_pnginfo.workflow
if ($null -eq $workflow) {
    throw "Prompt $PromptId does not contain an embedded visual workflow."
}

$errorMessage = @(
    $record.status.messages |
        Where-Object { $_[0] -eq 'execution_error' -and [string]$_[1].node_id -eq '5004' } |
        Select-Object -Last 1
)
if ($errorMessage.Count -ne 1 -or [string]$errorMessage[0][1].node_type -ne 'LTX2_NAG') {
    throw "Prompt $PromptId is not the audited LTX2_NAG node 5004 failure."
}

$apiPrompt = $record.prompt[2]
$promptGuideApi = $apiPrompt['5317']
if ($null -eq $promptGuideApi) {
    throw 'The failed prompt is missing DenoLTXPromptGuide node 5317.'
}

$positivePrompt = [string]$promptGuideApi.inputs.positive_prompt
$negativePrompt = [string]$promptGuideApi.inputs.negative_prompt
if ([string]::IsNullOrWhiteSpace($positivePrompt)) {
    throw 'The failed prompt did not contain a positive prompt to preserve.'
}

# The current KJNodes LTX2_NAG implementation is experimental and its connector
# device move fails for the LTX 2.5 INT8 ConvRot model. Remove both NAG nodes and
# route each model getter directly into its first sampler subgraph.
$activeModelLink = @($workflow.links | Where-Object { [int]$_[0] -eq 14172 })
if ($activeModelLink.Count -ne 1 -or [int]$activeModelLink[0][1] -ne 5387) {
    throw 'Expected active model link 14172 from GetNode 5387.'
}
$activeModelLink[0][3] = 5723
$activeModelLink[0][4] = 2
Remove-RootNodeAndLinks -Workflow $workflow -NodeId 5004 -LinkIds @(14006, 14007, 14538)
(Get-Node -Workflow $workflow -Id 5723).inputs |
    Where-Object name -eq 'model' |
    ForEach-Object { $_.link = 14172 }

$inactiveModelLink = @($workflow.links | Where-Object { [int]$_[0] -eq 14593 })
if ($inactiveModelLink.Count -ne 1 -or [int]$inactiveModelLink[0][1] -ne 5791) {
    throw 'Expected inactive model link 14593 from GetNode 5791.'
}
$inactiveModelLink[0][3] = 5827
$inactiveModelLink[0][4] = 2
Remove-RootNodeAndLinks -Workflow $workflow -NodeId 5816 -LinkIds @(14594, 14595, 14614)
(Get-Node -Workflow $workflow -Id 5827).inputs |
    Where-Object name -eq 'model' |
    ForEach-Object { $_.link = 14593 }

# Deno v0.3.8 migrated from a seven-slot legacy display layout to five real
# serialized values. Save the current layout so the scene prompt cannot be
# restored into the language combo on the next load.
$promptGuide = Get-Node -Workflow $workflow -Id 5317
$promptGuide.widgets_values = @($positivePrompt, 'English', 24, $true, $negativePrompt)

$note = Get-Node -Workflow $workflow -Id 5045
$note.title = 'RIMJOBLTX LTX 2.5 · NAG-safe repair'
$note.widgets_values = @(
    'LTX2_NAG was removed from both branches because current KJNodes fails while processing the LTX 2.5 INT8 ConvRot embedding connector. The model now routes directly into the sampler. Prompt-guide widgets were normalized to the current five-value schema.'
)

# Structural link validation before touching the saved workflow.
$nodeIds = @($workflow.nodes | ForEach-Object { [int]$_.id })
if (@($nodeIds | Group-Object | Where-Object Count -gt 1).Count -ne 0) {
    throw 'Duplicate root node IDs in repaired workflow.'
}
$linkIds = @($workflow.links | ForEach-Object { [int]$_[0] })
if (@($linkIds | Group-Object | Where-Object Count -gt 1).Count -ne 0) {
    throw 'Duplicate root link IDs in repaired workflow.'
}
foreach ($link in @($workflow.links)) {
    if ($link.Count -lt 6) {
        throw "Malformed root link: $($link | ConvertTo-Json -Compress)"
    }
    if ([int]$link[1] -notin $nodeIds -or [int]$link[3] -notin $nodeIds) {
        throw "Root link references a missing node: $($link | ConvertTo-Json -Compress)"
    }
}
foreach ($node in @($workflow.nodes)) {
    foreach ($input in @($node.inputs)) {
        if ($null -ne $input.link -and [int]$input.link -notin $linkIds) {
            throw "Node $($node.id) input $($input.name) references missing link $($input.link)."
        }
    }
    foreach ($output in @($node.outputs)) {
        if ($null -ne $output.links) {
            foreach ($linkId in @($output.links)) {
                if ($null -ne $linkId -and [int]$linkId -notin $linkIds) {
                    throw "Node $($node.id) output $($output.name) references missing link $linkId."
                }
            }
        }
    }
}
if (@($workflow.nodes | Where-Object type -eq 'LTX2_NAG').Count -ne 0) {
    throw 'An LTX2_NAG root node remains after repair.'
}

New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
if (Test-Path -LiteralPath $Destination) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = Join-Path $BackupDirectory "RIMJOBLTX_LTX25_720x480_5s.before-nag-fix-$stamp.json"
    Copy-Item -LiteralPath $Destination -Destination $backup
}

$json = $workflow | ConvertTo-Json -Depth 100 -Compress
$null = $json | ConvertFrom-Json -AsHashtable
[IO.File]::WriteAllText($Destination, $json, [Text.UTF8Encoding]::new($false))

[pscustomobject]@{
    Destination = $Destination
    Backup = $backup
    WorkflowId = $workflow.id
    Nodes = @($workflow.nodes).Count
    Links = @($workflow.links).Count
    NAGNodes = @($workflow.nodes | Where-Object type -eq 'LTX2_NAG').Count
    PositivePromptCharacters = $positivePrompt.Length
    Language = 'English'
} | ConvertTo-Json -Compress
