#!/usr/bin/env python3
"""Generate resumable, locally verified Prodigal Son casting auditions.

Uses the installed official Qwen VoiceDesign API directly, without any server.
The growing casting draft is reread between clips; complete=false waits for its
author to finish. Each output remains pending the user's casting review.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time
from datetime import datetime, timezone

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = Path(r"D:\AI\Models\TTS\qwen3_tts\Qwen3-TTS-12Hz-1.7B-VoiceDesign")
MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
MODEL_REVISION = "5ecdb67327fd37bb2e042aab12ff7391903235d3"
SOURCE_SHA256 = "b44704444023df54cc940ad2a619ecda68ee6b35eec650284ef509da2c6f3b32"


def utc():
    return datetime.now(timezone.utc).isoformat()


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def atomic_json(path, value):
    partial = path.with_suffix(path.suffix + ".partial")
    with partial.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(partial, path)


def event(stage, **detail):
    print(json.dumps({"time": utc(), "stage": stage, **detail}, ensure_ascii=False), flush=True)


def profile_input(profile, model_files, seed_variation=0):
    text = str(profile.get("text") or "").strip()
    description = str(profile.get("voiceDesign") or "").strip()
    profile_id = str(profile.get("profileId") or "")
    if not text or not description or not re.fullmatch(r"[A-Za-z0-9:_-]{1,150}", profile_id):
        raise ValueError(f"Incomplete or unsafe voice profile: {profile_id}")
    seed = int.from_bytes(hashlib.sha256(("prodigal-voice-design-v1:" + profile_id).encode()).digest()[:4], "big") % 2_147_483_647
    seed = (seed + seed_variation * 1_000_003) % 2_147_483_647
    word_count = len(text.split())
    settings = {
        "do_sample": True, "temperature": 0.9, "top_p": 1.0,
        "top_k": 50, "repetition_penalty": 1.05,
        "subtalker_dosample": True, "subtalker_temperature": 0.9,
        "subtalker_top_p": 1.0, "subtalker_top_k": 50,
        "max_new_tokens": 512 if word_count < 35 else 768,
    }
    identity = {
        "profileId": profile_id, "text": text, "voiceDesign": description,
        "language": "English", "seed": seed, "settings": settings,
        "modelId": MODEL_ID, "modelRevision": MODEL_REVISION,
        "modelFiles": model_files, "sourceSha256": SOURCE_SHA256,
        "precision": "bfloat16", "attentionImplementation": "sdpa",
        "outputFormat": "WAV PCM_16", "generatorVersion": 1,
    }
    encoded = json.dumps(identity, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return identity, hashlib.sha256(encoded).hexdigest()


def audio_quality(waveform, sample_rate, text, np):
    samples = np.asarray(waveform, dtype=np.float32).squeeze()
    if samples.ndim != 1 or not samples.size or not np.isfinite(samples).all():
        raise ValueError("Model returned empty, non-finite, or non-mono audio")
    if sample_rate != 24000:
        raise ValueError(f"Unexpected native sample rate: {sample_rate}")
    seconds = samples.size / sample_rate
    words = len(text.split())
    minimum = max(0.65, words * 0.105)
    maximum = max(12.0, words * 0.85 + 8)
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(samples.astype(np.float64) ** 2)))
    clipped = int(np.count_nonzero(np.abs(samples) >= 0.9999))
    active_seconds = float(np.count_nonzero(np.abs(samples) >= 0.003) / sample_rate)
    if not minimum <= seconds <= maximum:
        raise ValueError(f"Audio duration {seconds:.2f}s outside {minimum:.2f}–{maximum:.2f}s bounds")
    if peak < 0.01 or rms < 0.0015 or active_seconds < min(0.35, seconds * 0.15):
        raise ValueError(f"Silent or unusably quiet audio: peak={peak:.5f}, RMS={rms:.5f}")
    if clipped:
        raise ValueError(f"Clipped waveform: {clipped} samples reach full scale")
    return samples, {
        "passed": True, "checks": ["finite-mono", "native-24khz", "duration", "non-silent", "not-clipped"],
        "peak": peak, "rms": rms, "rmsDbfs": 20 * math.log10(rms),
        "clippedSamples": clipped, "activeSeconds": active_seconds,
        "tailRms": float(np.sqrt(np.mean(samples[-min(samples.size, 1200):].astype(np.float64) ** 2))),
        "transcriptVerification": "not_run", "castingReview": "pending",
    }


def valid_existing(result, input_hash, output_dir, sf, np):
    if result.get("status") != "completed" or result.get("inputSha256") != input_hash:
        return False
    candidate = output_dir / str(result.get("fileName") or "")
    if candidate.parent != output_dir or not candidate.is_file():
        return False
    try:
        if digest(candidate) != result.get("sha256"):
            return False
        audio, sr = sf.read(candidate, dtype="float32")
        audio_quality(audio, sr, result["text"], np)
        return True
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "screenshots/prodigal-voice-design-draft.json")
    parser.add_argument("--output", type=Path, default=ROOT / "public/pictures/prodigal-son/voice-designs")
    parser.add_argument("--limit", type=int, default=0, help="Stop after this many new clips; zero means all")
    parser.add_argument("--profile", action="append", default=[], help="Generate only this profile ID; may repeat")
    parser.add_argument("--seed-variation", type=int, default=0, help="Deterministic alternate take number")
    parser.add_argument("--results-file", default="run-results.json", help="Separate metadata filename for alternate takes")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+\.json", args.results_file) or args.seed_variation < 0:
        raise ValueError("Use a simple JSON result filename and a nonnegative seed variation")
    if args.seed_variation and args.results_file == "run-results.json":
        raise ValueError("Alternate takes require a separate results file to retain the original audit")
    output_dir = args.output.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    result_path = output_dir / args.results_file
    if digest(ROOT / "public/pictures/prodigal-son/Prodigal_Son.fountain") != SOURCE_SHA256:
        raise RuntimeError("The approved screenplay source hash changed")
    config = json.loads((MODEL_DIR / "config.json").read_text(encoding="utf-8"))
    if config.get("tts_model_type") != "voice_design" or config.get("tts_model_size") != "1b7":
        raise RuntimeError("The selected local checkpoint is not VoiceDesign 1.7B")
    event("verifying_model")
    model_files = {name: {"bytes": (MODEL_DIR / name).stat().st_size, "sha256": digest(MODEL_DIR / name)} for name in ("model.safetensors", "speech_tokenizer/model.safetensors", "config.json")}
    if model_files["model.safetensors"]["sha256"] != "391e8db219f292c515297cdceeb43e4eae67cdde35fa57e79a6a8a532fca0522":
        raise RuntimeError("Installed VoiceDesign weights do not match the pinned revision")

    import importlib.metadata
    import numpy as np
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported():
        raise RuntimeError("CUDA with BF16 support is required")
    existing = json.loads(result_path.read_text(encoding="utf-8")) if result_path.exists() else {}
    results = {result["profileId"]: result for result in existing.get("results", [])}
    state = {
        "schemaVersion": 1, "status": "running", "startedAt": utc(),
        "sourceSha256": SOURCE_SHA256, "modelId": MODEL_ID,
        "modelRevision": MODEL_REVISION, "modelPath": str(MODEL_DIR),
        "modelFiles": model_files, "runtime": {"python": sys.version, "executable": sys.executable, "torch": torch.__version__, "qwenTts": importlib.metadata.version("qwen-tts"), "transformers": importlib.metadata.version("transformers")},
        "precision": "bfloat16", "attentionImplementation": "sdpa",
        "reviewStatus": "PENDING_USER_REVIEW", "results": list(results.values()),
        "seedVariation": args.seed_variation,
    }
    atomic_json(result_path, state)
    model = None
    generated = 0
    attempted = set()
    verified = set()
    waiting_since = None

    def save():
        state["updatedAt"] = utc()
        state["results"] = list(results.values())
        state["completedCount"] = sum(r.get("status") == "completed" for r in results.values())
        state["failedCount"] = sum(r.get("status") == "failed" for r in results.values())
        atomic_json(result_path, state)

    while True:
        draft = json.loads(args.input.read_text(encoding="utf-8-sig"))
        if draft.get("source", {}).get("screenplaySha256") != SOURCE_SHA256:
            raise RuntimeError("Casting draft does not reference the approved screenplay")
        profiles = sorted(draft["profiles"], key=lambda item: item.get("order", 0))
        if args.profile:
            requested = set(args.profile)
            known = {p["profileId"] for p in profiles}
            if draft.get("complete") and requested - known:
                raise ValueError(f"Unknown requested profiles: {sorted(requested - known)}")
            profiles = [p for p in profiles if p["profileId"] in requested]
        state["draftComplete"] = bool(draft.get("complete"))
        state["draftProfileCount"] = len(profiles)
        pending = []
        for profile in profiles:
            if profile.get("aliasOfProfileId") or profile.get("generationRequired") is False:
                continue
            profile_id = profile["profileId"]
            # A reviewed alternate remains the selected take on a later resume.
            # Its text, direction, model, deterministic seed and WAV must still
            # match before it can be reused.
            seed_variation = args.seed_variation
            if not seed_variation and args.results_file == "run-results.json":
                selected = results.get(profile_id, {}).get("selectedSeedVariation", 0)
                if isinstance(selected, int) and 0 <= selected <= 100:
                    seed_variation = selected
            identity, input_hash = profile_input(profile, model_files, seed_variation)
            key = (profile_id, input_hash)
            if key in verified or key in attempted:
                continue
            if valid_existing(results.get(profile_id, {}), input_hash, output_dir, sf, np):
                verified.add(key)
                event("verified_existing", profileId=profile_id)
                continue
            pending.append((profile, identity, input_hash, seed_variation))
        if not pending:
            if draft.get("complete"):
                state["status"] = "completed" if not state.get("failedCount") else "completed_with_errors"
                state["finishedAt"] = utc()
                save()
                event(state["status"], completed=state["completedCount"], failed=state["failedCount"])
                break
            if waiting_since is None:
                waiting_since = time.monotonic()
                event("waiting_for_casting_draft")
            if time.monotonic() - waiting_since > 1800:
                raise RuntimeError("Casting draft remained incomplete for 30 minutes")
            time.sleep(3)
            continue
        waiting_since = None
        if args.limit and generated >= args.limit:
            state["status"] = "paused_at_limit"
            save()
            break
        profile, identity, input_hash, seed_variation = pending[0]
        profile_id = profile["profileId"]
        attempted.add((profile_id, input_hash))
        if model is None:
            event("loading_model", model=MODEL_ID, device="cuda:0")
            load_started = time.monotonic()
            model = Qwen3TTSModel.from_pretrained(str(MODEL_DIR), device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa", local_files_only=True)
            state["modelLoadSeconds"] = round(time.monotonic() - load_started, 3)
            event("model_loaded", seconds=state["modelLoadSeconds"])
        state["currentProfileId"] = profile_id
        save()
        started = time.monotonic()
        event("generating", profileId=profile_id, name=profile.get("name"), wordCount=len(identity["text"].split()), seed=identity["seed"])
        result = {**identity, "inputSha256": input_hash, "name": profile.get("name"), "assetId": profile.get("assetId"), "memberId": profile.get("memberId"), "textKind": profile.get("textKind"), "cueRefs": profile.get("cueRefs", []), "startedAt": utc(), "selectedSeedVariation": seed_variation}
        try:
            with torch.random.fork_rng(devices=[0]), torch.inference_mode():
                torch.manual_seed(identity["seed"])
                torch.cuda.manual_seed_all(identity["seed"])
                wavs, sample_rate = model.generate_voice_design(text=identity["text"], language="English", instruct=identity["voiceDesign"], **identity["settings"])
            if not isinstance(wavs, (list, tuple)) or len(wavs) != 1:
                raise ValueError("VoiceDesign did not return exactly one audition")
            audio, quality = audio_quality(wavs[0], int(sample_rate), identity["text"], np)
            file_name = f"{profile_id.replace(':', '_').lower()}_{input_hash[:12]}.wav"
            destination = output_dir / file_name
            partial = destination.with_suffix(".wav.partial")
            sf.write(partial, audio, int(sample_rate), format="WAV", subtype="PCM_16")
            written, written_rate = sf.read(partial, dtype="float32")
            _, written_quality = audio_quality(written, written_rate, identity["text"], np)
            info = sf.info(partial)
            if info.subtype != "PCM_16" or info.channels != 1 or info.frames != audio.size:
                raise ValueError("Written WAV did not retain the expected format and frame count")
            os.replace(partial, destination)
            result.update({"status": "completed", "fileName": file_name, "url": f"/pictures/prodigal-son/voice-designs/{file_name}", "sha256": digest(destination), "bytes": destination.stat().st_size, "durationSeconds": info.frames / info.samplerate, "sampleRate": info.samplerate, "channels": info.channels, "frames": info.frames, "format": "WAV", "subtype": info.subtype, "quality": {**written_quality, "sourcePeak": quality["peak"]}, "generationSeconds": round(time.monotonic() - started, 3), "finishedAt": utc()})
            event("sample_completed", profileId=profile_id, durationSeconds=result["durationSeconds"], generationSeconds=result["generationSeconds"], file=file_name)
            verified.add((profile_id, input_hash))
            generated += 1
        except Exception as error:
            result.update({"status": "failed", "error": f"{type(error).__name__}: {error}", "generationSeconds": round(time.monotonic() - started, 3), "finishedAt": utc()})
            event("sample_failed", profileId=profile_id, error=result["error"])
        results[profile_id] = result
        save()
    if model is not None:
        del model
        torch.cuda.empty_cache()
    return 1 if state.get("failedCount") else 0


if __name__ == "__main__":
    raise SystemExit(main())
