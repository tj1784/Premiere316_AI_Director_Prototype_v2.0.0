"""Score visible video faces against an exact identity reference with ArcFace.

The normalized score is calibrated against this project's 95th-percentile
hard-impostor cosine and 10th-percentile deterministic same-face transform.
Raw ArcFace cosine is never mislabeled as a percentage or probability.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys
from pathlib import Path

import cv2
import numpy as np
from insightface.app import FaceAnalysis


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--model-root", required=True, type=Path)
    parser.add_argument("--sample-every", type=int, default=4)
    parser.add_argument("--minimum-face-pixels", type=float, default=96.0)
    parser.add_argument("--minimum-detection-score", type=float, default=0.65)
    parser.add_argument("--json-out", type=Path)
    return parser.parse_args()


def largest_face(faces):
    if not faces:
        return None
    return max(
        faces,
        key=lambda face: max(0.0, float(face.bbox[2] - face.bbox[0]))
        * max(0.0, float(face.bbox[3] - face.bbox[1])),
    )


def face_extent(face) -> tuple[float, float]:
    return (
        max(0.0, float(face.bbox[2] - face.bbox[0])),
        max(0.0, float(face.bbox[3] - face.bbox[1])),
    )


def normalized_embedding(face) -> np.ndarray:
    embedding = np.asarray(face.embedding, dtype=np.float32)
    norm = float(np.linalg.norm(embedding))
    if not math.isfinite(norm) or norm <= 0:
        raise RuntimeError("Face embedding has an invalid norm")
    return embedding / norm


def normalized_identity_fidelity(cosine: float) -> float:
    """Map locally calibrated ArcFace cosine to a 0-100 fidelity index."""
    impostor_q95 = 0.610939
    same_face_q10 = 0.928551
    if cosine <= impostor_q95:
        return 0.0
    if cosine < same_face_q10:
        return 90.0 * (cosine - impostor_q95) / (same_face_q10 - impostor_q95)
    return min(100.0, 90.0 + 10.0 * (cosine - same_face_q10) / (1.0 - same_face_q10))


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    return float(np.quantile(np.asarray(values, dtype=np.float32), fraction))


def main() -> int:
    args = parse_args()
    if args.sample_every < 1:
        raise ValueError("--sample-every must be at least 1")
    if not args.reference.is_file():
        raise FileNotFoundError(args.reference)
    if not args.video.is_file():
        raise FileNotFoundError(args.video)
    if not args.model_root.is_dir():
        raise FileNotFoundError(args.model_root)

    os.environ.setdefault("ORT_LOG_SEVERITY_LEVEL", "3")
    analyzer = FaceAnalysis(
        name="antelopev2",
        root=str(args.model_root),
        providers=["CPUExecutionProvider"],
        allowed_modules=["detection", "recognition"],
    )
    analyzer.prepare(ctx_id=-1, det_size=(640, 640), det_thresh=0.45)

    reference_image = cv2.imread(str(args.reference), cv2.IMREAD_COLOR)
    if reference_image is None:
        raise RuntimeError(f"OpenCV could not read reference image {args.reference}")
    reference_face = largest_face(analyzer.get(reference_image))
    if reference_face is None:
        raise RuntimeError("No reference face was detected")
    reference_embedding = normalized_embedding(reference_face)
    reference_width, reference_height = face_extent(reference_face)

    capture = cv2.VideoCapture(str(args.video))
    if not capture.isOpened():
        raise RuntimeError(f"OpenCV could not open video {args.video}")
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    sampled = []
    frame_index = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if frame_index % args.sample_every != 0 and frame_index != frame_count - 1:
                frame_index += 1
                continue
            faces = analyzer.get(frame)
            face = largest_face(faces)
            record = {
                "frame": frame_index,
                "seconds": frame_index / fps if fps > 0 else None,
                "detected": face is not None,
                "valid_size": False,
                "scorable": False,
                "verified": False,
                "cosine": None,
                "normalized_identity_fidelity": None,
                "detection_score": None,
                "face_width": None,
                "face_height": None,
            }
            if face is not None:
                width, height = face_extent(face)
                record["face_width"] = width
                record["face_height"] = height
                record["valid_size"] = min(width, height) >= args.minimum_face_pixels
                record["detection_score"] = float(face.det_score)
                cosine = float(np.dot(reference_embedding, normalized_embedding(face)))
                record["cosine"] = cosine
                record["normalized_identity_fidelity"] = normalized_identity_fidelity(cosine)
                record["scorable"] = (
                    record["valid_size"] and record["detection_score"] >= args.minimum_detection_score
                )
                record["verified"] = record["scorable"] and record["normalized_identity_fidelity"] >= 90.0
            sampled.append(record)
            frame_index += 1
    finally:
        capture.release()

    similarities = [record["cosine"] for record in sampled if record["cosine"] is not None]
    valid_faces = [record for record in sampled if record["scorable"]]
    verified = [record for record in sampled if record["verified"]]
    total = len(sampled)
    acceptance = len(verified) / len(valid_faces) if valid_faces else 0.0
    scorable_coverage = len(valid_faces) / total if total else 0.0
    fidelity_values = [record["normalized_identity_fidelity"] for record in valid_faces]
    result = {
        "metric": "InsightFace antelopev2 ArcFace frame verification",
        "calibration": {
            "hard_impostor_q95_cosine": 0.610939,
            "same_face_transform_q10_cosine": 0.928551,
            "fidelity_90_definition": "same-face transform q10 boundary",
        },
        "reference": str(args.reference.resolve()),
        "video": str(args.video.resolve()),
        "minimum_face_pixels": args.minimum_face_pixels,
        "minimum_detection_score": args.minimum_detection_score,
        "video_fps": fps,
        "video_frames": frame_count,
        "sample_every_frames": args.sample_every,
        "sampled_frames": total,
        "valid_face_frames": len(valid_faces),
        "verified_frames": len(verified),
        "scorable_face_coverage": scorable_coverage,
        "identity_verification_accuracy": acceptance,
        "identity_verification_percent": 100.0 * acceptance,
        "normalized_fidelity_mean": statistics.fmean(fidelity_values) if fidelity_values else None,
        "normalized_fidelity_median": statistics.median(fidelity_values) if fidelity_values else None,
        "target_90_percent_met": acceptance >= 0.90 and scorable_coverage >= 0.90,
        "cosine_mean": statistics.fmean(similarities) if similarities else None,
        "cosine_median": statistics.median(similarities) if similarities else None,
        "cosine_p10": percentile(similarities, 0.10),
        "cosine_min": min(similarities) if similarities else None,
        "cosine_max": max(similarities) if similarities else None,
        "reference_face_width": reference_width,
        "reference_face_height": reference_height,
        "samples": sampled,
    }

    output = json.dumps(result, indent=2)
    print(output)
    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(f"{output}\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # keep CLI failures concise and machine-readable
        print(json.dumps({"error": f"{type(error).__name__}: {error}"}, indent=2), file=sys.stderr)
        raise
