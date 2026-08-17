param(
  [string]$Source = "BlokeyUI\ComfyUI\output\identity_tests\garden-first-segment-voice-r31_00001-audio.mp4",
  [string]$Output = "BlokeyUI\ComfyUI\output\identity_tests\garden-first-segment-voice-r31-1128x480-final.mp4"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
  throw "Source render not found: $Source"
}

$outputDirectory = Split-Path -Parent $Output
if ($outputDirectory) {
  New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}

# The LTX two-pass canvas is 1152x448. Preserve its full 2.57:1 picture without
# stretching the actor: scale to 1128x439, then add 20/21 pixels of black matte.
ffmpeg -hide_banner -loglevel error -y `
  -i $Source `
  -filter_complex "[0:v]scale=1128:439:flags=lanczos,pad=1128:480:0:20:black[v];[0:a]atrim=end=5.42,asetpts=PTS-STARTPTS,apad=pad_dur=1.34[a]" `
  -map "[v]" -map "[a]" `
  -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p `
  -r 25 -frames:v 169 `
  -c:a aac -b:a 192k -ar 48000 -ac 2 `
  -movflags +faststart `
  $Output

if ($LASTEXITCODE -ne 0) {
  throw "ffmpeg failed with exit code $LASTEXITCODE"
}

$probe = ffprobe -v error -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate,duration,nb_frames,sample_rate,channels -show_entries format=duration,size -of json $Output
if ($LASTEXITCODE -ne 0) {
  throw "ffprobe failed with exit code $LASTEXITCODE"
}

$probe
