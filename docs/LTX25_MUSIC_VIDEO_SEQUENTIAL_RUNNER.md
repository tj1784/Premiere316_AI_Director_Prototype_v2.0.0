# LTX 2.5 music-video sequential runner

The Director service owns the cross-prompt loop. ComfyUI remains an acyclic,
single-shot worker. A run submits exactly one 5-10 second prompt at a time,
waits for both required outputs, pins them in the Premiere project, and only
then submits the next shot.

Music runs compile the dedicated 24 GB workflow directly, independently of the
general workflow currently open in the Director UI. Its path may be overridden
with `DIRECTOR_MUSIC_VIDEO_WORKFLOW_PATH`; its SHA-256 is pinned when a run
starts so an update cannot silently change later shots.

## Required ComfyUI outputs

- Node `94` (`VHS_VideoCombine`): exact requested editorial frames.
- Node `201` (`SaveImage`): absolute final generated frame, used as the next
  I2V guide.
- Node `206` is patched per shot to crop the `8n+1` generation to the requested
  Premiere frame count.
- Node `200` stays at batch index `-1`, length `1`.

The audio-conditioning slice uses the same `8n+1` frame window as the video
latent. Adjacent jobs therefore overlap by exactly the node-201 boundary
frame. This lookahead exists only inside LTX conditioning: node `94` is cropped
to each authored 5-10 second cut, and the final master receives the pinned
original soundtrack on the exact 5,808-frame picture timeline. If the source
audio ends fractionally before the last lookahead frame, LTX Director pads its
fixed-duration conditioning waveform with silence; it does not read past the
file.

The runner assigns a unique output prefix containing the run and shot IDs, so
restart recovery can locate a prompt without submitting a duplicate.

## Project manifest

The preferred project-owned layout keeps the source metadata, lyrics, and
manifest together:

`projects/<projectSlug>/production/music-video/<manifestId>/manifest.json`

The runner also recognizes
`production/music-video/<manifestId>/music-video-manifest.json`,
`production/music-videos/<manifestId>.music-video.json`, and the legacy
single-manifest `production/music-video-manifest.json`.

The runner accepts any number of storyboard blocks and flattens their shots
into one continuous render. The storyboard clips are provenance; the finished
full-length video is registered as a project master without changing the
existing film clips.

```json
{
  "schema": "premiere316.music-video-manifest/v1",
  "id": "into-your-hands",
  "title": "Into Your Hands",
  "projectSlug": "harrowing_of_hell",
  "fps": 24,
  "width": 576,
  "height": 1024,
  "totalFrames": 5808,
  "globalPrompt": "Global identity and cinematography locks",
  "blocks": [
    {
      "id": "music-video-block-01",
      "clipId": "MV-B01",
      "startFrame": 0,
      "endFrame": 1440,
      "shots": [
        {
          "id": "mv-shot-001",
          "startFrame": 0,
          "length": 240,
          "prompt": "Opening shot prompt",
          "guideProjectMediaPath": "media/storyboard/music-video-opening.v1.png"
        },
        {
          "id": "mv-shot-002",
          "startFrame": 240,
          "length": 240,
          "prompt": "Continue exactly from the prior boundary frame"
        }
      ]
    }
  ]
}
```

All shots must be contiguous and between 120 and 240 frames at 24 fps. The
first shot needs an approved project image. Later shots deliberately omit a
guide because node `201` supplies it. A 242-second plan is 5,808 frames; block
boundaries may be `0`, `1440`, `2880`, `4320`, and `5808` while the handoff
continues across those editorial boundaries.

## API

Inspect without queueing:

`GET /api/music-video/manifests/<projectSlug>/<manifestId>`

Start the durable sequence:

```http
POST /api/music-video/sequences
Content-Type: application/json

{
  "projectSlug": "harrowing_of_hell",
  "useProjectManifest": true,
  "manifestId": "into-your-hands",
  "sourceAudioFile": "C:\\Users\\Blokey\\Documents\\Premiere316_AI_Director_Prototype_v2.0.0\\BlokeyUI\\ComfyUI\\output\\audio\\audio_minimax_music3_00010.flac"
}
```

The absolute source-audio option is restricted to the repo-local ComfyUI
`output/audio` directory. At start, the file is copied into
`media/audio`, then byte-counted and SHA-256 pinned. A project-relative
`projectMediaPath` may be supplied instead.

Read status:

- `GET /api/music-video/sequences?projectSlug=<slug>`
- `GET /api/music-video/sequences/<runId>?projectSlug=<slug>`
- `POST /api/music-video/sequences/<runId>/resume` with
  `{ "projectSlug": "<slug>" }` re-enters the idempotent monitor after a
  transient failure; it never discards or blindly resubmits a tracked prompt.

## Final media contract

Each node-94 shot is validated for exact frames, FPS, dimensions, and SHA-256.
Each node-201 image is saved and hashed before the next prompt is allowed.
For manifest runs, that raw node-201 PNG is also registered as the next
storyboard clip's active first-frame version under `media/storyboard`, with its
source clip, prompt ID, output node, boundary-frame index, workflow hash,
byte count, and SHA-256. The encoded MP4 tail is never substituted for this
extra LTX boundary frame.
After all shots complete, their already-conformed H.264 picture streams are
concatenated without another video encode. The pinned FLAC is then applied once
to the full picture, converted once to Premiere-compatible 48 kHz stereo AAC,
and padded only to the manifest frame boundary when required. The final MP4 is
validated again and registered in `project.masters` with source-audio and
per-shot provenance.

Active runs live in `director-generation-jobs.json`. A Director restart resumes
the current prompt from ComfyUI queue/history. A prompt in the narrow
submit-before-ledger window is recovered by its unique output prefix; the
runner will fail safely instead of silently submitting a duplicate.
