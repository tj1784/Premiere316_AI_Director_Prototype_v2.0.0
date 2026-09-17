"""Independent, resumable CPU ASR checks for generated Prodigal voice auditions.

This script reads generated WAVs and writes a separate QC report. It never changes
audio, voice designs, generation settings, approvals, or the production manifest.
ASR mismatches are review candidates, not proof of an audible defect.

Runtime: D:/AI/Runtimes/Premiere316VoiceQC/Scripts/python.exe
Model: https://huggingface.co/Systran/faster-whisper-base.en
API: https://github.com/SYSTRAN/faster-whisper#usage
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import sys
import time
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
MODEL = Path("D:/AI/Models/ASR/faster-whisper-base.en")
MODEL_REVISION = "3d3d5dee26484f91867d81cb899cfcf72b96be6c"
QC_VERSION = 1
CONTRACTIONS = {
    "waterskin": "water skin",
    "can't": "can not", "cannot": "can not", "won't": "will not", "shan't": "shall not",
    "i'm": "i am", "i've": "i have", "i'll": "i will", "i'd": "i would",
    "you're": "you are", "you've": "you have", "you'll": "you will", "you'd": "you would",
    "we're": "we are", "we've": "we have", "we'll": "we will", "we'd": "we would",
    "they're": "they are", "they've": "they have", "they'll": "they will", "they'd": "they would",
    "he's": "he is", "she's": "she is", "it's": "it is", "that's": "that is",
    "there's": "there is", "here's": "here is", "let's": "let us", "what's": "what is",
    "don't": "do not", "doesn't": "does not", "didn't": "did not", "isn't": "is not",
    "aren't": "are not", "wasn't": "was not", "weren't": "were not", "hasn't": "has not",
    "haven't": "have not", "hadn't": "had not", "wouldn't": "would not", "couldn't": "could not",
    "shouldn't": "should not", "mustn't": "must not",
}


def utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as file:
        for part in iter(lambda: file.read(1024 * 1024), b""):
            result.update(part)
    return result.hexdigest()


def tokens(text: str) -> list[str]:
    text = unicodedata.normalize("NFKC", text).casefold().replace("’", "'").replace("‘", "'")
    words = re.findall(r"[a-z0-9]+(?:'[a-z0-9]+)?", text)
    return [item for word in words for item in CONTRACTIONS.get(word, word).split()]


def alignment(expected: list[str], actual: list[str]) -> dict:
    """Unit-cost Levenshtein alignment; tie order is match/substitute, delete, insert."""
    matrix = [[0] * (len(actual) + 1) for _ in range(len(expected) + 1)]
    for i in range(len(expected) + 1):
        matrix[i][0] = i
    for j in range(len(actual) + 1):
        matrix[0][j] = j
    for i in range(1, len(expected) + 1):
        for j in range(1, len(actual) + 1):
            matrix[i][j] = min(matrix[i - 1][j - 1] + (expected[i - 1] != actual[j - 1]), matrix[i - 1][j] + 1, matrix[i][j - 1] + 1)
    i, j = len(expected), len(actual)
    edits = []
    while i or j:
        if i and j and matrix[i][j] == matrix[i - 1][j - 1] + (expected[i - 1] != actual[j - 1]):
            if expected[i - 1] != actual[j - 1]:
                edits.append({"kind": "substitution", "expectedIndex": i - 1, "actualIndex": j - 1, "expected": expected[i - 1], "actual": actual[j - 1]})
            i -= 1
            j -= 1
        elif i and matrix[i][j] == matrix[i - 1][j] + 1:
            edits.append({"kind": "omission", "expectedIndex": i - 1, "actualIndex": j, "expected": expected[i - 1]})
            i -= 1
        else:
            edits.append({"kind": "insertion", "expectedIndex": i, "actualIndex": j - 1, "actual": actual[j - 1]})
            j -= 1
    edits.reverse()
    counts = Counter(edit["kind"] for edit in edits)
    return {"expectedWords": len(expected), "transcribedWords": len(actual), "substitutions": counts["substitution"], "omissions": counts["omission"], "insertions": counts["insertion"], "wer": round(len(edits) / max(1, len(expected)), 5), "edits": edits}


def ngrams(words: list[str], size: int = 3) -> Counter:
    return Counter(tuple(words[i:i + size]) for i in range(len(words) - size + 1))


def compare(expected: str, transcript: str, voice_design: str) -> dict:
    reference, observed = tokens(expected), tokens(transcript)
    result = alignment(reference, observed)
    flags = []
    if result["wer"] > 0:
        flags.append({"kind": "transcript_mismatch", "message": "Independent ASR differs from the intended text; listen before concluding the audio is wrong."})
    if result["omissions"]:
        flags.append({"kind": "possible_omission", "words": [edit["expected"] for edit in result["edits"] if edit["kind"] == "omission"]})
    repeated = [" ".join(gram) for gram, count in ngrams(observed).items() if count > max(1, ngrams(reference)[gram])]
    repeated.extend(word for word in set(observed) if f"{word} {word} {word}" in " ".join(observed) and f"{word} {word} {word}" not in " ".join(reference))
    if repeated:
        flags.append({"kind": "possible_repetition", "phrases": repeated})
    instruction_matches = sorted(set(ngrams(observed)) & set(ngrams(tokens(voice_design))) - set(ngrams(reference)))
    if instruction_matches:
        flags.append({"kind": "possible_instruction_leak", "phrases": [" ".join(phrase) for phrase in instruction_matches]})
    if not observed:
        flags.append({"kind": "no_recognized_speech", "message": "ASR returned no words."})
    return {**result, "normalizedExpected": " ".join(reference), "normalizedTranscript": " ".join(observed), "flags": flags,
            "comparisonStatus": "match" if not flags else "needs_listening_review"}


def write_report(path: Path, report: dict) -> None:
    report["updatedAt"] = utc()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def self_test() -> None:
    assert tokens("I’m HERE. I cannot wait!") == tokens("I'm here; I can't wait.")
    assert compare("A man had two sons.", "A man had two sons.", "One clear human voice.")["wer"] == 0
    missing = compare("A man had two sons.", "A man had sons.", "One clear human voice.")
    assert missing["omissions"] == 1 and missing["wer"] == .2
    repeated = compare("A man had two sons.", "A man had two sons. A man had two sons.", "One clear human voice.")
    assert any(flag["kind"] == "possible_repetition" for flag in repeated["flags"])
    leak = compare("A man had two sons.", "One clear human voice. A man had two sons.", "One clear human voice.")
    assert any(flag["kind"] == "possible_instruction_leak" for flag in leak["flags"])
    assert compare("Your hand.", "You're hand.", "Ordinary speech.")["wer"] > 0
    assert compare("Fill the waterskin.", "Fill the water skin.", "Ordinary speech.")["wer"] == 0
    assert any(flag["kind"] == "possible_repetition" for flag in compare("Come here.", "Come here. Yes yes yes.", "Ordinary speech.")["flags"])
    print(json.dumps({"selfTest": "passed", "checks": 8}))


def secondary_check(model, candidate: Path, record: dict, generation: dict) -> None:
    if not record.get("flags") or record.get("secondaryTranscription"):
        return
    parts, _ = model.transcribe(str(candidate), language="en", beam_size=1, temperature=0, condition_on_previous_text=False, vad_filter=True, word_timestamps=False, initial_prompt=None)
    transcript = " ".join(part.text.strip() for part in parts).strip()
    comparison = compare(generation["text"], transcript, generation.get("voiceDesign", ""))
    record["secondaryTranscription"] = {"settings": {"beam_size": 1, "temperature": 0, "vad_filter": True, "word_timestamps": False, "condition_on_previous_text": False, "initial_prompt": None}, "transcript": transcript, **comparison, "checkedAt": utc()}
    record["asrAssessment"] = "secondary_decode_matches_expected" if comparison["wer"] == 0 else "same_mismatch_on_both_decodes" if tokens(transcript) == tokens(record["transcript"]) else "decoders_disagree_listening_needed"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "public/pictures/prodigal-son/voice-designs/run-results.json")
    parser.add_argument("--output", type=Path, default=ROOT / "screenshots/prodigal-voice-transcripts.json")
    parser.add_argument("--model", type=Path, default=MODEL)
    parser.add_argument("--watch", action="store_true", help="Continue as the generation manifest grows; stop when generation completes.")
    parser.add_argument("--poll-seconds", type=float, default=12)
    parser.add_argument("--idle-timeout", type=float, default=900)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--second-pass", action="store_true", help="Recheck only flagged files with independent beam1/VAD decoding, without expected text prompting.")
    parser.add_argument("--reuse-report", type=Path, action="append", default=[], help="Reuse completed candidate checks only when input, audio, model and QC cache hashes match.")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    from faster_whisper import WhisperModel
    model = WhisperModel(str(args.model), device="cpu", compute_type="int8", cpu_threads=4, num_workers=1, local_files_only=True)
    model_files = {path.name: {"bytes": path.stat().st_size, "sha256": digest(path)} for path in args.model.iterdir() if path.is_file()}
    model_fingerprint = hashlib.sha256(json.dumps(model_files, sort_keys=True).encode()).hexdigest()
    report = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else {"schemaVersion": 1, "results": [], "startedAt": utc()}
    report.update({"status": "running", "qcVersion": QC_VERSION, "sourceManifest": str(args.manifest.resolve()), "device": "cpu", "computeType": "int8", "cpuThreads": 4,
        "model": {"id": "Systran/faster-whisper-base.en", "revision": MODEL_REVISION, "path": str(args.model.resolve()), "files": model_files, "fingerprint": model_fingerprint},
        "runtime": {"python": sys.version, "executable": sys.executable, "fasterWhisper": importlib.metadata.version("faster-whisper"), "ctranslate2": importlib.metadata.version("ctranslate2")},
        "transcriptionSettings": {"language": "en", "beam_size": 5, "temperature": 0, "condition_on_previous_text": False, "vad_filter": False, "word_timestamps": True, "initial_prompt": None},
        "comparisonNotes": ["No expected text or voice-design prompt is supplied to ASR.", "WER ignores capitalization and punctuation, expands common English contractions, and treats waterskin/water skin as the same spoken words.", "Base English ASR can mishear words, especially very short clips and child voices. Flags require listening review; they do not approve or reject a generated voice.", "A second decode uses the same model with beam1/VAD and no word timestamps; decoder agreement is useful evidence but is not independent human listening.", "This check does not establish voice age, identity, acting quality, naturalness, absence of artifacts, or suitability for final production."]})
    records = {item["profileId"]: item for item in report["results"]}
    candidate_checks = {item.get("cacheKey"): item for path in args.reuse_report for item in json.loads(path.read_text(encoding="utf-8")).get("results", []) if item.get("status") == "completed"}
    if args.reuse_report:
        report["candidateReports"] = [str(path.resolve()) for path in args.reuse_report]
    last_progress = time.monotonic()
    while True:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        completed = [result for result in manifest.get("results", []) if result.get("status") == "completed"]
        for result in completed:
            profile_id = result["profileId"]
            name = result.get("fileName", "")
            base = args.manifest.resolve().parent
            candidate = (base / name).resolve()
            if not name or candidate.parent != base or candidate.suffix.lower() != ".wav":
                raise ValueError(f"Invalid generated audio filename: {profile_id}")
            audio_hash = digest(candidate)
            cache_key = hashlib.sha256(json.dumps({"inputSha256": result.get("inputSha256"), "audioSha256": audio_hash, "modelFingerprint": model_fingerprint, "qcVersion": QC_VERSION}, sort_keys=True).encode()).hexdigest()
            old = records.get(profile_id)
            if (not old or old.get("cacheKey") != cache_key) and cache_key in candidate_checks:
                old = records[profile_id] = candidate_checks[cache_key]
            if old and old.get("cacheKey") == cache_key and old.get("status") == "completed":
                old.update(compare(result["text"], old["transcript"], result.get("voiceDesign", "")))
                if args.second_pass:
                    secondary_check(model, candidate, old, result)
                continue
            check = {"profileId": profile_id, "name": result.get("name"), "assetId": result.get("assetId"), "textKind": result.get("textKind"), "fileName": name,
                "inputSha256": result.get("inputSha256"), "audioSha256": audio_hash, "cacheKey": cache_key, "expectedText": result["text"], "startedAt": utc(), "status": "running"}
            records[profile_id] = check
            start = time.monotonic()
            try:
                if audio_hash != result.get("sha256") or candidate.stat().st_size != result.get("bytes"):
                    raise ValueError("Generated WAV no longer matches the successful generation manifest checksum/size.")
                parts, info = model.transcribe(str(candidate), language="en", beam_size=5, temperature=0, condition_on_previous_text=False, vad_filter=False, word_timestamps=True, initial_prompt=None)
                parts = list(parts)
                transcript = " ".join(part.text.strip() for part in parts).strip()
                check.update({"status": "completed", "transcript": transcript, "durationSeconds": info.duration, "language": info.language,
                    "segments": [{"start": part.start, "end": part.end, "text": part.text, "avgLogprob": part.avg_logprob, "noSpeechProbability": part.no_speech_prob,
                        "words": [{"word": word.word, "start": word.start, "end": word.end, "probability": word.probability} for word in part.words or []]} for part in parts],
                    **compare(result["text"], transcript, result.get("voiceDesign", ""))})
                if args.second_pass:
                    secondary_check(model, candidate, check, result)
            except Exception as error:
                check.update({"status": "failed", "comparisonStatus": "verification_error", "error": f"{type(error).__name__}: {error}"})
            check.update({"finishedAt": utc(), "verificationSeconds": round(time.monotonic() - start, 3)})
            last_progress = time.monotonic()
            report["results"] = list(records.values())
            update_summary(report, manifest)
            write_report(args.output, report)
            print(json.dumps({"profileId": profile_id, "status": check["status"], "wer": check.get("wer"), "flags": [flag["kind"] for flag in check.get("flags", [])], "transcript": check.get("transcript")}), flush=True)
        report["results"] = list(records.values())
        update_summary(report, manifest)
        if not args.watch or manifest.get("status") in {"completed", "completed_with_errors", "failed", "interrupted"}:
            report["status"] = "completed" if manifest.get("status") in {"completed", "completed_with_errors"} else "snapshot_complete"
            write_report(args.output, report)
            print(json.dumps({"status": report["status"], **report["summary"]}), flush=True)
            return 0
        if time.monotonic() - last_progress > args.idle_timeout:
            report["status"] = "paused_waiting_for_generation"
            write_report(args.output, report)
            return 0
        write_report(args.output, report)
        time.sleep(max(1, min(args.poll_seconds, 60)))


def update_summary(report: dict, manifest: dict) -> None:
    successful = [item for item in report["results"] if item.get("status") == "completed"]
    for item in successful:
        if item.get("profileId") == "PS-EXT-MARKET:member-d" and item.get("wer") != 0 and item.get("secondaryTranscription", {}).get("wer") != 0:
            item["listeningReviewNote"] = "Listen for ‘has held’ in this audition; automatic transcription heard ‘is held’ in both takes."
        else:
            item.pop("listeningReviewNote", None)
    report["generationStatus"] = manifest.get("status")
    report["sourceSha256"] = manifest.get("sourceSha256")
    manifest_hashes = {item["profileId"]: item.get("sha256") for item in manifest.get("results", []) if item.get("status") == "completed"}
    report["checkedAudioMatchesCurrentManifest"] = len(successful) == len(manifest_hashes) and all(manifest_hashes.get(item["profileId"]) == item.get("audioSha256") for item in successful)
    report["voiceApprovalStatus"] = "PENDING_USER_REVIEW"
    report["summary"] = {"generatedFilesAvailable": sum(item.get("status") == "completed" for item in manifest.get("results", [])), "transcribed": len(successful),
        "normalizedMatches": sum(item.get("comparisonStatus") == "match" for item in successful), "needsListeningReview": sum(item.get("comparisonStatus") != "match" for item in successful),
        "verificationErrors": sum(item.get("status") == "failed" for item in report["results"]),
        "secondaryPassMatches": sum(item.get("secondaryTranscription", {}).get("wer") == 0 for item in successful),
        "matchedOnAtLeastOneDecode": sum(item.get("wer") == 0 or item.get("secondaryTranscription", {}).get("wer") == 0 for item in successful),
        "unresolvedAfterSecondary": sum(item.get("wer") != 0 and item.get("secondaryTranscription", {}).get("wer") != 0 for item in successful),
        "instructionLeakCandidates": sum(any(flag["kind"] == "possible_instruction_leak" for flag in item.get("flags", [])) for item in successful),
        "meanWer": round(sum(item["wer"] for item in successful) / len(successful), 5) if successful else None}


if __name__ == "__main__":
    raise SystemExit(main())
