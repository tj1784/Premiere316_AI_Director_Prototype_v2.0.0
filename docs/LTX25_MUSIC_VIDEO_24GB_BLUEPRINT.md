# LTX 2.5 music-video pipeline — current 24 GB workstation

This is the production contract for the drag-and-drop workflow:

`BlokeyUI/ComfyUI/user/default/workflows/Premiere316/LTX 2.5 Music Video/LTX25_MUSIC_VIDEO_24GB_60s_BLOCK_6x10s_DIRECTOR.json`

The workflow targets the **current RTX 5090 Laptop GPU with 24 GB VRAM**, not the planned RTX Pro 5000 upgrade.

## Important feasibility correction

The full LTX 2.5 Dev BF16 transformer is about 42 GB before the projected Gemma 4 encoder, VAEs, latents, and attention workspace. It cannot remain resident on a 24 GB GPU. A single 60–90 second 720p latent is also outside the production-safe duration/memory profile of LTX 2.5.

This workflow therefore uses:

- LTX 2.5 **Distilled INT8 ConvRot** weights;
- projected Gemma 4 12B INT8 text encoder;
- BF16 video and audio VAEs;
- official two-stage distilled sampling: 8 base steps plus 3 refinement steps;
- adjustable full-pixel delivery resolution, defaulting to 1024×576;
- one 5–10 second diffusion shot per job;
- six sequential 10-second shots for a 60-second editorial block, or nine for a 90-second block;
- server-owned last-frame handoff and final block assembly.

INT8 here quantizes model weights; it does **not** lower the requested pixel resolution. The blue resolution node can deliver 1024×576, 1280×720, or another even size. On the current 24 GB card, use 1280×720 only for 5–10 second shots and expect substantially higher runtime.

## Default render contract

| Setting | Value |
|---|---|
| Editorial frame rate | 24 fps |
| Editorial shot length | 240 frames / 10.000 s |
| LTX internal frame grid | 241 frames (`8n+1`) |
| Default final size | 1024×576 |
| Default stage-one canvas | 512×288 |
| Native latent-upscaled canvas | 1024×576 |
| Alternative final size | 1280×720 |
| Alternative stage-one canvas | 640×384 |
| Alternative native x2 canvas | 1280×768, then exact 1280×720 decoded resize |
| Stage one | Euler ancestral, CFG 1, official 8-step sigmas |
| Stage two | Euler, CFG 1, official 3-step refinement sigmas |
| Video decode | Tiled |
| Video output | H.264 MP4, yuv420p, CRF 18, exact 240-frame crop |
| Guide-image compression | 22 |

The workflow crops each 241-frame generation to exactly 240 editorial frames. It separately saves generated frame 240 as the next-shot boundary guide.

## Exact node wiring

### 1. Loaders and resolution

1. `UNETLoader #95 MODEL` → `LTXDirector #46 model`.
2. `CLIPLoader #84 CLIP` → `LTXDirector #46 clip`.
3. `CLIPLoader #84 CLIP` → `CLIPTextEncode #26 clip` for the short safety negative.
4. `VAELoader #4` loads the LTX 2.5 audio VAE and connects to `LTXDirector #46 audio_vae` and `LTXVAudioVAEDecode #16 audio_vae`.
5. `VAELoader #3` loads the LTX 2.5 video VAE and connects to both Director guide passes, the latent upsampler, and the tiled decoder.
6. `LTX25ResolutionPlan #205 stage1_width/stage1_height` → `LTXDirector #46 custom_width/custom_height`.
7. `LTX25ResolutionPlan #205 final_width/final_height` → `ImageScale #132 width/height`.

The resolution planner chooses the smallest 32-aligned stage-one canvas whose native x2 result covers the requested final size. The decoded image sequence is then resized to the exact delivery pixels.

### 2. Audio latent conditioning and slicing

The installed live runtime does not currently expose a usable model option in `AudioEncoderLoader`, so a fabricated `AudioEncoderEncode` chain would not queue. The native LTX 2.5 path is already implemented inside `LTXDirector #46`:

1. Add the complete four-minute soundtrack once to the Director **AUDIO** track at frame 0.
2. At 24 fps, the full project is 5,760 editorial frames.
3. Set `Use custom audio = ON`.
4. Set `Inpaint Audio = OFF`.
5. For each job, set the selected shot range, for example frames 0–240, 240–480, or 480–720.
6. The Director slices the waveform at that exact range, normalizes the working audio, encodes the slice through the LTX audio VAE, and returns `audio_latent`.
7. `LTXDirector #46 audio_latent` → `LTXVConcatAVLatent #7 audio_latent`.
8. With audio inpainting off, the audio noise mask is zero, so the supplied soundtrack slice is frozen rather than regenerated.
9. `LTXDirector #46 combined_audio` → `VHS_VideoCombine #94 audio`.
10. `LTXVAudioVAEDecode #16` remains an optional sampled-audio monitor; it is not the music master.

This is the correct structural-audio route for the installed LTX 2.5 architecture. It preserves the source music while still giving the joint A/V transformer the corresponding audio latent as temporal context. The delivered block master should ultimately remux the untouched original soundtrack once, avoiding AAC encoder-delay seams between shots.

The distributed JSON intentionally contains no guessed soundtrack filename. Until an AUDIO-track segment is added, `use_custom_audio` remains off and the preflight report marks audio as a queue blocker.

### Explicit non-Director audio-worker equivalent

If a future standalone worker is built without `LTXDirector`, use the live native classes below instead of inventing an `AudioEncoderEncode` node name:

1. `LoadAudio AUDIO` → `TrimAudioDuration AUDIO` (or `AudioFrameAdjuster AUDIO`).
2. Patch the slice start and duration from the shot's exact editorial frame range.
3. Trimmed `AUDIO` → `LTXVAudioVAEEncode audio`; `VAELoader #4 VAE` → its `audio_vae` input.
4. `LTXVAudioVAEEncode Audio Latent` → `LTXVSetAudioRefTokens audio_latent`.
5. Positive/negative text conditioning → the corresponding positive/negative inputs on `LTXVSetAudioRefTokens`.
6. Its conditioned positive/negative outputs → the LTX guider.
7. Its `frozen_audio` latent + the video latent → `LTXVConcatAVLatent`.
8. Feed the same trimmed original `AUDIO` directly to `VHS_VideoCombine audio`; do not use regenerated/decoded audio as the music master.

The supplied JSON uses the Director route because it already owns frame-accurate timeline slicing, prompt relay, reference-image preparation, and audio freezing. Do not wire both routes into the same prompt.

### 3. Prompt relay and shot timeline

`LTXDirector #46` is the prompt scheduler. Its saved timeline contains one 60-second block with six 240-frame shot records. The graph executes only the selected 10-second range per queue submission.

For each shot:

1. Store the long-lived appearance, world, lighting, camera-language, and continuity rules in `global_prompt`.
2. Store one chronological action/camera prompt in that shot's segment prompt.
3. Use frame-native fields, not ambiguous timestamp text, as the authority:
   - shot 1: start 0, length 240;
   - shot 2: start 240, length 240;
   - shot 3: start 480, length 240;
   - shot 4: start 720, length 240;
   - shot 5: start 960, length 240;
   - shot 6: start 1200, length 240.
4. The selected prompt is encoded by projected Gemma 4 and returned as Director positive conditioning.
5. `LTXDirector #46 positive` → `LTXVConditioning #5 positive`.
6. `CLIPTextEncode #26 conditioning` → `LTXVConditioning #5 negative`.
7. `LTXDirector #46 frame_rate` → `LTXVConditioning #5 frame_rate`.

Do not put 4–6 camera cuts into every 10-second generation. For identity-critical singing/acting, use one continuous shot. If multishot is intentional, keep it to 2–4 explicitly described cuts and re-establish the character, framing, screen direction, and continuous soundtrack after every cut.

### 4. Stage-one joint A/V sampling

1. `LTXVConditioning #5 positive/negative` → `LTXDirectorGuide #8 positive/negative`.
2. `LTXDirector #46 video_latent` and `guide_data` → `LTXDirectorGuide #8 latent/guide_data`.
3. `LTXDirectorGuide #8 latent` + `LTXDirector #46 audio_latent` → `LTXVConcatAVLatent #7`.
4. `LTXDirector #46 model` + guided conditioning → `CFGGuider #9` at CFG 1.
5. `RandomNoise #28`, `CFGGuider #9`, `KSamplerSelect #29`, `ManualSigmas #11`, and the concatenated A/V latent → `SamplerCustomAdvanced #10`.
6. Sampler #29 is `euler_ancestral`.
7. Sigmas #11 are `1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0`.
8. `SamplerCustomAdvanced #10 output` → `LTXVSeparateAVLatent #13`.

### 5. Native x2 refinement

1. Stage-one video latent → `LTXVCropGuides #55`.
2. `LTXVCropGuides #55 latent` + `LatentUpscaleModelLoader #57` + video VAE → `LTXVLatentUpsampler #52`.
3. Upscaled latent and cropped conditioning → `LTXDirectorGuide #58`.
4. `LTXDirectorGuide #58 latent` + the untouched stage-one audio latent → `LTXVConcatAVLatent #50`.
5. `RandomNoise #28`, `CFGGuider #49`, `KSamplerSelect #53`, `ManualSigmas #96`, and the upscaled A/V latent → `SamplerCustomAdvanced #47`.
6. Sampler #53 is deterministic `euler`.
7. Sigmas #96 are `0.909375, 0.725, 0.421875, 0.0`.
8. The result is separated by `LTXVSeparateAVLatent #48`, guide tokens are cropped by `LTXVCropGuides #14`, and video is decoded by `VAEDecodeTiled #15`.

### 6. Save, handoff, and GPU cleanup

1. `VAEDecodeTiled #15 IMAGE` → `ImageScale #132` for exact delivery dimensions.
2. `ImageScale #132 IMAGE` → `ImageFromBatch #206` with `batch_index=0`, `length=240`.
3. `ImageFromBatch #206 IMAGE` → `VHS_VideoCombine #94 images`.
4. `LTXDirector #46 combined_audio` → `VHS_VideoCombine #94 audio`.
5. The uncropped `ImageScale #132 IMAGE` → `ImageFromBatch #200` with `batch_index=-1`, `length=1`.
6. `ImageFromBatch #200 IMAGE` → `SaveImage #201`.
7. `VHS_VideoCombine #94` and `SaveImage #201` → `easy batchAnything #207`.
8. `easy batchAnything #207` → `easy cleanGpuUsed #202`.

The two-input barrier makes GPU cleanup execute only after both the MP4 and handoff PNG are complete. The 240-frame MP4 contains frames 0–239. The handoff PNG is generated frame 240, exactly the following timeline boundary; it starts the next shot without duplicating or skipping an editorial frame.

## Sequential 60–90 second block runner blueprint

A ComfyUI graph is a directed acyclic graph. It cannot safely feed a file produced by one prompt back into a second future prompt as a self-loop. That cross-job loop belongs in the 8791 Director backend.

Implement one server-owned runner named `LTX25SequentialBlockRunner` with this contract:

### Inputs

- `project_slug`
- `block_id`
- `soundtrack_media_id` or approved source file
- `block_start_frame`
- `block_length_frames` — 1,440 for 60 s or 2,160 for 90 s at 24 fps
- `shots[]` with `{id,startFrame,lengthFrames,prompt,seed,firstFrameBinding}`
- `final_width`, `final_height`
- `workflow_path`

### Preflight

1. Require 24 fps for this profile.
2. Require every shot to be 5–10 seconds for a 720p target on current hardware.
3. Require positive even delivery dimensions.
4. Resolve the stage-one dimensions through `LTX25ResolutionPlan` and require both to be divisible by 32.
5. Calculate `requestedFrames = shot.lengthFrames`.
6. Calculate `generationFrames = 8 × ceil(requestedFrames / 8) + 1`.
7. Resolve the soundtrack and first approved visual guide by immutable project-media version and hash.
8. Compile and live-validate every prompt before submitting the first job.

### Sequential execution

For each shot in order:

1. Clone the flat workflow API prompt.
2. Patch the Director range, prompt, timeline JSON, requested frame count, soundtrack slice, seed, and resolution.
3. For shot 1, upload the approved portrait/composition and set it as the image segment.
4. Submit exactly one prompt to 8188.
5. Wait for `/history/{prompt_id}` and require the intended final MP4 output node.
6. Verify video, audio, dimensions, fps, generated frame count, and duration.
7. Accept the exact 240-frame MP4 from crop node #206; independently verify the 241-frame generation contract.
8. Resolve and verify `SaveImage #201`, which contains generated frame 240—the exact next timeline boundary before the 241→240 crop.
9. Upload that PNG to ComfyUI input and patch the next shot from `text` to `image`, with `imageFile` set to the returned input name and guide strength 1.0.
10. Persist prompt ID, source hashes, workflow hash, output hashes, requested/generated frame counts, and handoff-frame hash.
11. Only then queue the next shot.

Never run handoff-dependent shots in parallel.

### Block completion

1. Concatenate the six or nine conformed MP4s without retiming.
2. Remux the exact original soundtrack slice for the block as the final audio authority.
3. Verify 24 fps, final dimensions, exact block frame count, 48 kHz stereo audio, duration, and SHA-256.
4. Register one immutable block version in the Premiere project.
5. Retain each shot and handoff frame as provenance.
6. Release model/latent caches after the block and before switching projects.

## Four-minute segmentation

Recommended options:

- **Four 60-second blocks:** 6 × 10-second shots per block, 24 total shot jobs.
- **Three 80-second blocks:** 8 × 10-second shots per block, 24 total shot jobs.
- **Mixed musical structure:** use 5–8 second shots around vocals, faces, or fast cuts and 8–10 second shots for wider instrumental passages.

Do not use four 60-second diffusion jobs or three 80-second diffusion jobs on the current GPU. The block duration is an editorial/assembly unit, not a single latent length.

## Dev/BF16 upgrade boundary

The future full-BF16 Dev configuration must be a separate workflow branch or separate workflow file. It needs its own model loader, 20–50-step scheduler, CFG 2–5 guider, memory policy, and validation renders. Do not implement it as a checkpoint-only dropdown on this distilled 8+3 graph.

## How to use the JSON now

1. Drag the JSON file named at the top of this document into ComfyUI.
2. In the blue `FINAL RESOLUTION` node, enter the exact output size.
3. Open `LTX Director #46` and add the full soundtrack to the AUDIO track.
4. Keep audio inpainting off.
5. Replace `char-jesus-main.v4.png` with the approved first composition or portrait.
6. Select the first 10-second range and queue it.
7. For manual operation, upload the handoff PNG from `SaveImage #201`, attach it to the next segment, select that segment, and queue again.
8. For automatic operation, use the sequential runner contract above in the 8791 Director service.

The file is already a complete ComfyUI visual-workflow JSON, not an API-only prompt and not a UUID subgraph wrapper.
