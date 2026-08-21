#!/usr/bin/env python3
"""Premiere316 standalone Qwen3-TTS VoiceDesign JSONL worker.

Stdout is reserved for the JSON protocol. Model/library diagnostics are routed
to stderr before heavyweight imports occur.
"""

from __future__ import annotations

import argparse
import gc
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any


PROTOCOL_STDOUT = sys.stdout
sys.stdout = sys.stderr


def emit(message: dict[str, Any]) -> None:
    PROTOCOL_STDOUT.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    PROTOCOL_STDOUT.flush()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Premiere316 Qwen3-TTS VoiceDesign worker")
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--model-revision", required=True)
    parser.add_argument("--code-revision", required=True)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--attention", default="sdpa", choices=("sdpa", "flash_attention_2"))
    return parser.parse_args()


ARGS = parse_args()
MODEL = None
TORCH = None
NP = None
SF = None
TORCHAUDIO = None
DEVICE = ARGS.device
LOADED_ATTENTION = None


def progress(request_id: str, stage: str, value: float) -> None:
    emit({"type": "progress", "id": request_id, "stage": stage, "progress": max(0.0, min(1.0, value))})


def load_model(request_id: str) -> dict[str, Any]:
    global MODEL, TORCH, NP, SF, TORCHAUDIO, DEVICE, LOADED_ATTENTION
    if MODEL is not None:
        return {
            "loaded": True,
            "device": DEVICE,
            "precision": "bf16",
            "attentionImplementation": LOADED_ATTENTION,
        }

    progress(request_id, "Importing standalone Qwen3-TTS runtime", 0.05)
    import numpy as numpy
    import soundfile as soundfile
    import torch
    import torchaudio
    from qwen_tts import Qwen3TTSModel

    if not torch.cuda.is_available():
        raise RuntimeError("Qwen VoiceDesign requires a CUDA-capable NVIDIA GPU")
    if not torch.cuda.is_bf16_supported():
        raise RuntimeError("The active CUDA GPU does not report BF16 support")

    NP = numpy
    SF = soundfile
    TORCH = torch
    TORCHAUDIO = torchaudio
    DEVICE = ARGS.device
    progress(request_id, "Loading Qwen3-TTS VoiceDesign in BF16", 0.15)

    load_kwargs = {
        "device_map": DEVICE,
        "dtype": torch.bfloat16,
        "attn_implementation": ARGS.attention,
        "local_files_only": True,
    }
    fallback_to_sdpa = False
    try:
        MODEL = Qwen3TTSModel.from_pretrained(ARGS.model_dir, **load_kwargs)
        LOADED_ATTENTION = ARGS.attention
    except Exception:
        if ARGS.attention != "flash_attention_2":
            raise
        print("FlashAttention 2 load failed; retrying with PyTorch SDPA.", file=sys.stderr)
        fallback_to_sdpa = True

    if fallback_to_sdpa:
        MODEL = None
        LOADED_ATTENTION = None
        gc.collect()
        try:
            torch.cuda.empty_cache()
        except Exception:
            pass
        try:
            torch.cuda.ipc_collect()
        except Exception:
            pass
        load_kwargs["attn_implementation"] = "sdpa"
        MODEL = Qwen3TTSModel.from_pretrained(ARGS.model_dir, **load_kwargs)
        LOADED_ATTENTION = "sdpa"

    progress(request_id, "Qwen3-TTS VoiceDesign loaded", 1.0)
    return {
        "loaded": True,
        "device": DEVICE,
        "precision": "bf16",
        "attentionImplementation": LOADED_ATTENTION,
        "modelId": ARGS.model_id,
        "modelRevision": ARGS.model_revision,
        "codeRevision": ARGS.code_revision,
    }


def unload_model() -> dict[str, Any]:
    global MODEL, TORCH, NP, SF, TORCHAUDIO, LOADED_ATTENTION
    MODEL = None
    if TORCH is not None and TORCH.cuda.is_available():
        try:
            TORCH.cuda.synchronize()
        except Exception:
            pass
        TORCH.cuda.empty_cache()
        TORCH.cuda.ipc_collect()
    gc.collect()
    TORCH = None
    NP = None
    SF = None
    TORCHAUDIO = None
    LOADED_ATTENTION = None
    return {"loaded": False, "released": True}


def atomic_soundfile_write(destination: Path, audio: Any, sample_rate: int, subtype: str) -> None:
    partial = destination.with_name(destination.name + ".partial")
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        if partial.exists():
            partial.unlink()
        SF.write(str(partial), audio, sample_rate, format="WAV", subtype=subtype)
        if not partial.exists() or partial.stat().st_size < 64:
            raise RuntimeError(f"Audio writer did not create a usable WAV: {partial}")
        os.replace(partial, destination)
    finally:
        try:
            if partial.exists():
                partial.unlink()
        except OSError:
            pass


def normalize_waveform(wavs: Any) -> Any:
    if not isinstance(wavs, (list, tuple)) or not wavs:
        raise RuntimeError("Qwen VoiceDesign returned no audition waveform")
    waveform = NP.asarray(wavs[0], dtype=NP.float32)
    waveform = NP.squeeze(waveform)
    if waveform.ndim != 1 or waveform.size == 0:
        raise RuntimeError(f"Qwen VoiceDesign returned an unsupported waveform shape: {waveform.shape}")
    if not NP.isfinite(waveform).all():
        raise RuntimeError("Qwen VoiceDesign returned NaN or infinite samples")
    return waveform


def production_48k(waveform: Any, native_rate: int) -> Any:
    tensor = TORCH.from_numpy(waveform).to(dtype=TORCH.float32).unsqueeze(0)
    if native_rate != 48000:
        tensor = TORCHAUDIO.functional.resample(
            tensor,
            orig_freq=native_rate,
            new_freq=48000,
            lowpass_filter_width=64,
            rolloff=0.9475937167399596,
            resampling_method="sinc_interp_kaiser",
            beta=14.769656459379492,
        )
    return tensor.squeeze(0).cpu().numpy()


def bounded_float(value: Any, default: float, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def bounded_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def generate(request_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    load_result = load_model(request_id)
    text = str(payload.get("text") or "").strip()
    instruct = str(payload.get("instruct") or "").strip()
    language = str(payload.get("language") or "English").strip()
    if not text:
        raise ValueError("Audition text is required")
    if not instruct:
        raise ValueError("Voice description instruction is required")

    seed = bounded_int(payload.get("seed"), 42, 0, 2_147_483_647)
    settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
    generation_kwargs = {
        "do_sample": True,
        "temperature": bounded_float(settings.get("temperature"), 0.9, 0.1, 2.0),
        "top_p": bounded_float(settings.get("topP"), 0.8, 0.05, 1.0),
        "top_k": bounded_int(settings.get("topK"), 50, 1, 200),
        "repetition_penalty": bounded_float(settings.get("repetitionPenalty"), 1.05, 0.5, 2.0),
        "max_new_tokens": bounded_int(settings.get("maxNewTokens"), 2048, 128, 4096),
    }

    native_path = Path(str(payload.get("nativePath") or "")).resolve()
    production_path_value = str(payload.get("production48kPath") or "").strip()
    production_path = Path(production_path_value).resolve() if production_path_value else None
    if not native_path.name.lower().endswith(".wav"):
        raise ValueError("nativePath must name a WAV file")
    if production_path is not None and not production_path.name.lower().endswith(".wav"):
        raise ValueError("production48kPath must name a WAV file")

    progress(request_id, "Generating Qwen VoiceDesign audition", 0.3)
    cuda_index = TORCH.device(DEVICE).index
    fork_devices = [cuda_index if cuda_index is not None else TORCH.cuda.current_device()]
    with TORCH.random.fork_rng(devices=fork_devices):
        TORCH.manual_seed(seed)
        TORCH.cuda.manual_seed_all(seed)
        wavs, sample_rate = MODEL.generate_voice_design(
            text=text,
            language=language,
            instruct=instruct,
            **generation_kwargs,
        )

    waveform = normalize_waveform(wavs)
    sample_rate = int(sample_rate)
    if sample_rate != 24000:
        raise RuntimeError(f"VoiceDesign returned {sample_rate} Hz; expected the native 24000 Hz contract")
    progress(request_id, "Writing native 24 kHz float WAV", 0.78)
    atomic_soundfile_write(native_path, waveform, sample_rate, "FLOAT")

    if production_path is not None:
        progress(request_id, "Creating separate 48 kHz PCM24 production copy", 0.88)
        resampled = production_48k(waveform, sample_rate)
        atomic_soundfile_write(production_path, resampled, 48000, "PCM_24")

    progress(request_id, "Audition files complete", 1.0)
    return {
        **load_result,
        "seed": seed,
        "nativePath": str(native_path),
        "production48kPath": str(production_path) if production_path is not None else None,
        "nativeSampleRate": sample_rate,
        "productionSampleRate": 48000 if production_path is not None else None,
        "nativeFrames": int(waveform.size),
        "durationSec": float(waveform.size / sample_rate),
        "settings": generation_kwargs,
    }


def handle(request: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    request_id = str(request.get("id") or "")
    command = str(request.get("command") or "").strip().lower()
    payload = request.get("payload") if isinstance(request.get("payload"), dict) else {}
    if command == "status":
        return ({"loaded": MODEL is not None, "device": DEVICE, "precision": "bf16", "attentionImplementation": LOADED_ATTENTION}, False)
    if command == "load":
        return (load_model(request_id), False)
    if command == "generate":
        return (generate(request_id, payload), False)
    if command == "unload":
        return (unload_model(), False)
    if command == "shutdown":
        return (unload_model(), True)
    raise ValueError(f"Unknown worker command: {command}")


def main() -> int:
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    emit({
        "type": "ready",
        "loaded": False,
        "device": DEVICE,
        "precision": "bf16",
        "attentionImplementation": ARGS.attention,
        "modelId": ARGS.model_id,
        "modelRevision": ARGS.model_revision,
        "codeRevision": ARGS.code_revision,
    })
    for raw_line in sys.stdin:
        request_id = ""
        try:
            request = json.loads(raw_line)
            request_id = str(request.get("id") or "")
            result, stop = handle(request)
            emit({"type": "response", "id": request_id, "ok": True, "result": result})
            if stop:
                break
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            emit({"type": "response", "id": request_id, "ok": False, "error": str(error)})
            # A failed initial model load can leave CUDA allocator state behind
            # even though MODEL was never assigned. The Node owner terminates
            # this process after the response; clear what we can immediately.
            if MODEL is None:
                try:
                    unload_model()
                except Exception:
                    pass
    unload_model()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
