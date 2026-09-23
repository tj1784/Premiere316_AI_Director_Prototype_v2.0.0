# Local model task map (Premiere316 v4.0.1)

Checked on 2026-09-23 against `D:\AI\Models` and this branch's runtime code. A file on disk is **installed**, not necessarily loaded or callable. This map identifies a local candidate for each production task and states whether Premiere316 can use it now. It does not change project selections or authorize generation.

| Premiere316 stage | Local choice |
| --- | --- |
| 01 Intake | Hermes 4 70B for interpretation; saving source facts needs no model. |
| 02 Research | Hermes 4 70B for synthesis; citations and source records need review. |
| 03 Screenplay | Hermes 4 70B writer/rewrite; pinned Llama 3.3 70B in the separate Movie Crew path. |
| 04 Inventory | No model for record keeping; Krea 2 RAW for new approved asset stills. |
| 05 Visual Development | Qwen3.8 27B with projector for visual interpretation; Krea 2 RAW for stills. |
| 06 Cinematography | Hermes 4 70B for planning; GAIN 27B for shot prompts. |
| 07 Performance | Llama 3.3 70B or Hermes 4 for text review; approved voice recordings stay the identity source. |
| 08 Shots | GAIN 27B for prompt/cue text; Krea 2 RAW for prepared stills. |
| 09 Prompt Lab | GAIN 27B; optional Sulphur prompt enhancer is not wired into this profile. |
| 10 Generate | Krea 2 RAW for prepared stills; specialized H3 movie path for video. Generic H3/LTX and direct TTS are blocked. |
| 11 Review | GPT-OSS 120B in the local profile; use human approval for final continuity and media decisions. |
| 12 Stitch | No model; timeline assembly uses project state and FFmpeg. |
| 13 Score | Qwen3-TTS VoiceDesign/Base and MiniMax Music3 through external local workflows, followed by import and review. |
| 14 Export | No model; FFmpeg/FFprobe perform encoding and checks. |

## Movie Script and planning

| Task | Installed local model to use | Current Premiere316 path |
| --- | --- | --- |
| Intake interpretation, source synthesis, scene architecture | Hermes 4 70B Q6_K (`LMStudio/lmstudio-community/Hermes-4-70B-GGUF/`, both GGUF shards) | Bound as **architect** in the local production profile. Requires its exact LM Studio served ID to be available. |
| Screenplay drafting and dialogue rewriting | Hermes 4 70B Q6_K | Bound as **writer** and **rewrite** in the current local production profile. The older Llama-default Movie Crew path instead uses the installed Llama 3.3 70B Instruct Q6_K; these are distinct routing configurations, not an automatic substitution. |
| Story Doctor, screenplay challenge, continuity reasoning | Llama 3.3 70B Instruct Q6_K (`LMStudio/lmstudio-community/Llama-3.3-70B-Instruct-GGUF/`, both shards) for the pinned Story Doctor; GPT-OSS 120B MXFP4 (`LMStudio/HauhauCS/GPTOSS-120B-Uncensored-HauhauCS-Aggressive/`) for the local profile's semantic reviewer | Llama requires an exact loaded served ID. GPT-OSS is the profile's reviewer, but installation alone does not prove that its large weights, context, and runtime buffers fit current free VRAM. |
| Optional independent creative challenge | Qwen3.8 27B Q8_0 (`LMStudio/lmstudio-community/Qwen3.8-27B-GGUF/`) is a candidate for an explicitly selected second opinion | The current profile names **Artemis 31B**, which was not found in the local inventory; the challenger binding remains unavailable until changed and verified. Qwen is not an automatic replacement. |
| Shot descriptions, prompt and cue drafting | Qwen3.8 27B Cold Fusion GAIN V1.1 regular Q8_0 (`LMStudio/DavidAU/Qwen3.8-27B-Cold-Fusion-GAIN-V1.1-NM-DAU-NEO-MAX-MTP-GGUF/Qwen3.8-27B-Cold-Fusion-GAIN-V1.1-NM-DAU-NEO-MAX-NEO-Q8_0.gguf`) | Bound as **prompt-cue**. The *regular* artifact is required; the similarly named MTP artifact is not interchangeable. LM Studio reported this regular model loaded at the time of inspection. |
| Short prompt cleanup | `LMStudio/SulphurAI/Sulphur-2-base/prompt_enhancer_uncensored-q8_0.gguf` | Installed; no dedicated Premiere316 production role is wired to it. Useful only through a deliberately selected local workflow. |
| Understanding reference images | Qwen3.8 27B Q8_0 with its `mmproj-Qwen3.8-27B-BF16.gguf` projector | Both files are installed. LM Studio separately reports vision support for the currently loaded GAIN variant. Premiere316 has no automatic visual-analysis task routing to either configuration; a visual workflow must verify the exact served model and projector. |

The screenplay crew uses LM Studio's local API and exact served IDs. It does not silently load or swap a model. The local profile bindings live in `src/lib/studio/production-profiles.ts`; the pinned Movie Crew rules live in `src/lib/studio/model-routing.ts` and `docs/architecture/adr-llama-default-crew.md`.

## Images, video, and audio

| Task | Installed local model to use | Current Premiere316 path |
| --- | --- | --- |
| Character, location, prop, and shot stills | Krea 2 RAW BF16 (`diffusion_models/Krea 2/krea2_raw_bf16.safetensors`) with Qwen3-VL-4B BF16 text encoder and `vae/Krea 2/krea2RealVae_v10.safetensors` | These components are present and Premiere316 has a dedicated prepared-image Krea 2 worker. Its exact component manifest and generation authorization must pass before a render. The default `flux2` still selection points to a missing `flux2_dev.safetensors`; select Krea 2 explicitly. |
| Fast alternate still concepts | FLUX.2 Klein 4B FP8 or 9B FP8 mixed (`diffusion_models/flux2/`) with matching Qwen3 encoder and FLUX.2 VAE | Weights and VAE are present. Catalog recognition does not make this the app's prepared-image generation path; verify a separate compatible workflow before using it. |
| Image editing | Qwen Image Edit 2511 INT8 (`diffusion_models/Qwen-Image/qwen_image_edit_2511_int8_convrot.safetensors`) | Installed; no verified Premiere316 image-edit adapter is established by this inventory. Import reviewed edits made in a local compatible workflow. |
| Full scene video from text | MiniMax H3 FL2VA BF16 (`diffusion_models/MiniMax-H3/minimax_h3_fl2va_bf16.safetensors`) with its Qwen3-VL-32B encoder and video/audio VAEs | The specialized native **Render movie** worker points to these exact local files and renders sequentially. This is separate from the generic MiniMax H3 Generate adapter, which returns `ADAPTER_UNAVAILABLE`. This audit did not run a film render. |
| First/last-frame or reference-conditioned video | MiniMax H3 FL2VA/Ref2VA files under `diffusion_models/MiniMax-H3/`; LTX 2.5 dev/distilled files under `diffusion_models/LTX/2.5/` are alternatives | Files are installed. The generic H3 and LTX 2.5 workers are fail-closed in this build; do not present them as ready Premiere316 generation engines. A compatible external local render may be imported and reviewed. |
| Character voice design | Qwen3-TTS 1.7B VoiceDesign (`TTS/qwen3_tts/Qwen3-TTS-12Hz-1.7B-VoiceDesign/`) | Installed. The v3 voice design UI is available under **Voice design & sound** for workflow JSON, audition imports, and approval. Premiere316's direct Qwen3-TTS worker is fail-closed; generate locally in a compatible workflow and import the WAV/FLAC. [Qwen model card](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign). |
| Voice cloning from an approved recording | Qwen3-TTS 1.7B Base (`TTS/qwen3_tts/Qwen3-TTS-12Hz-1.7B-Base/`) | Installed; use a local workflow and import the resulting audition. Keep approval and voice identity attached to the correct character. |
| Speech transcription and line alignment | Qwen3-ASR 1.7B and Qwen3 ForcedAligner 0.6B (`TTS/qwen3_tts/asr/`); smaller `ASR/faster-whisper-base.en/` is also present | Files are installed. No direct Premiere316 transcription/aligner worker was verified here. [Qwen ASR model card](https://huggingface.co/Qwen/Qwen3-ASR-1.7B). |
| Instrumental score and music | MiniMax Music3 (`diffusion_models/MiniMax-Music3/minimax_music3_dit_fp16.safetensors`) with its text encoder and `vae/MiniMax-Music3/minimax_music3_dav.safetensors` | Components are installed, but Premiere316's music generation remains fail-closed. Generate in a compatible local workflow, then import the audio. |
| Ambience, Foley, sound effects | Stable Audio 3 Medium (`background_removal/checkpoints/stableaudio3/stable_audio_3_medium.safetensors`) is present; MiniMax Music3 is the alternate music candidate | Check the companion encoder/workflow before external generation. Premiere316 does not directly render with either audio engine. |
| Upscale and cleanup | SeedVR2 3B plus VAE (`SEEDVR2/`), image upscalers (`upscale_models/`), and UVR DeEcho/DeReverb (`audio-cleanup/`) | These are installed postproduction tools, not a substitute for a missing image, video, or audio generation adapter. Use a compatible local workflow and import the reviewed result. |
| Timeline assembly and export | No generative model | Premiere316 uses project data and local FFmpeg/FFprobe for import, assembly, and export. Model selection is unnecessary for this task. |

## Readiness boundaries

- **Ready in code, still subject to runtime validation:** exact LM Studio model IDs when loaded; Krea 2 prepared-image worker; specialized native H3 movie worker. A weight file alone does not prove output quality, available VRAM, or a successful end-to-end render.
- **Installed but not directly wired:** Qwen3-TTS, MiniMax Music3, Stable Audio 3, Qwen Image Edit, and the listed upscalers/transcription models.
- **Explicitly blocked generic adapters:** LTX 2.5 video, generic MiniMax H3 Generate, and direct Qwen3-TTS. Their workers return `ADAPTER_UNAVAILABLE` rather than producing placeholder output.
- **Missing default still checkpoints:** `diffusion_models/flux2_dev.safetensors` and `diffusion_models/flux1-dev.safetensors` were not found. The existing FLUX.2 Klein files do not satisfy those exact adapters.
- **Missing screenplay challenger:** Artemis 31B is named by the local production profile but was not found under the model root.

Model paths above are relative to `D:\AI\Models`. This is an inventory and routing document, not an inference benchmark. Recheck exact components and LM Studio's loaded IDs before starting a production run.
