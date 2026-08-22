#!/usr/bin/env python3
"""Expand H02 spoken coverage, add segments for longer lines, lock 77% CU."""
from __future__ import annotations

import copy
import json
import random
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SB_PATH = ROOT / "projects/harrowing_of_hell/production/storyboard.json"
CUES_PATH = ROOT / "projects/harrowing_of_hell/production/h02-corrected-v3/H02_V3_TTS_CUES.json"
REPORT_PATH = ROOT / "projects/harrowing_of_hell/production/h02-corrected-v3/H02_STORYBOARD_CU_UPDATE.json"
FPS = 24

ANGLES = [
    "85mm facial close-up, eye-level three-quarter from camera left",
    "100mm facial close-up, slightly low front-right",
    "85mm facial close-up, true profile camera left",
    "135mm extreme close-up on eyes and mouth, slight high angle",
    "85mm facial close-up, eight-degree Dutch, three-quarter camera right",
    "65mm medium close-up face and shoulders, eye-level front",
    "100mm facial close-up over the listener's shoulder from camera right",
    "85mm facial close-up, fifteen-degree high looking down",
]

WIDE = [
    "50mm two-shot, both figures readable",
    "40mm medium including chains and iron tree",
    "24mm wider court coverage while the speaker remains dominant",
]

FACE = {
    "TORTURER": "the same human-scale Lesser Torturer, mask filling the frame, dry judicial eyes behind the mask, no roar, no extra limbs",
    "TORTURER_OS": "the same Lesser Torturer mask and jaw in partial profile as an off-screen speaker, court still readable behind",
    "ADAM": "the same elderly Adam, weathered lined face, dust-dry beard, exhausted eyes, one face only on the front of the head",
    "EVE": "the same mature Eve, warm lined face, dark hair, clear eyes, one face only on the front of the head",
    "MOSES": "the same older Moses, desert-worn face, grey-white beard, firm gaze, one face only on the front of the head",
    "DAVID": "the same adult David, lyrical face close to the harp, one face only on the front of the head",
    "DAVID_SUNG": "the same adult David, mouth nearly in frame as he intones, one face only on the front of the head",
    "JOHN": "the same rugged John, spare grainy face, wet-dark hair, one face only on the front of the head",
}


def words(text: str) -> int:
    return len([w for w in (text or "").replace("—", " ").split() if w])


def frames_for(text: str, minimum=144, maximum=288) -> int:
    est = int(round((words(text) / 2.25) * FPS / 24.0) * 24)
    return max(minimum, min(maximum, est or minimum))


def split_text(text: str) -> list[str]:
    raw = (text or "").strip()
    if words(raw) <= 18 and raw.count(".") + raw.count("?") <= 1:
        return [raw]
    parts = []
    buf = ""
    for chunk in raw.replace("?", "?|").replace(".", ".|").split("|"):
        chunk = chunk.strip()
        if not chunk:
            continue
        if not buf:
            buf = chunk
        elif words(buf) < 12:
            buf = f"{buf} {chunk}"
        else:
            parts.append(buf)
            buf = chunk
    if buf:
        parts.append(buf)
    if len(parts) <= 1:
        return [raw]
    return parts[:2] if words(raw) < 28 else parts[:3]


def cu_prompt(speaker: str, angle: str, dialogue: str, seconds: float, closeup: bool) -> str:
    face = FACE.get(speaker, FACE["ADAM"])
    kind = "facial close-up" if closeup else "coverage shot"
    return (
        f"One continuous {seconds:.1f}-second live-action 35mm anamorphic {kind} in the physically built basalt Court of Accusation. "
        f"Photographed human skin and hair, coarse ancient linen, matte hand-forged iron, practical smoke and ash, restrained ember key light, "
        f"weak cool rear separation, natural gravity and lens falloff. Camera: {angle}. Subject: {face}. "
        f"The speaker is delivering this line in post (do not render readable text): {dialogue} "
        "Mouth begins slightly parted as if speech has just started; eyes stay alive; no subtitle, no caption, no logo. "
        "All described actor and camera motion finishes 0.5 seconds before the end. "
        "The resulting composition remains locked through the final twelve frames; only minimal breathing, smoke and sparse ash continue. "
        "No Jesus face, no modern objects, no malformed anatomy, one face only on the front of any head."
    )


def main() -> None:
    cues = {c["segmentId"]: c for c in json.loads(CUES_PATH.read_text(encoding="utf-8"))["cues"]}
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = SB_PATH.with_name(f"storyboard.before-h02-cu-{stamp}.json")
    shutil.copy2(SB_PATH, backup)
    sb = json.loads(SB_PATH.read_text(encoding="utf-8"))

    h02_ids = [cid for cid in sb["clips"] if cid.startswith("H02-")]
    h02_ids.sort(key=lambda cid: sb["clips"][cid]["timelineStartFrame"])
    old_starts = [sb["clips"][cid]["timelineStartFrame"] for cid in h02_ids]
    old_durs = [sb["clips"][cid]["durationFrames"] for cid in h02_ids]
    old_gaps = []
    for i, cid in enumerate(h02_ids[:-1]):
        old_gaps.append(old_starts[i + 1] - (old_starts[i] + old_durs[i]))
    h03_first = min((c["timelineStartFrame"] for cid, c in sb["clips"].items() if cid.startswith("H03-")), default=None)
    last_h02_end = old_starts[-1] + old_durs[-1]
    gap_to_h03 = (h03_first - last_h02_end) if h03_first is not None else 0

    rng = random.Random(77)
    spoken_meta = []
    new_frames = []

    for cid in h02_ids:
        clip = sb["clips"][cid]
        vp = sb["videoPlans"][clip["videoPlanId"]]
        old_seg_ids = list(vp["segmentIds"])
        new_seg_ids = []
        new_td_segs = []
        bindings = []
        start = 0
        clip_lines = []

        for order, sid in enumerate(old_seg_ids, start=1):
            seg = sb["segments"][sid]
            bind = next((b for b in (clip.get("audioPlan") or {}).get("passBindings") or [] if b.get("segmentId") == sid), {})
            speaker = bind.get("speaker") or "NONE"
            parts = sid.split("-")
            cue = None
            # segment-h02-s03-c01-seg02 -> H02-S03-C01-SEG02
            if len(parts) >= 5 and parts[0] == "segment" and parts[1] == "h02":
                guess = f"H02-{parts[2].upper()}-{parts[3].upper()}-{parts[4].upper()}"
                cue = cues.get(guess)
            if speaker in (None, "NONE") or not cue:
                seg["startFrame"] = start
                seg["order"] = len(new_seg_ids) + 1
                new_seg_ids.append(sid)
                td = next((x for x in (vp.get("timelineData") or {}).get("segments") or [] if x.get("id") == sid), None)
                if td:
                    td = copy.deepcopy(td)
                    td["start"] = start
                    td["length"] = seg["lengthFrames"]
                    new_td_segs.append(td)
                bindings.append({
                    "segmentId": sid,
                    "speaker": speaker if speaker and speaker != "NONE" else "NONE",
                    "dialogue": None,
                    "inputMode": bind.get("inputMode") or "prior_tail",
                    "inputImage": bind.get("inputImage"),
                    "expectedHandoff": bind.get("expectedHandoff"),
                })
                start += seg["lengthFrames"]
                continue

            pieces = split_text(cue["exactDialogue"])
            for idx, piece in enumerate(pieces):
                if idx == 0:
                    piece_id = sid
                    piece_seg = seg
                else:
                    piece_id = f"{sid}b" if idx == 1 else f"{sid}c"
                    piece_seg = copy.deepcopy(seg)
                    piece_seg["id"] = piece_id
                    sb["segments"][piece_id] = piece_seg
                length = frames_for(piece, minimum=120 if idx else 144)
                seconds = length / FPS
                piece_seg["startFrame"] = start
                piece_seg["lengthFrames"] = length
                piece_seg["order"] = len(new_seg_ids) + 1
                piece_seg["status"] = "needs_guide" if idx else seg.get("status") or "ready"
                new_seg_ids.append(piece_id)
                spoken_meta.append({
                    "clipId": cid,
                    "segmentId": piece_id,
                    "speaker": cue["speaker"],
                    "dialogue": piece,
                    "parentCue": cue["cueId"],
                    "isNew": idx > 0,
                })
                bindings.append({
                    "segmentId": piece_id,
                    "speaker": cue["speaker"] if not cue.get("offScreen") else "TORTURER_OS",
                    "dialogue": piece,
                    "inputMode": "generated_still" if idx else (bind.get("inputMode") or "prior_tail"),
                    "inputImage": None if idx else bind.get("inputImage"),
                    "expectedHandoff": None,
                })
                clip_lines.append(f"{cue['speaker']}: {piece}")
                start += length

        # assign CU vs wide across this clip's spoken pieces later globally
        clip["_pending_bindings"] = bindings
        clip["_pending_seg_ids"] = new_seg_ids
        clip["_pending_td"] = new_td_segs
        clip["_pending_lines"] = clip_lines
        clip["_pending_duration"] = start

    spoken_ids = [m["segmentId"] for m in spoken_meta]
    cu_count = max(1, int(round(len(spoken_ids) * 0.77)))
    forced_wide = [m["segmentId"] for m in spoken_meta if m["clipId"] == "H02-S03-C03"]
    pool = [sid for sid in spoken_ids if sid not in forced_wide]
    rng.shuffle(pool)
    cu_set = set(pool[:cu_count])

    angle_i = 0
    wide_i = 0
    for meta in spoken_meta:
        closeup = meta["segmentId"] in cu_set
        angle = ANGLES[angle_i % len(ANGLES)] if closeup else WIDE[wide_i % len(WIDE)]
        if closeup:
            angle_i += 1
        else:
            wide_i += 1
        meta["closeup"] = closeup
        meta["angle"] = angle
        seg = sb["segments"][meta["segmentId"]]
        prompt = cu_prompt(meta["speaker"], angle, meta["dialogue"], seg["lengthFrames"] / FPS, closeup)
        seg["prompt"] = prompt
        if meta["isNew"]:
            fid = f"frame-{meta['segmentId'].replace('segment-', '')}-cu-v3r"
            sb["frames"][fid] = {
                "id": fid,
                "purpose": "first_frame",
                "ownerKind": "segment",
                "ownerId": meta["segmentId"],
                "prompt": prompt,
                "negativePrompt": "text, caption, subtitle, logo, watermark, extra limbs, second face on the back of the head, cartoon, CGI plastic, modern clothing",
                "status": "queued",
                "expectedInputPath": None,
                "generatedAssetId": None,
                "generatedAssetVersionId": None,
                "inputHash": None,
                "references": [],
                "lastError": None,
                "generatedVersions": [],
                "activeGeneratedVersion": None,
                "generatedFile": None,
                "generatedInputPath": None,
                "importProvenance": {
                    "packageId": "h02_v3_revised_cu",
                    "createdAt": datetime.now(timezone.utc).isoformat(),
                },
            }
            seg["frameId"] = fid
            seg["missingGuide"] = True
            new_frames.append(fid)
            td = {
                "id": meta["segmentId"],
                "start": seg["startFrame"],
                "length": seg["lengthFrames"],
                "prompt": prompt,
                "type": "image",
                "isEndFrame": False,
                "storyboardFrameId": fid,
                "guideStrength": 1,
                "referenceFiles": [],
                "expectedInputPath": None,
            }
            # stash on clip later
            clip = sb["clips"][meta["clipId"]]
            clip.setdefault("_extra_td", []).append(td)
        else:
            # keep existing frame, but if spoken CU rewrite prompt on frame too
            fid = seg.get("frameId")
            if fid and fid in sb["frames"] and closeup:
                sb["frames"][fid]["prompt"] = prompt

    # finalize clips / video plans
    new_starts = []
    cursor = old_starts[0]
    for i, cid in enumerate(h02_ids):
        clip = sb["clips"][cid]
        vp = sb["videoPlans"][clip["videoPlanId"]]
        segs = clip.pop("_pending_seg_ids")
        bindings = clip.pop("_pending_bindings")
        duration = clip.pop("_pending_duration")
        lines = clip.pop("_pending_lines")
        extra_td = clip.pop("_extra_td", [])
        clip["timelineStartFrame"] = cursor
        clip["durationFrames"] = duration
        clip["decodedFrames"] = duration + 1
        clip["dialogueAnchor"] = " ".join(lines)
        if lines:
            speakers = {m["speaker"] for m in spoken_meta if m["clipId"] == cid}
            clip["shotSizeLens"] = "Facial close-ups 85–135mm on 77% of spoken deliveries; remaining line coverage 24–50mm"
        if clip.get("audioPlan"):
            clip["audioPlan"]["dialogueText"] = clip["dialogueAnchor"]
            clip["audioPlan"]["passBindings"] = bindings
            clip["audioPlan"]["lengthFrames"] = duration
        vp["segmentIds"] = segs
        vp["segmentLengths"] = ",".join(str(sb["segments"][sid]["lengthFrames"]) for sid in segs)
        vp["correctedV3Package"] = "h02_v3_revised_cu"
        td = vp.get("timelineData") or {}
        old_td = {item.get("id"): item for item in (td.get("segments") or [])}
        rebuilt = []
        running = 0
        for sid in segs:
            seg = sb["segments"][sid]
            item = old_td.get(sid) or next((x for x in extra_td if x["id"] == sid), None) or {
                "id": sid,
                "prompt": seg.get("prompt"),
                "type": "image",
                "isEndFrame": False,
                "storyboardFrameId": seg.get("frameId"),
                "guideStrength": 1,
                "referenceFiles": [],
            }
            item = copy.deepcopy(item)
            item["id"] = sid
            item["start"] = running
            item["length"] = seg["lengthFrames"]
            item["prompt"] = seg.get("prompt")
            item["storyboardFrameId"] = seg.get("frameId")
            rebuilt.append(item)
            running += seg["lengthFrames"]
        td["segments"] = rebuilt
        td["normalDurationFrames"] = duration
        vp["timelineData"] = td
        vp["localPrompts"] = "\n\n".join(seg.get("prompt") or "" for sid in segs for seg in [sb["segments"][sid]])
        new_starts.append(cursor)
        if i < len(old_gaps):
            cursor = cursor + duration + max(0, old_gaps[i])
        else:
            cursor = cursor + duration

    new_h02_end = new_starts[-1] + sb["clips"][h02_ids[-1]]["durationFrames"]
    shift = (new_h02_end + max(0, gap_to_h03)) - (h03_first or new_h02_end)
    if h03_first is not None and shift:
        for cid, clip in sb["clips"].items():
            if clip.get("timelineStartFrame", 0) >= h03_first:
                clip["timelineStartFrame"] = int(clip["timelineStartFrame"] + shift)

    sb["updatedAt"] = datetime.now(timezone.utc).isoformat()
    sb["source"] = {
        **(sb.get("source") or {}),
        "h02DialogueRevision": "h02_v3_revised_cu",
        "h02CloseupPolicy": "0.77 facial close-up on spoken deliveries",
        "h02UpdatedAt": sb["updatedAt"],
    }
    tmp = SB_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(sb, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(SB_PATH)

    report = {
        "backup": str(backup),
        "spokenSegments": len(spoken_meta),
        "closeups": sum(1 for m in spoken_meta if m["closeup"]),
        "closeupRatio": round(sum(1 for m in spoken_meta if m["closeup"]) / max(1, len(spoken_meta)), 3),
        "newFrames": new_frames,
        "h02DurationDeltaFrames": new_h02_end - last_h02_end,
        "laterChapterShiftFrames": shift if h03_first is not None else 0,
        "spoken": spoken_meta,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: report[k] for k in report if k != "spoken"}, indent=2))


if __name__ == "__main__":
    main()
