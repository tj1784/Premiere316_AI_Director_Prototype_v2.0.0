# Wave 5 Gate — prompt compiler, video queue, fail-closed H3/LTX

Status: `SOURCE_VERIFIED_VIDEO_RUNTIME_BLOCKED`

Wave 4 remains GREEN and unmutated as accepted evidence. Wave 5 source, package, smoke, 14-stage visual matrix, and fail-closed UAT passed. No genuine MiniMax H3 or LTX 2.5 video file was produced. Wave 5 is **not GREEN**. Wave 6 remains closed.

Build: `p316-20260907141538-8286ff6d5eb0`  
Renderer source hash: `8286ff6d5eb0c456a9293bc6f03c3044ad489e20aa5a38b41d6962364e828147`

## What is implemented and packaged

- Prompt Compiler v1: Creative Intent → Canonical Spec → deterministic Llama-default compiler → engine prompt package (still and motion).
- Optional Qwen A/B remains explicit and unrun.
- Cross-media scheduler: priority, dependencies, single running job, cancel, restart re-queue without duplicate execution.
- Video jobs/takes: queue, fail-closed execution record, QC, reject; canonical blocked without durable media.
- Generate: “Queue missing video” writes fail-closed takes. Review lists video takes. Prompt Lab “Compile drafts” writes still/motion drafts without invoking a video runtime.
- JSONL workers `minimax_h3_jsonl_worker.py` and `ltx25_jsonl_worker.py` ping/release and refuse generate.

## Closeout verification

- `npm test` 269/269
- `npm run typecheck` pass
- `npm run build` pass
- `npm run electron:pack` pass
- Packaged smoke pass (`screenshots/wave5-closeout/packaged-smoke.json`)
- 14-stage visual matrix 28/28 at 100% and 150%, 0 violations, 0 console/page errors
- Isolated Wave 5 UAT: Prompt Lab compiled; Generate video queue visible; LTX fail-closed copy visible; queue produced no durable media; Review listed fail-closed takes; no still presented as video
- MiniMax H3 fail-closed copy is packaged in the worker and Review empty-state copy; Generate shows the selected video engine (default LTX 2.5)
- No port 8188, no Comfy graph, no cloud inference POST, no `/v1/chat/completions`

## What is not implemented / not verified

- No genuine MiniMax H3 or LTX 2.5 video file was produced.
- Comfy-named checkpoints are not used.
- Therefore Wave 5 is **not GREEN**.

## Crash fix included in this closeout

`makeSamplePicture()` compiled engine prompts before screenplay hydration, which threw `Cannot read properties of undefined (reading 'currentVersionId')` on Pictures. Closeout now hydrates then compiles, and the compiler treats missing screenplay as null provenance.

## Fail-closed engines

- MiniMax H3: weights may exist; no app-owned official native runtime.
- LTX 2.5: components may exist; no official non-Comfy native worker.

## Next

Do not open Wave 6 until Wave 5 is GREEN. GREEN requires a real official non-Comfy H3 or LTX 2.5 local worker that emits a valid video file through Premiere316.exe, with receipt, hash, probe metadata, provenance, and review/canonical/reject support.
