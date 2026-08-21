param(
  [Parameter(Mandatory = $true)][string]$RuntimeRoot,
  [Parameter(Mandatory = $false)][string]$SourceDir = "",
  [Parameter(Mandatory = $true)][string]$ModelDir,
  [Parameter(Mandatory = $true)][string]$CodeRevision,
  [Parameter(Mandatory = $true)][string]$ModelRevision
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version Latest

$ExpectedCodeRevision = "022e286b98fbec7e1e916cb940cdf532cd9f488e"
$ExpectedModelRevision = "5ecdb67327fd37bb2e042aab12ff7391903235d3"
$OfficialRepository = "https://github.com/QwenLM/Qwen3-TTS"
$OfficialModel = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
$ExpectedPayloadBytes = [long]4520163832
$MinimumFreeBytes = [long]1073741824
$MainWeightsSha256 = "391e8db219f292c515297cdceeb43e4eae67cdde35fa57e79a6a8a532fca0522"
$SpeechTokenizerWeightsSha256 = "836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258"

if ($CodeRevision -ne $ExpectedCodeRevision -or $ModelRevision -ne $ExpectedModelRevision) {
  throw "Refusing to install Qwen VoiceDesign from revisions other than the Premiere316 pins."
}

$RuntimeRoot = [IO.Path]::GetFullPath($RuntimeRoot)
$ModelDir = [IO.Path]::GetFullPath($ModelDir)
if ([string]::IsNullOrWhiteSpace($SourceDir)) { $SourceDir = Join-Path $RuntimeRoot "source" }
$SourceDir = [IO.Path]::GetFullPath($SourceDir)
$VenvDir = Join-Path $RuntimeRoot ".venv"
$Python = if ($env:OS -eq "Windows_NT") { Join-Path $VenvDir "Scripts\python.exe" } else { Join-Path $VenvDir "bin/python" }
$ManifestFile = Join-Path $RuntimeRoot "premiere316-install.json"
$ProgressFile = Join-Path $RuntimeRoot "download-progress.json"
$PackageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$DownloadHelper = Join-Path $PSScriptRoot "download_qwen_voice_design.py"
$ConstraintsFile = Join-Path $PSScriptRoot "qwen_voice_design_constraints.txt"

function Write-InstallProgress {
  param([string]$Stage, [double]$Progress, [long]$BytesDownloaded = 0, [Nullable[long]]$TotalBytes = $null)
  $message = [ordered]@{
    type = "progress"
    status = "installing"
    stage = $Stage
    progress = [Math]::Max(0, [Math]::Min(1, $Progress))
    bytesDownloaded = $BytesDownloaded
    totalBytes = $TotalBytes
  }
  [Console]::Out.WriteLine(($message | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

function Invoke-Checked {
  param([Parameter(Mandatory = $true)][string]$FilePath, [Parameter(Mandatory = $true)][string[]]$Arguments)
  & $FilePath @Arguments 2>&1 | ForEach-Object { [Console]::Error.WriteLine([string]$_) }
  if ($LASTEXITCODE -ne 0) { throw "$FilePath exited with code $LASTEXITCODE" }
}

function Get-DirectoryBytes {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return [long]0 }
  return [long]((Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum)
}

function Get-OptionalProperty {
  param($Object, [string]$Name, $Default = $null)
  if ($null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]) {
    return $Object.PSObject.Properties[$Name].Value
  }
  return $Default
}

New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
New-Item -ItemType Directory -Path $ModelDir -Force | Out-Null
if (-not (Test-Path -LiteralPath $DownloadHelper -PathType Leaf)) { throw "Download helper is missing: $DownloadHelper" }
if (-not (Test-Path -LiteralPath $ConstraintsFile -PathType Leaf)) { throw "Pinned runtime constraints are missing: $ConstraintsFile" }

$Uv = (Get-Command uv -ErrorAction Stop).Source
$Git = (Get-Command git -ErrorAction Stop).Source

Write-InstallProgress -Stage "Preparing pinned official Qwen3-TTS source" -Progress 0.03
if (Test-Path -LiteralPath $SourceDir) {
  if (-not (Test-Path -LiteralPath (Join-Path $SourceDir ".git") -PathType Container)) {
    throw "Existing Qwen source path is not a Git checkout: $SourceDir"
  }
  $dirty = & $Git -C $SourceDir status --porcelain
  if ($LASTEXITCODE -ne 0) { throw "Unable to inspect the existing Qwen source checkout." }
  if ($dirty) { throw "Existing Qwen source checkout has uncommitted changes; refusing to overwrite it." }
  Invoke-Checked -FilePath $Git -Arguments @("-C", $SourceDir, "fetch", "--depth", "1", "origin", $CodeRevision)
} else {
  Invoke-Checked -FilePath $Git -Arguments @("clone", "--filter=blob:none", "--no-checkout", $OfficialRepository, $SourceDir)
  Invoke-Checked -FilePath $Git -Arguments @("-C", $SourceDir, "fetch", "--depth", "1", "origin", $CodeRevision)
}
Invoke-Checked -FilePath $Git -Arguments @("-C", $SourceDir, "checkout", "--detach", $CodeRevision)
$ActualCodeRevision = (& $Git -C $SourceDir rev-parse HEAD).Trim().ToLowerInvariant()
if ($ActualCodeRevision -ne $ExpectedCodeRevision) { throw "Official Qwen source revision verification failed." }

Write-InstallProgress -Stage "Creating isolated Python 3.11 environment" -Progress 0.08
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
  Invoke-Checked -FilePath $Uv -Arguments @("venv", "--python", "3.11", $VenvDir)
}

Write-InstallProgress -Stage "Installing pinned CUDA BF16 runtime" -Progress 0.12
Invoke-Checked -FilePath $Uv -Arguments @(
  "pip", "install", "--python", $Python,
  "--link-mode", "hardlink",
  "--index-url", "https://download.pytorch.org/whl/cu128",
  "torch==2.8.0+cu128", "torchaudio==2.8.0+cu128"
)

Write-InstallProgress -Stage "Installing pinned official Qwen3-TTS code" -Progress 0.24
Invoke-Checked -FilePath $Uv -Arguments @(
  "pip", "install", "--python", $Python,
  "--link-mode", "hardlink", "--constraint", $ConstraintsFile,
  $SourceDir, "huggingface_hub[hf_xet]", "soundfile"
)

$ExistingBytes = Get-DirectoryBytes -Path $ModelDir
Write-InstallProgress -Stage "Downloading only the pinned 1.7B VoiceDesign checkpoint" -Progress 0.4 -BytesDownloaded $ExistingBytes
& $Python $DownloadHelper --model-dir $ModelDir --progress-file $ProgressFile --model-id $OfficialModel --revision $ModelRevision 2>&1 | ForEach-Object {
  $line = [string]$_
  if ($line.TrimStart().StartsWith("{")) { [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
  else { [Console]::Error.WriteLine($line) }
}
if ($LASTEXITCODE -ne 0) { throw "Pinned VoiceDesign model download failed with code $LASTEXITCODE" }

$RequiredFiles = @(
  (Join-Path $ModelDir "config.json"),
  (Join-Path $ModelDir "model.safetensors"),
  (Join-Path $ModelDir "tokenizer_config.json"),
  (Join-Path $ModelDir "vocab.json"),
  (Join-Path $ModelDir "merges.txt"),
  (Join-Path $ModelDir "speech_tokenizer\config.json"),
  (Join-Path $ModelDir "speech_tokenizer\model.safetensors")
)
$Missing = @($RequiredFiles | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
if ($Missing.Count -gt 0) { throw "Pinned model is incomplete: $($Missing -join ', ')" }
$MainWeights = Join-Path $ModelDir "model.safetensors"
$SpeechTokenizerWeights = Join-Path $ModelDir "speech_tokenizer\model.safetensors"
if ((Get-Item -LiteralPath $MainWeights).Length -ne 3833402552) { throw "Pinned main model weight size verification failed." }
if ((Get-Item -LiteralPath $SpeechTokenizerWeights).Length -ne 682293092) { throw "Pinned speech tokenizer weight size verification failed." }
if ((Get-FileHash -LiteralPath $MainWeights -Algorithm SHA256).Hash.ToLowerInvariant() -ne $MainWeightsSha256) {
  throw "Pinned main model SHA-256 verification failed."
}
if ((Get-FileHash -LiteralPath $SpeechTokenizerWeights -Algorithm SHA256).Hash.ToLowerInvariant() -ne $SpeechTokenizerWeightsSha256) {
  throw "Pinned speech tokenizer SHA-256 verification failed."
}

Write-InstallProgress -Stage "Verifying isolated Qwen VoiceDesign runtime" -Progress 0.94
$Verification = & $Python -c "import json, platform, torch, torchaudio, soundfile, qwen_tts; print(json.dumps({'python':platform.python_version(),'torch':torch.__version__,'torchaudio':torchaudio.__version__,'torchCuda':torch.version.cuda,'cudaAvailable':torch.cuda.is_available(),'bf16Supported':bool(torch.cuda.is_available() and torch.cuda.is_bf16_supported())}))"
if ($LASTEXITCODE -ne 0) { throw "Qwen VoiceDesign Python import verification failed." }
$RuntimeFacts = (([string[]]$Verification | Select-Object -Last 1) | ConvertFrom-Json)
$UvVersion = ((& $Uv --version) | Select-Object -Last 1).ToString().Replace("uv ", "").Trim()
$ModelBytes = Get-DirectoryBytes -Path $ModelDir
$Progress = if (Test-Path -LiteralPath $ProgressFile) { Get-Content -LiteralPath $ProgressFile -Raw | ConvertFrom-Json } else { $null }
$TotalBytes = if ($null -ne $Progress -and $null -ne $Progress.totalBytes) { [long]$Progress.totalBytes } else { $ModelBytes }
$PayloadFileCount = if ($null -ne $Progress -and $null -ne $Progress.payloadFileCount) { [int]$Progress.payloadFileCount } else { 13 }
$ModelVolumeRoot = [IO.Path]::GetPathRoot($ModelDir)
$PostDownloadFreeBytes = [long]([IO.DriveInfo]::new($ModelVolumeRoot).AvailableFreeSpace)
if ($PostDownloadFreeBytes -lt $MinimumFreeBytes) { throw "Model volume fell below the 1 GiB free-space safety floor." }
$ExistingManifest = if (Test-Path -LiteralPath $ManifestFile -PathType Leaf) {
  try { Get-Content -LiteralPath $ManifestFile -Raw | ConvertFrom-Json } catch { $null }
} else { $null }
$ExistingVerification = if (
  $null -ne $ExistingManifest -and
  $ExistingManifest.PSObject.Properties.Name -contains "verification"
) { $ExistingManifest.verification } else { $null }
$Manifest = [ordered]@{
  schemaVersion = 1
  installedFor = "Premiere316"
  installedAt = [DateTime]::UtcNow.ToString("o")
  source = [ordered]@{
    repository = $OfficialRepository
    codeRevision = $ActualCodeRevision
    localDirectory = $SourceDir
  }
  model = [ordered]@{
    repository = $OfficialModel
    modelRevision = $ModelRevision
    localDirectory = $ModelDir
    payloadFileCount = $PayloadFileCount
    payloadBytes = $ExpectedPayloadBytes
    mainWeightsSha256 = $MainWeightsSha256
    speechTokenizerWeightsSha256 = $SpeechTokenizerWeightsSha256
  }
  runtime = [ordered]@{
    python = $RuntimeFacts.python
    pythonExecutable = $Python
    uv = $UvVersion
    torch = $RuntimeFacts.torch
    torchaudio = $RuntimeFacts.torchaudio
    torchCuda = $RuntimeFacts.torchCuda
    precision = "bf16"
    attentionImplementation = "sdpa"
    isolated = $true
    includeSystemSitePackages = $false
    hardlinkMode = $true
    comfyUI = $false
    indexTts = $false
  }
  download = [ordered]@{
    bytesDownloaded = $ModelBytes
    totalBytes = $TotalBytes
    postDownloadFreeBytes = $PostDownloadFreeBytes
    minimumFreeBytes = $MinimumFreeBytes
    incompleteFiles = 0
  }
  verification = [ordered]@{
    packageCheck = "compatible"
    gpu = (Get-OptionalProperty $ExistingVerification "gpu")
    driver = (Get-OptionalProperty $ExistingVerification "driver")
    computeCapability = (Get-OptionalProperty $ExistingVerification "computeCapability")
    sm120Present = (Get-OptionalProperty $ExistingVerification "sm120Present" $false)
    cudaAvailable = [bool]$RuntimeFacts.cudaAvailable
    bf16Supported = [bool]$RuntimeFacts.bf16Supported
    bf16SmokePassed = [bool](Get-OptionalProperty $ExistingVerification "bf16SmokePassed" $false)
    modelLoaded = $false
    audioGenerated = $false
    modelIntegrity = "sha256-verified"
  }
  appEnvironmentOverrides = [ordered]@{
    QWEN3_TTS_VOICE_DESIGN_ROOT = $RuntimeRoot
    QWEN3_TTS_VOICE_DESIGN_MODEL_DIR = $ModelDir
    QWEN3_TTS_VOICE_DESIGN_PYTHON = $Python
    QWEN3_TTS_VOICE_DESIGN_CODE_REVISION = $CodeRevision
    QWEN3_TTS_VOICE_DESIGN_MODEL_REVISION = $ModelRevision
    QWEN3_TTS_VOICE_DESIGN_ATTENTION = "sdpa"
  }
}
$ManifestTemp = "$ManifestFile.$PID.tmp"
$Manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ManifestTemp -Encoding UTF8
Move-Item -LiteralPath $ManifestTemp -Destination $ManifestFile -Force
$CompleteProgress = [ordered]@{
  status = "complete"
  stage = "Pinned Qwen VoiceDesign installation ready"
  bytesDownloaded = $ModelBytes
  totalBytes = $TotalBytes
  progress = 1
  updatedAt = [DateTime]::UtcNow.ToString("o")
}
$ProgressTemp = "$ProgressFile.$PID.tmp"
$CompleteProgress | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ProgressTemp -Encoding UTF8
Move-Item -LiteralPath $ProgressTemp -Destination $ProgressFile -Force
Write-InstallProgress -Stage "Pinned Qwen VoiceDesign installation ready" -Progress 1 -BytesDownloaded $ModelBytes -TotalBytes $TotalBytes
