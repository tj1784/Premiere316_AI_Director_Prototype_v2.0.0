param([string]$Prompt = 'Read .pi-video-repair/assignment.md and continue the bounded video repair task. Use only the supplied Windows tools. Save a truthful report and stop after at most 10 tool calls.')
$ErrorActionPreference = 'Stop'
$repairRoot = 'D:/Projects/Premiere316_pi_video_repair'
$repairConfig = Join-Path $repairRoot '.pi-video-repair'
$repairEvidence = Join-Path $PSScriptRoot '../screenshots/pi-video-repair'
$piExecutable = Join-Path $env:APPDATA 'npm/pi.cmd'
if (!(Test-Path -LiteralPath (Join-Path $repairConfig 'models.json'))) { throw 'Isolated Pi model configuration is missing.' }
if (!(Test-Path -LiteralPath $piExecutable)) { throw 'Pi CLI is missing.' }
$env:PI_CODING_AGENT_DIR = $repairConfig
$env:PI_OFFLINE = '1'
Push-Location $repairRoot
try {
    & $piExecutable --offline --no-extensions --no-skills --no-prompt-templates --no-context-files --tools read,powershell,edit,write --provider lmstudio-video-repair --thinking off --session-dir (Join-Path $repairEvidence 'sessions') --mode json --print $Prompt
    if ($LASTEXITCODE -ne 0) { throw "Pi exited with code $LASTEXITCODE" }
} finally { Pop-Location }
