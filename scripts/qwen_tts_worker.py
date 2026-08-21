#!/usr/bin/env python3
"""Persistent JSON-lines bridge for standalone Qwen3-TTS Base cloning.

The worker deliberately performs one ``generate_voice_clone`` call for each
request. It never chunks or stitches dialogue. Stdout is reserved for protocol
JSON; dependency and model diagnostics are redirected to stderr before Qwen is
imported.
"""

from __future__ import annotations

import argparse
import gc
import json
import os
import random
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
    parser = argparse.ArgumentParser(description="Premiere316 standalone Qwen3-TTS Base worker")
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--attention", default="sdpa", choices=("sdpa", "flash_attention_2"))
    parser.add_argument("--protocol-info", action="store_true")
    return parser.parse_args()


ARGS = parse_args()
MODEL = None
TORCH = None
NP = None
SF = None
TORCHAUDIO = None
LOADED_ATTENTION = None


def progress(request_id: str, stage: str, value: float) -> None:
    emit({"type": "progress", "id": request_id, "stage": stage, "progress": max(0.0, min(1.0, value))})


def protocol_info() -> dict[str, Any]:
    return {
        "type": "protocol-info",
        "protocol": 1,
        "engine": "Qwen3-TTS Base",
        "model": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        "commands": ["status", "load", "generate", "unload", "shutdown"],
        "contract": {
            "oneContinuousGeneration": True,
            "exactReferenceTranscriptRequired": True,
            "xVectorOnlyMode": False,
            "outputSampleRate": 48000,
        },
    }


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


def load_model(request_id: str) -> dict[str, Any]:
    global MODEL, TORCH, NP, SF, TORCHAUDIO, LOADED_ATTENTION
    if MODEL is not None:
        return {
            "loaded": True,
            "device": ARGS.device,
            "precision": "bf16",
            "attentionImplementation": LOADED_ATTENTION,
        }

    progress(request_id, "Importing standalone Qwen3-TTS runtime", 0.03)
    import numpy as numpy
    import soundfile as soundfile
    import torch
    import torchaudio
    from qwen_tts import Qwen3TTSModel

    if not torch.cuda.is_available():
        raise RuntimeError("Standalone Qwen3-TTS requires a CUDA-capable NVIDIA GPU")
    if not torch.cuda.is_bf16_supported():
        raise RuntimeError("The active CUDA GPU does not report BF16 support")

    model_dir = Path(ARGS.model_dir).resolve()
    if not model_dir.is_dir():
        raise FileNotFoundError(f"Qwen3-TTS Base model directory is missing: {model_dir}")

    NP = numpy
    SF = soundfile
    TORCH = torch
    TORCHAUDIO = torchaudio
    progress(request_id, "Loading standalone Qwen3-TTS Base in BF16", 0.11)
    load_kwargs = {
        "device_map": ARGS.device,
        "dtype": torch.bfloat16,
        "attn_implementation": ARGS.attention,
        "local_files_only": True,
    }
    try:
        MODEL = Qwen3TTSModel.from_pretrained(str(model_dir), **load_kwargs)
        LOADED_ATTENTION = ARGS.attention
    except Exception:
        if ARGS.attention != "flash_attention_2":
            raise
        print("FlashAttention 2 load failed; retrying with PyTorch SDPA.", file=sys.stderr)
        load_kwargs["attn_implementation"] = "sdpa"
        MODEL = Qwen3TTSModel.from_pretrained(str(model_dir), **load_kwargs)
        LOADED_ATTENTION = "sdpa"

    model_type = str(getattr(MODEL.model, "tts_model_type", "")).lower()
    if model_type != "base":
        MODEL = None
        raise RuntimeError(f"Voice cloning requires the Qwen3-TTS Base model; loaded model type was {model_type or 'unknown'}")
    progress(request_id, "Standalone Qwen3-TTS Base loaded", 0.18)
    return {
        "loaded": True,
        "device": ARGS.device,
        "precision": "bf16",
        "attentionImplementation": LOADED_ATTENTION,
    }


def unload_model() -> dict[str, Any]:
    global MODEL, TORCH, NP, SF, TORCHAUDIO, LOADED_ATTENTION
    MODEL = None
    gc.collect()
    if TORCH is not None and TORCH.cuda.is_available():
        try:
            TORCH.cuda.synchronize()
        except Exception:
            pass
        TORCH.cuda.empty_cache()
        TORCH.cuda.ipc_collect()
    TORCH = None
    NP = None
    SF = None
    TORCHAUDIO = None
    LOADED_ATTENTION = None
    return {"loaded": False, "released": True}


def normalized_waveform(wavs: Any) -> Any:
    if not isinstance(wavs, (list, tuple)) or len(wavs) != 1:
        raise RuntimeError("Qwen3-TTS must return exactly one waveform for a one-piece generation")
    waveform = NP.asarray(wavs[0], dtype=NP.float32).squeeze()
    if waveform.ndim != 1 or waveform.size == 0:
        raise RuntimeError(f"Qwen3-TTS returned an unsupported waveform shape: {waveform.shape}")
    if not NP.isfinite(waveform).all():
        raise RuntimeError("Qwen3-TTS returned NaN or infinite samples")
    return waveform


def atomic_wav(destination: Path, waveform: Any, sample_rate: int, subtype: str) -> None:
    partial = destination.with_name(destination.name + ".writing")
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        if partial.exists():
            partial.unlink()
        SF.write(str(partial), waveform, sample_rate, format="WAV", subtype=subtype)
        if not partial.is_file() or partial.stat().st_size < 64:
            raise RuntimeError(f"Audio writer did not create a usable WAV: {partial}")
        os.replace(partial, destination)
    finally:
        try:
            if partial.exists():
                partial.unlink()
        except OSError:
            pass


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


def generate(request_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    load_result = load_model(request_id)
    text = str(payload.get("text") or "").strip()
    language = str(payload.get("language") or "English").strip() or "English"
    reference_audio = Path(str(payload.get("referenceAudio") or "")).resolve()
    reference_transcript = str(payload.get("referenceTranscript") or "").strip()
    native_path = Path(str(payload.get("nativePath") or "")).resolve()
    production_path = Path(str(payload.get("productionPath") or "")).resolve()
    if not text:
        raise ValueError("Speech text is required")
    if not reference_audio.is_file():
        raise FileNotFoundError(f"Reference WAV is missing: {reference_audio}")
    if reference_audio.suffix.lower() != ".wav":
        raise ValueError("Qwen3-TTS voice cloning requires a WAV reference")
    if not reference_transcript:
        raise ValueError("The exact reference transcript is required for ICL voice cloning")
    if native_path.suffix.lower() != ".wav" or production_path.suffix.lower() != ".wav":
        raise ValueError("nativePath and productionPath must name WAV files")

    settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
    seed = bounded_int(payload.get("seed"), 316, 0, 2_147_483_647)
    generation_kwargs = {
        "do_sample": True,
        "top_k": bounded_int(settings.get("topK"), 20, 1, 200),
        "top_p": bounded_float(settings.get("topP"), 0.8, 0.05, 1.0),
        "temperature": bounded_float(settings.get("temperature"), 0.9, 0.1, 2.0),
        "repetition_penalty": bounded_float(settings.get("repetitionPenalty"), 1.05, 0.5, 2.0),
        "subtalker_dosample": True,
        "subtalker_top_k": bounded_int(settings.get("subtalkerTopK"), 20, 1, 200),
        "subtalker_top_p": bounded_float(settings.get("subtalkerTopP"), 0.8, 0.05, 1.0),
        "subtalker_temperature": bounded_float(settings.get("subtalkerTemperature"), 0.9, 0.1, 2.0),
        "max_new_tokens": bounded_int(settings.get("maxNewTokens"), 4096, 128, 8192),
    }

    random.seed(seed)
    NP.random.seed(seed)
    TORCH.manual_seed(seed)
    TORCH.cuda.manual_seed_all(seed)
    progress(request_id, "Cloning voice in one continuous Qwen3-TTS generation", 0.24)
    cuda_index = TORCH.device(ARGS.device).index
    fork_devices = [cuda_index if cuda_index is not None else TORCH.cuda.current_device()]
    with TORCH.inference_mode(), TORCH.random.fork_rng(devices=fork_devices):
        TORCH.manual_seed(seed)
        TORCH.cuda.manual_seed_all(seed)
        # This scalar call is the editorial contract: no segmenting or stitching.
        wavs, sample_rate = MODEL.generate_voice_clone(
            text=text,
            language=language,
            ref_audio=str(reference_audio),
            ref_text=reference_transcript,
            x_vector_only_mode=False,
            non_streaming_mode=True,
            **generation_kwargs,
        )

    waveform = normalized_waveform(wavs)
    native_rate = int(sample_rate)
    if native_rate <= 0:
        raise RuntimeError(f"Qwen3-TTS returned an invalid sample rate: {native_rate}")
    progress(request_id, "Writing native Qwen voice-clone master", 0.78)
    atomic_wav(native_path, waveform, native_rate, "FLOAT")
    progress(request_id, "Creating 48 kHz PCM24 production master", 0.88)
    production = production_48k(waveform, native_rate)
    atomic_wav(production_path, production, 48000, "PCM_24")
    progress(request_id, "Qwen voice-clone master complete", 0.96)
    return {
        **load_result,
        "seed": seed,
        "nativePath": str(native_path),
        "productionPath": str(production_path),
        "nativeSampleRate": native_rate,
        "outputSampleRate": 48000,
        "nativeFrames": int(waveform.size),
        "durationSec": float(waveform.size / native_rate),
        "oneContinuousGeneration": True,
        "xVectorOnlyMode": False,
        "settings": generation_kwargs,
    }


def handle(request: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    request_id = str(request.get("id") or "")
    if not request_id:
        raise ValueError("request id is required")
    command = str(request.get("command") or "").strip().lower()
    payload = request.get("payload") if isinstance(request.get("payload"), dict) else {}
    if command == "status":
        return ({"loaded": MODEL is not None, "device": ARGS.device, "attentionImplementation": LOADED_ATTENTION}, False)
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
    if ARGS.protocol_info:
        emit(protocol_info())
        return 0
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    emit({
        "type": "ready",
        "protocol": 1,
        "engine": "Qwen3-TTS Base",
        "model": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        "loaded": False,
        "device": ARGS.device,
        "attentionImplementation": ARGS.attention,
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
    unload_model()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
