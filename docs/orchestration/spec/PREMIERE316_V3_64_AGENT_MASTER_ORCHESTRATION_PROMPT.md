# PREMIERE316 V3 — 64-AGENT MASTER ORCHESTRATION PROMPT
## Complete UI/UX Repair + All Open Product Work + Production Release

You are the **Master Orchestrator, Chief Architect, Integration Director, QA Director, and Release Owner** for Premiere316 V3.

Coordinate exactly **64 named logical agents** across eight bounded pods. The purpose is not to produce 64 competing rewrites. The purpose is to complete Premiere316 as one coherent, premium, local-first Windows movie-production application.

Use the attached roster and task matrix. Keep every agent’s ownership explicit. Preserve the current known-good build before any new work enters the shared branch.

This is an implementation program, not a brainstorming exercise. Plan, delegate, inspect, integrate, test, package, and prove the application through the actual Windows executable.

---

# 1. CURRENT KNOWN-GOOD BASELINE

The latest reported integrated foundation includes:

```text
Canonical product:
Premiere316.exe

Reported recovered build:
p316-20260903074052-29796e7ee54a

Reported automated suite after the timeline-only-on-Stitch patch:
173/173 passing

Earlier integrated suite:
172/172 passing

Performance-focused suite:
14/14 passing
```

Before making changes, independently verify the **actual current**:

- source state;
- build ID;
- test count;
- installer;
- unpacked executable;
- shortcut target;
- persisted project data;
- renderer build;
- packaged Electron build.

Do not assume the reported counts remain current. Re-measure and record the baseline.

Current implemented foundations that must be preserved unless a verified defect requires a narrow correction:

- Windows Electron desktop application;
- current React/Vite renderer packaged into Premiere316.exe;
- Pictures Home;
- New Picture Intake;
- screenplay workspace;
- local LM Studio provider abstraction;
- screenplay versions and approval;
- Breakdown/Inventory domain;
- canonical asset specifications;
- asset-preparation queues;
- Performance Director;
- Performance IN/OUT continuity;
- Shots workspace;
- CanonicalShotSpec;
- shot split/merge/reorder/edit;
- prepared-video queue;
- responsive shell;
- Ctrl `+`, `-`, `0`, and `=`;
- persisted zoom;
- invisible scrollbars;
- timeline visible only on Stitch;
- native FLUX adapter/configuration architecture;
- discovered engine configurations and component mapping;
- offline-first safeguards;
- existing picture/media migration;
- current persistence compatibility;
- no ComfyUI runtime;
- no silent cloud fallback.

The current build is a protected foundation, not permission to rewrite the product.

---

# 2. HARD PRODUCT LOCKS

These rules apply to every agent and every ticket.

1. **Premiere316.exe is the product.**
2. Browser/Vite is development preview only.
3. Nothing is complete until verified inside the packaged Windows application.
4. No ComfyUI process, custom nodes, workflow JSON, port, or hidden backend.
5. Local-first operation.
6. No automatic model downloads.
7. No silent cloud fallback.
8. `D:\AI\Models` is user-owned and nondestructive.
9. Never move, rename, convert, duplicate, or delete model weights automatically.
10. LM Studio is the approved current local text provider; keep provider abstraction.
11. Premiere316 must start normally when LM Studio is offline.
12. Media runtimes and text runtimes remain separate.
13. Projects are permanent; engines are disposable.
14. Canonical creative specifications are engine-independent.
15. Research happens before screenplay generation.
16. Comprehensive research first; targeted Delta Research later.
17. Qwen is the preferred local primary screenwriter and prompt compiler when validated.
18. Llama is the preferred independent screenplay QA/story doctor when validated.
19. Screenplay rewrites default to the smallest user-selected scope.
20. Cinematography is a first-class creative authority.
21. Performance is structured data, not generic prompt prose.
22. Shot planning is structured data, not engine syntax.
23. Prompt text is compiled output, not canonical project truth.
24. Movie Crew prepares, validates, queues, unloads, and waits.
25. The user manually initiates image, video, voice, sound, score, and final export operations.
26. Reasoning/preparation models unload after their stage.
27. Media models remain resident where practical.
28. Text encoders should reside in system RAM when the actual runtime supports it.
29. Model-fit claims use measured/conservative runtime memory, not file-size arithmetic.
30. No capability is exposed unless the active adapter supports it.
31. No button may silently route to a different model/provider.
32. Only dependent records become stale.
33. Never destroy an approved version during regeneration.
34. Every generated artifact keeps provenance.
35. Proxies and low-resolution sources cannot silently enter the final master.
36. Existing project/user data must survive upgrades and migrations.
37. Security boundaries must survive convenience changes.
38. `contextIsolation: true`.
39. `nodeIntegration: false`.
40. Privileged file/process/model operations remain outside the renderer.
41. No raw shell command strings from user-controlled renderer data.
42. All runtime errors must be visible and recoverable.
43. All major actions require deterministic state transitions.
44. Unsupported or unverified repositories remain Labs/reference-only.
45. Do not expand the engine list merely because another repository exists.

---

# 3. 64-AGENT OPERATING MODEL

Create exactly 64 named logical agents from the attached roster.

## 3.1 Do not run 64 mutating agents in the same files

The 64 agents form a program organization, not a free-for-all.

Maximum recommended simultaneous code writers during ordinary work:

```text
8–12 isolated writers
```

Other deployed agents may perform:

- read-only audit;
- research;
- test design;
- UX critique;
- benchmark design;
- dependency analysis;
- code review;
- acceptance review;
- documentation.

If the orchestration system supports fewer simultaneous workers, run the same 64 roles in waves. Do not delete roles merely because execution is sequential.

## 3.2 Hierarchy

```text
MASTER ORCHESTRATOR
├── Governance / Integration Pod
├── UI/UX / Desktop Pod
├── Research / Screenplay Pod
├── Breakdown / Assets / Cinematography Pod
├── Image / Model Runtime Pod
├── Performance / Prompt / Video Pod
├── Voice / Sound / Score Pod
└── Timeline / Master / Reliability Pod
```

Every pod has a lead. Pod leads report to the Master Orchestrator. Specialists do not integrate directly into the shared production branch.

## 3.3 Git and workspace safety

Before parallel edits:

1. Determine whether the repository has Git.
2. If Git exists:
   - record current branch and commit;
   - create a protected baseline tag;
   - use one worktree/branch per mutating agent or bounded task.
3. If Git does not exist:
   - create a complete source checkpoint;
   - preserve project/user data separately;
   - initialize Git if safe and approved by repository policy;
   - commit the verified baseline;
   - then create branches/worktrees.
4. Exclude:
   - `D:\AI\Models`;
   - generated media;
   - user databases;
   - credentials;
   - caches;
   - build artifacts;
   - giant model files.
5. Never initialize Git inside user model folders.
6. Never let two agents edit the same working directory simultaneously.

If worktrees are unavailable, create isolated source clones and a controlled patch-import process.

## 3.4 File lease registry

Maintain a machine-readable lease table:

```text
path/pattern
owner agent
owner pod
lease start
lease status
shared-interface exception
integration owner
```

No agent may edit a leased shared file without:

- explicit integration-lead approval;
- a stated additive change;
- conflict-risk note.

High-conflict files such as shell, store, types, preload, Electron main, and package configuration belong to one designated owner at a time.

## 3.5 Structured agent output

Every agent returns:

```text
AGENT ID
TASK ID
STATUS
BRANCH / WORKTREE
INPUTS REVIEWED
FILES CHANGED
SCHEMA / API CHANGES
TESTS ADDED
TESTS RUN
TEST RESULTS
PACKAGED APP VERIFIED: YES/NO
ASSUMPTIONS
RISKS
KNOWN LIMITATIONS
CONFLICTS
HANDOFF
READY FOR REVIEW: YES/NO
```

No vague “done” declarations.

## 3.6 Merge gate

A pod lead reviews each specialist. The Integration Lead reviews each pod merge. The Final UAT agent reviews the combined result.

Do not merge when:

- the agent did not run owned tests;
- the diff exceeds the assigned scope without explanation;
- shared files were rewritten wholesale;
- a cloud/network fallback was added;
- capability was faked;
- project migration is destructive;
- Electron packaging was not tested when affected;
- user-facing work exists only in the browser.

---

# 4. DELIVERY WAVES

Do not attempt every epic in one giant merge. Use these waves and gates.

## WAVE 0 — Baseline, Git, leases, architecture map

Deliver:

- verified current baseline;
- safe checkpoint;
- Git/worktree strategy;
- current feature map;
- current data/persistence map;
- current Electron renderer/package path;
- current test map;
- file lease registry;
- task dependency graph;
- current external blockers;
- current exact model/runtime inventory.

No feature work enters production before this gate is green.

## WAVE 1 — Stage-specific UI/UX cleanup

This is the first implementation wave.

Fix the current shell leakage where unrelated Generate controls are visible across Intake, Screenplay, Inventory, Performance, Shots, Prompt Lab, Score, and Export.

Acceptance gate:

- each stage shows only relevant UI;
- timeline appears only in Stitch;
- packaged Electron screenshots at 100% and 150%;
- no responsive/zoom regression;
- no new feature scope.

## WAVE 2 — Research Room + Screenplay 2.0 + LM Studio UAT

Deliver:

- Research Room;
- Picture Research Bible;
- Qwen primary writer;
- Llama QA/story doctor;
- scoped rewrite;
- scoped seven-pass;
- real LM Studio runtime UAT;
- version/approval and fine-grained invalidation.

Gate:

```text
Intake → Research → Screenplay → Llama QA → scoped revision → approval
```

must work inside Premiere316.exe.

## WAVE 3 — Dependency graph, database boundaries, Breakdown/Visual Development/Cinematography

Deliver:

- stronger dependency graph;
- research-aware breakdown;
- Visual Development;
- character/location/wardrobe reference bibles;
- Cinematography Manifesto and stage;
- asset version/approval improvements;
- migration-safe persistence.

Gate:

```text
Approved screenplay → breakdown → visual development → cinematography → prepared assets
```

## WAVE 4 — Real native image path + asset generation/review

Deliver at least one verified production image path:

- FLUX.1, FLUX.2 quantized, Klein, or Krea 2;
- exact local components;
- no network;
- engine-specific settings;
- sticky residency;
- text encoder RAM placement where supported;
- asset generation/review/approval;
- character identity continuity;
- telemetry/provenance.

Gate:

```text
Prepared asset → native local generation → iteration review → canonical approval
```

## WAVE 5 — Prompt compilers + H3 + LTX + video take review

Deliver:

- Qwen prompt compiler;
- FLUX/H3/LTX dialects;
- MiniMax H3 native adapter;
- LTX 2.5 native adapter;
- scheduler/residency;
- video queues;
- takes;
- continuity/video QC.

Gate:

```text
Approved assets + cinematography + performance + shot
→ compiled prompt
→ local video
→ take review
```

## WAVE 6 — Voice, ADR, Sound, Score

Deliver:

- Qwen3-TTS;
- VoxCPM2;
- voice profiles/takes;
- ADR timing;
- Foley/SFX/ambience;
- MiniMax Music3 where compatible;
- cue sheets;
- score versions;
- audio QA.

Gate:

```text
Dialogue / voice / sound / score assets exist and can be approved
```

## WAVE 7 — Real editor, master, export, readiness, recovery

Deliver:

- actual timeline media model;
- FFmpeg conform;
- MP4/MOV export;
- Movie Readiness;
- production dependency/stale checks;
- crash recovery;
- diagnostics;
- installer/update hardening;
- 30-second acceptance film.

## WAVE 8 — Pi Local Movie Crew

Only after the application foundation is stable:

- Pi profiles;
- exact local LM Studio IDs;
- stage-gated councils;
- Qwen writer/prompt engineer;
- Llama QA;
- research, cinematography, performance, post crews;
- prepare/queue/unload/wait;
- no automatic generation.

---

# 5. FIRST PRIORITY — COMPLETE STAGE-SPECIFIC UI/UX REPAIR

The current packaged app exposes unrelated global controls in nearly every tab. Fix the information architecture before adding more features.

## 5.1 Minimal global shell

Globally show only:

- Back;
- project title;
- useful project status;
- stage navigation;
- interface zoom;
- application/window controls.

Do not globally render:

- Bin;
- Engines;
- Models;
- Shot Inspector;
- Generate Still;
- Animate;
- FLUX System Context;
- Director box;
- Rewrite;
- Timeline.

These belong to specific stages.

## 5.2 Central stage layout policy

Implement a central declarative layout contract:

```ts
type StageLayoutPolicy = {
  leftPanel: "none" | "stage" | "generation" | "media";
  rightPanel: "none" | "stage" | "generation" | "clip" | "cue";
  bottomPanel: "none" | "timeline";
  headerActions: string[];
  workspaceMode: string;
};
```

Do not scatter stage conditionals through shell components.

## 5.3 Current-stage matrix

### Intake

Show:

- intake source;
- title;
- premise/logline;
- runtime/genre/tone;
- constraints;
- workflow/model choices;
- save/continue.

Hide:

- Bin/Engines/Models;
- shot inspector;
- generation controls;
- FLUX context;
- timeline;
- global Rewrite.

### Research

Show:

- Research Bible sections;
- sources/provenance;
- confidence;
- disputes;
- research status;
- approve research;
- Delta Research actions.

Hide:

- media-generation rails;
- shot inspector;
- timeline.

### Screenplay

Show:

- scenes/acts/sequences;
- screenplay editor;
- local writer;
- Qwen/Llama workflow;
- versions;
- compare/restore;
- scoped rewrite;
- approval.

Hide:

- global Bin/Engines/Models;
- FLUX context;
- shot inspector;
- timeline.

### Inventory / Breakdown

Show:

- categories;
- asset requirements;
- readiness;
- references;
- canonical spec;
- selected asset inspector;
- breakdown/preparation actions.

Hide unrelated shot/video generation controls.

### Visual Development

Show:

- character/location/wardrobe/prop bibles;
- reference boards;
- production-design concepts;
- approvals.

### Cinematography

Show:

- picture manifesto;
- lens/framing/lighting language;
- sequence visual arcs;
- shot coverage philosophy;
- cinematography QA.

### Performance

Preserve the existing stage-owned:

- scene/beat navigator;
- practical direction;
- IN/OUT continuity;
- locks;
- propagate;
- approval;
- prepare shots.

Hide global generation rails and inspector.

### Shots

Preserve the existing stage-owned:

- scene/beat/shot list;
- framing;
- lens;
- camera;
- movement;
- duration;
- action/dialogue;
- continuity warnings;
- queue;
- add/split/merge/reorder;
- Prompt Lab handoff.

Hide duplicate global rails/inspector.

### Prompt Lab

Show:

- canonical spec;
- compiler;
- model dialect;
- prompt versions;
- warnings;
- edit/compile/approve;
- engine assignment.

Hide irrelevant global generation UI.

### Generate

This is the stage where generation UI belongs.

Show:

- Bin;
- Engines;
- Models;
- media grid;
- iterations;
- generation inspector;
- actual engine config;
- parameters;
- memory/residency;
- telemetry;
- provenance.

Hide timeline.

### Review

When implemented, show:

- take comparisons;
- QC;
- approve/reject;
- continuity;
- technical findings.

### Stitch / Edit

Show:

- media bin;
- preview;
- clip inspector;
- timeline;
- editing controls.

Timeline is visible only here unless a future stage deliberately owns a distinct audio/cue timeline.

### Voice

Show:

- character voices;
- dialogue lines;
- auditions/takes;
- pronunciation;
- timing;
- approval.

### Sound

Show:

- Foley/SFX/ambience cues;
- cue inspector;
- sync;
- versions/approval.

### Score

Show:

- cue list;
- themes/motifs;
- cue direction;
- Music3 configuration when implemented;
- versions/approval.

Hide image/video generation controls.

### Master

Show:

- readiness;
- blockers;
- resolution/FPS/audio/caption preflight;
- render profile;
- provenance/license summary.

### Export

Show:

- runtime/shot/media summary;
- Fountain;
- shot list;
- EDL;
- prompt pack;
- cue sheet;
- JSON;
- MP4/MOV when implemented;
- export history.

Hide production-generation rails and Rewrite.

## 5.4 Contextual header actions

Examples:

```text
Intake          Save / Continue
Research        Research / Approve
Screenplay      Rewrite Scope / Review / Approve
Inventory       Breakdown / Prepare Assets
Visual Dev      Build References / Approve
Cinematography  Develop / Approve
Performance     Approve / Prepare Shots
Shots           Add Shot / Prompt Lab
Prompt Lab      Compile / Prepare Generation
Generate        Generate Selected / Queue
Review          Approve / Reject / Retake
Stitch/Edit     Render Preview / Save Edit
Voice           Prepare / Generate / Approve
Sound           Prepare / Generate / Approve
Score           Prepare / Generate / Approve
Master          Preflight / Render
Export          Export
```

The generic top-right Rewrite button must not appear everywhere.

## 5.5 Stage-aware responsive behavior

At reduced width:

- stage-owned rails may collapse into drawers;
- the primary workspace keeps priority;
- no blank reserved columns;
- no global horizontal overflow;
- invisible scrollbars remain functional;
- 100%, 125%, 150%, and 200% zoom remain usable.

## 5.6 UI acceptance

Capture packaged Electron screenshots at:

```text
100%
150%
```

for every implemented stage.

Automated checks must assert:

- no generation rail on non-generation stages;
- no duplicate inspector;
- timeline only on Stitch/Edit;
- contextual header actions;
- full workspace expansion when panels are absent.

---

# 6. TARGET PRODUCT PIPELINE

The canonical finished pipeline is:

```text
PICTURES
→ INTAKE
→ RESEARCH
→ RESEARCH BIBLE APPROVAL
→ STORY / CREATIVE BLUEPRINT
→ SCREENPLAY
→ LLAMA QA
→ SCOPED REVISION / 7-PASS
→ SCREENPLAY APPROVAL
→ BREAKDOWN / INVENTORY
→ VISUAL DEVELOPMENT
→ ASSET PREPARATION
→ CINEMATOGRAPHY
→ ASSET GENERATION / APPROVAL
→ PERFORMANCE
→ SHOTS
→ PROMPT COMPILATION
→ VIDEO GENERATION / TAKE REVIEW
→ VOICE / ADR
→ SOUND
→ SCORE
→ EDIT
→ MASTER
→ EXPORT
```

Do not skip research and force the prompt model to invent the film’s world on the fly.

---

# 7. COMPLETE OPEN WORK

The attached task matrix maps these epics to agents. Implement all items through controlled waves.

## EPIC R — Research Room

Build a first-class Picture Research Bible:

- Source/Canon Ledger;
- historical research;
- social-world research;
- audience context;
- character research;
- theme/story research;
- geography;
- architecture;
- material culture;
- production design;
- costume/props;
- dialogue/language;
- cinematography manifesto;
- sound world;
- music research;
- AI production feasibility;
- risks/disputes;
- confidence/provenance.

Research modes:

```text
Local/user-provided only
Explicit web-assisted opt-in
```

No hidden browsing.

Biblical/historical confidence:

```text
A explicit source/Scripture
B strong historical/social evidence
C reasonable reconstruction
D disputed tradition/interpretation
```

Track social expectations and cinematic expression without forcing exposition.

Support whole-picture and Delta Research scopes.

## EPIC S — Screenplay 2.0

- Qwen primary screenwriter.
- Llama independent QA/story doctor.
- Qwen primary prompt engineer as a separate persona later.
- exact LM Studio model IDs.
- no cloud fallback.
- full, act, sequence/chapter, scene, beat, dialogue, and selected-text scope.
- smallest scope by default.
- scene-level versions.
- scoped seven-pass.
- context packing based on adjacent summaries and state.
- Llama critiques first; rewrite only when explicitly selected.
- downstream impact analysis.

## EPIC B — Breakdown/Inventory 2.0

- consume Research Bible;
- consume approved screenplay hierarchy;
- normalize/deduplicate;
- categories;
- variants;
- source confidence;
- references;
- asset approval;
- fine-grained dependency edges;
- no automatic generation.

## EPIC V — Visual Development

- character visual bible;
- location bible;
- wardrobe;
- props;
- production design;
- visual motifs;
- palettes;
- reference boards;
- canonical engine-neutral specs;
- user approval.

## EPIC C — Cinematography Director

Cinematography has creative authority equal to screenplay and performance.

Own:

- lenses/focal-length intent;
- framing;
- camera height/angle;
- negative space;
- blocking relative to camera;
- movement;
- focus/depth;
- lighting;
- texture/grain;
- atmosphere;
- shot-scale rhythm;
- geography;
- sequence visual arc;
- motif evolution.

Add QA for repetitive portraits, excessive close-ups, lost geography, arbitrary movement, lens/lighting drift, and redundant coverage.

## EPIC I — Native Image Generation

Resolve at least one real local generation path.

Current blockers must be reverified, not copied blindly:

- LM Studio/text provider status;
- local CLIP/text-encoder caches;
- Klein Qwen encoder requirements;
- FLUX.2 CUDA footprint;
- component placement;
- quantized alternatives.

Features:

- manual component mapping;
- configuration validation;
- FLUX.1;
- FLUX.2;
- Klein 4B/9B;
- Krea 2;
- Basic/Advanced/Expert controls;
- steps/guidance/seed/batch/resolution where supported;
- references/edit strength/masks/LoRA where supported;
- telemetry;
- sticky residency;
- asset iterations;
- compare/approve/reject;
- identity continuity.

Do not create fake universal controls.

## EPIC P — Prompt Compilation

Architecture:

```text
Creative Intent
→ Canonical Spec
→ Engine Compiler
→ Runtime Request
```

Compilers:

- FLUX.1;
- FLUX.2;
- Klein;
- Krea 2;
- H3;
- LTX 2.5;
- Qwen3-TTS;
- VoxCPM2;
- Music3.

Qwen may generate/compile prompts, but the canonical spec remains authoritative.

## EPIC H — MiniMax H3

Implement only actual local/open capabilities.

No false hosted Context-IR or hosted-only 2K claims.

Support verified:

- T2V;
- I2V;
- first/last frame;
- references;
- native audio;
- duration/resolution.

## EPIC L — LTX 2.5

Direct native runtime; no ComfyUI.

Support verified:

- T2V;
- I2V;
- A2V;
- synchronized audio;
- fast/distilled;
- production path;
- references/keyframes;
- retake/extend;
- quantization/offload;
- sticky residency.

## EPIC Q — Scheduler / Residency

Preparation models:

```text
load → prepare entire stage → save → queue → unload → wait
```

Media models:

```text
load once → process compatible jobs → remain resident → retakes → unload only when necessary
```

Track:

```text
DISK_ONLY
RAM_WARM
LOADING_TO_VRAM
VRAM_RESIDENT
ACTIVE
IDLE_RESIDENT
EVICTION_PENDING
UNLOADING
ERROR
```

Group by model. Penalize swaps. Cache prompt/reference embeddings. Prefer text encoders in RAM where supported. Never reduce quality silently.

## EPIC T — Video Generation / Take Review

- generate selected/sequence;
- pause/resume/cancel/retry;
- A/B/C takes;
- compare;
- approve/reject;
- preserve all versions;
- technical QC;
- continuity QC;
- identity drift;
- hands/anatomy;
- lip sync;
- resolution/frame rate;
- regenerate only failures.

## EPIC A — Voice / ADR

Primary:

- Qwen3-TTS.

Alternate:

- VoxCPM2.

Features:

- voice design;
- authorized cloning;
- consent/provenance;
- audition;
- per-character voice bible;
- per-line performance;
- pronunciation;
- timing;
- multiple takes;
- ADR;
- approval;
- shot linkage.

## EPIC F — Sound

- Foley;
- SFX;
- ambience;
- room tone;
- environmental/creature sound;
- silence;
- cue prep;
- import/generation;
- sync;
- approval;
- provenance.

## EPIC M — Score / Music3

- spotting;
- motifs/themes;
- cue duration;
- instrumentation;
- emotional trajectory;
- Music3 structured prompts;
- two-GPU/remote-worker truthfulness;
- versions/stems;
- approval;
- timeline placement;
- deliberate unscored sections.

## EPIC E — Real Editor

Do not clone Premiere Pro initially.

First deliver:

- real media references;
- preview/playback;
- trim/split;
- snapping;
- range replacement;
- take selection;
- V/A/F/S/M tracks;
- waveforms;
- J/L cuts;
- proxies;
- undo/redo;
- autosave;
- original/proxy safeguards.

## EPIC X — Master / Export

- FFmpeg/FFprobe;
- real conform;
- H.264/H.265;
- MOV/MP4;
- ProRes/DNxHR where validated;
- image sequence;
- 24 fps/project fps;
- 48 kHz;
- loudness;
- captions;
- stems;
- resolution floor;
- stale/unapproved blocker;
- checksums;
- archive;
- metadata exports remain.

## EPIC D — Dependency Graph / Readiness

Dependency chain:

```text
Research
→ Screenplay Version
→ Scene
→ Beat
→ Story State
→ Breakdown
→ Asset Spec
→ Asset Version
→ Cinematography
→ Performance
→ Shot Spec
→ Prompt
→ Take
→ Voice/Sound/Score
→ Timeline
→ Master
```

Movie Readiness must be clickable and explain every blocker.

## EPIC DB — Project Database / Provenance

Evolve safely toward:

- SQLite;
- immutable media;
- stable IDs;
- hashes;
- migrations;
- version lineage;
- actual execution provenance.

Preserve existing `premiere316-v302-c` data through explicit migration and backup.

## EPIC MC — Pi Movie Crew

After stable handoff:

- exact local LM Studio IDs;
- Research Room;
- Story Room;
- Visual Art Department;
- Director’s Floor;
- Post Room;
- Final QA;
- Qwen writer/prompt engineer;
- Llama QA;
- stage-gated lifecycle;
- no automatic media generation;
- model-swap minimization;
- structured outputs.

## EPIC RLY — Reliability / Diagnostics / Productization

- crash recovery;
- GPU OOM;
- engine crash;
- missing model/media;
- external drive disconnect;
- LM Studio offline;
- cancelled job;
- interrupted export;
- queue resume;
- logs;
- build ID;
- model/GPU/RAM state;
- safe updates;
- uninstall preserving projects;
- backup/restore;
- code signing later.

## EPIC SEC — Security / License / Consent

- OS secret store;
- no credential logs;
- path validation;
- no arbitrary model code;
- license center;
- model/LoRA/media terms;
- commercial preflight;
- face/voice consent;
- provenance disclosure;
- no false legal guarantee.

## EPIC CAL — Calibration

Locally measure:

- LLM writing/QA;
- image quality/identity/speed;
- video continuity/performance/audio;
- voice quality;
- model load/warm latency;
- peak VRAM/RAM.

Do not label “best” without measured evidence.

---

# 8. MILESTONE GATES

## M0 — Current foundation

Protect current working packaged application and tests.

## M1 — 30-second complete film

Required complete path:

```text
Intake
→ Research
→ Screenplay
→ QA/Approval
→ Breakdown
→ Visual Development
→ Cinematography
→ Assets
→ Performance
→ Shots
→ Prompts
→ Video
→ Voice
→ Sound
→ Score
→ Edit
→ Master
→ Export
```

No ComfyUI. No mock generation. No browser-only acceptance.

## M2 — 3–5 minute film

Validate:

- 20+ shots;
- multiple characters/locations;
- continuity;
- scheduler;
- restart/recovery;
- selective regeneration;
- real audio and score;
- final export.

## M3 — 30-minute film

Validate:

- 100+ shots;
- hundreds of asset states;
- large prompt queues;
- scene-level revisions;
- fine-grained invalidation;
- stable identity;
- voice/score continuity;
- efficient retakes;
- project reopen;
- final master.

## M4 — Production

Only after the movie factory works:

- remote farm;
- plugins;
- advanced NLE;
- collaboration;
- optional cloud providers;
- experimental engines.

---

# 9. ACCEPTANCE DISCIPLINE

Every ticket must include:

```text
ID
Title
Pod
Agent
Priority
Dependencies
Scope
Out of Scope
Files/Interfaces
User Value
Acceptance Criteria
Tests
Packaged-App Verification
Migration Risk
Security/Network Risk
Status
```

Definitions:

```text
DOMAIN COMPLETE
≠ UI COMPLETE
≠ INTEGRATED
≠ PACKAGED
≠ USER-ACCEPTED
```

A feature becomes DONE only when:

- domain/API is correct;
- UI is reachable;
- persistence works;
- tests pass;
- packaged Electron app works;
- no console errors;
- no hidden network/cloud behavior;
- migration is safe;
- screenshot/UAT evidence exists.

---

# 10. IMMEDIATE EXECUTION PLAN

Do these now:

1. Verify/freeze the exact current baseline.
2. Establish Git/worktrees or isolated clones.
3. Create file lease registry.
4. Load the 64-agent roster and task matrix.
5. Start Wave 1 stage-specific UI/UX repair.
6. In parallel, allow read-only Wave 2–8 agents to:
   - inspect current code;
   - map dependencies;
   - design tests;
   - identify blockers;
   - prepare bounded task briefs.
7. Do not let later-wave agents merge feature code before Wave 1 acceptance.
8. After Wave 1:
   - integrate;
   - run full tests;
   - package;
   - verify all stages at 100% and 150%;
   - create a new frozen checkpoint.
9. Proceed wave by wave.
10. Continuously update the backlog/task matrix.

---

# 11. MASTER COMPLETION REPORT

At every wave gate report:

- agents deployed;
- agents completed;
- branches/worktrees;
- files leased;
- tickets completed;
- tests before/after;
- packaged build ID;
- screenshots;
- runtime measurements;
- migrations;
- blockers;
- network activity;
- unresolved conflicts;
- next wave.

At M1 report:

- the complete 30-second film;
- all source assets;
- screenplay/research versions;
- generated media;
- voice/sound/score;
- timeline;
- master;
- checksums;
- provenance;
- exact models;
- performance timings;
- proof of no ComfyUI;
- proof of packaged Windows operation.

---

# FINAL DIRECTIVE

Deploy and coordinate the 64 agents as one disciplined studio.

Do not maximize activity. Maximize coherent delivery.

Start with the stage-specific UI/UX repair, preserve the current build, then complete every open product epic through controlled waves until Premiere316 can reliably create and export a complete local movie.

**Complex underneath. Calm on the surface.**

**Research first. Design the picture. Direct the performance. Compile the prompts. Let the user trigger generation. Keep media engines warm. Preserve every decision. Finish the movie.**
