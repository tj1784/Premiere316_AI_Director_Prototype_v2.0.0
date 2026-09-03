const ROOT = "D:/Projects/Premiere316_v3";
const SPEC = ROOT + "/docs/orchestration/spec";
const CONTROL = ROOT + "/docs/orchestration";
const WAVE1 = ROOT + "/docs/release/wave1-gate.md";
const PRIOR = "C:/Users/teeja/.pi/agent/sessions/--D--Projects-Premiere316_v3--/subagent-artifacts/outputs/8cb6467d-f37c-45c2-9844-8f2a8ca33b5c";
const HEAD = "18c6bbb";

const verdictSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "blockerKind", "summary", "findings"],
  properties: {
    verdict: { type: "string", enum: ["pass", "blocked"] },
    blockerKind: { type: "string", enum: ["none", "code", "external-runtime", "data", "security", "packaging"] },
    summary: { type: "string" },
    findings: { type: "array", items: { type: "string" }, maxItems: 30 }
  }
};

function contract(wave, focus) {
  return "TARGET: " + ROOT + " at protected Wave 1 checkpoint " + HEAD + ".\n" +
    "READ FIRST: " + SPEC + "/PREMIERE316_V3_64_AGENT_MASTER_ORCHESTRATION_PROMPT.md; " +
    SPEC + "/PREMIERE316_V3_64_AGENT_ROSTER.md; " + SPEC + "/PREMIERE316_V3_STAGE_LAYOUT_MATRIX.md; " +
    CONTROL + "/task-status.json; " + CONTROL + "/wave-status.json; " + CONTROL + "/file-leases.json; " + WAVE1 + ".\n" +
    "WAVE: " + wave + ". FOCUS: " + focus + "\n" +
    "HARD LOCKS: Premiere316.exe is the product; local-first; no automatic model downloads; never auto-load an LM Studio model; never mutate/move/rename/copy/delete D:/AI/Models; no ComfyUI process/code/workflow/port; no silent cloud fallback; generation is explicitly user-triggered; contextIsolation true; nodeIntegration false; renderer receives no shell/filesystem/process primitive; preserve premiere316-v302-c and The Last Reel; additive migrations only; preserve 100-200% zoom; one writer in this cwd at a time. Browser evidence is supplemental only.\n" +
    "If a required exact operator-served model or native runtime is unavailable, implement and verify the honest fail-closed product path, report EXTERNAL-RUNTIME BLOCKED, and do not waive the packaged gate or authorize the next wave. Never fake media or mark a disabled adapter complete.";
}

const planning = await runs.all([
  {
    key: "plan-governance",
    agent: "oracle",
    task: contract("2-8", "Act as A03/A05/A06. Re-audit the current Wave 1 checkpoint and produce a concise cross-wave architecture, security, migration, lease, packaging, and stop-condition directive. Reconcile the original captain reports under " + PRIOR + "/captains. Read only; no edits or process launches."),
    output: "plans/governance.md",
    outputMode: "file-only"
  },
  {
    key: "plan-wave2",
    agent: "p316-captain",
    task: contract("2", "Act as A17 and account for assigned A18-A25/A28/A30 reports. Refresh the exact implementation DAG for Research Room, Picture Research Bible, source/canon confidence, social world, cinematography research, exact served Qwen writer, separate exact served Llama critique-first QA, scoped hierarchy/rewrites/seven-pass/versioning, and packaged LM Studio UAT. Read only; do not spawn children or edit."),
    output: "plans/wave2.md",
    outputMode: "file-only"
  },
  {
    key: "plan-wave3",
    agent: "p316-captain",
    task: contract("3", "Act as the Wave 3 portfolio captain. Refresh exact additive schemas/UI/tests for dependency graph, research-aware breakdown, Inventory 2.0, Visual Development, identity/reference bibles, production design, Cinematography and QA. Preserve approved existing domains. Read only; no children or edits."),
    output: "plans/wave3.md",
    outputMode: "file-only"
  },
  {
    key: "plan-wave4",
    agent: "p316-captain",
    task: contract("4", "Act as A33. Inspect source plus the local model inventory read-only. Define the smallest genuine native image path, exact component resolution, capability-specific controls, sticky residency, telemetry, iterations/review/approval, and benchmark gate. Prefer FLUX.1 only if all exact local components exist; otherwise identify the smallest complete installed Klein/Krea path. Never download, mutate weights, use ComfyUI, or call generation. Read only."),
    output: "plans/wave4.md",
    outputMode: "file-only"
  },
  {
    key: "plan-wave5",
    agent: "p316-captain",
    task: contract("5", "Act as A41. Refresh engine-neutral compiler, H3/LTX native adapter, scheduler/residency, video queue/takes and video QC implementation contracts from actual local repositories and weights. Reject hosted-only claims and ComfyUI. Read only; do not launch models."),
    output: "plans/wave5.md",
    outputMode: "file-only"
  },
  {
    key: "plan-wave6",
    agent: "p316-captain",
    task: contract("6", "Act as A49/A57. Refresh genuine local Qwen3-TTS/VoxCPM2, voice consent/ADR, sound, Music3, score versions/placement and audio QA contracts. Distinguish installed, supported, Labs and blocked capabilities. Read only; no model launch."),
    output: "plans/wave6.md",
    outputMode: "file-only"
  },
  {
    key: "plan-wave7-8",
    agent: "p316-captain",
    task: contract("7-8", "Act as A57. Refresh the bounded real editor, typed FFmpeg conform/export, Movie Readiness, provenance/database evolution, recovery/diagnostics/security, 30-second acceptance film, and Pi Movie Crew contracts. Inspect actual FFmpeg availability read-only. Do not edit, package or launch generation."),
    output: "plans/wave7-8.md",
    outputMode: "file-only"
  }
]);

const wave2 = await runs.run("wave2-a18-implementation", {
  agent: "worker",
  task: contract("2", "You are A18, sole Wave 2 implementation writer under explicit A03/A06/A10 integration authority. Do not spawn subagents. Read the design-ui skill before editing UI. Use the refreshed plans " + planning[0].output + " and " + planning[1].output + " plus prior A17 report " + PRIOR + "/captains/A17.md. Implement the complete Wave 2 software slice in this cwd. Add a real Research Stage after Intake without repurposing an id; route new pictures Intake→Research while legacy pictures and The Last Reel migrate unchanged. Add optional migration-safe Picture Research Bible state: local/user-provided default, explicit web-assisted mode visibly disabled unless separately authorized, source/canon ledger with citations/locators, A-D confidence, disputes, social-world behavior and cinematic expression, risks, feasibility, cinematography/sound/music research, whole-picture and delta scopes, append-only versions and explicit approval. Build a polished responsive Research workspace and central StageLayoutPolicy row with no generation rails/timeline. Extend screenplay architecture with stable act/sequence/scene/beat hierarchy, smallest-scope default, scene/beat/dialogue/selection/full scopes, append-only scoped revisions and scoped seven-pass, fine-grained impact records, approved-version preservation. Qwen writer selection must accept only an exact currently served Qwen LM Studio id; Llama Story Doctor is a separate exact currently served Llama id and critique-first, never mutating Fountain until the user explicitly applies a scoped revision. Preserve loopback-only provider discovery, cancel/unload/telemetry, startup while offline and no automatic loading. Add deterministic unit/integration tests using injected local provider doubles only; do not fake packaged runtime evidence. Update stage navigation, migration allowlists, shell policy, UAT harness stage discovery, package test list and orchestration leases/status honestly. Run npm test, npm run typecheck and npm run build. Do not package, touch user data, alter D:/AI/Models, or mark Wave 2 green. Leave a coherent uncommitted diff and report exact blockers."),
  output: "implementation/wave2-A18.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] }
});

const wave2Review = await runs.run("wave2-a03-review", {
  agent: "reviewer",
  task: contract("2", "Act as A03/A06/A10 integration reviewer. Read implementation report " + wave2.output + ", inspect every actual working-tree change, and compare it to the Wave 2 gate. Review migration idempotence, Last Reel compatibility, stable ids, approval/version semantics, Qwen/Llama role separation, loopback-only behavior, stage IA, tests and cross-domain regressions. Ignore only the unavoidable fact that LM Studio may currently be offline; code defects remain blockers. Return pass only if the source is ready for packaging."),
  outputSchema: verdictSchema
});

let wave2Repair = null;
if (wave2Review.structuredOutput.verdict === "blocked") {
  wave2Repair = await runs.run("wave2-a03-repair", {
    agent: "worker",
    task: contract("2", "You are A03 emergency integration writer, sole writer. Inspect A18 report " + wave2.output + " and reviewer findings: " + JSON.stringify(wave2Review.structuredOutput) + ". Repair every code, migration, UI, accessibility, security and test blocker without reducing acceptance criteria. Keep changes additive and within Wave 2. Run npm test, npm run typecheck and npm run build. Do not package, commit, touch user data/models, auto-load LM Studio or open Wave 3."),
    output: "implementation/wave2-A03-repair.md",
    outputMode: "file-only",
    acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] }
  });
}

const wave2Gate = await runs.run("wave2-a04-package-gate", {
  agent: "worker",
  task: contract("2", "You are A04 packaged-gate owner and sole writer/process owner. Inspect the complete current diff, A18 report " + wave2.output + (wave2Repair ? " and repair report " + wave2Repair.output : "") + ". First run full tests/typecheck/build and repair only narrow packaging/UAT defects. Create/update a safe packaged Wave 2 UAT harness using a temporary copied profile; never mutate the live profile without a cold backup and byte-for-byte restore. Run npm run electron:pack; verify app.asar audit, build/source identity, installer and shortcut. Walk the complete packaged pipeline at 100% and 150%, including Research and Screenplay 2.0 offline behavior, and capture native BrowserWindow screenshots. Query LM Studio only on approved loopback endpoints. If it is already running with exact served Qwen and Llama models, run real user-triggered draft→critique→scoped revision→approval UAT and record actual served ids/telemetry. If not, do not start the server or load any model: mark S-001 and the Wave 2 gate BLOCKED_EXTERNAL_RUNTIME. In either case, write docs/release/wave2-gate.md and update task/wave/lease ledgers truthfully. Commit the coherent implementation and evidence as a pending-runtime checkpoint when code/package gates pass; create a green tag and open Wave 3 only when the real LM Studio gate passes. Leave Premiere316 closed and user data restored."),
  output: "gates/wave2-A04.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] }
});

const wave2Audits = await runs.all([
  {
    key: "wave2-a07-audit",
    agent: "reviewer",
    task: contract("2", "Act as independent A07. Read " + wave2Gate.output + " and inspect current source, tests, package evidence and git state. Return pass only if every code/test/migration/packaging requirement is met and state any exact external runtime blocker separately."),
    outputSchema: verdictSchema
  },
  {
    key: "wave2-a64-audit",
    agent: "reviewer",
    task: contract("2", "Act as final independent A64 red team with veto. Read " + wave2Gate.output + ", inspect source and actual evidence. Test for fake model identity, silent fallback, research network access, destructive persistence, missing packaged UX, cloud/ComfyUI, approval destruction and skipped real LM Studio UAT. A required operator-served model being absent is an external-runtime BLOCK, never a waiver."),
    outputSchema: verdictSchema
  }
]);

if (wave2Audits[0].structuredOutput.verdict === "blocked" || wave2Audits[1].structuredOutput.verdict === "blocked") {
  return {
    status: "BLOCKED_AT_WAVE_2",
    completedGreenThrough: 1,
    implementation: wave2.output,
    repair: wave2Repair ? wave2Repair.output : null,
    gate: wave2Gate.output,
    audits: [wave2Audits[0].structuredOutput, wave2Audits[1].structuredOutput],
    nextAction: "Do not open Wave 3. Resolve the reported code issue or have the operator explicitly serve the required exact Qwen and Llama LM Studio models, then resume this controlled program."
  };
}

const wave3 = await runs.run("wave3-a25-implementation", {
  agent: "worker",
  task: contract("3", "You are A25, sole Wave 3 integration writer under A03 schema authority. Use plans " + planning[0].output + " and " + planning[2].output + ". Implement the full additive Wave 3 slice: research→master dependency graph with precise stale propagation; research-aware approved-screenplay breakdown; Inventory 2.0 edit/merge/split/reference/readiness; Visual Development stage and engine-neutral character/location/wardrobe/prop bibles, boards, motifs and palettes; character identity/expression/wardrobe-state bundles and drift rules; production design/costume/props variants; first-class Cinematography stage with manifesto, sequence arcs, lens/framing/height/movement/focus/lighting/texture/geography/rhythm and deterministic QA for repetition/geography/drift/redundancy. Preserve approved records and existing Performance/Shots. Add migration-safe optional fields, central stage policies, responsive UI and thorough tests. No generation or model use. Run tests/typecheck/build, update leases/status honestly, do not package/commit or open Wave 4."),
  output: "implementation/wave3-A25.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] }
});

const wave3Gate = await runs.run("wave3-a04-package-gate", {
  agent: "worker",
  task: contract("3", "You are A03/A04 Wave 3 integration and packaged-gate writer. Review " + wave3.output + " and actual diff; repair defects without scope expansion. Run all source gates, package Premiere316, and perform isolated packaged UAT at 100/150% for Approved Screenplay→research-aware Breakdown→Inventory→Visual Development→Cinematography→prepared assets. Verify fine-grained staleness and Last Reel migration. Write docs/release/wave3-gate.md, update ledgers, commit and tag only on green; otherwise record blocker and do not open Wave 4."),
  output: "gates/wave3.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] }
});

const wave3Audit = await runs.run("wave3-a64-audit", {
  agent: "reviewer",
  task: contract("3", "Independent A64 gate review. Inspect " + wave3Gate.output + ", source, tests, package, screenshots, data proof and git. Veto domain flattening, broad invalidation, destructive migration, fake readiness, stage leakage, browser-only evidence or missing packaged flow."),
  outputSchema: verdictSchema
});
if (wave3Audit.structuredOutput.verdict === "blocked") {
  return { status: "BLOCKED_AT_WAVE_3", completedGreenThrough: 2, implementation: wave3.output, gate: wave3Gate.output, audit: wave3Audit.structuredOutput };
}

const wave4 = await runs.run("wave4-a34-implementation", {
  agent: "worker",
  task: contract("4", "You are A34/A38 sole Wave 4 writer. Use plans " + planning[0].output + " and " + planning[3].output + ". Implement exact read-only component resolution and at least one genuine native offline image adapter from installed components only; never download or alter weights and never use ComfyUI code/process/workflows. Capability/control schemas must be adapter-specific and execution must remain privileged outside renderer. Implement explicit user-triggered prepared-asset generation, immutable iterations, A/B compare, approve/reject, canonical approval, identity/reference continuity checks, sticky residency, conservative memory planning, actual provenance and measured telemetry with unknown fields left unknown. Unsupported FLUX.2/Klein/Krea paths remain visibly disabled/Labs. Add tests and packaged UAT harness. A tiny acceptance generation may be launched only through the packaged user action after all safety checks. Run source gates; do not package/commit/open Wave 5."),
  output: "implementation/wave4-A34.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] }
});

const wave4Gate = await runs.run("wave4-a04-package-gate", {
  agent: "worker",
  task: contract("4", "A04 packaged gate. Review/repair " + wave4.output + ". Build/package and run isolated Premiere316 UAT for Prepared asset→explicit native local generation→iteration review→canonical approval. Prove network denial, exact components, provenance, output validity, sticky residency and measured cold/warm timing. Never mutate model files. If no complete installed native path can produce a real image, record BLOCKED_EXTERNAL_RUNTIME; do not fake, tag green or open Wave 5. Otherwise write Wave 4 report/ledgers, commit/tag and close all processes."),
  output: "gates/wave4.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] }
});
const wave4Audit = await runs.run("wave4-a64-audit", {
  agent: "reviewer",
  task: contract("4", "Independent A64 image-path red team. Inspect " + wave4Gate.output + " and actual artifacts. Veto mock/placeholder output, downloads, model mutations, ComfyUI, fabricated telemetry, wrong model identity, silent fallback, browser-only acceptance or absent packaged generation."),
  outputSchema: verdictSchema
});
if (wave4Audit.structuredOutput.verdict === "blocked") {
  return { status: "BLOCKED_AT_WAVE_4", completedGreenThrough: 3, implementation: wave4.output, gate: wave4Gate.output, audit: wave4Audit.structuredOutput };
}

const wave5 = await runs.run("wave5-a44-implementation", {
  agent: "worker",
  task: contract("5", "You are A44/A47 sole Wave 5 writer. Use plans " + planning[0].output + " and " + planning[4].output + ". Implement Creative Intent→Canonical Spec→engine compiler→typed runtime request; Qwen prompt compiler remains user-triggered and exact-served-model gated, with deterministic local fallback compilation that is clearly non-model and never fabricates QA. Add truthful FLUX/H3/LTX dialects. Implement only verified native MiniMax H3 and LTX 2.5 capabilities from installed local repositories, outside renderer, no ComfyUI. Add cross-media scheduler/residency state machine, grouping/swap penalties/caches; immutable video jobs/takes with pause/resume/cancel/retry and review; technical and continuity QC with selective failure regeneration. Unsupported runtime features remain disabled. Add stages/policies/UI/migrations/tests. Run source gates; no package/commit/open Wave 6."),
  output: "implementation/wave5-A44.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] }
});
const wave5Gate = await runs.run("wave5-a04-package-gate", {
  agent: "worker",
  task: contract("5", "A04 Wave 5 packaged gate. Review/repair " + wave5.output + "; test/build/package; run isolated packaged UAT for approved assets+cinematography+performance+shot→compiled prompt→explicit genuine local video→take review/QC. Prove exact runtime/model identity, output media validity, scheduler/residency and no network/ComfyUI. If installed H3/LTX cannot genuinely generate, record external-runtime block and stop. Otherwise report/update ledgers/commit/tag."),
  output: "gates/wave5.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] }
});
const wave5Audit = await runs.run("wave5-a64-audit", { agent: "reviewer", task: contract("5", "A64 red-team " + wave5Gate.output + ". Veto fake video, hosted-only claims, ComfyUI, wrong model, non-user-triggered work, lossy state transitions, missing take preservation/QC or browser-only evidence."), outputSchema: verdictSchema });
if (wave5Audit.structuredOutput.verdict === "blocked") return { status: "BLOCKED_AT_WAVE_5", completedGreenThrough: 4, implementation: wave5.output, gate: wave5Gate.output, audit: wave5Audit.structuredOutput };

const wave6 = await runs.run("wave6-a52-implementation", {
  agent: "worker",
  task: contract("6", "You are A52 sole Wave 6 writer. Use plans " + planning[0].output + " and " + planning[5].output + ". Implement truthful local Qwen3-TTS primary and VoxCPM2 alternate adapter gates, voice bibles/design/authorized clone consent/auditions/line takes/pronunciation/timing/ADR/approval/shot linkage; Sound workspace for Foley/SFX/ambience/room tone/environment/silence/import or supported generation, sync/version/approval/provenance; Music3 capability/hardware gate and Score spotting/themes/cues/versions/stems/placement/unscored sections; deterministic 48k/channel/clipping/dialogue-priority/sync/loudness QA. Privileged typed runtimes only, no arbitrary commands, cloud or automatic generation. Add stages/UI/migration/tests. Run source gates; no package/commit/open Wave 7."),
  output: "implementation/wave6-A52.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] }
});
const wave6Gate = await runs.run("wave6-a04-package-gate", {
  agent: "worker",
  task: contract("6", "A04 Wave 6 packaged gate. Review/repair " + wave6.output + "; test/build/package; isolated packaged UAT must create or import genuine dialogue/voice/sound/score assets, validate them and approve them with provenance. Exercise native adapters only through explicit actions and only when exact installed runtimes pass; no mocks. If required genuine assets cannot be produced/approved, block externally. Otherwise report/ledgers/commit/tag."),
  output: "gates/wave6.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] }
});
const wave6Audit = await runs.run("wave6-a64-audit", { agent: "reviewer", task: contract("6", "A64 red-team " + wave6Gate.output + ". Veto fake audio, absent consent/provenance, unsupported model claims, cloud/ComfyUI, fabricated 48k/loudness results, destructive takes or browser-only acceptance."), outputSchema: verdictSchema });
if (wave6Audit.structuredOutput.verdict === "blocked") return { status: "BLOCKED_AT_WAVE_6", completedGreenThrough: 5, implementation: wave6.output, gate: wave6Gate.output, audit: wave6Audit.structuredOutput };

const wave7 = await runs.run("wave7-a58-implementation", {
  agent: "worker",
  task: contract("7", "You are A58/A59 sole Wave 7 writer. Use plans " + planning[0].output + " and " + planning[6].output + ". Implement a bounded real editor with immutable media references, preview, trim/split/snapping/range replacement/take selection, V/A/F/S/M tracks, waveforms, J/L cuts, proxies, undo/redo/autosave and original/proxy safeguards. Add typed privileged FFmpeg/FFprobe allowlisted jobs, conform and validated MP4/MOV exports (H.264/H.265 and only validated optional codecs), image sequence, fps/48k/loudness/captions/stems/resolution/stale/unapproved preflight, checksums/archive/history. Add clickable Movie Readiness blockers, migration-safe project graph/provenance evolution, crash/OOM/disconnect/offline/cancel/export recovery, queue resume, diagnostics, security/license/consent/commercial preflight and backup/restore. No generic shell bridge. Add tests/UI. Run source gates; no package/commit/open Wave 8."),
  output: "implementation/wave7-A58.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] }
});
const wave7Gate = await runs.run("wave7-a04-package-gate", {
  agent: "worker",
  task: contract("7", "A04/A64 Wave 7 release gate. Review/repair " + wave7.output + "; full tests/build/package/ASAR/shortcut/installer checks; cold-backup user data. Through packaged Premiere316 only, create the required genuine 30-second acceptance film from approved Wave 2-6 assets, edit/conform/master/export it, ffprobe outputs, validate audio/fps/resolution/duration, checksums/provenance/readiness/recovery and no proxy in master. Preserve all source assets and restore protected user data. No mock generation. Write full M1 evidence, ledgers, commit/tag only if green."),
  output: "gates/wave7-M1.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] }
});
const wave7Audit = await runs.run("wave7-a64-audit", { agent: "reviewer", task: contract("7", "Final independent M1 red team. Inspect " + wave7Gate.output + ", real media with ffprobe/checksums, package/source identity, security/network/process evidence, data restoration and entire pipeline. Veto any synthetic placeholder, browser-only step, skipped stage, unapproved/stale input, proxy master, cloud/ComfyUI, missing recovery or unverifiable film."), outputSchema: verdictSchema });
if (wave7Audit.structuredOutput.verdict === "blocked") return { status: "BLOCKED_AT_WAVE_7", completedGreenThrough: 6, implementation: wave7.output, gate: wave7Gate.output, audit: wave7Audit.structuredOutput };

const wave8 = await runs.run("wave8-a63-implementation", {
  agent: "worker",
  task: contract("8", "You are A63 sole Wave 8 writer. Use plans " + planning[0].output + " and " + planning[6].output + ". Implement repository-local Pi Movie Crew profiles/config/docs for Research Room, Story Room, Visual Art Department, Director's Floor, Post Room and Final QA; exact operator-served LM Studio Qwen writer/prompt-engineer and Llama QA ids from proven Wave 2 evidence; stage-gated councils and typed structured handoffs; prepare→save→queue→unload→wait lifecycle; model-swap minimization; no automatic media generation, no model loading, no secrets, no changes to global user Pi settings. Integrate only safe app-facing manifests/status UI if required. Add validation tests. Package Premiere316 and prove the crew configuration never bypasses app gates. Update final ledgers/release report, commit/tag only on green."),
  output: "implementation/wave8-A63.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] }
});
const finalAudit = await runs.all([
  { key: "final-a07", agent: "reviewer", task: contract("0-8", "Final A07 test/evidence audit of all checkpoints through " + wave8.output + ". Inspect current repo/package and return pass only with complete test, migration, packaged screenshot/UAT and real M1 evidence."), outputSchema: verdictSchema },
  { key: "final-a08", agent: "reviewer", task: contract("0-8", "Final A08 release/change audit through " + wave8.output + ". Verify commits/tags/build ids/hashes/installer/shortcut/rollback/user data/models/release ledgers."), outputSchema: verdictSchema },
  { key: "final-a64", agent: "reviewer", task: contract("0-8", "Final A64 independent release veto. Red-team the entire real packaged pipeline, media/provenance/checksums, exact local runtimes, no cloud/ComfyUI, security and recovery. Return pass only if every wave and M1 is genuinely proven."), outputSchema: verdictSchema }
]);

if (finalAudit.some(function (item) { return item.structuredOutput.verdict === "blocked"; })) {
  return { status: "FINAL_AUDIT_BLOCKED", completedGreenThrough: 7, wave8: wave8.output, audits: finalAudit.map(function (item) { return item.structuredOutput; }) };
}

return {
  status: "ALL_WAVES_GREEN",
  completedGreenThrough: 8,
  plans: planning.map(function (item) { return item.output; }),
  wave2: wave2Gate.output,
  wave3: wave3Gate.output,
  wave4: wave4Gate.output,
  wave5: wave5Gate.output,
  wave6: wave6Gate.output,
  wave7: wave7Gate.output,
  wave8: wave8.output,
  finalAudits: finalAudit.map(function (item) { return item.structuredOutput; })
};
