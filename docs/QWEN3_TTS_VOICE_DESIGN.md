# Qwen3-TTS Voice Design

Premiere316 uses the standalone Qwen3-TTS VoiceDesign checkpoint to cast an original character voice from a natural-language description. It does not replace IndexTTS 2.5: Qwen creates and auditions the voice identity, while the selected native audition can become an immutable IndexTTS speaker reference for subsequent dialogue.

This integration is intentionally separate from ComfyUI and IndexTTS. It installs only the 1.7B VoiceDesign checkpoint—not Qwen3-TTS Base or CustomVoice—and it does not add packages to either existing Python environment.

## Immutable upstream contract

| Artifact | Immutable pin | Official source |
|---|---|---|
| Qwen3-TTS code | `022e286b98fbec7e1e916cb940cdf532cd9f488e` | [QwenLM/Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) · [pinned commit](https://github.com/QwenLM/Qwen3-TTS/commit/022e286b98fbec7e1e916cb940cdf532cd9f488e) |
| VoiceDesign model | `5ecdb67327fd37bb2e042aab12ff7391903235d3` | [Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign) · [pinned tree](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign/tree/5ecdb67327fd37bb2e042aab12ff7391903235d3) |
| Main weights | SHA-256 `391e8db219f292c515297cdceeb43e4eae67cdde35fa57e79a6a8a532fca0522` | `model.safetensors`, 3,833,402,552 bytes |
| Speech-tokenizer weights | SHA-256 `836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258` | `speech_tokenizer/model.safetensors`, 682,293,092 bytes |

The server records both revisions with every audition and rejects an install manifest, source checkout, or model declaration that does not match the Premiere316 pins. Runtime loading uses the local model directory with `local_files_only=True`; the worker is launched with Hugging Face and Transformers offline mode enabled.

## Installed layout

The verified workstation installation uses these paths:

| Purpose | Path |
|---|---|
| Runtime root | `C:\Users\Blokey\AppData\Local\Premiere316\Qwen3-TTS-VoiceDesign` |
| Standalone Python | `C:\Users\Blokey\AppData\Local\Premiere316\Qwen3-TTS-VoiceDesign\.venv\Scripts\python.exe` |
| Verified source checkout | `C:\Users\Blokey\AppData\Local\Premiere316\Qwen3-TTS-VoiceDesign\src\Qwen3-TTS` |
| Install manifest | `C:\Users\Blokey\AppData\Local\Premiere316\Qwen3-TTS-VoiceDesign\premiere316-install.json` |
| Download state | `C:\Users\Blokey\AppData\Local\Premiere316\Qwen3-TTS-VoiceDesign\download-progress.json` |
| VoiceDesign model | `E:\Premiere316\Models\Qwen3-TTS-12Hz-1.7B-VoiceDesign` |

The manifest is authoritative for the source and model locations. A new clean run of the repository installer may create the source checkout as `<runtime-root>\source`; health checks use the path recorded in the manifest rather than assuming one source-directory name.

### Python 3.11 decision

The official README recommends a fresh Python 3.12 environment, but the pinned official [`pyproject.toml`](https://github.com/QwenLM/Qwen3-TTS/blob/022e286b98fbec7e1e916cb940cdf532cd9f488e/pyproject.toml) declares Python `>=3.9` and explicitly classifies Python 3.11 as supported. This workstation therefore uses CPython `3.11.15`.

That choice was necessary for a safe local install: the compatible `torch==2.8.0+cu128` and `torchaudio==2.8.0+cu128` CPython 3.11 artifacts were already present in the uv cache, while Python 3.12 would have required another multi-gigabyte Torch wheel on a C: volume that did not have safe headroom. uv installed the cached pair with NTFS hardlinks. The new venv still has its own logical package installation and `include-system-site-packages=false`; it neither imports from nor modifies IndexTTS.

The verified core runtime is:

- CPython `3.11.15`;
- uv `0.11.12`;
- `qwen-tts==0.1.1` built from the pinned checkout;
- `torch==2.8.0+cu128`;
- `torchaudio==2.8.0+cu128`;
- CUDA runtime 12.8 with `sm_120` support;
- BF16 enabled on the RTX 5090 Laptop GPU.

## Inference and attention policy

The worker follows the official API through `Qwen3TTSModel.from_pretrained(...)` and `generate_voice_design(text=..., language=..., instruct=...)`. Text is the exact spoken audition line; `instruct` is the compiled natural-language voice description. Those inputs remain separate.

The production baseline is:

```text
device_map = cuda:0
dtype = torch.bfloat16
attn_implementation = sdpa
local_files_only = true
```

CUDA and BF16 are required. Startup fails clearly if the selected GPU does not expose either capability. The verified Torch build reports CUDA 12.8, compute capability 12.0, and an architecture list containing `sm_120`; a small BF16 CUDA matrix multiplication passed before any model load.

FlashAttention 2 is optional and is not required on Windows. The default `sdpa` path uses PyTorch/Transformers attention and works without a separately compiled `flash-attn` package. If `QWEN3_TTS_VOICE_DESIGN_ATTENTION=flash_attention_2` is explicitly requested and that load fails, the worker retries once with `sdpa` and reports the implementation it actually loaded.

## Audio contract

“12Hz” names the model's internal token rate; it is not the output WAV sample rate. The model's native audio contract is 24 kHz.

| Output | Format | Purpose |
|---|---|---|
| Native audition | Mono, 24,000 Hz, 32-bit float WAV (`FLOAT`) | Immutable model output, signal/provenance validation, and IndexTTS speaker-reference handoff |
| Production copy | Mono, 48,000 Hz, 24-bit PCM WAV (`PCM_24`) | Editorial playback, Assets/Voice Library registration, and production interchange |

The worker requires the upstream method to return exactly 24,000 Hz, finite samples, and a non-empty mono waveform. It writes the native file atomically and never converts or overwrites it. When **Create a separate 48 kHz production copy** is enabled, the worker resamples from the native waveform with torchaudio's Kaiser-windowed sinc resampler and writes a second atomic PCM24 WAV.

The 48 kHz copy is a delivery derivative, not a new voice reference. Premiere316 prefers it for general media/asset use, while the IndexTTS handoff deliberately uses the unchanged native 24 kHz float WAV together with its exact audition transcript, SHA-256, validation results, and pinned-model provenance.

## Lazy loading, GPU release, and cancellation

Qwen VoiceDesign is not loaded when Premiere316 starts. Health checks read paths, pins, and required files only. The standalone JSONL worker starts with `loaded: false`, and the heavyweight imports and model allocation occur only when the user presses **Load model** or the first generation job reaches the worker.

Generation is serialized through the Premiere316 queue and shared GPU-resource manager. Before Qwen loads, the queue waits for active shared work, unloads another resident local voice engine when appropriate, and asks ComfyUI to release idle models. A busy Qwen worker rejects a second request instead of running concurrent generations in the same process.

VoiceDesign remains standalone when ComfyUI is offline: a refused ComfyUI connection is treated as “nothing to release” only when there is no active ComfyUI GPU lease. A ComfyUI lease with a job ID or active state always fails closed, so a transient listener failure cannot cause Qwen to start over live Comfy work.

- **Unload / release GPU** sends a graceful shutdown when the worker is idle. The worker drops the model, synchronizes CUDA, calls `empty_cache()` and `ipc_collect()`, runs garbage collection, and exits.
- The default resident-idle timeout is 180,000 ms. After a completed request, an idle loaded worker shuts itself down when that timer expires. `QWEN3_TTS_VOICE_DESIGN_IDLE_MS` can change it, with a 10-second minimum.
- **Cancel** aborts the active queue job and terminates only the owned Qwen worker process. The upstream generation call is synchronous and does not expose token-level cooperative cancellation, so process termination is the reliable interruption boundary.
- Audition files are written through `.partial` files followed by an atomic replace, so an interrupted write is never accepted under the final WAV name. Normal Python exceptions remove the partial file; server cancellation removes any recorded final outputs, marks queued/generating auditions cancelled, and requires a fresh lazy load. Because Windows cancellation forcibly terminates the synchronous worker, an orphaned `.partial` can remain after a hard stop; it is never treated as a completed audition and should be removed only after confirming that no Qwen worker is active.

## Installer, manifest, and discovery

The repository-owned installer is [`scripts/install_qwen_voice_design.ps1`](../scripts/install_qwen_voice_design.ps1), with snapshot handling in [`scripts/download_qwen_voice_design.py`](../scripts/download_qwen_voice_design.py). A clean invocation supplies all immutable values explicitly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\install_qwen_voice_design.ps1 `
  -RuntimeRoot "C:\Users\Blokey\AppData\Local\Premiere316\Qwen3-TTS-VoiceDesign" `
  -ModelDir "E:\Premiere316\Models\Qwen3-TTS-12Hz-1.7B-VoiceDesign" `
  -CodeRevision "022e286b98fbec7e1e916cb940cdf532cd9f488e" `
  -ModelRevision "5ecdb67327fd37bb2e042aab12ff7391903235d3"
```

Do not rerun the installer merely to test an already-ready runtime. Check the VoiceDesign health response and current free space first.

The installer and downloader enforce the same storage and integrity policy as the verified workstation install. They calculate the exact missing payload before download, refuse an operation projected to leave less than 1 GiB free on the model volume, use one download worker, verify the 13-file/4,520,163,832-byte snapshot, and hash both large weight files. Torch and torchaudio are constrained to the verified CUDA 12.8 pair so installing Qwen dependencies cannot silently replace them. A forced repair rejects a busy Qwen worker and unloads an idle one before touching the venv, source checkout, model, or manifest. The completed manifest retains runtime, integrity, free-space, and verification evidence rather than replacing it with a minimal declaration.

`premiere316-install.json` uses `schemaVersion: 1`. Its operational fields are:

- `source.repository`, `source.codeRevision`, and `source.localDirectory`;
- `model.repository`, `model.modelRevision`, and `model.localDirectory`;
- `runtime.pythonExecutable`, Torch/torchaudio versions, precision, attention implementation, and isolation flags;
- `download.bytesDownloaded`, `download.totalBytes`, and free-space evidence;
- optional integrity and smoke-verification details.

The current manifest contains the absolute E: model path, so the default app configuration needs no environment override. These overrides are available for controlled deployments:

| Variable | Meaning |
|---|---|
| `QWEN3_TTS_VOICE_DESIGN_ROOT` | Runtime root. `QWEN_VOICE_DESIGN_ROOT` is accepted as a compatibility alias. |
| `QWEN3_TTS_VOICE_DESIGN_MODEL_DIR` | Exact local snapshot directory. `QWEN_VOICE_DESIGN_MODEL_DIR` is accepted as a compatibility alias. |
| `QWEN3_TTS_VOICE_DESIGN_PYTHON` | Standalone venv Python executable. |
| `QWEN3_TTS_VOICE_DESIGN_IDLE_MS` | Loaded-worker idle timeout; default 180,000 ms and minimum 10,000 ms. |
| `QWEN3_TTS_VOICE_DESIGN_ATTENTION` | `sdpa` by default; `flash_attention_2` is an optional request with SDPA fallback. |
| `QWEN3_TTS_VOICE_DESIGN_CODE_REVISION` | Declared code revision. Values outside the application pin fail health validation. |
| `QWEN3_TTS_VOICE_DESIGN_MODEL_REVISION` | Declared model revision. Values outside the application pin fail health validation. |

The worker process also receives `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, `HF_HUB_DISABLE_TELEMETRY=1`, and `PYTHONNOUSERSITE=1`. These are runtime isolation controls rather than alternative model-location settings.

## Storage caveat

The pinned 13-file model payload is 4,520,163,832 bytes (about 4.21 GiB). Hugging Face local-download metadata and filesystem allocation increased the observed E: consumption to 4,528,799,744 bytes. At installation time E: had 6,239,551,488 bytes free before download and 1,710,751,744 bytes (about 1.59 GiB) afterward, remaining above the required 1 GiB floor.

C: initially had too little safe headroom for both the model and a duplicate Python 3.12 CUDA Torch wheel, which is why the model is on E: and the CPython 3.11 Torch files use physical hardlink deduplication on C:. Do not duplicate or relocate the snapshot, rebuild the venv, or clear shared uv cache content without recalculating current free space and understanding hardlink ownership. The original installation did not delete or clean any existing runtime.

## License and runtime caveats

The pinned official repository and model declare the [Apache License 2.0](https://github.com/QwenLM/Qwen3-TTS/blob/022e286b98fbec7e1e916cb940cdf532cd9f488e/LICENSE). Preserve required notices and review the license before redistribution. The software/model license does not grant rights to a real person's identity, a performance, scripts, or other input material; production use remains responsible for consent and applicable law.

Additional operational limits:

- This runtime contains only `Qwen3-TTS-12Hz-1.7B-VoiceDesign`.
- FlashAttention is not installed in the verified Windows environment; SDPA is the supported baseline.
- The Python `sox` package may print a warning when the complete Qwen package imports without an external SoX executable. The installed 12 Hz VoiceDesign path does not use the source tree's 25 Hz SoX normalization implementation.
- One persistent worker handles one request at a time. A batch of one to three auditions is generated serially with distinct recorded seeds.
- A seed is recorded and reseeds Torch/CUDA in an isolated RNG scope, but it is best-effort reproducibility rather than a promise of bit-identical audio across different drivers, attention backends, or runtime revisions.
- IndexTTS accepts speaker references only from 8 to 15 seconds. Premiere keeps shorter/longer Qwen auditions as valid designed voices but disables their **Send to IndexTTS** action and explains that the spoken line must be adjusted and regenerated.

## Verified live production smoke

On 2026-08-20 the live Premiere316 service completed the core end-to-end path against the pinned runtime:

- one VoiceDesign request sent the exact audible line to `text` and the separate compiled casting direction to `instruct`, then produced three distinct validated auditions at 24 kHz with seeds `31642`, `31643`, and `31644`;
- the three native SHA-256 values were `1de0b97072a5f0fe3c3603826e7e15f82eeebc16a22131000ed5d97787059fcd`, `0916b4f823c36a1ef11b106070ae78f71bd4380b570b4150d871584939413480`, and `5f259213547ad579e0d25d62fcc6c075a25d66505cc8e760ea26de4de5c04ed6`;
- a separate 13.92-second take (`1d08355f47444b57f0d00c49e4d6ddab68d194682ef8ff7b3c1933c1e46d721c`) was selected, saved to the character's versioned Voice Library asset, and handed to IndexTTS as immutable voice `voice_1d08355f47444b57` with its exact transcript sidecar;
- IndexTTS used that reference to generate a new 6.106848-second, mono 22,050 Hz dialogue WAV (`24dd046b67d185b850969f883d7b6a243f8e40805a635eb71b35ec59eff826db`), served successfully through Premiere316 media routing;
- Qwen released its worker/lease before IndexTTS acquired the GPU, and the IndexTTS idle shutdown later released its worker/lease.

After those successful runs, Windows stopped exposing the E: model volume. Premiere316 now reports **Installed · model unavailable** and disables model loading instead of treating missing files as a usable runtime. The generated project media and metadata remain on C:. Do not run a forced repair, relocate the snapshot, or redownload the model to work around a missing volume; restore the existing volume first. Queue/process cancellation remains covered by the automated worker tests, but a second live mid-generation cancellation cannot be run while the pinned model volume is absent.

## User workflow

1. Open **Create Sound**, then choose **Voice Design**.
2. Confirm the engine shows **Installed · lazy load** or **Loaded**. If it shows **Installed · model unavailable**, restore the configured model volume before continuing. Use **Load model** only when immediate warm-up is useful; generation will otherwise load it automatically.
3. Select a character or use **Autofill from selected character**, name the voice, and describe age, register, timbre, texture, resonance, accent/cadence, diction, pace, temperament, performance style, intensity, period direction, and exclusions.
4. Choose the language and enter the exact audition line. Only that line is spoken; keep stage direction in the voice-description fields.
5. Request one to three auditions, optionally set a best-effort repeat seed, leave the separate 48 kHz production copy enabled for editorial use, and press **Generate audition(s)**.
6. Listen to the native and 48 kHz variants, compare finished auditions, and regenerate or create a variation when needed.
7. Use **Select voice** to make a validated result canonical for the character, then **Save to library** for a reusable Voice Library asset.
8. For an audition between 8 and 15 seconds, use **Send to IndexTTS** to register the immutable native WAV and exact transcript as the IndexTTS 2.5 speaker reference. The original Qwen audition is preserved. If the action is disabled, lengthen or shorten only the audible audition line and regenerate.
9. Use **Cancel** for an active job or **Unload / release GPU** when finished so the shared GPU can return to IndexTTS, ComfyUI, or video generation.
