const ROOT = "D:/Projects/Premiere316_v3";
const HEAD = "527046e";
const TAG = "wave3-p316-20260903203247-955eb4a6feaa";
const SPEC = ROOT + "/docs/orchestration/spec";

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["auditor", "verdict", "blockerKind", "summary", "findings"],
  properties: {
    auditor: { type: "string" },
    verdict: { type: "string", enum: ["pass", "blocked"] },
    blockerKind: { type: "string", enum: ["none", "code", "components", "external-runtime", "migration", "data", "security", "ui", "accessibility", "evidence", "packaging"] },
    summary: { type: "string" },
    findings: { type: "array", items: { type: "string" }, maxItems: 50 }
  }
};

const componentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "selectedAdapter", "runtimeCandidate", "summary", "components", "findings"],
  properties: {
    verdict: { type: "string", enum: ["pass", "blocked"] },
    selectedAdapter: { type: ["string", "null"] },
    runtimeCandidate: { type: ["string", "null"] },
    summary: { type: "string" },
    components: { type: "array", items: { type: "string" }, maxItems: 40 },
    findings: { type: "array", items: { type: "string" }, maxItems: 40 }
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
    generatedArtifacts: { type: "array", items: { type: "string" }, maxItems: 20 },
    findings: { type: "array", items: { type: "string" }, maxItems: 50 }
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
    findings: { type: "array", items: { type: "string" }, maxItems: 30 }
  }
};

function contract(role) {
  return "TARGET " + ROOT + " at clean Wave3 GREEN commit " + HEAD + " tag " + TAG + ". Read AGENTS.md, " + SPEC + "/PREMIERE316_V3_64_AGENT_MASTER_ORCHESTRATION_PROMPT.md, roster, stage matrix, task-status/wave-status/file-leases and docs/release/wave3-gate.md. Act as logical " + role + " on openai-codex/gpt-5.5 medium. Exactly 64 logical roles remain; physical concurrency <=5 (this workflow peaks 3), one writer in shared cwd. Preserve protected commits/tags, Premiere316.exe, The Last Reel, approved bytes/IDs/history, local persist key premiere316-v302-c, secure Electron (contextIsolation true/nodeIntegration false/sandbox/webSecurity), 100-200% zoom and additive hydration. Auth/database/cloud remain off. Never download/convert/rename/move/copy/delete/edit model weights or write D:/AI/Models; never edit installed external runtime repos; never invoke ComfyUI code/process/workflows/port; never use hosted inference. LM Studio remains unloaded and is not needed. Image inference may occur only in the later packaged runtime gate after exact offline checks and only through an explicit visible user action; no source/planning reviewer may load a model. Unsupported adapters remain disabled/Labs. Wave5 closed until Wave4 package and A07/A08/A64 pass.";
}

const plans = await runs.all([
  {
    key: "wave4-components",
    agent: "p316-captain",
    task: contract("A38 Component Resolver specialist") + " READ-ONLY I-001 survey. Do not spawn children, start Python, import a model, allocate CUDA, write caches/pyc/logs, or alter any file. Inspect exact metadata for D:/Projects/flux, D:/Projects/Flux2, D:/Dev/Tools/Python312, D:/_Cache/HuggingFace and only relevant D:/AI/Models files. Verify official repository identities, worker/API compatibility, Python/torch package metadata without imports where possible, CUDA/GPU memory via nvidia-smi, exact checkpoint/encoder/tokenizer/VAE cache revisions, sizes/mtimes and safe sampled identities already supported by app. Re-evaluate FLUX.1, FLUX.2 Dev, Klein 4B/9B, Krea 2 independently. Select the smallest complete genuine offline native path; prefer exact FLUX.1 only if complete and safe because I-002 is the P0 dependency, otherwise name the real blocker. Do not infer components by filename similarity. Audit current src/lib/studio/local-still.server.ts and external stills_worker.py, including whether FLUX.1 really remains resident. Never expose secrets. Return a truthful table and structured verdict; a blocked runtime is acceptable and must not be faked.",
    output: "plans/wave4-components.md",
    outputMode: "file-only",
    outputSchema: componentSchema,
    maxRuntimeMs: 3600000
  },
  {
    key: "wave4-architecture",
    agent: "oracle",
    task: contract("A33/A39 image-runtime architect") + " Read-only architecture plan for I-001..I-008. Inspect current dormant model scanner/config/controls/native contract/provenance/residency/backend/preload/UI/store/production graph and official installed runtime interfaces. Specify exact privileged component resolver, relative-path renderer contract, allowlisted worker IPC, offline enforcement, conservative memory preflight, sticky residency and explicit release, actual/null telemetry, durable isolated media paths, output validation and immutable provenance. Specify additive ProductionAsset iteration/review-decision/canonical approval/continuity schemas and migration, prepared dependency revalidation, A/B comparison and a first-class Review stage if that best follows the canonical Stage Layout Matrix. Controls must be adapter-specific; no fake knobs. Include tests, 390px/100-200% UX, package harness, cold/warm acceptance and rollback strategy. No edits or process/model launch.",
    output: "plans/wave4-architecture.md",
    outputMode: "file-only",
    maxRuntimeMs: 3600000
  },
  {
    key: "wave4-preredteam",
    agent: "oracle",
    task: contract("A40/A64 native-image pre-red-team") + " Read-only attack of the currently dormant Wave4 code. Find every route that could auto-load, execute an arbitrary path, leak filesystem/process capabilities to renderer, trust filename-only model identity, silently reach network, write weights/caches/external repos, fabricate telemetry/residency, lose iterations/approved history, approve stale outputs, save ephemeral URLs, or claim visual identity without evidence. Inspect packaging resources and current UI reachability. Provide concrete P0/P1 regression requirements and a packaged visible-control proof standard. No edits/process/model launch.",
    output: "plans/wave4-preredteam.md",
    outputMode: "file-only",
    maxRuntimeMs: 3600000
  }
]);

const component = plans[0].structuredOutput || null;
const implementation = await runs.run("wave4-implementation", {
  agent: "worker",
  task: contract("A34/A32 sole Wave4 source writer under A33/A38/A39/A40 authority") + " Read the design-ui skill and plans " + plans[0].output + ", " + plans[1].output + ", " + plans[2].output + " plus component verdict " + JSON.stringify(component) + ". Take an exclusive Wave4 source lease. Implement the complete software slice I-001..I-008 without launching any model or packaging. Use an app-owned, allowlisted native worker/boundary or immutable official installed API; do not edit D:/Projects/flux, D:/Projects/Flux2, caches or model files. Exact component resolution must run privileged/read-only, bind explicit checkpoint+encoder/tokenizer+VAE revisions, expose only renderer-safe IDs/relative paths, verify local existence/type/size/fingerprint, force offline mode and fail closed. Implement at least the selected complete FLUX.1 path if component truth supports it; all incomplete FLUX.2/Klein/Krea paths stay visibly disabled/Labs with exact reasons. Do not pretend filename mapping proves runnable. Implement capability-owned Basic/Advanced/Expert controls only. Add conservative memory planning, genuine sticky residency with authoritative ping, explicit user release, and telemetry sourced from actual worker measurements with unknowns null. Ensure no model wake occurs on catalog/inspect/startup. Implement the domain path PreparedAssetRecord -> explicit selected prepared-asset generation -> append-only immutable iteration record/media hash/provenance -> A/B review -> append-only approve/reject decision -> explicit canonical approved iteration. Canonical approval must reject stale dependencies, wrong asset/spec/engine, invalid/missing output/provenance, continuity blockers, rejected iteration, or silent replacement. Preserve all prior approved iterations and spec history. Implement deterministic character identity/reference continuity checks against approved bibles/spec locks, expose findings, and require explicit reviewer confirmation/reason rather than fabricate pixel understanding. Add a polished stage-owned Generate flow and Review stage/central policy/navigation if required by canonical matrix, with focus-safe drawers/modals, 44px touch targets, 390px and 100-200% behavior; timeline remains Stitch-only and generation rails Generate-only. Store media durably under the desktop isolated/user-data media root through privileged service; web mode remains honest disabled/import-only, no auth/db. Update additive persistence/hydration and fine-grained dependency graph. Add output PNG validation and sidecar provenance. Package an app-owned worker/resource if needed; set PYTHONDONTWRITEBYTECODE and offline env, avoid arbitrary command/path input. Add exhaustive deterministic doubles/tests for component identity, no auto-load/network/ComfyUI, path traversal, controls, residency, telemetry nulls, output validation, iteration immutability, stale rejection, continuity, migration, stage policy and UI route reachability. Update ledgers truthfully to SOURCE_IMPLEMENTED_AWAITING_REVIEW/PACKAGE; Wave5 closed. Run npm test/typecheck/build/git diff --check. Leave coherent unstaged source diff; no commit/tag/package/external writes/generation.",
  output: "implementation/wave4-gpt55.md",
  outputMode: "file-only",
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] },
  maxRuntimeMs: 14400000
});

let sourceReviews = await runs.all([
  {
    key: "wave4-source-a07",
    agent: "oracle",
    task: contract("A07 independent Wave4 source/test auditor") + " Inspect the entire working diff from " + HEAD + " and plans/results " + implementation.output + ". Re-run npm test/typecheck/build/diff checks. Audit every I-001..I-008 requirement, additive migration/history, Stage Layout, output/media durability, controls, component resolver, runtime contract, tests and actual UI reachability. No model/process/package/mutation. Pass only if source is ready for genuine packaged generation.",
    outputSchema: reviewSchema,
    maxRuntimeMs: 7200000
  },
  {
    key: "wave4-source-a64",
    agent: "oracle",
    task: contract("A64 source security/data red team") + " Inspect full diff and " + implementation.output + ". Try to bypass explicit action/exact identity/path allowlists/offline mode/stale gates/continuity confirmation/append-only review/canonical approval. Check no arbitrary shell/filesystem primitive reaches renderer, no auto-wake, no ComfyUI/cloud/download/cache writes, no fabricated telemetry, no model mutation and no old-data/Last Reel loss. Inspect responsive/accessibility test coverage. No model/process/package/mutation. Return blocked on any exploitable or false-evidence path.",
    outputSchema: reviewSchema,
    maxRuntimeMs: 7200000
  }
]);

function reviewsBlocked(items) {
  for (let i = 0; i < items.length; i++) {
    if (!items[i] || !items[i].structuredOutput || items[i].structuredOutput.verdict !== "pass") return true;
  }
  return false;
}

if (reviewsBlocked(sourceReviews)) {
  const repair = await runs.run("wave4-source-repair", {
    agent: "worker",
    task: contract("A33/A34/A32 sole Wave4 source repair writer") + " Repair every source finding without reducing acceptance: " + JSON.stringify(sourceReviews.map(function (x) { return x && x.structuredOutput ? x.structuredOutput : null; })) + ". Add regressions, retain exact component truth and explicit-action security. Run full source gates. No package/model/process/external repo/model/cache mutation/commit/tag. Update implementation report.",
    output: "implementation/wave4-source-repair.md",
    outputMode: "file-only",
    acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] },
    maxRuntimeMs: 10800000
  });
  const rereview = await runs.run("wave4-source-rereview", {
    agent: "oracle",
    task: contract("combined A07/A64 fresh source reviewer") + " Inspect the entire actual diff and repair " + repair.output + " against all prior findings and I-001..I-008. Re-run test/typecheck/build/diff. No model/package/mutation. Pass only with no code/migration/data/security/UI/accessibility blocker.",
    outputSchema: reviewSchema,
    maxRuntimeMs: 7200000
  });
  sourceReviews = [rereview];
}

if (reviewsBlocked(sourceReviews)) {
  return {
    status: "BLOCKED_WAVE4_SOURCE",
    completedGreenThrough: 3,
    component: component,
    reviews: sourceReviews.map(function (x) { return x && x.structuredOutput ? x.structuredOutput : null; })
  };
}

const pack = await runs.run("wave4-package-runtime", {
  agent: "worker",
  task: contract("A04 exclusive Wave4 package/native-runtime gate owner") + " Source passed. Inspect all plans/reviews and current diff. Take exclusive package/process/data lease. Repair only narrow integration defects. Before any generation, cold-backup and manifest live %APPDATA%/Premiere316, snapshot path/size/mtime plus safe sampled fingerprints for the exact selected D:/AI/Models components and required offline cache revisions, verify official runtime/code identities, no ComfyUI process/port, no LM Studio model, enough GPU/system memory, offline env and output path isolation. Run all source gates, package Windows, verify source/build identity/ASAR/external resources/installer/shortcut/security and update native visual harness for every current stage at 100/150 plus mobile-width behavior. Run ordinary serialized packaged smoke first with zero inference and verify no auto-load. Then, and only through packaged Premiere316.exe visible controls under a fresh isolated profile, establish prerequisites for one approved prepared character asset, select the exact verified native FLUX.1 configuration, choose a small supported draft resolution, and click the explicit Generate action. Produce two genuine local PNG iterations sequentially (cold then warm) without intermediate unload, prove the same authoritative resident model/components before the warm job, validate signatures/dimensions/decodability/nontrivial bytes/content hashes, sidecars and durable media URIs. Use visible Review-stage controls for A/B compare, inspect both real images, record honest continuity findings, explicitly confirm with a reason only if defensible, reject one and canonically approve the other. Prove rejected/approved/history records are append-only, old approved data survives, dependencies current, provenance exact, network attempts absent, actual timings/memory (unknown values remain null), model/cache manifests unchanged and no fake placeholders. Capture native screenshots and copy bounded real generated outputs+sidecars to screenshots/wave4-native for evidence. Run a warm/cold benchmark only if the two required iterations already provide the measurements; do not add gratuitous generations. Click the visible explicit Release action once at the final boundary; verify Python/app/Electron/model processes gone. Delete isolated profile only after evidence copy. Compare/restore live data byte-identically. If exact components/runtime fail or either genuine output cannot be produced, record BLOCKED_EXTERNAL_RUNTIME truthfully; still commit coherent source plus blocked evidence, create no green tag and keep Wave5 closed. If pass, write docs/release/wave4-gate.md and machine reports, set PACKAGE_PASS_AWAITING_AUDIT, commit source/evidence as `feat(wave4): package native image generation gate`, no tag/Wave5. Leave clean and return exact commit/build/artifacts/findings.",
  outputSchema: packageSchema,
  acceptance: { level: "checked", evidence: ["changed-files", "tests-added", "commands-run", "validation-output", "residual-risks", "diff-summary", "no-staged-files"] },
  maxRuntimeMs: 28800000
});

if (!pack.structuredOutput || pack.structuredOutput.verdict !== "pass") {
  return { status: "BLOCKED_WAVE4_RUNTIME", completedGreenThrough: 3, component: component, package: pack.structuredOutput || null };
}

const p = pack.structuredOutput;
function auditTask(role, focus) {
  return contract(role) + " Packaged Wave4 checkpoint: " + JSON.stringify(p) + ". Independently inspect actual commit, docs/release/wave4-gate.md, machine reports, real PNGs/sidecars/screenshots, source/package and current host state. Read-only: do not run generation, load/unload models, mutate profiles or files. " + focus;
}

const audits = await runs.all([
  {
    key: "wave4-a07",
    agent: "oracle",
    task: auditTask("A07 runtime test/evidence auditor", "Re-run source tests/typecheck/build/diff checks. Verify package/build/resource hashes, all-stage native captures, serialized zero-inference smoke, exact component manifests, two real valid outputs, cold/warm residency telemetry, immutable iterations/review/canonical approval and representative screenshot/image inspection."),
    outputSchema: reviewSchema,
    maxRuntimeMs: 7200000
  },
  {
    key: "wave4-a08",
    agent: "oracle",
    task: auditTask("A08 release/data auditor", "Verify clean ancestry from Wave3 tag, package identity/hashes/installer/shortcut, live data pre/post byte identity, model/cache manifests unchanged, temp/process cleanup, leases/64 roles/concurrency five, no tag and Wave5 closed. Recompute bounded artifact hashes."),
    outputSchema: reviewSchema,
    maxRuntimeMs: 5400000
  },
  {
    key: "wave4-a64",
    agent: "oracle",
    task: auditTask("A64 native-image red team", "Veto mock/placeholder/imported output, seeded pass flags, browser/dev-only action, automatic load, wrong/substituted components, path traversal/arbitrary commands, downloads/network/cloud/ComfyUI, external repo/model/cache writes, fake residency/telemetry, invalid output, mutable/lost history, stale or unconfirmed canonical approval, missing character continuity, UI stage leakage or data drift. Inspect generated PNGs and visible-control traces."),
    outputSchema: reviewSchema,
    maxRuntimeMs: 7200000
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

if (auditBlocked) {
  return { status: "BLOCKED_WAVE4_AUDIT", completedGreenThrough: 3, package: p, audits: auditValues };
}

const final = await runs.run("wave4-finalize", {
  agent: "worker",
  task: contract("A01 Wave4 governance finalizer") + " A07/A08/A64 passed: " + JSON.stringify(auditValues) + ". Governance/evidence only; no package/runtime/model/media rerun. Verify clean checkpoint " + String(p.commit) + ", package/build/artifact/model-data evidence and no target tag. Reconcile docs/release/wave4-gate.md, task-status/file-leases/wave-status: I-001..I-008 DONE, Wave4 GREEN, currentWave 5, Wave5 OPEN but not started with only dependency roots READY and dependents blocked; Waves6-8 closed. Record released lease, exact 64 logical roles, concurrency five. Commit `chore(wave4): attest native image gate and open wave5`; create annotated tag `wave4-" + String(p.buildId) + "` without moving existing tags. Verify JSON/ancestry/package hashes/model and live-data evidence, clean tree, no Premiere316/Electron/Python worker/loaded model process. Return result.",
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
