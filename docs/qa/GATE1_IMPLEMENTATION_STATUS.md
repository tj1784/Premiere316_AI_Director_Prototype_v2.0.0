# 17234f7 UI/UX QA — implementation status

**Date:** 2026-08-22  
**Verdict:** Still **NO-GO** for production, but Gate 1 P1 state-truth defects now have code and unit tests.

## Shipped in this pass

### Gate 1 — state truth

| ID | Status | What landed |
|---|---|---|
| TAKE-001 | Done | Active / Latest-per-segment / All restored; default Active |
| IMP-001 | Done | Per-file import results + persistent report + retry failed |
| IMP-002 | Done | Shared `shared/media-types.js`; images rejected visibly; AVI aligned |
| IMP-015 | Done | Unsupported-only drops produce a report |
| IMP-018 | Done | Folder scan wrapped in try/catch/finally |
| COMFY-001 | Done | Separate selected / loading / loaded keys; success only after inject ACK |
| COMFY-002 | Done | Request IDs ignore stale loads; confirm before replacing a loaded graph |
| COMFY-003 | Done | Tracked `workflows/manifest.json` + packaged inventory + missing-library banner |
| SCOPE-006 | Done | ADR records BlokeyUI boundary; product graphs live in `workflows/` |

### Related reliability that came with Gate 1

| ID | Status | What landed |
|---|---|---|
| IMP-003 | In Progress | Editor uploads stream to `staging/editor-uploads` then atomically rename |
| IMP-004 | Done | Scanning state starts immediately |
| IMP-006 | Done | Merge webkit entries and `dataTransfer.files` |
| IMP-011 | Done | Import no longer forces take filter to All |
| TAKE-002 | Done | Replace selected clip with take |
| TAKE-004 | Done | Segment scope excludes unassigned unless opted in |
| TAKE-006 | Done | Take filter persisted per project |
| COMFY-004 / 005 / 006 | Done | HTTP status, list state machine, unavailable options disabled |
| COMFY-010 | Done | Exact IDs; ambiguous matches return 409 |
| COMFY-011 / 015 / 019 / 020 | Done | Guarded iframe, reload, awaited inject, visible hash/source |
| SEQ-AUD-001 | In Progress | Preview uses Web Audio GainNode and is no longer clamped to unity; export parity still needs a measured fixture |
| SEQ-PLAY-001 | In Progress | Transport clock freezes while waiting/stalled/seeking |
| SEQ-PLAY-002 / 010 | In Progress | Program video no longer remounts per cut; next clip preloads |
| SEQ-PLAY-003 / 004 | Done | Buffering overlay + play() rejection text |
| SCOPE-001–005, TAKE-007 | Done | Documented in `docs/adr/0001-uiux-release-scope.md` |
| QA-001 | In Progress | `npm test` unit coverage + `.github/workflows/ci.yml`. Not yet Playwright/browser UAT |

## Still open (not claimed)

- Full dual-buffer seam swap and 50-cut 4K proof (SEQ-PLAY-002)
- Measured preview/export loudness fixtures (SEQ-AUD-001 remainder)
- Durable import jobs, preflight endpoint, MIME signature checks
- Versioned Comfy extension/bridge (COMFY-018 / COMFY-012 prompt IDs when API missing)
- Playwright UAT, axe, 400% zoom, forced-colors
- Product CRUD take model (explicitly deferred)

## Tests added

- `tests/uiux-gate1.test.mjs`
- Extended `tests/sequence-editor-ui.test.mjs` and `tests/sequence-editor-state.test.mjs`
