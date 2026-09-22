# Astra Ultra / Local Models — Implementation Step 1 change map

Source specification: `Premiere316_V3_Two_Profile_Review_Patch(2).md`, revision 1.6 (supplied 2026-09-22). This packet preserves the original Step 1 inspection and supersedes its revision 1.1/1.2 binding snapshot with current installation evidence.

Inspection baseline: commit `35cdafb` on `codex/voice-reference-emotion`. The historical R4 review point was `90c6732`; the current branch also contains the later Cueboard implementation commit `0e2b43b`.

Status: review packet only. No profile, orchestration, approval, serializer, project-data, download, model-lifecycle, or live-generation behavior has been changed. This completes the revision 1.6 update to Implementation Step 1 and deliberately stops before Step 2.

## Executive finding

Premiere316 already has most of the reusable pieces: exact LM Studio model discovery, versioned screenplay artifacts, explicit approval functions, project persistence, dependency invalidation, media take review, immutable Director workflow review, and a narrow versioned Cueboard H3 serializer. It does **not** have the requested two-profile contract or an Astra provider, and its default movie-plan path currently behaves opposite to the requested guided default. The requested regular GAIN V1.1 Q8_0 artifact is now verified on disk and loaded, but LM Studio exposes it under an inherited served key ending in `mtp`; Step 2 must therefore persist artifact identity separately from the callable alias.

The implementation should extend the existing `Picture`, `PictureScreenplay`, `ProductFlowState`, project storage, approval functions, and media workspaces. It should not create another project database or approval system.

## Binding audit

### Astra Ultra

No callable Astra/xAI text provider exists in the current application.

- `src/lib/studio/local-llm-provider.ts` defines only a local-only provider contract (`local: true`, `cloudFallback: false`).
- `src/lib/studio/lmstudio-provider.server.ts` is the sole active text inference adapter.
- `src/lib/studio/screenplay-api.ts` and `src/lib/studio/movie-plan-api.ts` construct the LM Studio path.
- `scripts/no-cloud-runtime.test.mjs` and the Wave 1 release record intentionally assert that hosted xAI runtime paths are absent.
- There is no Astra model ID, endpoint, credential binding, capability declaration, or Ultra effort mapping in `src` or `desktop`.

Therefore **Astra Ultra is unresolved and must remain visibly unavailable until an actual configured provider binding is introduced**. Step 2 must not invent a model ID, map the display label to a Grok model, reuse LM Studio, or silently downgrade effort.

The provider change belongs behind a generalized text-provider boundary rather than inside UI components. The minimum affected surface is:

- `src/lib/studio/local-llm-provider.ts`: split reusable generation/discovery types from the LM Studio-only capability assertions, or add a sibling general provider contract.
- `src/lib/studio/lmstudio-provider.server.ts`: continue implementing only Local Models.
- `src/lib/studio/screenplay-api.ts`, `src/lib/studio/movie-plan-api.ts`, and `src/lib/studio/movie-plan-client.ts`: dispatch through the selected profile's resolved provider snapshot.
- New `src/lib/studio/production-profiles.ts` (recommended): own exactly two profile IDs, role bindings, capability status, revisions, and no-fallback resolution.
- New server-only Astra adapter/configuration module only after the real binding and supported Ultra setting are known.

### Local Models snapshot

The current application defaults are legacy Llama/Qwen-oriented rather than the requested crew:

- `src/lib/studio/model-routing.ts`: `MovieCrewRoutingProfile` has only `writer`, `qa`, and `promptEngineer`; the default is Llama 3.3 70B, Qwen is an optional family.
- `src/lib/studio/movie-plan-model.ts`: `DEFAULT_MOVIE_PLAN_MODEL` is `gptoss-120b-uncensored-hauhaucs-aggressive`, while selection without an explicit ID still prefers a Llama-family model. These two default mechanisms are inconsistent and must be replaced by profile-role resolution.
- `src/lib/studio/screenplay-models.ts`: correctly retains exact served IDs, local catalog matches, quantization, context, and status.
- `src/lib/studio/qwen-writer-identity.ts` and `src/lib/studio/exact-local-writer.ts`: enforce the current Llama/Qwen identity rules and will need role-aware replacements rather than broad family matching.

The refreshed read-only inspection on 2026-09-22 found the following relevant state:

| Requested binding | Current exact evidence | Refreshed Step 1 status |
| --- | --- | --- |
| Hermes 4 70B | Both Q6_K shards exist: `Hermes-4-70B-Q6_K-00001-of-00002.gguf` (39,953,846,688 bytes) and `...00002-of-00002.gguf` (17,934,300,608 bytes). Native key `nousresearch/hermes-4-70b`; selected variant `@q6_k`; no loaded instance | Installed — not loaded; restore architect, lead screenplay writer, and rewrite roles |
| Artemis 31B v1.1 | No matching installed file or native-catalog entry in the refreshed evidence | Optional and unavailable; retain explicit skip, never substitute |
| GAIN V1.1 | User-confirmed file `D:/AI/Models/LMStudio/DavidAU/Qwen3.8-27B-Cold-Fusion-GAIN-V1.1-NM-DAU-NEO-MAX-MTP-GGUF/Qwen3.8-27B-Cold-Fusion-GAIN-V1.1-NM-DAU-NEO-MAX-NEO-Q8_0.gguf` exists at 29,787,699,776 bytes. Native key `qwen3.8-27b-cold-fusion-gain-v1.1-nm-dau-neo-max-mtp`; Q8_0, 27B, 31,630,644,152 catalog bytes, 262,144 max context; loaded instance at 8,192 context | Loaded and selected for the shot/prompt/cue role; successful inference is not claimed. The artifact filename is regular non-MTP even though the repository folder, native key, and LM Studio label end in `mtp` |
| GPT-OSS 120B | Native key `gptoss-120b-uncensored-hauhaucs-aggressive`; MXFP4, 65,369,016,544 bytes, 131,072 max context; not loaded | Installed, requested uncensored variant preserved, not currently runnable |
| Observerx Heretic Abliterated | Exact file `RVN-BF16.gguf` (53,808,281,888 bytes); native key `qwen3.8-27b-heretic-abliterated-uncensored`; no loaded instance | Installed — not loaded; unassigned alternate only |
| Huihui Abliterated | Exact file `Huihui-Qwen3.8-27B-abliterated-bf16.gguf` (54,657,733,920 bytes); native key `huihui-qwen3.8-27b-abliterated`; no loaded instance | Installed — not loaded; unassigned alternate only |

This is a machine snapshot, not a permanent registry assertion. Runtime resolution must always refresh the native catalog and record the exact served instance. The application must not treat `/v1/models` rows as loaded; `LmStudioProvider` already correctly relies on `/api/v1/models` loaded instances.

### Revision 1.6 GAIN identity — regular artifact under an inherited MTP alias

The GAIN repository distributes regular and MTP variants. The selected regular file is:

| Decision | Exact weight filename |
| --- | --- | --- |
| Use for shot, prompt, and cue authoring | `Qwen3.8-27B-Cold-Fusion-GAIN-V1.1-NM-DAU-NEO-MAX-NEO-Q8_0.gguf` |
| Exclude | `Qwen3.8-27B-Cold-Fusion-GAIN-V1.1-NM-DAU-NEO-MAX-NEO-MTP-Q8_0.gguf` and every other actual MTP weight artifact |

LM Studio currently displays and serves the selected regular file as `qwen3.8-27b-cold-fusion-gain-v1.1-nm-dau-neo-max-mtp`. The user's screenshot and the native API both confirm that alias. The implementation must use that real callable alias after matching it to the verified regular artifact; it must not invent or rename the callable ID to a speculative non-MTP label.

Step 2 must persist at least repository identity, exact absolute artifact path, exact filename, quantization, size/hash when available, actual callable alias, and discovery timestamp as separate fields. Eligibility is determined from verified artifact identity, not a substring test on the parent folder, repository slug, display label, or served key. This allows the regular `NEO-Q8_0.gguf` to remain eligible under the inherited MTP alias while still rejecting the distinct `NEO-MTP-Q8_0.gguf`, a renamed MTP file, or an ambiguous mapping. If multiple artifacts share an alias, resolution must stop at **Needs verification** rather than guessing.

GAIN remains assigned to P5 asset/image/video prompts, shot/camera/VFX plans, and sound/music cue sheets. Hermes remains the screenplay and rewrite owner; GPT-OSS remains the semantic reviewer; Artemis remains the optional challenger. Observerx, Huihui, and TURBO-Fable remain unassigned alternates and cannot silently replace GAIN or another role.

### Refreshed availability and historical placeholder promotion

The earlier checksum/in-progress screenshot is historical. Hermes, Observerx, and Huihui now appear in the native catalog with complete files on disk. Their stable placeholder records should be promoted in place to **Installed — not loaded**, preserving prior failure/skip history while clearing stale current-error status. GAIN should be recorded as **Loaded — selected** only while its exact current loaded instance remains discoverable; a successful generation still requires the ordinary runtime request checks.

The revision 1.2 skip authorization becomes a conditional fallback, not a permanent blacklist. Refresh authoritative discovery before skipping. An offline catalog or installed-but-unloaded model is not evidence of absence. If an original entry is genuinely missing or incomplete after successful discovery, the affected inference unit may still record **Skipped — model unavailable** without substitution; dependent missing inputs remain explicit and cannot satisfy completeness checks.

### Managed sequential local execution gap

The existing provider `load()` validates an already-loaded instance, and its ordinary `unload()` retains residency. That is not yet the requested sequential crew lifecycle. Step 3 must extend the existing provider/scheduler boundary to resolve an exact eligible artifact, estimate occupancy, reuse or load the intended instance, track run-owned versus borrowed residency, physically release only run-owned predecessors when required, verify the next instance, and then submit the declared step. Tests must cover Hermes → regular GAIN Q8_0 → GPT-OSS, cancel/failure paths, and protection of unrelated user-owned instances. No lifecycle action is part of Step 1 or Step 2 configuration work.

### Shared engines

- Video selection is already separate in `Picture.selectedEngine` (`src/lib/studio/types.ts`); the default is `ltx-director`, and MiniMax H3 is catalogued separately.
- `src/lib/studio/audio-generation-catalog.ts` currently lists generic **ACE-Step 1.5** and **Stable Audio 3 Medium**, not the requested exact **ACE-Step 1.5 XL SFT** and **Stable Audio 3 Small-SFX** bindings.
- `src/lib/studio/audio-runtime.ts` reports every listed audio engine fail-closed because no verified local worker is connected.

The requested exact audio variants are therefore unresolved. Step 5 must add them only after installed files, supported inputs, and an executable adapter are verified.

## Current state and persistence paths

### Canonical project state

- `src/lib/studio/types.ts` — `Picture` is the aggregate root. It already owns screenplay, research, production, performance, prompts, media workspaces, selected engines, and project metadata.
- `src/lib/studio/store.ts` — `blankPicture`, `useStudio`, and private `migratePicture` create, persist, and hydrate projects.
- `src/lib/studio/project-storage.ts` — Zustand JSON is persisted under `premiere316-v302-c`, primarily in IndexedDB, with ordered migration/write protection.
- `src/lib/studio/project-library-client.ts` — desktop-local project folders are reconciled into the same storage path.

Step 2 should add an optional, versioned production-routing field to `Picture` and hydrate it in `migratePicture`. New projects get Astra Ultra plus Step-by-step review. Existing projects with an explicit `selectedModelId`, `pinnedWriterServedId`, or saved provider choice must keep that exact legacy selection under the Local Models profile; it must not be relabelled as Astra or rewritten to a new preferred local binding. The Local Models snapshot must bind GAIN's artifact identity and the actual LM Studio callable alias separately so the verified regular file remains usable without weakening the no-MTP policy.

The persisted run record must distinguish:

- project profile preference;
- new-run execution-mode default (always guided);
- active run's explicit mode and immutable profile/model/settings snapshot;
- per-role artifact path/identity, callable alias, availability evidence, ownership/residency, and no-MTP eligibility decision;
- current production step/unit, inputs, dependency versions, output revision, pending review, and checkpoint state;
- user approval receipt versus machine validation/checkpoint;
- cancellation/pause state and obsolete late candidates.

`Autonomous — Complete Movie Script` may be recovered for an active run, but must not become the next run's default.

### Existing artifact and approval authorities

Reuse these existing authorities rather than creating a second approval store:

- Research: `approveResearchBible`, `approvedResearchSnapshot`, and `approveResearchOrError` in `src/lib/research/bible.ts` and `src/lib/research/research-approval.ts`.
- Screenplay: `appendScreenplayVersion`, `approveCurrentScreenplay`, and `approvedScreenplayBoundary` in `src/lib/studio/screenplay.ts`.
- Asset specifications: `approveCanonicalSpec` and `approveInventoryAssetSpec` in `src/lib/production/breakdown.ts` and `src/lib/production/inventory.ts`.
- Image iterations: `reviewGeneratedIteration` and `approveCanonicalIteration` in `src/lib/production/image-iterations.ts`.
- Keyframes: `approveKeyframeIteration` in `src/lib/production/generate-gates.ts`.
- Video/audio takes: `reviewVideoTake` and `reviewAudioTake` in `src/lib/production/video-iterations.ts` and `src/lib/production/audio-iterations.ts`.
- Cueboard performance: `applyPerformanceDrafts` records an explicit applied draft but is not a general production approval receipt.
- Director submission: `desktop/director-execution.mjs` binds a review ID to a workflow SHA-256, prevents duplicate/uncertain resubmission, and submits only the reviewed immutable graph. Its review ticket is a submission gate, not authority to approve upstream writing or generated media.

### Current conflicting behavior

`src/lib/studio/product-flow.ts` currently defaults every internal review flag off (`PHASE_REVIEW_DEFAULTS`) and exposes `approvedByAutomation` as a department state. `src/components/studio/stage-views.tsx` labels per-phase review optional and starts `Build Movie Plan` as a multi-department pipeline.

`executeMoviePlan` in `src/lib/studio/movie-plan-pipeline.ts` currently:

- continues from research through prompt writing unless an optional phase checkbox pauses it;
- passes `!reviewThis("research")` into the research application path, allowing automated approval;
- calls `approveCurrentScreenplay` when screenplay/QA review is not selected;
- performs a bounded automatic screenplay correction in the default path;
- can continue into asset draft generation from the intake action.

Those branches must not be reused as guided approval. Step 3 must separate machine-complete/checkpoint state from user approval, make guided one-unit execution the default, and reserve automatic P1–P6 continuation for the explicit autonomous run contract.

## Current execution paths and gaps

### Screenplay jobs

- `src/lib/studio/screenplay-workflow.ts` — `runScreenplayWorkflow` can run one named pass or every remaining pass; it appends immutable versions and ends `READY_FOR_REVIEW`.
- `src/lib/studio/screenplay-jobs.server.ts` — `ScreenplayJobManager` owns in-memory jobs, single-operation exclusion, exact selected model checks, cancellation, role telemetry, and local resident-family handling.
- `src/lib/studio/screenplay-client.ts` / `screenplay-api.ts` — renderer/server boundary.
- `src/components/studio/screenplay-workspace.tsx` and `stage-views.tsx::ScreenplayStage` — editing, model pinning, Story Doctor, version restore, and explicit screenplay approval.

Gaps for the requested contract:

- job snapshots live only in the server process and are not restart-recoverable;
- there is no request ticket bound to profile revision, dependency hashes, source/reference versions, and step scope;
- late-response rejection is local to individual UI guards, not a common orchestration rule;
- `runScreenplayWorkflow` operates on whole-pass Fountain output, not a complete-film scene-unit plan with coverage accounting;
- the active UI has no Reject, Skip optional, Approve & run exactly next, or approved-but-paused Run next control for the production pipeline;
- no autonomous full-package coverage ledger proves every scene, shot prompt, and cue record was produced.

### Movie-plan orchestration

- `src/lib/studio/movie-plan-pipeline.ts::executeMoviePlan` is the closest current P1–P6 orchestrator.
- `src/lib/studio/product-flow.ts` stores department steps and next UI touchpoint.
- `src/lib/studio/movie-plan-stream.ts` provides token/reasoning progress only; it is not a durable run log.
- `src/components/studio/movie-plan-activity.tsx` renders transient activity.

Step 3 should evolve these instead of creating a parallel orchestrator. The durable state machine should use explicit states such as `ready`, `running`, `awaiting_review`, `approved`, `rejected`, `paused`, `canceled`, `failed`, and `stale`, with atomic/idempotent transitions. Guided execution may dispatch only the displayed unit. Autonomous execution may dispatch only the predeclared P1–P6 units within its limits and must stop before media generation.

### Dependency invalidation

- `src/lib/performance/domain.ts::buildDependencyGraph` and `applyDependencyInvalidation` already stale affected shots.
- `src/lib/emotion/integration.ts::performanceSourceKey` fingerprints the approved screenplay, scene, live nodes, assets, references, shots, Director data, beats, and voice selections.
- `isPerformanceDraftStale`, `review-guard.ts::createReviewGuard`, and `jointReviewFingerprint` reject changed/stale Cueboard work.
- production image/video/audio iteration modules preserve historical takes and explicit review state.

The new run ticket and approval receipt should reuse these source/version identities. It should invalidate actual descendants while leaving unrelated approved ancestors intact.

## Registry and Harrowing V3 findings

The repository has stable IDs across screenplay hierarchy, production assets/iterations, performance scenes/beats/shots, prompts, media jobs/takes, voice references, and Director workflows. It does **not** have one generic runtime registry implementing all documented type keys (`CHR`, `CHAR_SHEET`, `CHAR_STATE`, `LOC`, `GEO`, `SCENE`, `BEAT`, `SHOT`, `LINE`, `SILENT_BEAT`, `CAMERA`, `CONTINUITY_STATE`, `SOUND`, `MUSIC`, `REFERENCE`, `PROMPT`, `WORKFLOW`, `TAKE`, `REVIEW`). Those names currently exist mainly in the adopted production-bible documentation.

Step 4 should add a typed resolution/index layer over existing canonical records, not copy all entities into a second database. IDs continue to originate from their current owners. The index should resolve type, record ID, revision/hash, owning artifact path, and required media bytes.

The workspace contains a substantial existing Harrowing project under `projects/harrowing_of_hell`, including `project.json`, `project-linked.json`, `screenplay.md`, production screenplay revisions/review, storyboard data, workflows, references, sound/music recipes, and media. That folder is currently untracked and was not modified or staged during Step 1.

The current Harrowing screenplay contains concrete identity/source decisions, including the approved Jesus burial-linen/wound/no-crown lock, but it is not the same as the supplied proposed V3 preset in every respect (for example, the existing screenplay is dialogue-heavy). The named source documents `Harrowing_of_Hell_V3_Visual_Sound_and_Music_Direction.md` and `Harrowing_V3_Bible_Review_and_Model_Routing.md` were not found in the repository. Step 4 must reconcile the preset against actual approved project records and explicit later corrections; it must not replace the screenplay from the new specification alone.

## R4 historical-gap comparison

The historical review at `90c6732` predates commit `0e2b43b`. Current evidence changes the gap assessment as follows:

| R4 item | Current evidence | Remaining work |
| --- | --- | --- |
| Missing H3 renderer | `src/lib/emotion/serializers.ts::serializePerformance` now exports `h3-ref2va-1`; `src/lib/emotion/joint-generation.ts` writes its text into the verified H3 Ref2VA prompt node | Fixed for the narrow Cueboard Ref2VA performance path; not a complete selected-mode serializer matrix for all H3 base/reference modes |
| Writer prose vs payload separation | Cueboard `CompiledOutput`, serializer fields, and diagnostics are separate; `prompt-compiler.ts::compileEnginePromptPackage` also emits a package plus engine prompt | The generic prompt compiler remains engine-label prose and does not implement every H3 mode's official structure |
| Exact dialogue | Cueboard serializer inserts protected dialogue once and rejects duplicates/reserved markup | Extend coverage to every final selected-engine serializer and silent beat path |
| Sound/score fields | H3 Cueboard serializer preserves `overall_soundscape` and `non_diegetic_music`; `N/A` means no native score | External-score strategy and project cue links are not yet bound into every video payload |
| Authored performance sound | `makePerformanceDraft` still rejects narration, extra dialogue, nonverbal vocalizations, allowed-sound events, and `authored_sound_events` | This retained guard is correct. Source-bound post sound should use audio cue records first; any native exception needs the narrow typed capability and tests described in the specification |
| Stale proposal/reference handling | `performanceSourceKey`, `isPerformanceDraftStale`, review fingerprints, reference hashes, tombstones, and Director workflow hashes are implemented | Generalize the same version-bound ticket rule to profile runs and package approvals |

The functions explicitly named in the specification are present and must be preserved: `approvedPerformanceSource`, `makePerformanceDraft`, `isPerformanceDraftStale`, `applyPerformanceDrafts`, and `undoPerformanceDraft` in `src/lib/emotion/integration.ts`.

## Audio and media handoff map

- `src/lib/production/audio-types.ts` — `SoundCueRecord`, `AudioJob`, `AudioTake`, and `AudioWorkspace` are the existing persistence path.
- `src/lib/production/audio-iterations.ts` — cue seeding, fail-closed jobs, import, QC, review, canonical selection, and restart recovery.
- `src/components/studio/audio-generation-options.tsx` and the Score/Review surfaces in `stage-views.tsx` — current user-facing engine selection and imported-take review.
- `src/lib/production/video-types.ts` / `video-iterations.ts` — corresponding video job/take path.
- `src/lib/studio/director-execution.ts` plus `desktop/director-execution.mjs` — reviewed LTX Director workflow execution.
- `src/lib/studio/video-runtime.server.ts` — H3/LTX adapter availability reporting; keyframe-conditioned H3 remains fail-closed here.
- `desktop/native-film.mjs` — separate local MiniMax H3 text-to-video movie render path with per-shot provenance.

`SoundCueRecord` currently lacks most requested source hashes, revision links, sync landmarks, tail, narrative function, perspective, mix priority, references, exact engine settings, candidate count, and take linkage. Step 4 should migrate it compatibly before Step 5 connects any worker. Prompt approval must remain distinct from take approval.

## UI change map

Primary integration points:

- `src/components/studio/stage-views.tsx::IntakeStage`: replace the optional phase-review checkbox model with two separate selectors, explicit mode status, a guided next-unit action, and the autonomous pre-run summary/action.
- `src/components/studio/local-writer-select.tsx`: move exact-model selection into the expandable Local Models technical detail/override view; do not present it as a third profile.
- `src/components/studio/screenplay-workspace.tsx`: retain full Fountain editing/history and Story Doctor details; consume the shared run/review state for bounded actions.
- `src/components/studio/movie-plan-activity.tsx`: render durable unit progress/checkpoints and blocking conditions rather than only transient stream activity.
- Existing research, inventory, performance, prompt, Generate, Score, and Review workspaces: host the relevant complete deliverable and shared review controls without losing current previews or delete/approval controls.

The compact creative surface should show profile, mode, current unit/scope, source revision, review state, proposed next step, and the complete result. It may present the verified creative label **GAIN V1.1 — Q8_0 — regular artifact** while technical details retain the exact disk path and real LM Studio alias ending in `mtp`. Exact provider IDs, settings, reference resolution, hashes, validation, and cost/remote status belong in technical details.

## Planned file-level implementation sequence

### Step 2 — profiles and persistence

- Add `src/lib/studio/production-profiles.ts` plus focused tests.
- Extend `Picture` and `store.ts::blankPicture/migratePicture` with compatible routing/run defaults.
- Replace legacy Llama/Qwen default resolution in `model-routing.ts` and `movie-plan-model.ts` with exact role resolution while preserving legacy explicit IDs.
- Generalize provider status enough to represent unavailable Astra without fabricating a call.
- Promote the three historical placeholder records from current discovery without losing their stable IDs/history; retain the skip policy only as a conditional fallback after successful refresh.
- Persist GAIN's verified regular `...NEO-Q8_0.gguf` artifact identity separately from the real callable alias `qwen3.8-27b-cold-fusion-gain-v1.1-nm-dau-neo-max-mtp`; reject actual MTP artifacts without inventing a renamed alias.
- Add the two selectors/status/technical details in `stage-views.tsx` and supporting components.
- Keep both new execution controls non-executable until Step 3 replaces the old automatic-approval path; Step 2 is configuration/persistence only.

### Step 3 — execution and review

- Extend `ProductFlowState` (schema migration required) into a durable unit/run state.
- Refactor `executeMoviePlan`, `runScreenplayWorkflow`, and `ScreenplayJobManager` around immutable request snapshots and idempotent dispatch.
- Remove machine-created research/screenplay approval from the orchestration path.
- Add shared review actions mapped to existing approval functions.
- Add coverage, retry/revision budgets, pause/cancel/recovery, late-result quarantine, conditional unavailable-step records, missing-source propagation, affected-scope retry, managed sequential model lifecycle, and autonomous P1–P6 completion validation.

### Step 4 — authoring, registry resolution, serializers, and V3

- Add the five local crew roles and distinct role prompts; all Astra roles resolve to the single verified Astra binding.
- Add the typed existing-record resolver/index and source-bound cue migration.
- Reconcile Harrowing V3 only from project records and supplied approved sources.
- Expand selected-mode serializers only where actual adapter contracts are confirmed.

### Step 5 — media adapters

- Add exact ACE-Step XL SFT and Stable Audio Small-SFX capability records/adapters only when verified.
- Reuse video selection, Director review, video/audio workspaces, QC, previews, and canonical-take review.
- Keep every media job individually user-started and end in pending take review.

### Step 6 — integrated verification

- Run the repository's real `typecheck`, build, full/focused tests, development/built browser smoke, keyboard/mobile review flow, and adapter capability reporting.
- Distinguish mocked provider coverage from actual inference and preserve the existing R4 suites.

## Focused test map

Extend these suites rather than creating a disconnected checklist:

- Profiles/bindings/defaults: `model-routing.test.ts`, `movie-plan-model.test.ts`, new `production-profiles.test.ts`, including artifact-versus-alias classification for regular and MTP GAIN files.
- Persistence/migration/recovery: `project-storage.test.ts`, `screenplay.test.ts`, `audio-iterations.test.ts`, `video-iterations.test.ts`, including stable placeholder promotion and separate artifact/callable identity across availability refresh.
- Guided/autonomous orchestration: `movie-plan-pipeline.test.ts`, `screenplay-jobs.test.ts`, `movie-plan-stream.test.ts`, plus new run-state tests for conditional skip, dependency propagation, truthful incomplete status, stale binding snapshots, and affected-scope retry.
- Model lifecycle/ownership: extend `local-llm-provider.test.ts`, `screenplay-jobs.test.ts`, and residency tests for Hermes → regular GAIN Q8_0 → GPT-OSS, borrowed/run-owned instances, physical release verification, cancel/failure, ambiguous aliases, and zero calls to actual MTP artifacts.
- Approval/staleness/identity: `research` tests, `production/dependency-graph.test.ts`, `generate-gates.test.ts`, `performance*.test.ts`, `emotion/integration.test.ts`, `emotion/review-guard.test.ts`.
- Serializers and exact speech/sound: `emotion/r4.test.ts`, `prompt-compiler.test.ts`, `director-compiler.test.mjs`.
- Submission/idempotency/media review: `director-execution.test.mjs`, `audio-iterations.test.ts`, `video-iterations.test.ts`.
- UI/default accessibility/reload: existing responsive/stage tests plus browser interaction coverage for the two selectors and review controls.

Several current assertions must intentionally change, including `product-flow.test.ts` (“phase-review checkboxes default off”) and `movie-plan-pipeline.test.ts` (“default mode auto-approves internal research and screenplay”).

## Decisions and boundaries for Step 2

1. The actual callable Astra provider/model binding and its supported Ultra effort value must be supplied or configured. Until then, Astra Ultra can be the visible new-work default but must show a blocking setup state and make no call.
2. Use the user-confirmed regular GAIN file `D:/AI/Models/LMStudio/DavidAU/Qwen3.8-27B-Cold-Fusion-GAIN-V1.1-NM-DAU-NEO-MAX-MTP-GGUF/Qwen3.8-27B-Cold-Fusion-GAIN-V1.1-NM-DAU-NEO-MAX-NEO-Q8_0.gguf` for the GAIN role. Its current callable alias ends in `mtp`; preserve that real alias and prove eligibility from the artifact mapping rather than a label.
3. Hermes, Observerx, and Huihui are now installed according to both disk and native-catalog evidence. Promote their existing placeholder identities in place. Observerx and Huihui remain unassigned alternates; Artemis remains optional and unavailable until verified.
4. Step 2 may finish with honest unavailable provider/optional-model states, but its new controls must not execute the legacy automatic-approval pipeline before Step 3 exists.
5. Every run must refresh GAIN, Hermes, GPT-OSS, and optional Artemis from the current catalog and snapshot the exact instance/configuration. The refreshed Step 1 state is evidence, not a permanent readiness assertion.
6. The Harrowing V3 direction/routing source documents named by the specification must be imported or mapped to existing approved project revisions before preset content is written.
7. Persistent patch/rule IDs for this proposed addendum should be allocated in `docs/cueboard-r4/RULE_REGISTER.md` only when the addendum is adopted; Step 1 does not claim those IDs.

## Step 1 verification boundary

- Inspected current repository instructions, source, tests, current branch history, R4 implementation record, provider adapters, live LM Studio native catalog, installed relevant model files, Harrowing project records, serializers, audio/video paths, approvals, and persistence.
- Compared specification revisions 1.2 and 1.6 and incorporated refreshed downloads, conditional placeholder promotion, managed sequential lifecycle requirements, and artifact-level no-MTP enforcement into the planned persistence, orchestration, UI, and test surfaces.
- Verified the user-supplied GAIN path exists and names the regular `NEO-Q8_0.gguf` artifact at 29,787,699,776 bytes. Verified LM Studio exposes that artifact through the inherited `...-mtp` native key and currently reports one loaded instance.
- Verified complete Hermes shards plus installed Observerx, Huihui, and GPT-OSS files/native catalog entries. No model was loaded, unloaded, or called by this inspection.
- No model download was started, repaired, canceled, or retried.
- No media was generated, submitted, changed, approved, or deleted.
- No existing project record, source text, reference, engine choice, or approval was changed.
- No application code was changed; build/browser gates are deferred until an implementation step changes runtime behavior.
