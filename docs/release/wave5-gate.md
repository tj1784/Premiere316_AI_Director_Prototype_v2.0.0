# Wave 5 Gate — prompt compiler, video queue, fail-closed H3/LTX

Status: `SOURCE_PASS_VIDEO_RUNTIME_FAIL_CLOSED`

Wave 4 remains GREEN and unmutated as accepted evidence. Wave 5 implemented the production pipeline around video without claiming MiniMax H3 or LTX 2.5 can generate. Wave 6 is still closed.

## What is implemented

- Prompt Compiler v1: Creative Intent → Canonical Spec → deterministic Llama-default compiler → engine prompt package (still and motion).
- Optional Qwen A/B remains explicit and unrun.
- Cross-media scheduler: priority, dependencies, single running job, cancel, restart re-queue without duplicate execution. Operator LM Studio/Comfy processes are protected.
- Video jobs/takes: queue, fail-closed execution record, QC, reject, canonical blocked without durable media.
- Generate stage: “Queue missing video” writes fail-closed takes. Review stage lists video takes. Prompt Lab “Compile drafts” writes still/motion drafts without invoking a video runtime.
- JSONL workers `minimax_h3_jsonl_worker.py` and `ltx25_jsonl_worker.py` ping/release and refuse generate.

## What is not implemented / not verified

- No genuine MiniMax H3 or LTX 2.5 video file was produced.
- Comfy-named checkpoints are not used.
- Port 8188 is not contacted.
- Packaged Electron smoke, 14-stage visual matrix, and a live video job were not run in this gate.
- Therefore Wave 5 is **not GREEN**.

## Tests

- `npm test` includes prompt-compiler, scheduler, video-runtime, and video-iterations suites.
- `npm run typecheck` passes.

## Fail-closed engines

- MiniMax H3: weights may exist; no app-owned official native runtime.
- LTX 2.5: components may exist; no official non-Comfy native worker.

## Next

Do not open Wave 6 until Wave 5 is GREEN. GREEN requires packaged smoke, visual matrix, and either a real local video job or a documented packaged UAT of the fail-closed path.
