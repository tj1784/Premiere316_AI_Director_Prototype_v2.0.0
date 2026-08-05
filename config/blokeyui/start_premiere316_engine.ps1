$ErrorActionPreference = "Stop"

$engineRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$comfyRoot = Join-Path $engineRoot "ComfyUI"
$runtimeRoot = Join-Path $engineRoot "premiere316_runtime"
$python = Join-Path $engineRoot "python_embeded\python.exe"
$main = Join-Path $comfyRoot "main.py"
$modelPaths = Join-Path $engineRoot "premiere316_model_paths.yaml"

foreach ($directory in @("input", "output", "temp", "user")) {
  New-Item -ItemType Directory -Path (Join-Path $runtimeRoot $directory) -Force | Out-Null
}

if (-not (Test-Path -LiteralPath $python)) {
  throw "Embedded Python was not found: $python"
}
if (-not (Test-Path -LiteralPath $main)) {
  throw "ComfyUI main.py was not found: $main"
}

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

$arguments = @(
  "-s",
  $main,
  "--windows-standalone-build",
  "--listen", "127.0.0.1",
  "--port", "8190",
  "--disable-auto-launch",
  "--input-directory", (Join-Path $runtimeRoot "input"),
  "--output-directory", (Join-Path $runtimeRoot "output"),
  "--temp-directory", (Join-Path $runtimeRoot "temp"),
  "--user-directory", (Join-Path $runtimeRoot "user"),
  "--extra-model-paths-config", $modelPaths,
  "--disable-all-custom-nodes",
  "--whitelist-custom-nodes",
  "ComfyUI-LTXVideo",
  "WhatDreamsCost-ComfyUI",
  "ComfyUI-KJNodes",
  "comfyui-videohelpersuite",
  "comfyui-vrgamedevgirl",
  "ComfyUI-Krea2T-Enhancer",
  "comfyui-krea2edit",
  "ComfyUI-Pixaroma",
  "ComfyUI-Qwen-TTS",
  "comfyui-easy-use",
  "pulid_comfyui",
  "comfyui_layerstyle",
  "sineforge_workflow_bridge"
)

Set-Location -LiteralPath $comfyRoot
& $python @arguments
exit $LASTEXITCODE
