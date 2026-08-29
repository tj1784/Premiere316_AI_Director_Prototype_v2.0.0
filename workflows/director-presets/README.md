# Director presets

This directory contains canonical ComfyUI **UI workflow graphs** for Premiere316 director workflows. Importing one of these JSON files opens an editable graph; it does not submit a prompt, enqueue a job, upload an input, or render media. Review every input, model, output prefix, and timeline before queueing it in ComfyUI.

## `ltx25-premiere316-segmented-i2v.ui.json`

Canonical Premiere316 segmented LTX-2.5 image-to-video compiler graph. The release copy preserves the executable compiler seam, node IDs, links, model bindings, raw output node `94`, temporal guides, and semantic-reference nodes while removing the source machine's absolute paths, cached project timeline, inline preview image, and project-specific prompts.

The packaged graph intentionally opens with a neutral one-frame timeline and no media. Bind a project asset index and choose the first frame, prompt, timing, and semantic references in Premiere316 before compiling or queueing it.

Custom-node requirements:

- Premiere316 / `whatdreamscost-comfyui`: `BlokeyLtxDirector`, `BlokeyLtxDirectorGuide`, `Premiere316AssetResolver`, `Premiere316ReferenceSheetBuilder`, and the `LTX2.5_Premiere316` compiler seam.
- `ComfyUI-VideoHelperSuite`: `VHS_VideoCombine`.
- LTX Ingredients IC-LoRA nodes including `LTXICLoRALoaderModelOnly` and `LTXAddVideoICLoRAGuide`.

Declared model files include the LTX-2.5 distilled transformer, video/audio VAEs, Gemma 4 LTX text encoder, LTX-2.5 spatial upscaler, and the LTX Ingredients IC-LoRA adapter stored in the graph's loader widgets.

## `harrowing-of-hell-ltx25-i2v.ui.json`

LTX-2.5 image-to-video preset for the Harrowing of Hell H01-S01-C01 first-frame continuation. The release copy intentionally omits the source workflow's cached `extra.prompt` execution payload while preserving the authored UI graph.

External input:

- `harrowing_of_hell_H01-S01-C01_first.v4.2m24s-i2v-master.png` must be available by that relative name in the ComfyUI input directory. The graph deliberately does not contain an absolute workstation path or embedded replacement image.

ComfyUI requirements:

- A recent ComfyUI build with the native LTX-2.5, audio/video latent, prompt-enhancer, video-save, and embedded-subgraph nodes used by the graph. The workflow metadata identifies these nodes as `comfy-core`; it does not declare a third-party custom-node pack.

Declared model files:

- `models/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors`
- `models/vae/ltx-2.5-video-vae-bf16.safetensors`
- `models/vae/ltx-2.5-audio-vae-bf16.safetensors`
- `models/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors`
- `models/text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors`
- `models/text_encoders/gemma4_e2b_it_bf16.safetensors`
- `models/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors`

## `harrowing-of-hell-ltx25-director.ui.json`

Authored Harrowing of Hell LTX-2.5 Director preset. The release copy preserves all 30 nodes, 56 links, model bindings, authored visual timeline and prompts, but removes the source machine's absolute output directory, cloud preview URL, local soundtrack and waveform cache, saved video preview, and anomalous runtime hashes.

External input:

- `whatdreamscost/harrowing_of_hell.png` is a relative ComfyUI input reference. Supply that file (or deliberately replace the timeline image) before queueing.

Custom-node requirements:

- `whatdreamscost-comfyui`: `LTXDirector` and `LTXDirectorGuide`.
- `ComfyUI-VideoHelperSuite`: `VHS_VideoCombine`.
- KJNodes LTX VAE loaders and a recent ComfyUI build with the LTX-2.5 sampling, decoding, and image utility nodes represented in the graph.

The graph retains its declared LTX-2.5 transformer and Gemma 4 text encoder plus its LTX 2.3-compatible video/audio VAEs, text projection, and spatial upscaler. These mixed-version bindings are intentional source behavior and should be verified against the target ComfyUI installation before queueing.

## `ltx25-music-video-24gb-60s-director.ui.json`

LTX-2.5 music-video shot-worker preset designed for a 24 GB GPU. The timeline describes a 60-second block as six 10-second shots, while the current graph output is one exact 240-frame shot plus a boundary-frame handoff for orchestration of the next shot.

External inputs:

- `char-jesus-main.v4.png` must be available by that relative name in the ComfyUI input directory for the first timeline image guide.
- Load the authoritative soundtrack in the LTX Director UI before queueing. The timeline enables its audio track but intentionally stores no absolute audio-file path and no embedded soundtrack.

Custom-node requirements:

- `kijai/ComfyUI-PromptRelay` / `whatdreamscost-comfyui`: `LTXDirector` and `LTXDirectorGuide`.
- `ComfyUI-VideoHelperSuite`: `VHS_VideoCombine`.
- `ComfyUI-Easy-Use`: `easy batchAnything` and `easy cleanGpuUsed`.
- Premiere316's `custom_nodes/ltx25_smart_controls`: `LTX25ResolutionPlan`.
- A recent ComfyUI build with the native LTX-2.5 audio/video latent, sampling, decoding, and image utility nodes used by the graph.

Declared model files:

- `models/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors`
- `models/vae/LTX/2.5/ltx-2.5-video-vae-bf16.safetensors`
- `models/vae/LTX/2.5/ltx-2.5-audio-vae-bf16.safetensors`
- `models/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors`
- `models/latent_upscale_models/LTX/2.5/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors`

The model paths above reproduce the widget values stored in each graph. If a ComfyUI installation uses extra-model-path mappings, the same files may be physically stored in a shared model library while remaining visible under these logical names.
