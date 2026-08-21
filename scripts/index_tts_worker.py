"""Persistent JSON-lines bridge from Premiere316 to standalone IndexTTS-2.5.

Stdout is reserved for protocol JSON. IndexTTS and dependency logging is
redirected to stderr before the package is imported.
"""

from __future__ import annotations

import argparse
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


def bounded_vector(value: Any) -> list[float]:
    if not isinstance(value, list) or len(value) != 8:
        raise ValueError("emotionVector must contain exactly eight numbers")
    result = []
    for item in value:
        number = float(item)
        if number != number or number in (float("inf"), float("-inf")):
            raise ValueError("emotionVector contains a non-finite number")
        result.append(max(0.0, min(1.0, number)))
    return result


def truncated_scaled(vector: list[float], weight: float) -> list[float]:
    scale = max(0.0, min(1.0, float(weight)))
    return [int(value * scale * 10000) / 10000 for value in vector]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Premiere316 IndexTTS-2.5 JSONL worker")
    parser.add_argument("--root", required=False)
    parser.add_argument("--model-dir", required=False)
    parser.add_argument("--config", required=False)
    parser.add_argument("--use-qwen-emo", action="store_true")
    parser.add_argument("--protocol-info", action="store_true")
    return parser.parse_args()


def protocol_info() -> dict[str, Any]:
    return {
        "type": "protocol-info",
        "protocol": 1,
        "engine": "IndexTTS-2.5",
        "commands": ["generate"],
        "emotionLabels": [
            "happy",
            "angry",
            "sad",
            "afraid",
            "disgusted",
            "melancholic",
            "surprised",
            "calm",
        ],
        "runtime": {
            "useBf16": True,
            "useCudaKernel": False,
            "useDeepSpeed": False,
            "useAccel": False,
            "useTorchCompile": False,
            "qwenEmotionDefault": False,
        },
    }


def main() -> int:
    args = parse_args()
    if args.protocol_info:
        emit(protocol_info())
        return 0
    if not args.root or not args.model_dir or not args.config:
        emit({"type": "fatal", "error": "--root, --model-dir, and --config are required"})
        return 2

    root = Path(args.root).resolve()
    model_dir = Path(args.model_dir).resolve()
    config = Path(args.config).resolve()
    os.chdir(root)
    sys.path.insert(0, str(root))
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    try:
        from indextts.infer_v2_5 import IndexTTS2

        model = IndexTTS2(
            cfg_path=str(config),
            model_dir=str(model_dir),
            use_bf16=True,
            device=None,
            use_cuda_kernel=False,
            use_deepspeed=False,
            use_accel=False,
            use_torch_compile=False,
            use_qwen_emo=bool(args.use_qwen_emo),
        )
        emit(
            {
                "type": "ready",
                "protocol": 1,
                "engine": "IndexTTS-2.5",
                "device": str(model.device),
                "useQwenEmotion": bool(args.use_qwen_emo),
                "runtime": protocol_info()["runtime"],
            }
        )
    except Exception as error:  # startup failures must still use protocol stdout
        traceback.print_exc(file=sys.stderr)
        emit({"type": "fatal", "error": f"IndexTTS startup failed: {error}"})
        return 1

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = str(request.get("id") or "")
            if not request_id:
                raise ValueError("request id is required")
            if request.get("command") != "generate":
                raise ValueError(f"unsupported command: {request.get('command')}")

            reference_audio = Path(str(request.get("referenceAudio") or "")).resolve()
            output_path = Path(str(request.get("outputPath") or "")).resolve()
            text = str(request.get("text") or "").strip()
            style = str(request.get("style") or "").strip()
            language = str(request.get("language") or "EN").strip().upper() or "EN"
            if language == "AUTO":
                language = "EN"
            if language not in {"EN", "ZH", "JA", "ES", "AR"}:
                raise ValueError("language must be EN, ZH, JA, ES, AR, or AUTO")
            emotion_weight = max(0.0, min(1.0, float(request.get("emotionWeight", 0.8))))
            duration_factor = float(request.get("durationFactor", 1.0))
            if duration_factor < 0.5 or duration_factor > 2.0:
                raise ValueError("durationFactor must be between 0.5 and 2.0")
            seed = int(request.get("seed", 0))
            if seed < 0 or seed > 0x7FFFFFFF:
                raise ValueError("seed must be between 0 and 2147483647")
            if not reference_audio.is_file():
                raise FileNotFoundError(f"reference audio not found: {reference_audio}")
            if not text:
                raise ValueError("speech text is required")
            output_path.parent.mkdir(parents=True, exist_ok=True)
            if output_path.exists():
                output_path.unlink()

            raw_vector = bounded_vector(request.get("emotionVector"))
            vector_source = "premiere316-style-heuristic"
            if args.use_qwen_emo and style:
                if model.qwen_emo is None:
                    raise RuntimeError("Qwen emotion was requested but is not loaded")
                emotion_mapping = model.qwen_emo.inference(style)
                raw_vector = bounded_vector(list(emotion_mapping.values()))
                vector_source = "indextts-qwen-emotion"
            normalized_vector = model.normalize_emo_vec(raw_vector)
            actual_vector = truncated_scaled(normalized_vector, emotion_weight)
            import numpy as np
            import torch

            random.seed(seed)
            np.random.seed(seed)
            torch.manual_seed(seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(seed)

            emit(
                {
                    "type": "progress",
                    "id": request_id,
                    "stage": "Generating cloned speech with standalone IndexTTS-2.5",
                    "progress": 0.18,
                }
            )
            model.infer(
                spk_audio_prompt=str(reference_audio),
                text=text,
                output_path=str(output_path),
                lang=language.lower(),
                emo_audio_prompt=None,
                emo_alpha=emotion_weight,
                emo_vector=normalized_vector,
                use_emo_text=False,
                emo_text=None,
                use_random=False,
                interval_silence=200,
                verbose=False,
                max_text_tokens_per_segment=120,
                stream_return=False,
                duration_factor=duration_factor,
                text_normalization=True,
            )
            if not output_path.is_file() or output_path.stat().st_size < 64:
                raise RuntimeError("IndexTTS did not create a usable WAV file")
            emit(
                {
                    "type": "response",
                    "id": request_id,
                    "ok": True,
                    "result": {
                        "outputPath": str(output_path),
                        "bytes": output_path.stat().st_size,
                        "device": str(model.device),
                        "emotionVector": actual_vector,
                        "emotionVectorSource": vector_source,
                        "durationFactor": duration_factor,
                        "seed": seed,
                    },
                }
            )
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            emit(
                {
                    "type": "response",
                    "id": request_id,
                    "ok": False,
                    "error": str(error),
                }
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
