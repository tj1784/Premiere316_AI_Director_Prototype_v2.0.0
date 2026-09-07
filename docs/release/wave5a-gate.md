# Wave 5A Gate — video architecture, fail-closed H3/LTX

Status: **GREEN**

Tag: `wave5a-p316-20260907141538-8286ff6d5eb0`  
Build: `p316-20260907141538-8286ff6d5eb0`  
Renderer source hash: `8286ff6d5eb0c456a9293bc6f03c3044ad489e20aa5a38b41d6962364e828147`  
Evidence commit: `528b981ca2ac4f5d17015a4806bbd2770a298e77`

Wave 5A is the **app-side video production architecture**. It is not a real video-generation runtime.

## GREEN because

- Prompt Compiler v1 (Llama-default, optional Qwen unrun)
- Video queue, takes, QC, reject; canonical blocked without durable media
- Generate video-queue UI and Review take structure
- Packaged fail-closed MiniMax H3 and LTX 2.5 JSONL workers (ping/release, refuse generate)
- `npm test` 269/269, typecheck, production build, `electron:pack`
- Packaged smoke pass
- 14-stage visual matrix 28/28 at 100% and 150%
- Isolated fail-closed UAT: compile drafts, queue missing video, no durable media, no still-as-video
- No ComfyUI, no port 8188, no cloud inference POST

Evidence: `screenshots/wave5-closeout/`

## Explicitly not claimed

- No genuine H3 or LTX 2.5 video file
- Full Wave 5 is **not** GREEN (see Wave 5B)
- Wave 7 final-film acceptance remains blocked

## UI note

Generate shows the **selected** video engine (default LTX 2.5). MiniMax H3 fail-closed copy lives in the packaged worker and Review empty-state copy. Backlog: expose both engine statuses on a readiness card (`docs/release/wave5b-blockers.md`).
