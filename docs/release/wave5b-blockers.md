# Wave 5B Blockers — real local video runtime

Status: **BLOCKED**

Wave 5A is GREEN. Wave 5B is the missing **official non-Comfy** MiniMax H3 or LTX 2.5 runtime that emits real video through `Premiere316.exe`.

## Required for Wave 5B GREEN

- App-owned official native worker (not Comfy, not port 8188, not Hugging Face download, not cloud)
- User-triggered generate only
- Durable video file (not a still, not a fixture)
- SHA-256 of the file
- Probe metadata: duration, fps, frame count
- Provenance sidecar
- Review / reject / canonical approval
- Authenticated ledger binding
- Isolated packaged UAT of the live job
- Independent A07 / A08 / A64 veto retained

## Current honest state

- `desktop/workers/minimax_h3_jsonl_worker.py` refuses `generate`
- `desktop/workers/ltx25_jsonl_worker.py` refuses `generate`
- Weights/components may exist locally; they are not a verified Premiere316 runtime
- Comfy-converted LTX checkpoints are not used

## Backlog (not in this checkpoint)

`W5B/UI` — Video engine readiness panel should expose **all** configured video engine statuses (MiniMax H3 and LTX 2.5), not only the selected engine on Generate.

## Downstream gates

- Wave 6 **may start**. Voice, ADR, Foley, and score can bind to screenplay, characters, shots, Prompt Lab, and placeholder/fail-closed video state.
- Wave 7 final-film / export acceptance remains **blocked** until Wave 5B GREEN or an approved imported video source exists.
