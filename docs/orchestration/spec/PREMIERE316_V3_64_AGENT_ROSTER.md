# Premiere316 V3 — 64-Agent Roster and Ownership

Use this roster with the master orchestration prompt. A role may execute in a later wave, but all 64 roles remain represented.

| ID | Pod | Role | Primary scope | Mutation boundary |
|---|---|---|---|---|
| A01 | Governance & Integration | Master Orchestrator | Own program DAG, priorities, agent deployment, gate decisions, final accountability. | Orchestration docs only; no feature code except emergency integration approval. |
| A02 | Governance & Integration | Chief Architecture Lead | Protect engine-neutral architecture, Electron boundaries, project graph, ADRs. | docs/architecture/**; schema proposals through reviewed patches. |
| A03 | Governance & Integration | Integration Lead | Review/merge pod outputs, semantic conflict resolution, shared branch ownership. | Shared integration files under explicit leases. |
| A04 | Governance & Integration | Build & Packaging Lead | Renderer/Electron build, app.asar, installer, shortcuts, build IDs, package smoke. | desktop/**, build config, packaging scripts under lease. |
| A05 | Governance & Integration | Security & Offline Lead | No hidden network, secrets, path safety, process boundaries, model-code trust. | security policies/tests; reviewed security fixes. |
| A06 | Governance & Integration | Migration Lead | Safe schema/data/project migrations, backups, legacy Last Reel compatibility. | migrations/** and migration adapters. |
| A07 | Governance & Integration | Test Strategy Lead | Global test taxonomy, regression matrix, E2E harness, baseline comparison. | tests/harness/**, test config under lease. |
| A08 | Governance & Integration | Release & Change Manager | Versioning, changelog, checkpoint integrity, release evidence, rollback plans. | docs/release/**, artifact manifests. |
| A09 | UI/UX & Desktop | UI/UX Pod Lead | Stage-specific information architecture and visual coherence. | UI pod integration branch only. |
| A10 | UI/UX & Desktop | Stage Shell Engineer | Declarative stage layout policy; remove global UI leakage. | studio shell/layout policy under exclusive lease. |
| A11 | UI/UX & Desktop | Contextual Panels Engineer | Contextual left/right panels and inspectors per stage. | panel components, stage adapters. |
| A12 | UI/UX & Desktop | Navigation & Responsive Engineer | Stage navigation groups, overflow, 100–200% zoom behavior, no blank columns. | navigation/responsive components, not Electron zoom core. |
| A13 | UI/UX & Desktop | Accessibility & Keyboard QA | Keyboard, focus, labels, zoom shortcuts, reachability, reduced motion. | accessibility fixes/tests only. |
| A14 | UI/UX & Desktop | Visual Regression Agent | Packaged screenshots at 100/150%, layout comparison, stage contamination detection. | visual tests/baselines only unless assigned narrow fix. |
| A15 | UI/UX & Desktop | Desktop Window & Preload UI Engineer | Native dialogs, window behavior, secure renderer bridge for UI needs. | preload/UI bridge only with A04 lease. |
| A16 | UI/UX & Desktop | Packaged UI UAT Verifier | Electron-only stage walkthrough, no browser acceptance. | UAT scripts/reports only. |
| A17 | Research & Screenplay | Research Room Lead | Picture Research Bible domain, workflow, approval, Delta Research. | research domain/UI under pod lease. |
| A18 | Research & Screenplay | Source & Canon Research Engineer | Source ledger, quote/provenance, confidence classes, harmonization. | source-ledger domain/tests. |
| A19 | Research & Screenplay | Historical & Social-World Engineer | Expected behavior, taboo/reversal, visible reaction, confidence, cinematic expression. | social-world domain/UI/tests. |
| A20 | Research & Screenplay | Cinematography Research Engineer | Picture-level cinematography manifesto research artifact. | research/cinematography artifacts only. |
| A21 | Research & Screenplay | Qwen Screenwriter Integration | Primary local writer, scene/chapter/full scope, structured outputs. | screenplay writer workflow/provider client. |
| A22 | Research & Screenplay | Llama QA / Story Doctor Integration | Independent QA categories, critique-first, optional rewrite. | screenplay QA workflow. |
| A23 | Research & Screenplay | Scoped Rewrite & Versioning Engineer | Stable screenplay hierarchy, fine-grained versions, scoped seven-pass, invalidation. | screenplay domain/store/migrations under lease. |
| A24 | Research & Screenplay | LM Studio Provider & UAT Engineer | Endpoint discovery, served models, streaming, cancel, telemetry, offline state. | LocalLLMProvider/LMStudioProvider and tests. |
| A25 | Breakdown, Assets & Cinematography | Breakdown Pod Lead | Research-aware approved-screenplay breakdown and pod integration. | breakdown pod branch. |
| A26 | Breakdown, Assets & Cinematography | Asset Schema & Dependency Engineer | Canonical asset specs, variants, references, fine-grained edges. | asset domain/dependency adapters. |
| A27 | Breakdown, Assets & Cinematography | Inventory UI Engineer | Categories, readiness, asset inspector, edit/merge/split/reference UX. | inventory components. |
| A28 | Breakdown, Assets & Cinematography | Visual Development Lead | Reference bibles, boards, palettes, motifs, approval workflow. | visual-development domain/UI. |
| A29 | Breakdown, Assets & Cinematography | Character Identity & Reference Engineer | Identity specs, expression/wardrobe states, reference bundles, drift rules. | character identity domain/UI/tests. |
| A30 | Breakdown, Assets & Cinematography | Production Design / Costume / Props Engineer | Locations, materials, costume, props, set dressing, continuity variants. | production-design domain/UI. |
| A31 | Breakdown, Assets & Cinematography | Cinematography Director Engineer | Manifesto, sequence visual arcs, lens/framing/lighting stage and QA. | cinematography domain/UI/tests. |
| A32 | Breakdown, Assets & Cinematography | Asset Versioning & Approval QA | Iterations, compare, canonical approval, stale/waived states, persistence. | asset QA/tests; narrow fixes. |
| A33 | Image Engines & Model Runtime | Image Runtime Pod Lead | Native image engine architecture and pod integration. | image engine integration branch. |
| A34 | Image Engines & Model Runtime | FLUX.1 Specialist | Offline components, native runtime, settings, LoRA, telemetry, warm generation. | engines/flux1/**. |
| A35 | Image Engines & Model Runtime | FLUX.2 Dev Specialist | Native Dev runtime, quantization/offload truth, multi-reference/edit capability. | engines/flux2-dev/**. |
| A36 | Image Engines & Model Runtime | Klein 4B/9B Specialist | Distilled settings, encoder cache, fast preview/production configs. | engines/flux2-klein/**. |
| A37 | Image Engines & Model Runtime | Krea 2 Specialist | Raw/Turbo native adapter, capabilities, license, prompt/control mapping. | engines/krea2/**. |
| A38 | Image Engines & Model Runtime | Component Resolver & Cache Specialist | Exact local encoder/VAE/tokenizer mapping, no network, cache validation. | model registry/component resolver. |
| A39 | Image Engines & Model Runtime | Memory, Residency & Telemetry Specialist | RAM/VRAM placement, sticky residency, fit estimates, measured telemetry. | resource scheduler/residency image portions. |
| A40 | Image Engines & Model Runtime | Image QC & Benchmark Engineer | Identity/anatomy/reference adherence, warm/cold timings, peak memory, calibration. | image QC/benchmarks/tests. |
| A41 | Performance, Prompt & Video | Performance/Video Pod Lead | Integrate Performance/Shots with compilers/video without flattening domains. | pod integration branch. |
| A42 | Performance, Prompt & Video | Performance UI & Continuity QA | IN/OUT states, warnings, locks, propagation, research/cinematography inputs. | performance UI/tests; preserve domain. |
| A43 | Performance, Prompt & Video | Shot Planner & Canonical Spec QA | Scene→beat→shot, duration/dialogue allocation, references, readiness. | shot domain/UI/tests; preserve canonical spec. |
| A44 | Performance, Prompt & Video | Qwen Prompt Compiler Engineer | Engine-specific prompt compilers from canonical specs; scoped recompilation. | prompt compiler package. |
| A45 | Performance, Prompt & Video | MiniMax H3 Native Adapter Specialist | Verified local H3 capabilities, refs/audio/duration, honest labels. | engines/minimax-h3/**. |
| A46 | Performance, Prompt & Video | LTX 2.5 Native Adapter Specialist | Native T2V/I2V/A2V/audio/quality paths, no ComfyUI. | engines/ltx2/**. |
| A47 | Performance, Prompt & Video | Video Queue & Take Review Engineer | Jobs, take versions, review, retry/cancel/pause/resume, approvals. | video queue/review components/domain. |
| A48 | Performance, Prompt & Video | Video QC & Continuity Engineer | Resolution/frame/identity/performance/audio/lip-sync/continuity checks. | video QC/tests. |
| A49 | Voice, Sound & Score | Audio/Post Pod Lead | Integrate voice, sound, score and timeline-facing audio artifacts. | audio pod integration branch. |
| A50 | Voice, Sound & Score | Qwen3-TTS Specialist | Local voice design/clone/TTS adapter, timing, telemetry, consent. | engines/qwen3-tts/**. |
| A51 | Voice, Sound & Score | VoxCPM2 Specialist | Alternate voice adapter, capabilities, streaming/48k where verified. | engines/voxcpm2/**. |
| A52 | Voice, Sound & Score | Voice/ADR UI & Consent Engineer | Profiles, auditions, line takes, pronunciation, ADR, authorization. | voice domain/UI/tests. |
| A53 | Voice, Sound & Score | Sound/Foley/Ambience Engineer | Cue prep/import/generation contracts, sync, provenance, silence. | sound domain/UI/tests. |
| A54 | Voice, Sound & Score | MiniMax Music3 Specialist | Local/remote capability truth, prompts, stems, hardware gates. | engines/minimax-music3/**. |
| A55 | Voice, Sound & Score | Score UI & Cue-Sheet Engineer | Themes, cues, versions, unscored sections, placement, approval. | score domain/UI/tests. |
| A56 | Voice, Sound & Score | Audio QA / Sync / Loudness Engineer | 48k, clipping, channels, dialogue priority, sync, loudness, stems. | audio QC/tests. |
| A57 | Timeline, Master & Reliability | Timeline/Editor Pod Lead | Controlled real editor scope and post integration. | timeline pod branch. |
| A58 | Timeline, Master & Reliability | FFmpeg & Conform Engineer | Typed FFmpeg/FFprobe jobs, proxies/originals, hardware encode, validation. | render-service/**. |
| A59 | Timeline, Master & Reliability | Master & Export Engineer | Preflight, MP4/MOV/stems/captions/checksums/archive. | master/export domain/UI/tests. |
| A60 | Timeline, Master & Reliability | Movie Readiness Engineer | Clickable completion/blocker dashboard across all stages. | readiness domain/UI/tests. |
| A61 | Timeline, Master & Reliability | SQLite / Project Graph / Provenance Engineer | Migration-safe DB, immutable media, hashes, lineage, execution records. | database/project-graph/provenance. |
| A62 | Timeline, Master & Reliability | Recovery / Queue / Diagnostics Engineer | Crash/OOM/restart/resume/logs/build state/model state. | recovery/diagnostics/queue infrastructure. |
| A63 | Timeline, Master & Reliability | Pi Movie Crew Orchestration Engineer | Profiles, councils, exact local IDs, stage-gated prepare/queue/unload. | .pi/** and app integration after foundation gate. |
| A64 | Timeline, Master & Reliability | Final Independent UAT / Red Team | End-to-end films, negative tests, no-Comfy/no-cloud proof, release veto. | UAT tests/reports only; no feature ownership. |
