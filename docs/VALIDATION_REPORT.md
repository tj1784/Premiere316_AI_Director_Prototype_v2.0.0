# Validation report

Date: 2026-08-04

## Passed

- Production browser client build using `scripts/build-portable.mjs`.
- TypeScript type check with `npm run typecheck`.
- Node syntax checks for every server and build script.
- Browser render at 1920×1200 with zero console errors.
- Project creation, loading, saving, and media registration.
- First/middle/last guide creation and guide version registration.
- Noncontiguous segment selection grouping into two independent queue jobs.
- Frame-zero handling and frame/second conversion.
- LTX `8n + 1` frame expansion metadata.
- Exact output trimming helper.
- Prompt range clipping and ` | ` Prompt Relay delimiter.
- Object-valued ComfyUI widgets, including the Video Combine format, loop count, ping-pong, and save-output settings.
- Selected middle-range replacement over an accepted baseline clip.
- Synthetic visual verification of that replacement: red baseline → blue replacement → red baseline.
- Clip assembly, project stitching, score generation fallback, dialogue-aware score mixing, and H.264/AAC master output.
- Supplied workflow byte-for-byte integrity; SHA-256 matches the uploaded JSON.

## Environment-dependent validation

An end-to-end LTX generation run was not possible in the build environment because ComfyUI was not running on port 8190. The following parts were still verified without claiming a completed model inference:

- The supplied workflow loads successfully.
- Its UI graph converts into API-prompt structure.
- Object-style Video Combine widget values are retained.
- The selected-range compiler patches Director timing, prompt, guide, resolution, seed, and output fields.
- Guide images are prepared for upload through the ComfyUI input API.
- Noncontiguous selections create independent render jobs.

The final ComfyUI inference test must be performed on the target workstation where the workflow's custom nodes and model files are installed.
