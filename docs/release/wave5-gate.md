# Wave 5 Gate — split

Overall status: **PARTIAL — 5A GREEN / 5B BLOCKED**

Do **not** treat full Wave 5 as GREEN. There is no `wave5-p316-…` tag.

| Gate | Status | Meaning |
|---|---|---|
| Wave 5A | **GREEN** | App-side video architecture verified and packaged |
| Wave 5B | **BLOCKED** | Real local non-Comfy H3/LTX video runtime missing |
| Wave 5 overall | PARTIAL | Architecture yes; generated video no |

Build: `p316-20260907141538-8286ff6d5eb0`  
5A tag: `wave5a-p316-20260907141538-8286ff6d5eb0`

## What 5A verified

Wave 5A is **app-side video architecture verified**: Prompt Compiler, video queue, take/review data model, Generate queue UI, Review take structure, fail-closed MiniMax H3 worker, fail-closed LTX 2.5 worker, packaged Electron smoke, 14-stage visual matrix, no-Comfy / no-8188 / no-cloud proof.

Details: `docs/release/wave5a-gate.md`  
Evidence: `screenshots/wave5-closeout/`

## What 5B still blocks

Wave 5B is **real video runtime blocked**. GREEN requires an official non-Comfy H3 or LTX 2.5 worker that emits a valid video file through Premiere316.exe, with receipt, SHA-256, probe metadata, provenance, review/reject/canonical, and ledger binding.

Details: `docs/release/wave5b-blockers.md`

## Downstream

- Wave 6 **may proceed** because audio/voice/score can bind to screenplay, characters, shots, and placeholder video states.
- Wave 7 final-film acceptance remains **blocked** until real video runtime or approved imported video exists.

Wave 4 remains GREEN and unmutated.
