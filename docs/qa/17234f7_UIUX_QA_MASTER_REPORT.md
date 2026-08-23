# Premiere316 UI/UX QA — Commit `17234f7`

**Repository:** `tj1784/Premiere316_AI_Director_Prototype_v2.0.0`  
**Commit:** `17234f7bcc9687d12afa23fbb88c6eff5be7e2a9`  
**Parent:** `680f18ca1903ef5102249cc63ed98b47e2c60b35`  
**Advertised scope:** Sequence play, takes, folder drop, and Comfy workflow picker  
**Assessment type:** Deep source/diff/UI-contract QA and release-gate audit  
**Verdict:** **NO-GO for release or production reliance**  
**Remediation (2026-08-22):** Gate 1 P1 state-truth items now have implementation + unit tests. See `docs/qa/GATE1_IMPLEMENTATION_STATUS.md`. Playback architecture, measured audio parity, Playwright UAT, and remaining P2/P3 work are still open.

## Executive judgment

The direction is useful: the sequence workspace is becoming more self-service, folder drop lowers friction, and the Comfy picker is the right product concept. The implementation at `17234f7`, however, does not yet make those workflows trustworthy.

The strongest problems are not cosmetic. They concern **state truth**, **media timing**, **silent partial failure**, **preview/export mismatch**, **non-reproducible local dependencies**, and **lack of behavioral test gates**. In a filmmaking workflow, these defects create the worst class of UX failure: the interface appears to have completed the requested action while the underlying result can be different, incomplete, or not actually loaded.

### Release tally

- **P0 confirmed:** 0
- **P1 release blockers:** 11
- **P2 major defects/risks:** 54
- **P3 moderate/polish/operational items:** 9
- **Total registered findings:** 74
- **Manual/automated UAT cases supplied:** 88

A lack of a confirmed P0 is not a release pass. The P1 set directly affects the advertised flows.

## What was and was not validated

### Completed

1. Commit and parent comparison.
2. Current source review of the sequence UI, Comfy UI, server import/workflow handlers, FFmpeg audio behavior, styles, and tests.
3. Main/master pointer and protection/status review.
4. Clean-checkout dependency analysis across the root repository, `BlokeyUI` submodule, nested ComfyUI location, and ignore rules.
5. Interaction-state, failure-state, accessibility, responsiveness, performance, concurrency, and regression analysis.
6. A complete repair-oriented issue register and executable UAT matrix.

### Not completed—and therefore not claimed

A real browser/runtime session could not be executed because no deployed origin or workstation-local service was available to this environment, and the repository could not be cloned into the execution container. The local diagnostics, patch scripts, and local Comfy workflow files were not committed. Therefore:

- No pixel-perfect screenshot comparison is claimed.
- No real codec/decode timing measurement is claimed.
- No live Comfy iframe handshake is claimed.
- No test-suite PASS is claimed.
- Visual overflow and contrast findings are marked for rendered confirmation where appropriate.

The static findings labeled **Confirmed** are directly visible in source or repository state. Findings labeled **High-confidence runtime risk** follow directly from the architecture but still require execution evidence.

## Release scorecard

| Dimension | Grade | Judgment |
|---|---:|---|
| Functional state truth | **Red** | Picker label/canvas and import summary/result can disagree. |
| Playback reliability | **Red** | Wall-clock transport and no cut preloading undermine trustworthy review. |
| Takes workflow | **Red** | Latest/segment regressed and default became noisier. |
| Folder import | **Red** | Silent losses/failures, contract mismatch, and unsafe large-file architecture. |
| Comfy picker | **Red** | No load ACK, race/dirty-state gaps, and local inventory is not reproducible. |
| Error recovery | **Red** | Several failures are swallowed or collapsed into ambiguous states. |
| Accessibility | **Red** | Core editing remains pointer-centric, tiny, and incompletely named. |
| Responsive usability | **Red/Unverified** | Static constraints strongly predict failure on common low-height/scaled Windows layouts. |
| Automated confidence | **Red** | No true interaction tests or required branch gates. |
| Product direction | **Green** | The intended self-service workflow is correct and worth finishing. |

## Immediate release blockers

| ID | Surface | Finding | Why it blocks |
|---|---|---|---|
| **SEQ-PLAY-001** | Sequence / Playback | The program clock advances from requestAnimationFrame wall-clock time even while the current video is waiting, stalled, seeking, or not ready. | The playhead and auxiliary audio can move ahead while picture is frozen, followed by a hard seek or skipped visual material. Editorial timing cannot be trusted. |
| **SEQ-PLAY-002** | Sequence / Playback | Every cut remounts a single <video> element keyed by clip ID, with no next-clip preload, double buffer, preroll, or readiness gate. | Cuts can flash black, show the prior frame, or stall on real 4K/AI-generated media and slow disks. |
| **SEQ-AUD-001** | Sequence / Audio | Preview gain converts dB to linear gain and clamps it to 0–1, while the editor/export path permits positive gain up to +12 dB. | Preview and export do not match. A +12 dB clip previews at unity but exports at roughly 3.98× linear gain, creating surprise loudness or clipping. |
| **IMP-001** | Sequence / Folder Drop | Per-file import failures are swallowed, and completion messaging reports only the imported count without a failed/rejected count, reason list, or retry. | Users can believe a folder was handled successfully while assets are missing. This is especially dangerous in large production drops. |
| **IMP-002** | Sequence / Folder Drop | The client accepts image extensions but never categorizes/imports them, and accepts AVI while the server rejects AVI. | Images disappear silently and AVI produces a hidden failure. The drop-zone promise is not truthful. |
| **IMP-003** | Sequence / Folder Drop | Large uploads use in-memory multipart buffering and synchronous disk writes, with very large configured limits. | Large AI-video imports can spike process memory, block the event loop, freeze the UI/API, or terminate the server. |
| **TAKE-001** | Sequence / Takes | Latest/segment filtering was removed from the visible controls, its remaining branch is a no-op, and the default filter changed from Active to All. | The take bin becomes noisier and the fastest segment-review path disappears in the very commit advertised as improving takes. |
| **COMFY-001** | Comfy Picker | The picker can display a selected workflow before that graph has been loaded into the iframe, and success is announced without a bridge acknowledgement that the graph actually loaded. | The label and canvas can disagree. A user can edit or queue the wrong graph while believing the selected workflow is active. |
| **COMFY-002** | Comfy Picker | Rapid workflow changes are not cancellation- or sequence-token-protected, and loading another workflow does not confirm unsaved graph edits. | An older request can overwrite a newer selection, and local graph work can be destroyed without warning. |
| **COMFY-003** | Comfy Picker / Packaging | The server scans BlokeyUI/ComfyUI/user/default/workflows, but BlokeyUI explicitly ignores **/user/default/workflows/ and those local workflow files were not committed. | 17234f7 alone cannot reproduce the developer's picker inventory. Clean machines can show a partial/empty library or resolve different graphs. |
| **QA-001** | Release Engineering | No behavioral browser tests cover play, cuts, takes, folder drop, or the Comfy picker; the commit has no CI status/workflow run, and main/master have no required checks. | The primary advertised workflows can regress while both release branches still accept the commit. |

## Detailed blocker analysis

### SEQ-PLAY-001 — Sequence / Playback — P1

**Classification:** Confirmed code defect; runtime impact high-confidence

**Finding:** The program clock advances from requestAnimationFrame wall-clock time even while the current video is waiting, stalled, seeking, or not ready.

**User/production impact:** The playhead and auxiliary audio can move ahead while picture is frozen, followed by a hard seek or skipped visual material. Editorial timing cannot be trusted.

**Evidence anchor:** `client/src/components/SequenceEditorWorkspace.tsx — beginPlayback/requestAnimationFrame and media synchronization logic`

**Required repair:** Make media readiness authoritative. Pause the transport clock on waiting/stalled/seeking; resume only after canplay/seeked. Use a shared master clock and explicit buffering state.

**Release acceptance:** Under throttled decode/network conditions, the program playhead does not advance during a stall; picture and audio return within one frame at 24 fps.
### SEQ-PLAY-002 — Sequence / Playback — P1

**Classification:** Confirmed architecture; runtime impact high-confidence

**Finding:** Every cut remounts a single <video> element keyed by clip ID, with no next-clip preload, double buffer, preroll, or readiness gate.

**User/production impact:** Cuts can flash black, show the prior frame, or stall on real 4K/AI-generated media and slow disks.

**Evidence anchor:** `client/src/components/SequenceEditorWorkspace.tsx — program monitor JSX and currentProgramClip key/src handling`

**Required repair:** Use two alternating video elements or a media buffer, preload the next source, seek it before the seam, and swap only after readiness is acknowledged.

**Release acceptance:** A 50-cut mixed-codec sequence plays three consecutive passes with zero black frames, zero stale frames, and no seam stall.
### SEQ-AUD-001 — Sequence / Audio — P1

**Classification:** Confirmed code defect

**Finding:** Preview gain converts dB to linear gain and clamps it to 0–1, while the editor/export path permits positive gain up to +12 dB.

**User/production impact:** Preview and export do not match. A +12 dB clip previews at unity but exports at roughly 3.98× linear gain, creating surprise loudness or clipping.

**Evidence anchor:** `client/src/components/SequenceEditorWorkspace.tsx — dB gain clamp; server/ffmpeg.js — export volume application`

**Required repair:** Use Web Audio GainNode or another path that supports gain above unity, or remove positive gain from the UI/export contract.

**Release acceptance:** For -24, -12, 0, +6, and +12 dB, preview and exported integrated/peak levels agree within 0.5 dB.
### IMP-001 — Sequence / Folder Drop — P1

**Classification:** Confirmed code defect

**Finding:** Per-file import failures are swallowed, and completion messaging reports only the imported count without a failed/rejected count, reason list, or retry.

**User/production impact:** Users can believe a folder was handled successfully while assets are missing. This is especially dangerous in large production drops.

**Evidence anchor:** `client/src/components/SequenceEditorWorkspace.tsx — importDroppedMedia per-file empty catch and summary notice`

**Required repair:** Return a structured result for every file: imported, duplicate, unsupported, oversized, failed. Present a persistent summary and retryable failure list.

**Release acceptance:** A mixed 20-file drop reports scanned/imported/skipped/failed totals that add up exactly to 20, with reason and retry for each failure.
### IMP-002 — Sequence / Folder Drop — P1

**Classification:** Confirmed cross-layer contract defect

**Finding:** The client accepts image extensions but never categorizes/imports them, and accepts AVI while the server rejects AVI.

**User/production impact:** Images disappear silently and AVI produces a hidden failure. The drop-zone promise is not truthful.

**Evidence anchor:** `client/src/components/SequenceEditorWorkspace.tsx — extension allowlist/classification; server/sequence-editor.js — server extension validation`

**Required repair:** Create one shared media-type contract. Import images into a defined bin/workflow or reject them visibly. Align AVI support on both layers.

**Release acceptance:** Every advertised extension has an end-to-end test and a visible deterministic result; no accepted file vanishes silently.
### IMP-003 — Sequence / Folder Drop — P1

**Classification:** Confirmed server architecture risk

**Finding:** Large uploads use in-memory multipart buffering and synchronous disk writes, with very large configured limits.

**User/production impact:** Large AI-video imports can spike process memory, block the event loop, freeze the UI/API, or terminate the server.

**Evidence anchor:** `server/index.js — multer memory storage/limits and import routes; server/sequence-editor.js — synchronous writes`

**Required repair:** Stream multipart data directly to a staging file, validate while streaming, atomically rename, expose progress, and make limits explicit in the UI.

**Release acceptance:** Importing files near the configured limit does not cause a material event-loop stall or memory spike proportional to full file size.
### TAKE-001 — Sequence / Takes — P1

**Classification:** Confirmed regression against parent commit

**Finding:** Latest/segment filtering was removed from the visible controls, its remaining branch is a no-op, and the default filter changed from Active to All.

**User/production impact:** The take bin becomes noisier and the fastest segment-review path disappears in the very commit advertised as improving takes.

**Evidence anchor:** `client/src/components/SequenceEditorWorkspace.tsx at parent 680f18c versus 17234f7 — takeFilter state, visibleMedia filter, rendered filter buttons`

**Required repair:** Restore Active, Latest/segment, and All; default to Active; add regression tests for item membership and default state.

**Release acceptance:** Latest/segment shows only the newest eligible take for the selected segment, Active remains default, and All is an explicit opt-in.
### COMFY-001 — Comfy Picker — P1

**Classification:** Confirmed state-truth defect

**Finding:** The picker can display a selected workflow before that graph has been loaded into the iframe, and success is announced without a bridge acknowledgement that the graph actually loaded.

**User/production impact:** The label and canvas can disagree. A user can edit or queue the wrong graph while believing the selected workflow is active.

**Evidence anchor:** `client/src/components/ComfyUIWorkspace.tsx — initial picker state, loadWorkflow/injectGraph, URL fallback and success notice`

**Required repair:** Separate selected, loading, and loadedWorkflow IDs. Auto-load deliberately or show 'not loaded'. Require an explicit iframe bridge ACK containing workflow ID/hash before success.

**Release acceptance:** The toolbar never claims workflow X is loaded unless the iframe returns an ACK for X; initial state is unambiguous.
### COMFY-002 — Comfy Picker — P1

**Classification:** Confirmed missing concurrency/dirty-state control

**Finding:** Rapid workflow changes are not cancellation- or sequence-token-protected, and loading another workflow does not confirm unsaved graph edits.

**User/production impact:** An older request can overwrite a newer selection, and local graph work can be destroyed without warning.

**Evidence anchor:** `client/src/components/ComfyUIWorkspace.tsx — loadWorkflow request lifecycle and option change handling`

**Required repair:** Abort or ignore stale loads, serialize bridge application, track canvas dirty state, and require discard/save confirmation.

**Release acceptance:** In a 20-change rapid-selection test, only the final workflow loads. Modified graphs cannot be replaced without an explicit user decision.
### COMFY-003 — Comfy Picker / Packaging — P1

**Classification:** Confirmed reproducibility defect

**Finding:** The server scans BlokeyUI/ComfyUI/user/default/workflows, but BlokeyUI explicitly ignores **/user/default/workflows/ and those local workflow files were not committed.

**User/production impact:** 17234f7 alone cannot reproduce the developer's picker inventory. Clean machines can show a partial/empty library or resolve different graphs.

**Evidence anchor:** `server/aaa-workflow.js — WORKFLOW_ROOT; root .gitmodules; BlokeyUI .gitignore; pinned BlokeyUI tree`

**Required repair:** Package supported workflow JSON in a tracked product directory with a manifest/version/hash, or provide a deterministic installer/import step and a first-run missing-library state.

**Release acceptance:** A clean recursive clone produces the same supported picker inventory and graph hashes as the release machine, or clearly blocks with actionable setup.
### QA-001 — Release Engineering — P1

**Classification:** Confirmed process gap

**Finding:** No behavioral browser tests cover play, cuts, takes, folder drop, or the Comfy picker; the commit has no CI status/workflow run, and main/master have no required checks.

**User/production impact:** The primary advertised workflows can regress while both release branches still accept the commit.

**Evidence anchor:** `tests/sequence-editor-ui.test.mjs; tests/e2e/uat-harness.mjs; tests/e2e/uat-p0.browser.mjs; package.json; branch/status metadata`

**Required repair:** Add real Playwright browser tests, API contract tests, accessibility checks, and required branch protection on one canonical release branch.

**Release acceptance:** The P1 acceptance cases run in CI and must pass before merge; main and master cannot advance without the required checks.

## Sequence playback deep QA

### What is good

- The editor already has revision-aware saving and a conflict path.
- Autosave, dirty-state protection, undo/redo, source/program separation, probing, and export preparation are useful foundations.
- Missing/probe errors are more discoverable than in a bare media-bin implementation.
- Track lock/mute concepts and explicit picture-versus-audio-tail representation are directionally sound.

### What must change

The program monitor currently behaves more like a wall-clock slideshow controller than an editing transport. The transport must never outrun the media it claims to represent. Playback should be rebuilt around:

1. An authoritative clock.
2. Media readiness and stall state.
3. Preloaded current/next video surfaces.
4. Scheduled audio through Web Audio.
5. Explicit buffering/degraded-preview feedback.
6. Test fixtures with long-GOP, HEVC/H.264/WebM, variable resolution, missing/corrupt media, and slow I/O.
7. Preview/export loudness parity.

A useful architecture is a two-surface video deck: A is visible while B preloads and seeks the next cut. At the seam, swap opacity/visibility only after B is ready. Audio should be scheduled against one `AudioContext` timeline. This will not make browser playback a full NLE engine, but it will make it predictable.

## Takes deep QA

The parent commit had a working user model: **Active**, **Latest**, and **All**, with Active as the default. `17234f7` regresses that model. The correct product flow should be:

1. Selecting a timeline clip scopes the bin to that segment.
2. Active is the default state.
3. Latest/segment shows exactly one latest candidate per relevant segment or the latest candidate for the selected segment—choose one clear definition and label it.
4. All is an explicit historical view.
5. The selected take and selected timeline target are visually linked.
6. A primary **Replace** command performs the edit.
7. Previous/next take shortcuts support rapid audition.
8. Unassigned imports live in their own group.
9. Undo/redo restores both timeline and active-take metadata atomically.

## Folder-drop deep QA

Folder drop needs to be treated as an import job, not a loop around hidden file uploads.

### Required job model

- `scanning`
- `preflighting`
- `importing`
- `partially_complete`
- `complete`
- `cancelled`
- `failed`

Each discovered file needs a terminal result:

- imported
- linked existing
- skipped duplicate
- unsupported
- oversized
- corrupt/unprobeable
- permission failure
- copy/write failure
- cancelled

The summary must reconcile exactly: **scanned = imported + linked + skipped + failed + cancelled**.

### Required server architecture

- Stream to a staging path rather than keeping the full media payload in memory.
- Validate extension, MIME/signature, size, and destination.
- Use atomic exclusive naming or content hashes.
- Atomically append import metadata with revision protection.
- Preserve relative path/provenance.
- Return structured per-file outcomes.
- Add retention/orphan/duplicate tools.

### Drop-target truth

A bin drop can mean **Import**. A timeline drop conventionally means **Insert/overwrite at this time and track**. Do not make visually different targets perform the same hidden import unless they are labeled as the same operation.

## Comfy picker deep QA

The picker needs a formal bridge contract. Reaching into private iframe globals and scraping/clicking the embedded UI is too fragile for a production integration.

### Required bridge messages

- `PREMIERE_COMFY_HELLO`
- `COMFY_CAPABILITIES`
- `PREMIERE_LOAD_GRAPH` with workflow ID/hash/JSON
- `COMFY_GRAPH_LOADED` with ID/hash or structured error
- `PREMIERE_GET_DIRTY_STATE`
- `COMFY_DIRTY_STATE`
- `PREMIERE_QUEUE_GRAPH`
- `COMFY_PROMPT_ACCEPTED` with prompt ID
- `COMFY_PROMPT_REJECTED` with validation details

The toolbar should separately show:

- Context asset/slot
- Recommended workflow
- Selected workflow
- Loaded workflow
- Source: packaged/local/catalog
- Version/hash
- Dirty status
- Engine/bridge status
- Last queue prompt ID/status

### Packaging requirement

The exact workflows supported by the product must live in a tracked, versioned package manifest. User-created workflows may remain local, but they cannot be the only source for a release feature. The current ignore rule for `**/user/default/workflows/` is reasonable for personal data, but the product must not quietly depend on that directory for deterministic behavior.

## Accessibility and responsive QA

The current interface is optimized for a large desktop monitor and pointer use. That can be a product choice, but it still needs:

- keyboard-complete editing,
- visible focus,
- named controls,
- usable hit targets,
- readable status text,
- live progress/error announcements,
- a low-height Windows layout,
- and tested scaling at 100%, 125%, and 150%.

The fixed minimum widths and dense fixed-height regions should be replaced by deliberate workstation breakpoints rather than generic mobile responsiveness. The key target is not a phone; it is a Windows editing workstation in split-screen, 1366×768, 1440×900, or a 4K panel at 150% scaling.

## Remaining P2/P3 register

The full sortable register is delivered separately. Key groups are:

- Playback: missing stall UI, swallowed play errors, independent media clocks, rAF fades, no metering, and frame-accuracy limitations.
- Takes: no direct replace, no rapid compare/cycle, segment-scope leakage, weak status hierarchy.
- Import: no scan/progress/cancel, mixed payload loss, nonstandard folder API dependence, flattened hierarchy, no dedupe, context reset, concurrency/collision risks.
- Comfy: unchecked HTTP statuses, conflated loading/error states, selectable unready options, non-searchable flat list, sync filesystem work, fuzzy resolution, unsafe iframe access, DOM-click queueing, stale engine source, no timeout, no explicit reload, hidden recommendation/provenance.
- Accessibility: missing names, pointer-only edits, undersized controls, tiny text, rigid layout, unannounced dynamic states, global shortcut scope.
- Release process: scope contamination, local-only diagnostics/patches, unsigned commit, large project-data churn, and no tests added with the feature.

## Repair order

### Gate 1 — Stop false state and silent loss

1. Restore deterministic takes filtering/default.
2. Replace import summary with complete per-file result accounting.
3. Align file-type contracts.
4. Separate selected/loading/loaded Comfy workflow state.
5. Require Comfy graph-load and queue ACKs.
6. Package or manifest supported workflows.

### Gate 2 — Make playback/import safe

1. Stall-aware master clock.
2. Current/next preload deck.
3. Web Audio scheduling and gain parity.
4. Streaming imports with atomic writes.
5. Import progress/cancel and revision-safe metadata updates.

### Gate 3 — Make workflows efficient

1. Direct take replace.
2. Take cycling/A-B.
3. Searchable grouped Comfy picker.
4. Recent import group, duplicate policy, preserved paths.
5. Buffering/relink/error recovery surfaces.

### Gate 4 — Make it testable and shippable

1. Real Playwright tests, not bundle-string checks.
2. API contract tests for every extension/result.
3. Comfy mock bridge test harness.
4. Axe plus keyboard test pass.
5. Performance fixtures for large bins, folders, workflows, and 4K media.
6. Protect a canonical branch with required checks.

## Minimum automated suite before release

1. **Playback integration:** mocked waiting/canplay/seeking plus real media fixtures.
2. **Cut continuity:** pixel/frame sentinel around seams.
3. **Audio parity:** known tones at negative/zero/positive dB compared to export.
4. **Take filters:** exact item membership and default-state tests.
5. **Take replacement:** document mutation + undo/redo.
6. **Folder drop:** mixed entries/files, deep trees, partial failure, duplicates, cancel, concurrent import.
7. **Import API:** extension/MIME/size matrix and atomic write behavior.
8. **Comfy picker:** initial state, ACK, stale-request rejection, dirty confirmation, offline/partial/malformed states.
9. **Clean clone:** deterministic packaged workflow inventory/hash.
10. **Accessibility:** names/roles, keyboard completion, focus preservation, live regions.
11. **Responsive screenshots:** target workstation resolutions/scales.
12. **Branch gate:** an intentionally failing test must block merge.

## Manual release gate

Do not call this release-ready until all of the following are true:

- All P1 findings are closed with evidence.
- The supplied P1 UAT cases pass on the actual Windows/Comfy workstation.
- No uncaught console errors occur in primary flows.
- Preview/export gain parity is measured.
- A clean recursive clone yields deterministic workflow support.
- Folder import reports every file and survives large-file testing.
- A multi-cut 4K sequence plays without black/stale seam frames.
- Keyboard-only primary workflows pass.
- Required CI checks protect the canonical branch.
- Diagnostics and migration/patch scripts are committed and reproducible.

## Source map

- `client/src/components/SequenceEditorWorkspace.tsx`
- `client/src/components/ComfyUIWorkspace.tsx`
- `client/src/components/CreateSoundWorkspace.tsx`
- `client/src/styles.css`
- `server/sequence-editor.js`
- `server/aaa-workflow.js`
- `server/index.js`
- `server/ffmpeg.js`
- `tests/sequence-editor-ui.test.mjs`
- `tests/sequence-editor.test.mjs`
- `tests/e2e/browser-harness.mjs`
- `tests/e2e/uat-harness.mjs`
- `tests/e2e/uat-p0.browser.mjs`
- `package.json`
- `.gitignore`
- `.gitmodules`
- `tj1784/BlokeyUI/.gitignore`
- GitHub commit, branch, status, workflow-run, and submodule-tree metadata

## Final verdict

`17234f7` is an important prototype checkpoint, not a safe release checkpoint. Keep it behind an internal/developer flag or revert the advertised flows from the release branch until the P1 set is repaired. The most serious theme is **trust**: the editor must never claim a workflow loaded, a folder imported, a preview matched export, or a timeline played correctly unless the underlying system can prove that result.
