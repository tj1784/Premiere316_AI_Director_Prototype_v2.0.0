const ROOT = "D:/Projects/Premiere316_v3";
const SPEC = ROOT + "/docs/orchestration/spec";
const BASELINE = ROOT + "/docs/orchestration/baseline-audit.json";
const LEASES = ROOT + "/docs/orchestration/file-leases.json";
const MATRIX = ROOT + "/docs/orchestration/task-status.json";
const REF = "a5b8285";

const preAgents = [
  ["A02", "Chief Architecture Lead", "Map engine-neutral boundaries, shared schemas, Electron separation, current architecture debt, and ADR decisions required by Waves 2-8."],
  ["A05", "Security & Offline Lead", "Audit current source for hidden network/cloud paths, renderer privilege leaks, path/process risks, arbitrary model code, and no-ComfyUI enforcement. Cite exact files."],
  ["A06", "Migration Lead", "Map every current persistence format and migration seam, especially premiere316-v302-c, screenplay, production, performance, media provenance, backup, and nondestructive upgrade requirements."],
  ["A15", "Desktop Window & Preload UI Engineer", "Audit the secure preload/window boundary for stage-aware UI needs. Identify only necessary future IPC changes and protect contextIsolation, sandbox, nodeIntegration false, and trusted sender checks."],
  ["A24", "LM Studio Provider & UAT Engineer", "Audit current LM Studio provider discovery, exact served-model semantics, streaming/cancel/unload/telemetry/offline behavior, and define real packaged UAT without cloud fallback."],
  ["A61", "SQLite / Project Graph / Provenance Engineer", "Map current localStorage/domain persistence to a migration-safe future SQLite graph. Identify stable IDs, immutable media, hashes, lineage, and rollback seams without proposing destructive migration."],
  ["A62", "Recovery / Queue / Diagnostics Engineer", "Map current recovery, queue, backend lifecycle, build diagnostics, engine failure/OOM handling, and define bounded Wave 7 implementation tickets."],
  ["A63", "Pi Movie Crew Orchestration Engineer", "Audit the supplied roster/profile and current local model catalog integration needs. Prepare a Wave 8 stage-gated crew brief only; no automatic generation or pre-M1 integration."],

  ["A11", "Contextual Panels Engineer", "For Wave 1, inspect shell, Bin, Inspector, stage views, and internal stage-owned layouts. Produce an exact visibility map and smallest central-policy integration seam; no edits."],
  ["A12", "Navigation & Responsive Engineer", "For Wave 1, inspect stage rail, panel breakpoints, zoom behavior, released-space expansion, drawer behavior, overflow, and blank-column risk at 100-200%. Specify focused tests; no edits."],
  ["A13", "Accessibility & Keyboard QA", "For Wave 1, inspect keyboard/focus/labels/drawer semantics/zoom reachability and reduced-width behavior. Identify concrete regressions and tests; no edits."],
  ["A27", "Inventory UI Engineer", "Inspect Inventory's stage-owned category/grid/asset-inspector composition and identify exactly which global shell controls currently contaminate it. Preserve all completed breakdown behavior; no edits."],
  ["A42", "Performance UI & Continuity QA", "Inspect Performance's stage-owned navigator, direction, IN/OUT continuity, locks, propagation, approval, and shot preparation. Identify global shell contamination and preservation tests; no edits."],
  ["A55", "Score UI & Cue-Sheet Engineer", "Inspect Score's current cue workflow and identify unrelated global image/video controls to remove in Wave 1 without adding Wave 6 features. Define contextual action expectations; no edits."],

  ["A18", "Source & Canon Research Engineer", "Map existing types/store/UI seams for a Source/Canon Ledger, quote provenance, confidence A-D, disputes, and explicit local/web-assisted modes. Prepare bounded Wave 2 tickets only."],
  ["A19", "Historical & Social-World Engineer", "Map data/UI/test seams for expected behavior, taboo/reversal, visible reaction, confidence, and cinematic expression. Prepare Wave 2 task contracts only."],
  ["A20", "Cinematography Research Engineer", "Map how a picture-level cinematography research manifesto can feed later Cinematography without flattening canonical domains. Prepare Wave 2/3 contract and tests only."],
  ["A21", "Qwen Screenwriter Integration", "Audit screenplay workflow/provider boundaries for Qwen as primary local writer, exact model IDs, structured output, scopes, and no fallback. Prepare Wave 2 implementation brief only."],
  ["A22", "Llama QA / Story Doctor Integration", "Audit screenplay QA seams for independent critique-first Llama workflow and explicit rewrite selection. Define categories, structured output, tests, and LM Studio prerequisites."],
  ["A23", "Scoped Rewrite & Versioning Engineer", "Audit screenplay hierarchy/versioning/approval/invalidation for smallest-scope rewrites and scoped seven-pass. Identify migration-safe changes and exact tests."],
  ["A25", "Breakdown Pod Lead", "Audit current approved-screenplay to deterministic breakdown path and map Research Bible integration, normalization, approvals, and dependencies for Wave 3."],
  ["A28", "Visual Development Lead", "Map bounded Visual Development domain/UI for character/location/wardrobe/prop bibles, boards, palettes, motifs, and approvals. Reuse current assets and avoid engine syntax."],
  ["A30", "Production Design / Costume / Props Engineer", "Map production-design, location material, costume, prop, set-dressing, and continuity variant contracts against current asset domain. Prepare Wave 3 tasks only."],

  ["A26", "Asset Schema & Dependency Engineer", "Audit canonical asset specifications and dependency seams. Define fine-grained research-screenplay-asset edges, variants, references, and safe staleness rules."],
  ["A29", "Character Identity & Reference Engineer", "Map identity specs, expressions, wardrobe states, reference bundles, provenance, and drift rules onto current asset structures without engine coupling."],
  ["A31", "Cinematography Director Engineer", "Map a first-class Cinematography domain/UI and QA for lenses, framing, movement, lighting, geography, visual arcs, and repetition drift. Prepare Wave 3 contracts/tests."],
  ["A32", "Asset Versioning & Approval QA", "Audit existing asset iteration, compare, canonical approval, stale/waived persistence, and identify exact gaps/tests for Wave 4."],
  ["A34", "FLUX.1 Specialist", "Audit current FLUX.1 native adapter/config path and local components. Identify verified offline generation blockers, supported controls, telemetry, and honest Wave 4 acceptance."],
  ["A35", "FLUX.2 Dev Specialist", "Audit current FLUX.2 Dev component mapping, quantization/offload and multi-reference/edit truth. Identify measured memory blockers and bounded native implementation path."],
  ["A36", "Klein 4B/9B Specialist", "Audit Klein 4B/9B distilled settings, encoder cache requirements, fixed sampling, preview/production configs, and exact offline blockers."],
  ["A37", "Krea 2 Specialist", "Audit Krea 2 Raw/Turbo local files, actual adapter support, licenses, capability labels, prompt/control mapping, and missing components without inventing universal controls."],
  ["A38", "Component Resolver & Cache Specialist", "Audit D:/AI/Models resolver/cache behavior from source and recorded baseline only. Map exact encoder/VAE/tokenizer/component validation and no-network guarantees; never mutate model files."],

  ["A39", "Memory, Residency & Telemetry Specialist", "Audit current scheduler/residency states, measured versus estimated RAM/VRAM, sticky media residency, preparation-model unload, embedding caches, and cross-media gaps."],
  ["A40", "Image QC & Benchmark Engineer", "Map objective image QC/calibration for identity, anatomy, reference adherence, cold/warm latency, and peak memory. Do not claim best without measurements."],
  ["A43", "Shot Planner & Canonical Spec QA", "Audit current scene-beat-shot domain, duration/dialogue allocation, continuity, queue readiness, and canonical engine-neutral spec. Identify preservation and Wave 5 gaps."],
  ["A44", "Qwen Prompt Compiler Engineer", "Audit current prompt compiler and define Creative Intent to Canonical Spec to engine dialect to runtime request architecture for all listed engines, with scoped recompilation."],
  ["A45", "MiniMax H3 Native Adapter Specialist", "Audit repository and local inventory evidence for actual H3 local/open T2V, I2V, first/last frame, refs, audio, duration, resolution. Reject hosted-only claims."],
  ["A46", "LTX 2.5 Native Adapter Specialist", "Audit local inventory and source for direct native LTX 2.5 T2V/I2V/A2V/audio, fast/production, refs/keyframes, offload, residency, and no-ComfyUI path."],
  ["A47", "Video Queue & Take Review Engineer", "Map deterministic video jobs, pause/resume/cancel/retry, A/B/C takes, immutable versions, approvals, and failure-only regeneration onto current queues."],
  ["A48", "Video QC & Continuity Engineer", "Define source-backed video QC contracts for resolution, frame rate, identity, anatomy, performance, audio/lip sync, continuity, and selective retry."],
  ["A49", "Audio/Post Pod Lead", "Map voice, sound, score and timeline-facing artifact boundaries, dependencies, approvals, and integration gates for Wave 6 without writing code."],

  ["A50", "Qwen3-TTS Specialist", "Audit local inventory/source seams for Qwen3-TTS voice design/cloning, timing, telemetry, consent, provenance, and local-only adapter acceptance."],
  ["A51", "VoxCPM2 Specialist", "Audit actual local VoxCPM2 availability/capabilities, streaming and 48k claims. Define honest alternate adapter contract and blockers."],
  ["A52", "Voice/ADR UI & Consent Engineer", "Map character voice bibles, auditions, line takes, pronunciation, timing, ADR, approvals, authorization, provenance, and shot linkage."],
  ["A53", "Sound/Foley/Ambience Engineer", "Map cue preparation/import/generation contracts for Foley, SFX, ambience, room tone, environmental sound and silence with sync, approval, provenance."],
  ["A54", "MiniMax Music3 Specialist", "Audit Music3 local/remote truth, local inventory, hardware gates, structured prompt and stem capabilities. No silent cloud or unsupported claims."],
  ["A56", "Audio QA / Sync / Loudness Engineer", "Define measurable 48k, clipping, channel, dialogue priority, sync, loudness and stem validation for packaged acceptance."],
  ["A58", "FFmpeg & Conform Engineer", "Audit FFmpeg/FFprobe availability and design typed jobs, proxy/original safeguards, conform, hardware encode and validation boundaries. No raw renderer shell strings."],
  ["A59", "Master & Export Engineer", "Audit current metadata export and map real preflight, MP4/MOV, stems, captions, checksums, archive, codecs and validation for Wave 7."],
  ["A60", "Movie Readiness Engineer", "Map a clickable dependency/staleness blocker dashboard from current domains through master, with deterministic explanations and no fabricated readiness."],
];

const captainGroups = {
  A03: ["A02", "A04", "A05", "A06", "A15", "A24", "A61", "A62", "A63"],
  A09: ["A10", "A11", "A12", "A13", "A14", "A16", "A27", "A42", "A55"],
  A17: ["A18", "A19", "A20", "A21", "A22", "A23", "A25", "A28", "A30"],
  A33: ["A26", "A29", "A31", "A32", "A34", "A35", "A36", "A37", "A38"],
  A41: ["A39", "A40", "A43", "A44", "A45", "A46", "A47", "A48", "A49"],
  A57: ["A50", "A51", "A52", "A53", "A54", "A56", "A58", "A59", "A60"],
};

function commonPacket(id, role, focus) {
  return "AGENT ID: " + id + "\nROLE: " + role + "\nPROFILE: 64-is-the-new-black, Grok 4.6 medium\n" +
    "TARGET: " + ROOT + " at orchestration ref " + REF + "\n" +
    "READ FIRST: " + SPEC + "/PREMIERE316_V3_64_AGENT_MASTER_ORCHESTRATION_PROMPT.md; " +
    SPEC + "/PREMIERE316_V3_64_AGENT_ROSTER.md; " + SPEC + "/PREMIERE316_V3_STAGE_LAYOUT_MATRIX.md; " +
    MATRIX + "; " + BASELINE + "; " + LEASES + ".\n" +
    "AUTHORITY: READ-ONLY. Do not edit, stage, commit, package, install, launch generation, modify user data, or touch D:/AI/Models. Later waves are blocked; create an evidence-backed implementation brief, not feature code.\n" +
    "FOCUS: " + focus + "\n" +
    "SUCCESS: cite exact current files/symbols, distinguish implemented foundations from gaps, name dependencies and ownership conflicts, propose bounded acceptance tests and packaged-Windows UAT, and flag migration/security/network/model blockers. Stop when the owned surface is mapped; escalate destructive or cross-owner changes.\n" +
    "OUTPUT: AGENT ID; TASK IDs; STATUS; INPUTS REVIEWED; FILES/SYMBOLS MAPPED; PROPOSED FILE LEASES; SCHEMA/API IMPACT; TESTS REQUIRED; PACKAGED APP VERIFICATION; ASSUMPTIONS; RISKS; LIMITATIONS; CONFLICTS; HANDOFF; READY FOR IMPLEMENTATION YES/NO.";
}

const preItems = [];
for (let i = 0; i < preAgents.length; i += 1) {
  const row = preAgents[i];
  preItems.push({
    key: "brief-" + row[0].toLowerCase(),
    agent: "reviewer",
    task: commonPacket(row[0], row[1], row[2]),
    output: "briefs/" + row[0] + ".md",
    outputMode: "file-only",
  });
}
const preResults = await runs.all(preItems);
const briefById = {};
for (let i = 0; i < preAgents.length; i += 1) briefById[preAgents[i][0]] = preResults[i].output;

function groupReferences(ids) {
  let text = "";
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    text += "\n- " + id + ": " + (briefById[id] || "reserved for a post-synthesis Wave 1 execution/validation stage") + ";";
  }
  return text;
}

function captainPacket(id, title, objective) {
  return "AGENT ID: " + id + "\nROLE: " + title + "\nPROFILE: 64-is-the-new-black, Grok 4.6 xhigh\n" +
    "TARGET: " + ROOT + " at ref " + REF + ". You are read-only and must not edit product source.\n" +
    "MASTER CONTRACT: Read all files under " + SPEC + " plus " + BASELINE + ", " + LEASES + ", and " + MATRIX + ".\n" +
    "YOUR NINE LOGICAL REPORTS:" + groupReferences(captainGroups[id]) + "\n" +
    "OBJECTIVE: " + objective + "\n" +
    "Enforce task dependencies, one writer per cwd/worktree, ownership boundaries, no later-wave merge before prior packaged gate, preservation of 173 tests/data/zoom/completed domains, local-first/no silent cloud, secure Electron, no ComfyUI, and packaged Premiere316.exe acceptance. Resolve contradictions conservatively and cite evidence.\n" +
    "OUTPUT: AGENT ID; nine agents accounted for; accepted findings; rejected/speculative findings; ordered task DAG; exact leases; writer directive if applicable; tests; packaged gates; blockers; conflicts; release vetoes; handoff to A01.";
}

const captainItems = [
  { key: "captain-a03", agent: "p316-captain", task: captainPacket("A03", "Integration Lead / Governance Portfolio Captain", "Synthesize the governance, packaging, security, migration, desktop, LM Studio, database, recovery and Pi-crew briefs. Freeze later work behind its waves. Explicitly include BASE-001 shortcut repair as A04's post-UI packaging responsibility."), output: "captains/A03.md", outputMode: "file-only" },
  { key: "captain-a09", agent: "p316-captain", task: captainPacket("A09", "UI/UX Pod Lead / Wave 1 Captain", "Produce the smallest coherent implementation directive for A10. Centralize StageLayoutPolicy; remove global Bin/Inspector/Rewrite leakage; keep global shell minimal; render Bin/Inspector only for Generate and Stitch as declared; timeline only Stitch; release absent panel columns; preserve stage-owned workspaces and zoom. Reserve A14 visual and A16 packaged UAT for after packaging."), output: "captains/A09.md", outputMode: "file-only" },
  { key: "captain-a17", agent: "p316-captain", task: captainPacket("A17", "Research & Screenplay Portfolio Captain", "Synthesize a dependency-correct Wave 2 to early Wave 3 backlog for Research Bible, local Qwen writer, independent Llama QA, scoped versioning, approved-screenplay breakdown and Visual Development. No code is authorized yet."), output: "captains/A17.md", outputMode: "file-only" },
  { key: "captain-a33", agent: "p316-captain", task: captainPacket("A33", "Image Runtime / Assets / Cinematography Portfolio Captain", "Synthesize Wave 3-4 contracts for fine-grained assets, identity, Cinematography, component resolution and honest native image paths. No model-file mutation, downloads, fake readiness, or pre-gate feature code."), output: "captains/A33.md", outputMode: "file-only" },
  { key: "captain-a41", agent: "p316-captain", task: captainPacket("A41", "Performance, Prompt & Video Portfolio Captain", "Synthesize Wave 4-5 contracts for residency, image QC, shot preservation, engine-neutral compilers, H3/LTX native adapters, queue/takes and video QC. Keep generation manual and capabilities adapter-gated."), output: "captains/A41.md", outputMode: "file-only" },
  { key: "captain-a57", agent: "p316-captain", task: captainPacket("A57", "Timeline, Audio, Master & Reliability Portfolio Captain", "Synthesize Wave 6-7 contracts for voice, consent, sound, score, audio QA, real editor, typed FFmpeg conform, master/export and Movie Readiness. Preserve originals and require packaged film acceptance."), output: "captains/A57.md", outputMode: "file-only" },
];
const captainResults = await runs.all(captainItems);

const writer = await runs.run("writer-a10-wave1", {
  agent: "worker",
  task: "AGENT ID: A10\nTASKS: UX-001, UX-002, UX-003, UX-004 support, UX-005 harness\nPROFILE: 64-is-the-new-black, Grok 4.6 medium\nTARGET: " + ROOT + " on main at current HEAD; sole active product-source writer. Do not create subagents. Do not commit, stage, package, install, modify user data, touch D:/AI/Models, or edit later-wave domains.\nREAD FIRST: all files under " + SPEC + "; " + BASELINE + "; " + LEASES + "; A09 captain directive " + captainResults[1].output + "; A11/A12/A13/A27/A42/A55 briefs " + groupReferences(["A11", "A12", "A13", "A27", "A42", "A55"]) + ".\nLEASE: You may edit only src/components/studio/shell.tsx, src/lib/studio/responsive-layout.ts, src/lib/studio/responsive-layout.test.ts, new src/lib/studio/stage-layout.ts, new src/lib/studio/stage-layout.test.ts, and new scripts/desktop-stage-visual.mjs. If a necessary change falls outside this set, stop and report it rather than crossing the lease.\nIMPLEMENTATION CONTRACT: Add one declarative StageLayoutPolicy source of truth for every currently implemented StageId. The shell must consult it rather than scatter stage conditionals. Global shell shows Back, title/status, stage navigation, zoom and window chrome only. Remove the generic global Rewrite and unconditional panel toggles. Intake, Screenplay, Inventory, Performance, Shots, Prompt Lab, Score and Export must not render global Bin/Engines/Models, global Inspector, FLUX context or timeline. Generate owns Bin plus generation Inspector. Stitch owns media Bin, clip Inspector and timeline. Do not reserve columns for absent panels. Preserve internal stage-owned UIs and all functionality. Responsive panel drawers apply only when the active stage owns that panel; 100/125/150/200% remain usable. Add focused policy/responsive/source-level regression tests. Add a packaged Electron screenshot harness covering every implemented stage at 100% and 150%, using an isolated temporary user-data directory and never altering the real user profile. Do not add future stages or fake actions.\nVALIDATE: run focused new tests, npm test (must be at least 173 and all pass), npm run typecheck, and npm run build. Do not run electron:pack; A04 owns packaging after your handoff. Inspect git diff for scope and report any baseline issue.\nOUTPUT: required structured agent report with files changed, API/type changes, tests added/run/results, packaged app verified NO (reserved A04/A14/A16), assumptions, risks, conflicts, handoff, and READY FOR REVIEW.",
  output: "implementation/A10.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] },
});

const packager = await runs.run("packager-a04-wave1", {
  agent: "worker",
  task: "AGENT ID: A04\nTASK: Wave 1 packaging gate plus BASE-001\nPROFILE: 64-is-the-new-black, Grok 4.6 medium\nTARGET: " + ROOT + " after A10 handoff " + writer.output + ". You are the sole active writer/process owner. Do not create subagents.\nAUTHORITY: Inspect A10's diff. Do not alter its UI files unless a packaging-only blocker is proven and reported. Your source lease is desktop/build-info.json and packaging/build outputs; package.json/electron-builder/desktop runtime may receive only a narrowly justified packaging fix. Never touch project data or D:/AI/Models.\nREQUIRED: rerun npm test and npm run typecheck; run npm run electron:pack to produce the unpacked Premiere316.exe and installer and pass ASAR/resource audit. Record new build ID and SHA-256s. Repair the existing Start Menu Premiere316 shortcut, which baseline evidence shows targets the retired V2 launcher: after successful packaging only, point it directly at D:/Projects/Premiere316_v3/dist-desktop/win-unpacked/Premiere316.exe with the V3 working directory/icon. Verify the shortcut target using WScript.Shell. Do not run the installer or delete the protected baseline. Confirm source hash matches packaged build-info. Leave the app closed for A14.\nOUTPUT: structured A04 report with files changed, commands/results, build ID, executable/installer/resource hashes, shortcut before/after/verification, package audit, risks, and READY FOR PACKAGED UAT.",
  output: "implementation/A04.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] },
});

const visual = await runs.run("validator-a14-wave1", {
  agent: "delegate",
  task: "AGENT ID: A14\nTASK: UX-005 packaged Electron visual regression\nPROFILE: 64-is-the-new-black, Grok 4.6 medium\nTARGET: " + ROOT + " after A10 " + writer.output + " and A04 " + packager.output + ". READ ONLY: do not edit source, package, shortcut, user data, or model files.\nRun the new scripts/desktop-stage-visual.mjs against dist-desktop/win-unpacked/Premiere316.exe. It must capture every currently implemented stage at 100% and 150% in packaged Electron using isolated user data. Inspect every screenshot (not merely JSON) for shell contamination, blank columns, overlap, clipping, horizontal overflow, and unreadable text. Assert no global generation rail/Inspector on non-Generate/non-Stitch stages, timeline only on Stitch, no generic Rewrite, contextual stage-owned actions, and workspace expansion. Record console errors and exact screenshot paths. If the harness or UI fails, report BLOCK; do not fix source.\nOUTPUT: structured A14 report, per-stage/per-zoom verdict table, concrete file/visual evidence, failures, and PACKAGED APP VERIFIED YES/NO.",
  output: "validation/A14.md",
  outputMode: "file-only",
});

const uat = await runs.run("validator-a16-wave1", {
  agent: "delegate",
  task: "AGENT ID: A16\nTASK: Packaged Wave 1 UI UAT\nPROFILE: 64-is-the-new-black, Grok 4.6 medium\nTARGET: " + ROOT + " after visual report " + visual.output + ". READ ONLY: do not edit source or model files.\nBefore launching, make a cold-safe temporary backup of %APPDATA%/Premiere316 if the app is closed; record the premiere316-v302-c SHA-256. Run node scripts/desktop-smoke.mjs and a packaged stage walkthrough as needed. Verify PACKAGED DIST build identity, app source match, offline LM Studio startup, one existing picture preserved, stage navigation, Generate ownership, timeline only Stitch, secure preload behavior visible through existing tests, zoom reset/in/out/persistence at 100-200%, and zero page/console errors. Restore the exact pre-UAT user profile after closing the app and verify the persistent payload SHA-256 matches. Do not run the installer, generate media, or change the shortcut.\nOUTPUT: structured A16 report with commands/results, build ID, data hashes before/after, packaged assertions, console errors, and PACKAGED APP VERIFIED YES/NO. Any data mismatch is P0 BLOCK.",
  output: "validation/A16.md",
  outputMode: "file-only",
});

const auditItems = [
  { key: "audit-a07", agent: "reviewer", task: "AGENT ID: A07, Test Strategy Lead. Fresh read-only Wave 1 gate review of current " + ROOT + ". Read specs, baseline, A10 " + writer.output + ", A04 " + packager.output + ", A14 " + visual.output + ", A16 " + uat.output + ". Inspect actual changed files. Report only evidence-backed missing tests/regressions, exact files, baseline versus final counts, and gate verdict BLOCK or OK. No edits.", output: "audits/A07.md", outputMode: "file-only" },
  { key: "audit-a08", agent: "reviewer", task: "AGENT ID: A08, Release & Change Manager. Fresh read-only Wave 1 release-evidence audit of current " + ROOT + ". Read baseline and A04/A14/A16 outputs. Verify protected tag/rollback, package identity, installer/exe evidence, shortcut evidence, user-data restoration, lease compliance and checkpoint readiness. Report concrete gaps and verdict BLOCK or OK. No edits or release action.", output: "audits/A08.md", outputMode: "file-only" },
  { key: "audit-a64", agent: "reviewer", task: "AGENT ID: A64, Final Independent UAT / Red Team. Fresh read-only Wave 1 veto review of current " + ROOT + ". Read master spec, stage matrix, actual changed files, and A10/A04/A14/A16 evidence. Look for shell leakage, fake capabilities, browser-only acceptance, ComfyUI/cloud regressions, responsive/zoom/data/security regressions, and unverified claims. Cite exact evidence and end with RELEASE VETO or WAVE 1 ACCEPTABLE. No edits.", output: "audits/A64.md", outputMode: "file-only" },
];
const audits = await runs.all(auditItems);

return {
  profile: "64-is-the-new-black",
  logicalAgents: 64,
  root: "A01",
  mediumSpecialists: 54,
  xhighCaptains: 6,
  directAuditors: 3,
  preBriefCount: preResults.length,
  captainOutputs: [captainResults[0].output, captainResults[1].output, captainResults[2].output, captainResults[3].output, captainResults[4].output, captainResults[5].output],
  implementation: writer.output,
  packaging: packager.output,
  visualValidation: visual.output,
  packagedUat: uat.output,
  audits: [audits[0].output, audits[1].output, audits[2].output],
};
