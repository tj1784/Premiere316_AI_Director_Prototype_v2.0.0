# LTX 2.5 shared-library migration — 2026-08-12

Status: complete and live-visible on Premiere316 ComfyUI `127.0.0.1:8188`.

## LTX 2.5 models moved

- `models/diffusion_models/LTX/2.5/ltx-2.5-22b-dev-transformer-bf16.safetensors`
- `models/diffusion_models/LTX/2.5/ltx-2.5-22b-dev-transformer-comfy-int8-convrot.safetensors`
- `models/vae/LTX/2.5/ltx-2.5-video-vae-bf16.safetensors`
- `models/vae/LTX/2.5/ltx-2.5-video-vae-conv-bf16.safetensors`
- `models/vae/LTX/2.5/ltx-2.5-audio-vae-bf16.safetensors`
- `models/loras/LTX/2.5/ltx-2.5-22b-distilled-lora-450-bf16.safetensors`
- `models/latent_upscale_models/LTX/2.5/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors`
- `models/latent_upscale_models/LTX/2.5/ltx-2.5-latent-temporal-upscaler-x2-bf16-1.0.safetensors`
- `models/model_patches/LTX/2.5/ltx-2.5-duration-head-bf16.safetensors`

## LTX 2.3 GGUF models preserved

- `models/diffusion_models/LTX/LTX-2.3-22B-distilled-1.1-Q3_K_M.gguf`
- `models/diffusion_models/LTX/2.3/Dev/ltx-2.3-22b-dev-Q5_K_M.gguf`
- `models/diffusion_models/LTX/2.3/Dev/ltx-2.3-22b-dev-Q6_K.gguf`
- `models/diffusion_models/LTX/2.3/Distilled/ltx-2.3-22b-distilled-1.1-Q5_K_M.gguf`
- `models/diffusion_models/LTX/2.3/FineTunes/10Eros_v1-Q5_K_M.gguf`

## Explicit identity-model exception preserved

- `models/loras/faceID/Best_FaceID_v1.0_LoRA.safetensors`
- `models/loras/faceID/Best_FaceID_CharacterSheet_v1.0_LoRA.safetensors`

The completed Downloads copy of `Best_FaceID_v1.0_LoRA.safetensors` was deleted only after a fresh SHA-256 match against the shared keeper.

## Cleanup result

- Remaining audited LTX 2.3 non-GGUF model files in the shared model library: `0`
- Remaining completed LTX 2.3 non-GGUF model files in Downloads: `0`
- Listed source files remaining in Downloads: `0`
- Incomplete `.crdownload`, `.part`, and `.incomplete` files were not moved or deleted.
- Final free space during validation: `174.77 GiB`

## Workflows

- Shared catalog: `C:/ComfyUI/ComfyUI_Shared_Folders/workflows`
- Premiere316 menu hardlinks: `BlokeyUI/ComfyUI/user/default/workflows/Shared Imports`
- Standalone Downloads workflows processed: `74`
- Unique workflows moved: `45`
- Exact-byte workflow duplicates removed: `29`
- Workflows visible under `Shared Imports` on live port 8188: `47`

## Remaining LTX 2.5 workflow dependency gap

The imported `ltx25BasicWorkflowT2V_v10.json` selects a distilled INT8 transformer and a projected Gemma 4 text encoder that were not among the completed supplied files:

- `ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors`
- `gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors`

The installed dev transformer plus distilled LoRA can be used by a repaired dev-plus-LoRA workflow, but the projected Gemma 4 encoder is still required.
