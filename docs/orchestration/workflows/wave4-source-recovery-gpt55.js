const ROOT = "D:/Projects/Premiere316_v3";
const BASE = "527046e0b4ee45031fde3b740a9fcfac1f21f534";
const RUN = "768ac9d8-6c1e-4cd2-8b7d-5e4555e5c876";
const ART = "C:/Users/teeja/.pi/agent/sessions/--D--Projects-Premiere316_v3--/subagent-artifacts/outputs/" + RUN;

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["auditor", "verdict", "blockerKind", "summary", "findings"],
  properties: {
    auditor: { type: "string" },
    verdict: { type: "string", enum: ["pass", "blocked"] },
    blockerKind: { type: "string", enum: ["none", "code", "components", "external-runtime", "migration", "data", "security", "ui", "accessibility", "evidence", "packaging"] },
    summary: { type: "string" },
    findings: { type: "array", items: { type: "string" }, maxItems: 60 }
  }
};

const componentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "candidate", "summary", "exactEvidence", "loadPlan", "findings"],
  properties: {
    verdict: { type: "string", enum: ["pass", "blocked"] },
    candidate: { type: ["string", "null"] },
    summary: { type: "string" },
    exactEvidence: { type: "array", items: { type: "string" }, maxItems: 50 },
    loadPlan: { type: ["string", "null"] },
    findings: { type: "array", items: { type: "string" }, maxItems: 50 }
  }
};

const packageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "blockerKind", "summary", "commit", "buildId", "report", "generatedArtifacts", "findings"],
  properties: {
    verdict: { type: "string", enum: ["pass", "blocked"] },
    blockerKind: { type: "string", enum: ["none", "code", "components", "external-runtime", "data", "security", "ui", "accessibility", "evidence", "packaging"] },
    summary: { type: "string" },
    commit: { type: ["string", "null"] },
    buildId: { type: ["string", "null"] },
    report: { type: ["string", "null"] },
    generatedArtifacts: { type: "array", items: { type: "string" }, maxItems: 30 },
    findings: { type: "array", items: { type: "string" }, maxItems: 60 }
  }
};

const finalSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary", "commit", "tag", "wave4", "wave5", "findings"],
  properties: {
    verdict: { type: "string", enum: ["pass", "blocked"] },
    summary: { type: "string" },
    commit: { type: ["string", "null"] },
    tag: { type: ["string", "null"] },
    wave4: { type: "string", enum: ["GREEN", "BLOCKED"] },
    wave5: { type: "string", enum: ["OPEN", "CLOSED"] },
    findings: { type: "array", items: { type: "string" }, maxItems: 40 }
  }
};

function contract(role) {
  return "TARGET " + ROOT + " at Wave3 GREEN base " + BASE + " with the current intentional uncommitted Wave4 source diff from failed source workflow " + RUN + ". Act as logical " + role + " using openai-codex/gpt-5.5 medium. Preserve exactly 64 logical roles, max physical concurrency five (workflow peak three), one writer, all protected tags/packages, Premiere316.exe, The Last Reel, approved bytes/IDs/history, premiere316-v302-c, secure Electron, additive hydration, 390px and 100-200% zoom. No auth/database/cloud. Never download/convert/copy/rename/move/delete/edit weights or write D:/AI/Models. Never edit installed D:/Projects/flux, D:/Projects/Flux2, Python packages or model/cache snapshots. Never invoke or connect to ComfyUI/8188. Pre-existing operator LM Studio/ComfyUI processes are ambient: do not stop, restart, attach to, inspect internally, or attribute them to Premiere316; prove the app process tree makes no contact. Do not auto-load any model. Only the later packaged visible user Generate action may launch the allowlisted app-owned native image worker. Wave5 remains closed until package and A07/A08/A64 pass.";
}

const analysis = await runs.all([
  {
    key: "wave4-deep-components",
    agent: "p316-captain",
    task: contract("A38 deep local-component resolver") + " Read-only; do not spawn children or launch/import Python/models/CUDA. Reconcile the earlier blocked report " + ART + "/plans/wave4-components.md with all local evidence. Specifically inspect D:/AI/Models/text_encoders/clip_l.safetensors (full SHA-256 660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd, 246144152 bytes), its safetensors header/key shapes, D:/Dev/Tools/Python312/Lib/site-packages/open_clip/bpe_simple_vocab_16e6.txt.gz, installed transformers/safetensors/open_clip package metadata, the complete local google/t5-v1_1-xxl snapshot, flux1-dev and ae.safetensors, and official D:/Projects/flux source. Decide whether an APP-OWNED offline FLUX.1 adapter can truthfully instantiate a local transformers CLIPTextModel with canonical ViT-L/14 text config, load this exact local state dict, tokenize with the installed OpenAI SimpleTokenizer/BPE vocabulary, load T5 from its direct local snapshot, and call only official BFL model/sampling APIs. Do not label the standalone file as the absent HF snapshot or assert upstream byte equivalence; identify it by its own full hash, schema and exact package/resource hashes. Verify required tensor keys/shapes and tokenizer vocabulary semantics statically. A candidate pass means source-ready for later empirical package proof, not that inference has run. If unsafe/incomplete, block exactly. Also check no hidden complete caches elsewhere. Return exact evidence and a no-network/no-external-write load plan.",
    output: "plans/wave4-deep-components.md",
    outputMode: "file-only",
    outputSchema: componentSchema,
    maxRuntimeMs: 5400000
  },
  {
    key: "wave4-repair-plan",
    agent: "oracle",
    task: contract("A33/A32 repair architect") + " Read-only. Inspect the full current diff and the final rereview blockers: privileged backend trusts renderer IDs instead of a current approved prepared authorization; renderer benchmark can generate; legacy shot StillBay remains reachable; media writes to cwd/temp; Review auto-confirms continuity. Design the narrow complete repair. Require a backend-validated one-use expiring authorization envelope bound to picture/asset/prepared/spec/dependency fingerprints, exact manifest and generation config; generation accepts only opaque token and consumes it. Backend must independently validate schema/current prepared state and issue an execution receipt bound to durable bytes/sidecar. Remove every renderer-visible benchmark/free wake/shot-generation path. Main must pass a profile-scoped durable media root and register traversal-safe read-only media protocol. Approval must call privileged durable-output verification and collect visible reviewer-entered reason plus individual concrete findings/confirmations. Specify tests and preserve append-only history. Include app-owned worker packaging, direct-local component APIs, offline/cache-write isolation, sticky FLUX.1 and truthful worker telemetry. No edits/process/model launch.",
    output: "plans/wave4-security-repair.md",
    outputMode: "file-only",
    maxRuntimeMs: 3600000
  },
  {
    key: "wave4-repair-redteam",
    agent: "oracle",
    task: contract("A64 recovery red-team") + " Read-only. Attack the current diff and propose regression gates for forged prepared envelopes/tokens, token replay/cross-asset use, direct benchmark/wake/expose, dev server generation, arbitrary model/output paths, media URI traversal, symlink escape, caller-forged PNG/sidecar hashes, approval after durable file tampering/restart, fake continuity, source-level adapter hard-disable, auto-load during inspect, Python writes/downloads, and killing/using ambient operator processes. Determine what can be guaranteed with an untrusted renderer and localStorage, and require backend-owned validation/receipts without claiming stronger cryptographic project authority than exists. No edits/process/model launch.",
    output: "plans/wave4-recovery-redteam.md",
    outputMode: "file-only",
    maxRuntimeMs: 3600000
  }
]);

const component = analysis[0].structuredOutput || null;
const repair = await runs.run("wave4-recovery-writer", {
  agent: "worker",
  task: contract("A34/A32 sole Wave4 recovery source writer") + " Read the design-ui skill, all current source, prior implementation/repair under " + ART + "/implementation, final reviewer findings, and new plans " + analysis[0].output + ", " + analysis[1].output + ", " + analysis[2].output + ". Component decision: " + JSON.stringify(component) + ". Repair every P0/P1 without launching Python/model/package or touching external roots. Preserve useful current work, but prefer coherent redesign over patches. Implement an app-owned packaged FLUX.1 worker only if the deep candidate passes. Bind the standalone CLIP component by its truthful local stable ID/full SHA/schema, not the absent HF ID. Use direct local T5 snapshot and explicit transformer/AE paths with offline/local-only settings. Worker must retain exact FLUX.1 transformer, T5, CLIP and VAE for authoritative sticky residency; ping reports identity/component digest; explicit release drops them. Capture actual load/inference/total/peak CUDA and process RAM when measurable, otherwise null. Spawn from an app-owned temp cwd with PYTHONDONTWRITEBYTECODE, isolated pycache/TORCH_HOME, no tokens/API keys/proxies, offline flags and no external writes; package worker as an immutable resource and hash it. Create a privileged prepared-generation authority with strict bounded envelope validation, current approved prepared/spec/dependency/visual/cinematography checks, exact component manifest/config binding, one-use expiring random token, focused visible-action origin checks in main, and no renderer-selected output/model absolute paths. Make generation consume the token before worker launch. Backend owns the durable profile media path, creates filenames, validates real PNG decode/signature/dimensions/mtime/nontrivial bytes, hashes media+sidecar with Node crypto, stores an execution receipt, and exposes a narrow verify receipt/output call used immediately before canonical approval. On restart, verify durable media/sidecar bytes from a signed or content-addressed record without overstating localStorage trust. Keep renderer/domain rehashing as defense in depth and use known SHA vectors. Delete/remove all renderer reachability for engines.benchmark, stills.wake/expose and legacy shot StillBay; dev/server functions remain fail-closed. Replace Generate rails shot controls with prepared assets only. Set durable media root from Electron app.getPath(userData), register a traversal/symlink-safe read-only media scheme, and never write cwd/source/temp copies as canonical. Enforce size limits on IPC byte arrays and references. Review stage must render real image A/B cards, deterministic continuity findings, checkboxes for each blocker/manual item, and an editable nonempty reason; never hard-code confirmation/reason. Approval requires fresh backend verification plus current dependencies and appends decisions without deleting/replacing iterations. Reject preserves media. Ensure migration sanitizes all fields and Last Reel. Make manifests dynamic: READY only from exact present components, official runtime shape, package resources, memory/headroom; incomplete alternatives disabled/Labs. Remove unsafe benchmark UI and misleading status. Add/repair tests for authorization/token replay/cross binding/expiry, prepared freshness, direct-route denial, origin, durable traversal/symlink/tamper/restart verification, real hashes, exact local CLIP manifest, no auto-load, offline env, worker IPC schemas, residency truth, telemetry null semantics, iteration/decision immutability, continuity inputs, persistence, Review stage, accessibility and responsive layout. Update harness expectations but do not package. Update ledgers SOURCE_REPAIRED_AWAITING_REVIEW, Wave5 closed. Run npm test/typecheck/build/git diff --check and leave unstaged/no commit.",
  output: "implementation/wave4-security-recovery.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] },
  maxRuntimeMs: 18000000
});

let reviews = await runs.all([
  {
    key: "wave4-recovery-a07",
    agent: "oracle",
    task: contract("A07 fresh Wave4 source auditor") + " Inspect the entire actual diff from " + BASE + ", component report " + analysis[0].output + " and recovery " + repair.output + ". Re-run all source gates. Verify I-001..I-008, complete reachable Prepared -> Generate -> Review -> canonical domain/UI path, dynamic exact manifest, app-owned worker/resource, sticky contract, durable media, additive migration and 14-stage policy. Treat empirical inference as package-only, but source must be genuinely executable if the declared exact local candidate is present. No mutation/process/model/package.",
    outputSchema: reviewSchema,
    maxRuntimeMs: 9000000
  },
  {
    key: "wave4-recovery-a64",
    agent: "oracle",
    task: contract("A64 fresh source security red-team") + " Inspect full diff and recovery " + repair.output + ". Attempt every prior bypass: forged/missing/stale prepared state, replay/cross-asset token, direct benchmark/wake/expose/dev generation, absolute model/output path, URI traversal/symlink, oversized payload, forged/tampered bytes/sidecar/receipt, approval without explicit continuity reason/findings, mutable history, auto-load on inspect, external/cache writes, cloud/8188 and renderer primitives. Confirm the app does not kill or contact ambient operator processes. Re-run tests/typecheck/build/diff. No mutation/model/package.",
    outputSchema: reviewSchema,
    maxRuntimeMs: 9000000
  }
]);

function blocked(items) {
  for (let i = 0; i < items.length; i++) {
    if (!items[i] || !items[i].structuredOutput || items[i].structuredOutput.verdict !== "pass") return true;
  }
  return false;
}

if (blocked(reviews)) {
  const finalRepair = await runs.run("wave4-recovery-final-repair", {
    agent: "worker",
    task: contract("A33/A34 sole final Wave4 source repair") + " Repair all fresh findings without weakening the gate: " + JSON.stringify(reviews.map(function (x) { return x && x.structuredOutput ? x.structuredOutput : null; })) + ". Add exact regressions and run full source gates. Do not package/launch Python or model/commit/touch external roots. Wave5 closed.",
    output: "implementation/wave4-final-source-repair.md",
    outputMode: "file-only",
    acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] },
    maxRuntimeMs: 14400000
  });
  const rereview = await runs.run("wave4-recovery-rereview", {
    agent: "oracle",
    task: contract("combined A07/A64 post-repair gate") + " Freshly inspect complete diff and " + finalRepair.output + ". Reproduce all prior security/domain/data/UI attacks and run full source gates. No package/model/mutation. Pass only with no source blocker; external empirical runtime is a later distinct gate.",
    outputSchema: reviewSchema,
    maxRuntimeMs: 9000000
  });
  reviews = [rereview];
}

if (blocked(reviews)) {
  return { status: "BLOCKED_WAVE4_SOURCE_RECOVERY", completedGreenThrough: 3, component: component, reviews: reviews.map(function (x) { return x && x.structuredOutput ? x.structuredOutput : null; }) };
}

const pack = await runs.run("wave4-recovery-package", {
  agent: "worker",
  task: contract("A04 exclusive Wave4 package and native-runtime gate") + " Source passed and component candidate is " + JSON.stringify(component) + ". Inspect all plans/reviews/current diff. If component verdict is blocked or static evidence is incomplete, package and commit a truthful fail-closed SOURCE/PACKAGE checkpoint with docs/release/wave4-gate.md status BLOCKED_EXTERNAL_RUNTIME, no green tag/Wave5, then return blocked; never improvise a substitute. If candidate passes, take exclusive process/data lease. Preserve a metadata snapshot of all ambient operator LM Studio/ComfyUI/Python processes and never stop/contact them. Back up+manifest live %APPDATA%/Premiere316. Snapshot exact selected weights/cache/package/runtime file size/mtime/full or explicitly sampled hashes. Verify available GPU headroom after ambient use, official source identity, exact Python package/resource identities, app-owned worker hash, offline env and no 8188 routes. Run tests/typecheck/build/package/security/ASAR/UI-resource/installer/shortcut checks. Update packaged zero-inference smoke and native visual matrix for all current stages at 100/150 and mobile; prove startup/catalog/inspect do not launch our Python worker. Using a fresh isolated profile and packaged Premiere316.exe only, establish one current approved prepared character asset as fixture prerequisites, then use visible Generate controls to authorize and launch one small real FLUX.1 iteration. Generate a second iteration via a second explicit click without release. Prove one-use authorization tokens, exact local standalone CLIP/T5/transformer/VAE IDs, same resident component digest before warm job, valid nontrivial decodable PNGs, distinct real SHA-256s, sidecars/receipts, profile-durable media, measured cold/warm/load/inference/VRAM/RAM where available and null otherwise. Sample process network connections throughout: Premiere316/backend/worker make zero external or 8188 connections; do not attribute ambient connections. Use visible Review A/B, visually inspect both outputs, display concrete continuity findings, enter a genuine reason, confirm only defensible items, reject one and canonically approve the other after privileged re-verification. Test stale/tamper/replay denial without extra generation. Copy bounded PNGs/sidecars/receipts/screenshots/reports to screenshots/wave4-native. Click visible Release exactly once; verify only Premiere316 child worker exits and ambient processes remain as before. Delete isolated profile after evidence copy. Prove live user data and selected weights/caches/external repos unchanged, restore live profile on any drift. If any model/import/CUDA/runtime/output fails, release only our worker, preserve evidence, set BLOCKED_EXTERNAL_RUNTIME and keep Wave5 closed; do not fake. Otherwise write docs/release/wave4-gate.md and machine reports, update I-001..I-008 PACKAGE_PASS_AWAITING_AUDIT, commit source/package/evidence as `feat(wave4): package genuine native image gate`, no tag/Wave5. Leave clean and return exact outcome.",
  outputSchema: packageSchema,
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] },
  maxRuntimeMs: 32400000
});

if (!pack.structuredOutput || pack.structuredOutput.verdict !== "pass") {
  return { status: "BLOCKED_WAVE4_RUNTIME", completedGreenThrough: 3, component: component, package: pack.structuredOutput || null };
}

const p = pack.structuredOutput;
function auditTask(role, focus) {
  return contract(role) + " Wave4 package checkpoint " + JSON.stringify(p) + ". Independently inspect actual source/commit/package, docs/release/wave4-gate.md, generated PNGs/sidecars/receipts, visible-control traces, process/network/component/data manifests and host cleanup. Read-only; never generate/load/release/mutate. " + focus;
}

const audits = await runs.all([
  {
    key: "wave4-recovery-runtime-a07",
    agent: "oracle",
    task: auditTask("A07 native runtime evidence auditor", "Re-run source tests/typecheck/build/diff. Recompute package/resource and generated-artifact hashes. Verify zero-inference smoke, all-stage captures, exact two-click cold/warm sticky residency, real PNG decode, provenance, durable verification, A/B decisions/canonical approval and representative visual inspection."),
    outputSchema: reviewSchema,
    maxRuntimeMs: 9000000
  },
  {
    key: "wave4-recovery-runtime-a08",
    agent: "oracle",
    task: auditTask("A08 release/data auditor", "Verify ancestry from Wave3 tag, package/build/installer/shortcut, source/component/worker identities, live-data and external model/cache/repo pre/post equality, ambient process preservation, child process cleanup, leases/64 roles/concurrency five, no Wave4 tag and Wave5 closed."),
    outputSchema: reviewSchema,
    maxRuntimeMs: 7200000
  },
  {
    key: "wave4-recovery-runtime-a64",
    agent: "oracle",
    task: auditTask("A64 native-image final red team", "Veto imported/mock/placeholder output, seeded pass booleans, direct/non-packaged generation, auto-load, component substitution, network/8188/cloud, ambient-process interference, fake telemetry, token/receipt/tamper bypass, stale/unconfirmed approval, mutable history, inaccessible Review UI or protected-data drift. Visually inspect real outputs and screenshots."),
    outputSchema: reviewSchema,
    maxRuntimeMs: 9000000
  }
]);

let auditBlocked = false;
const auditValues = audits.map(function (x) {
  if (!x || !x.structuredOutput) {
    auditBlocked = true;
    return null;
  }
  if (x.structuredOutput.verdict !== "pass") auditBlocked = true;
  return x.structuredOutput;
});
if (auditBlocked) return { status: "BLOCKED_WAVE4_AUDIT", completedGreenThrough: 3, package: p, audits: auditValues };

const final = await runs.run("wave4-recovery-finalize", {
  agent: "worker",
  task: contract("A01 Wave4 governance finalizer") + " All three audits pass: " + JSON.stringify(auditValues) + ". Governance/evidence only; no runtime/package/generation. Verify clean package commit/build/artifacts/manifests and no Wave4 tag. Reconcile release report and orchestration ledgers: I-001..I-008 DONE, Wave4 GREEN, currentWave 5, Wave5 OPEN not started with only dependency roots READY; Waves6-8 closed. Record released lease, 64 logical roles/concurrency five. Commit `chore(wave4): attest native image gate and open wave5`; create annotated tag `wave4-" + String(p.buildId) + "` without moving tags. Verify JSON/ancestry/package+real-media hashes, live/model evidence, clean tree, our processes zero and ambient processes untouched. Return exact result.",
  outputSchema: finalSchema,
  acceptance: { level: "checked", evidence: ["changed-files", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] },
  maxRuntimeMs: 3600000
});

return {
  status: final.structuredOutput && final.structuredOutput.verdict === "pass" ? "WAVE_4_GREEN_WAVE_5_OPEN" : "BLOCKED_WAVE4_FINALIZATION",
  completedGreenThrough: final.structuredOutput && final.structuredOutput.verdict === "pass" ? 4 : 3,
  package: p,
  audits: auditValues,
  final: final.structuredOutput || null
};
