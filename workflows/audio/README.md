# Premiere316 audio workflow registry

This directory contains app-owned ComfyUI prompt-API copies and their binding registry. The source UI workflows under `BlokeyUI/ComfyUI/user/default/workflows` remain untouched.

## What is ready

- MiniMax Music 3: caption, separate lyrics, seed, 0.04–360 seconds, optional tiled decode, FLAC/MP3/Opus through the real `SaveAudioAdvanced` inputs.
- Stable Audio 3 Medium: the clean text-to-audio graph is registered separately as Music, Sound FX, and Hybrid. It exposes prompt, duration, and seed. Its installed `SaveAudioMP3` output is honestly MP3-only.
- Gemma 4 prompt enhancement: separate Music and Sound FX text-only adapters. Enhancement is optional and off by default; the calling UI must preserve the original prompt, show the proposed result, and require an explicit choice before generation.

Qwen Voice Design, ACE-Step 1.5 XL Turbo, and Fish S2 are retained as disabled profiles with exact errors in `registry.json`. AudioReact is intentionally excluded because it produces reactive video rather than source audio.

“Ready” here means the saved bindings match the source hash, every node class exists in live `/object_info`, and every selected model resolves locally. No render was queued during this audit, so `renderValidated` remains false.

## Runtime contract

1. Load `registry.json` and select only entries whose `readiness.enabled` is true.
2. Resolve `appOwnedApiWorkflowPath` relative to the repository root.
3. Recompute the original source SHA-256. If it differs from `sourceWorkflowSha256`, do not submit; expose **Needs Rebinding**.
4. Recompute the API-copy SHA-256 and validate every bound `nodeId`, `class_type`, and `inputName` against live `/object_info`.
5. Clone the API JSON in memory and replace only the inputs declared in `inputNodeBindings`.
6. For Gemma dynamic inputs, keep ComfyUI's flattened prompt-API names such as `sampling_mode.temperature`; ComfyUI reconstructs the nested dynamic-combo value at execution.
7. Submit through the existing ComfyUI queue only after normal GPU/queue admission. Recover saved filenames from `/history` using the declared output node.

## Adding a profile later

1. Copy, never move or overwrite, the chosen UI workflow into an app-owned API graph under `api/`.
2. Give the profile a stable versioned ID and record both source and API SHA-256 values.
3. Record exact input/output node IDs and input names; never expose a control without a real binding.
4. Record node classes from the API graph and compare each one with live `/object_info/<class>`.
5. Check model names against the corresponding live loader dropdown and resolve the actual file in configured model roots. A directory name alone is not proof of a complete model.
6. Record the intersection of duration constraints across all linked duration consumers.
7. Mark the profile ready only when source hash, API hash, nodes, models, and bindings all validate. Otherwise keep it disabled with exact errors.
8. Run a short real generation and decode the output before changing `renderValidated` to true.

Do not register video-reactive graphs as audio generators, and do not infer reference-audio, negative-prompt, video-conditioning, timed-event, lyrics, or lossless-output capabilities unless the selected graph exposes those inputs or outputs.
