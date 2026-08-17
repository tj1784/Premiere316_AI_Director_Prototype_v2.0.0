from __future__ import annotations

import argparse
import json
import math
import subprocess
from pathlib import Path

import librosa
import numpy as np


FPS = 24
GRID = 8
MIN_SHOT = 120
MAX_SHOT = 240
TARGET_SHOT = 192


def ffprobe(path: Path) -> dict:
    raw = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        text=True,
        encoding="utf-8",
    )
    return json.loads(raw)


def zscore_rows(values: np.ndarray) -> np.ndarray:
    return (values - values.mean(axis=1, keepdims=True)) / (values.std(axis=1, keepdims=True) + 1e-9)


def nearest_novelty(novelty: np.ndarray, sr: int, hop: int, frame: int) -> float:
    second = frame / FPS
    index = int(round(second * sr / hop))
    lo = max(0, index - int(sr / hop))
    hi = min(len(novelty), index + int(sr / hop) + 1)
    return float(np.max(novelty[lo:hi])) if hi > lo else 0.0


def choose_shots(core_frames: int, novelty: np.ndarray, sr: int, hop: int) -> list[dict]:
    positions = list(range(0, core_frames + 1, GRID))
    best: dict[int, tuple[float, int | None]] = {0: (0.0, None)}
    novelty_scale = float(np.percentile(novelty, 90)) or 1.0

    for end in positions[1:]:
        winner: tuple[float, int | None] | None = None
        boundary_reward = nearest_novelty(novelty, sr, hop, end) / novelty_scale
        for length in range(MIN_SHOT, MAX_SHOT + 1, GRID):
            start = end - length
            if start not in best:
                continue
            duration_penalty = ((length - TARGET_SHOT) / 72.0) ** 2
            cost = best[start][0] + duration_penalty - (0.72 * boundary_reward if end < core_frames else 0.0)
            if winner is None or cost < winner[0]:
                winner = (cost, start)
        if winner is not None:
            best[end] = winner

    if core_frames not in best:
        raise RuntimeError(f"Could not partition {core_frames} frames into valid LTX shots")

    ranges: list[tuple[int, int]] = []
    cursor = core_frames
    while cursor:
        start = best[cursor][1]
        if start is None:
            raise RuntimeError("Broken shot partition")
        ranges.append((start, cursor))
        cursor = start
    ranges.reverse()

    shots = []
    for index, (start, end) in enumerate(ranges, 1):
        requested = end - start
        shots.append(
            {
                "id": f"shot-{index:02d}",
                "startFrame": start,
                "lengthFrames": requested,
                "endFrameExclusive": end,
                "startSeconds": round(start / FPS, 6),
                "durationSeconds": round(requested / FPS, 6),
                "generationFrames": requested + 1,
                "boundaryNovelty": round(nearest_novelty(novelty, sr, hop, end), 6),
            }
        )
    return shots


def group_blocks(shots: list[dict], target_frames: int = 1440) -> list[dict]:
    blocks: list[dict] = []
    start_index = 0
    while start_index < len(shots):
        start_frame = shots[start_index]["startFrame"]
        best_end = start_index
        best_distance = math.inf
        for end_index in range(start_index, len(shots)):
            length = shots[end_index]["endFrameExclusive"] - start_frame
            if length > 2160:
                break
            if length >= 1200:
                distance = abs(length - target_frames)
                if distance < best_distance:
                    best_distance = distance
                    best_end = end_index
        if best_end < start_index:
            best_end = start_index
        chosen = shots[start_index : best_end + 1]
        end_frame = chosen[-1]["endFrameExclusive"]
        blocks.append(
            {
                "id": f"block-{len(blocks) + 1:02d}",
                "shotIds": [item["id"] for item in chosen],
                "startFrame": start_frame,
                "lengthFrames": end_frame - start_frame,
                "startSeconds": round(start_frame / FPS, 6),
                "durationSeconds": round((end_frame - start_frame) / FPS, 6),
            }
        )
        start_index = best_end + 1
    return blocks


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    audio_path = args.audio.resolve()
    probe = ffprobe(audio_path)
    tags = probe.get("format", {}).get("tags", {})
    prompt = json.loads(tags.get("prompt", "{}"))
    workflow = json.loads(tags.get("workflow", "{}"))
    music_inputs = prompt.get("37:13", {}).get("inputs", {})
    duration = float(probe["format"]["duration"])
    master_frames = round(duration * FPS)
    core_frames = (master_frames // GRID) * GRID

    signal, sr = librosa.load(audio_path, sr=22050, mono=True)
    hop = 512
    onset = librosa.onset.onset_strength(y=signal, sr=sr, hop_length=hop)
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=hop, units="time")
    rms = librosa.feature.rms(y=signal, frame_length=2048, hop_length=hop)
    chroma = librosa.feature.chroma_cqt(y=signal, sr=sr, hop_length=hop)
    mfcc = librosa.feature.mfcc(y=signal, sr=sr, n_mfcc=13, hop_length=hop)
    features = np.vstack([zscore_rows(mfcc), zscore_rows(chroma), zscore_rows(rms)])
    delta = np.sqrt(np.sum(np.diff(features, axis=1, prepend=features[:, :1]) ** 2, axis=0))
    smooth = max(1, int(sr / hop))
    novelty = np.convolve(delta, np.ones(smooth) / smooth, mode="same")
    peaks = librosa.util.peak_pick(
        novelty,
        pre_max=int(2 * sr / hop),
        post_max=int(2 * sr / hop),
        pre_avg=int(3 * sr / hop),
        post_avg=int(3 * sr / hop),
        delta=float(np.percentile(novelty, 70) * 0.15),
        wait=int(4 * sr / hop),
        sparse=True,
    )
    peak_times = librosa.frames_to_time(peaks, sr=sr, hop_length=hop)
    ranked = sorted(
        ({"seconds": float(t), "score": float(novelty[i])} for i, t in zip(peaks, peak_times)),
        key=lambda item: item["score"],
        reverse=True,
    )[:32]
    ranked.sort(key=lambda item: item["seconds"])

    shots = choose_shots(core_frames, novelty, sr, hop)
    blocks = group_blocks(shots)
    stream = probe["streams"][0]
    result = {
        "schema": "premiere316.ltx25-music-video-analysis.v1",
        "source": {
            "path": str(audio_path),
            "durationSeconds": duration,
            "masterFrames24fps": master_frames,
            "visualCoreFrames": core_frames,
            "tailHoldFrames": master_frames - core_frames,
            "sampleRate": int(stream["sample_rate"]),
            "channels": int(stream["channels"]),
            "codec": stream["codec_name"],
        },
        "embeddedGeneration": {
            "workflowId": workflow.get("id"),
            "caption": music_inputs.get("caption", ""),
            "lyrics": music_inputs.get("lyrics", ""),
            "seed": prompt.get("37:38", {}).get("inputs", {}).get("seed"),
            "unet": prompt.get("37:6", {}).get("inputs", {}).get("unet_name"),
            "clip": prompt.get("37:3", {}).get("inputs", {}).get("clip_name"),
            "vae": prompt.get("37:7", {}).get("inputs", {}).get("vae_name"),
        },
        "analysis": {
            "estimatedTempoBpm": float(np.atleast_1d(tempo)[0]),
            "detectedBeatCount": int(len(beats)),
            "transitionCandidates": [
                {"seconds": round(item["seconds"], 6), "frame": round(item["seconds"] * FPS), "score": round(item["score"], 6)}
                for item in ranked
            ],
        },
        "shots": shots,
        "blocks": blocks,
    }

    encoded = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)


if __name__ == "__main__":
    main()
