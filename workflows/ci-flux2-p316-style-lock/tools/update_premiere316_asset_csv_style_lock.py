#!/usr/bin/env python3
"""Patch the canonical Premiere316 97-row asset CSV for CI FLUX2 Style-Lock.

The package's first utility targeted human-readable column names. Premiere316's
canonical export uses exact snake_case headers, so this installed version maps
those headers explicitly and can synchronize from the live asset manifest.
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

STYLE_LOCK = """STYLE-ONLY IMAGE REFERENCE LOCK — Premiere316
Use the ComfyUI image references only for art direction: sacred cinematic realism, warm divine-gold light, dark smoky umber shadows, ember haze, live-action camera language, realistic material physics, detailed texture, and restrained film grain. Do not copy content, identity, wardrobe, wounds, props, locations, crowds, gates, or layout from the references unless this exact row prompt requests them."""

AUDIO_LOCK = """AUDIO STYLE BRIDGE — Premiere316
Translate the visual design into audio language: sacred cinematic realism, ancient stone resonance, warm harmonic glow, smoky low-frequency pressure, ember crackle, drifting air, natural dynamics, restrained epic scale. Keep the row's dialogue, sound, or music prompt as content source-of-truth."""

WORKFLOW_4X3 = "ci-flux2-p316-style-only-4x3-max"
WORKFLOW_16X9 = "ci-flux2-p316-style-only-16x9-max"
WORKFLOW_2X3 = "ci-flux2-p316-style-only-2x3-vertical-max"
WORKFLOW_JESUS = "ci-flux2-jesus-only-character-sheet-4x3-max"

WORKFLOW_LABELS = {
    WORKFLOW_4X3: "CI FLUX.2 Style-Lock · 4:3 MAX",
    WORKFLOW_16X9: "CI FLUX.2 Style-Lock · 16:9 MAX",
    WORKFLOW_2X3: "CI FLUX.2 Style-Lock · 2:3 Vertical MAX",
    WORKFLOW_JESUS: "CI FLUX.2 · Jesus Identity Sheet 4:3 MAX",
}

MODEL = "FLUX.2 Dev · runtime FP8 cast + Mistral 3 Small FLUX.2 FP4"
STYLE_CONTINUITY = "STYLE-ONLY REF LOCK: references control lighting, palette, texture, and cinematic art direction only; no content or identity borrowing."
ERROR_VALUES = ("#REF!", "#VALUE!", "#N/A", "#DIV/0!", "#NAME?", "#NULL!", "#NUM!")


def workflow_for(row: dict[str, str]) -> str | None:
    asset_id = row["asset_id"]
    category = row["category"].strip().lower()
    if asset_id == "character-jesus-the-harrower-primary-appearance":
        return WORKFLOW_JESUS
    if category in {"character", "wardrobe", "artifact"}:
        return WORKFLOW_2X3
    if category in {"location", "extra", "atmosphere", "guide-frame"}:
        return WORKFLOW_16X9
    if row["media_type"].strip().lower() == "image":
        return WORKFLOW_4X3
    return None


def insert_after_header(prompt: str, block: str) -> str:
    prompt = (prompt or "").replace("\r\n", "\n").strip()
    if block in prompt:
        return prompt
    head, separator, tail = prompt.partition("\n\n")
    return f"{head}\n\n{block}\n\n{tail}".strip() if separator else f"{prompt}\n\n{block}".strip()


def load_manifest(path: str | None) -> tuple[dict[str, dict], dict[str, dict]]:
    if not path:
        return {}, {}
    payload = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    assets = {asset["id"]: asset for asset in payload.get("items", [])}
    catalog = {workflow["id"]: workflow for workflow in payload.get("catalog", [])}
    return assets, catalog


def sync_from_manifest(row: dict[str, str], asset: dict, catalog: dict[str, dict]) -> None:
    workflow_id = asset.get("workflowId") or row["workflow_id"]
    workflow = catalog.get(workflow_id, {})
    state = asset.get("workflow") or {}
    row["workflow_id"] = workflow_id
    row["workflow_label"] = state.get("label") or workflow.get("label") or WORKFLOW_LABELS.get(workflow_id, row["workflow_label"])
    row["model"] = state.get("model") or workflow.get("model") or (MODEL if workflow_id in WORKFLOW_LABELS else row["model"])
    row["workflow_ready"] = str(bool(state.get("ready", True))).lower()
    row["workflow_available_now"] = str(bool(state.get("availableNow", False))).lower()
    row["workflow_reason"] = state.get("reason") or workflow.get("purpose") or row["workflow_reason"]
    row["workflow_snapshot"] = asset.get("workflowSnapshot") or row["workflow_snapshot"]
    row["workflow_hash"] = asset.get("workflowHash") or row["workflow_hash"]
    row["prompt_header"] = asset.get("promptHeader") or row["prompt_header"]
    row["generation_prompt"] = asset.get("prompt") or row["generation_prompt"]
    continuity = asset.get("continuity")
    if isinstance(continuity, list):
        row["continuity_locks"] = "\n".join(str(value) for value in continuity)
    row["approval_current"] = str(bool(asset.get("approvalCurrent", False))).lower()
    row["prompt_enhancement"] = asset.get("promptEnhancement") or row["prompt_enhancement"]
    row["prompt_enhanced_at"] = asset.get("promptEnhancedAt") or row["prompt_enhanced_at"]
    row["last_error"] = asset.get("lastError") or ""
    row["updated_at"] = asset.get("updatedAt") or row["updated_at"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--manifest", help="Optional live production/asset-manifest.json")
    args = parser.parse_args()

    with Path(args.input).open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        fields = reader.fieldnames or []

    required = {
        "asset_id", "category", "category_label", "media_type", "workflow_id",
        "workflow_label", "model", "workflow_ready", "workflow_available_now",
        "workflow_reason", "workflow_snapshot", "workflow_hash", "prompt_header",
        "generation_prompt", "continuity_locks", "approval_current",
        "prompt_enhancement", "prompt_enhanced_at", "last_error", "updated_at",
    }
    missing = sorted(required.difference(fields))
    if missing:
        raise SystemExit(f"Missing canonical Premiere316 columns: {', '.join(missing)}")
    if len(rows) != 97 or len(fields) != 37:
        raise SystemExit(f"Expected 97 rows and 37 columns; found {len(rows)} rows and {len(fields)} columns")

    manifest_assets, catalog = load_manifest(args.manifest)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for row in rows:
        asset = manifest_assets.get(row["asset_id"])
        if asset:
            sync_from_manifest(row, asset, catalog)
            continue

        workflow_id = workflow_for(row)
        if workflow_id:
            row["workflow_id"] = workflow_id
            row["workflow_label"] = WORKFLOW_LABELS[workflow_id]
            row["model"] = MODEL
            if workflow_id != WORKFLOW_JESUS:
                row["generation_prompt"] = insert_after_header(row["generation_prompt"], STYLE_LOCK)
                if STYLE_CONTINUITY not in row["continuity_locks"]:
                    row["continuity_locks"] = (row["continuity_locks"].strip() + "\n" + STYLE_CONTINUITY).strip()
        elif row["category"] in {"voice", "sound", "music"}:
            row["generation_prompt"] = insert_after_header(row["generation_prompt"], AUDIO_LOCK)
        row["prompt_enhancement"] = (row["prompt_enhancement"].strip() + " · CI FLUX2 Premiere316 Style-Lock package").strip(" ·")
        row["prompt_enhanced_at"] = now
        row["updated_at"] = now
        row["approval_current"] = "false"

    ids = [row["asset_id"] for row in rows]
    if len(set(ids)) != len(ids):
        raise SystemExit("Duplicate asset IDs detected")
    if any(not row["generation_prompt"].strip() for row in rows):
        raise SystemExit("Missing generation prompt detected")
    for index, row in enumerate(rows, start=2):
        for column, value in row.items():
            if value and any(error in value for error in ERROR_VALUES):
                raise SystemExit(f"Spreadsheet error value in row {index}, column {column}")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)

    with output.open("r", encoding="utf-8-sig", newline="") as handle:
        round_trip = list(csv.DictReader(handle))
    if len(round_trip) != len(rows) or any(len(row) != len(fields) for row in round_trip):
        raise SystemExit("CSV round-trip validation failed")

    print(json.dumps({
        "rows": len(rows),
        "columns": len(fields),
        "uniqueAssetIds": len(set(ids)),
        "workflowCounts": dict(Counter(row["workflow_id"] for row in rows)),
        "output": str(output),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
