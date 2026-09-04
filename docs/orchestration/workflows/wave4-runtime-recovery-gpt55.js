const ROOT = "D:/Projects/Premiere316_v3";
const BASE = "527046e0b4ee45031fde3b740a9fcfac1f21f534";
const PRIOR = "C:/Users/teeja/.pi/agent/sessions/--D--Projects-Premiere316_v3--/subagent-artifacts/outputs/7530a147-786c-4fb8-ab94-d2169e1b141f";

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
  required: ["verdict", "candidate", "summary", "componentIds", "loaderContract", "findings"],
  properties: {
    verdict: { type: "string", enum: ["pass", "blocked"] },
    candidate: { type: ["string", "null"] },
    summary: { type: "string" },
    componentIds: { type: "array", items: { type: "string" }, maxItems: 30 },
    loaderContract: { type: ["string", "null"] },
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

function text(lines) {
  return lines.join(" ");
}

function contract(role) {
  return text([
    "TARGET " + ROOT + " at Wave3 GREEN base " + BASE + " with the current uncommitted Wave4 source/security recovery diff.",
    "Act as logical " + role + " on openai-codex/gpt-5.5 medium; exactly 64 logical roles, physical concurrency <=5 (peak three), one writer.",
    "Preserve protected commits/tags/package, Premiere316.exe, The Last Reel, approved bytes/IDs/history, premiere316-v302-c, secure Electron, additive hydration, 390px and 100-200% zoom.",
    "No auth/database/cloud. Never download/convert/copy/rename/move/delete/edit weights or write D:/AI/Models, installed runtime repos, Python packages, or shared model/cache snapshots.",
    "Never invoke/connect to ComfyUI or port 8188. Ambient operator LM Studio/ComfyUI/Python processes are untouchable: do not stop, attach to, query internally, or blame them; isolate and prove Premiere316 child behavior.",
    "No model auto-load. Only the later packaged Premiere316 visible Generate action may launch the app-owned allowlisted FLUX.1 worker. Wave5 closed until package plus A07/A08/A64 pass."
  ]);
}

const prep = await runs.all([
  {
    key: "wave4-t5-components",
    agent: "p316-captain",
    task: contract("A38 standalone encoder resolver") + text([
      "READ-ONLY and no children/Python import/model/CUDA/process launch.",
      "The prior survey missed D:/AI/Models/text_encoders/t5xxl_fp16.safetensors (9787841024 bytes). Stat and fully hash it if practical, parse its safetensors header, prove exact T5-v1.1-XXL encoder schema: shared embedding, 24 encoder blocks, d_model 4096, d_ff 10240, 64 heads, gated-gelu, final norm and vocab 32128.",
      "Bind tokenizer/config only to the direct local google/t5-v1_1-xxl snapshot revision 3db67ab1af984cf10548a73467f0e5bca2aaaeb2; do not use its incomplete weight blob.",
      "Reconfirm standalone clip_l.safetensors full hash 660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd and 196-tensor CLIP-L text schema, plus OpenCLIP BPE full hash 924691ac288e54409236115652ad4aa250f48203de50a9e4722a6ecd48d6804a.",
      "Verify flux1-dev transformer, ae, official D:/Projects/flux source, Python package metadata and GPU footprint.",
      "Decide whether an app-owned worker can instantiate T5EncoderModel from local config then exact standalone encoder state, T5Tokenizer from the direct local tokenizer snapshot, CLIPTextModel from explicit ViT-L/14 text config then exact standalone state, and OpenAI SimpleTokenizer/BPE, before calling official BFL flow/AE/sampling APIs.",
      "Identify components by their own local full/sample hashes and schema; do not call them the absent HF weight snapshots or use ComfyUI code. A pass is static source candidacy pending packaged empirical proof."
    ]),
    output: "plans/wave4-standalone-encoders.md",
    outputMode: "file-only",
    outputSchema: componentSchema,
    acceptance: false,
    maxRuntimeMs: 7200000
  },
  {
    key: "wave4-current-a07-plan",
    agent: "oracle",
    task: contract("A07 current-diff review planner") + " Read-only. Inspect the current diff and " + PRIOR + "/implementation/wave4-security-recovery.md. Enumerate every remaining correctness/data/UI/package blocker after the backend-token/durable-media/explicit-review changes, including tests not actually exercising backend authority and whether no app-owned worker exists. Produce a narrow repair checklist. No source mutation or process/model launch.",
    output: "plans/wave4-current-source-gaps.md",
    outputMode: "file-only",
    acceptance: false,
    maxRuntimeMs: 5400000
  },
  {
    key: "wave4-worker-contract",
    agent: "oracle",
    task: contract("A33/A39 native worker architect") + text([
      "Read-only. Design an app-owned Python FLUX.1 JSONL worker using only installed transformers, safetensors, open_clip tokenizer data and official BFL flux source.",
      "It must directly load standalone T5/CLIP state dicts with strict key checks, retain T5/CLIP/flow/AE as one exact resident session, expose ping/generate/release only, validate all request/output paths against injected roots, reject references and unsupported controls, use 512x512 draft and official 20-step guidance 3.5 schedule, and measure load/encode/inference/decode/total/max CUDA/process RAM where available.",
      "No download/auth/API/fallback imports may execute; direct local paths only, offline env, isolated writable caches/cwd, no external repo writes. Specify package resource location and Node lifecycle/identity checks. Review backend one-use authorization, output receipt, durable profile protocol and visible Review reason/finding requirements too."
    ]),
    output: "plans/wave4-app-worker-contract.md",
    outputMode: "file-only",
    acceptance: false,
    maxRuntimeMs: 5400000
  }
]);

const component = prep[0].structuredOutput || null;
const implementation = await runs.run("wave4-runtime-writer", {
  agent: "worker",
  task: contract("A34/A32 sole Wave4 source/runtime writer") + text([
    "Read AGENTS.md and design-ui skill, all current diff, prior reports under " + PRIOR + ", and new plans " + prep[0].output + ", " + prep[1].output + ", " + prep[2].output + ". Component verdict: " + JSON.stringify(component) + ".",
    "Repair every current source gap. Keep the hardened backend one-use prepared authorization, but make its envelope independently validate full current production facts, exact approved spec/dependency fingerprints, allowed config and manifest digest; consume token before spawn, bind output receipt, and require fresh privileged durable verification before canonical approval. Be honest that renderer supplies project state while backend independently verifies invariants; do not claim cryptographic database authority.",
    "Remove all benchmark/free wake/expose/legacy shot generation from bridge, UI and dev routes. Keep ambient processes untouched. Make profile durable media protocol traversal/symlink-safe and content-addressed/versioned, with strict bounded IPC and actual PNG/sidecar hash verification.",
    "If the standalone encoder candidate passes, implement and package an app-owned desktop/workers FLUX.1 JSONL worker per the exact plan. Modify the exact component resolver to require standalone t5xxl_fp16 plus its schema/hash, direct tokenizer/config snapshot (not incomplete HF weights), standalone CLIP plus BPE, flux1-dev, AE, official runtime and package worker hash. Unsupported FLUX.2/Klein/Krea stay disabled/Labs. Never import or reuse ComfyUI code.",
    "Worker uses direct local configuration/state loading with strict missing/unexpected-key assertions and no from_pretrained weight lookup, while tokenizer loads direct local files only. It keeps all components resident and reports authoritative component digest. Explicit release only. All writable cwd/pycache/TORCH_HOME/temp/log/output are app-profile locations; strip proxy/token/API env and force offline.",
    "Generate UI authorizes only current approved prepared assets and cannot select absolute paths. Review displays media:// images in A/B layout, real deterministic findings, individual confirmations and editable explicit reason; no hard-coded confirmation. Rejection and canonical approval append history. Approval first invokes privileged durable receipt verification and then current dependency/domain validation.",
    "Add tests covering exact T5/CLIP headers/expected identities without reading gigabytes per test, packaged worker presence/hash and forbidden API/download strings, strict JSONL/path contracts, token expiry/replay/cross-asset/config/manifest/stale denial, direct route absence, origin/focus guards, durable traversal/symlink/tamper/restart verification, known SHA vectors, migration, immutable review history, Review/Generate stage ownership, responsive/focus/touch behavior, zero auto-load and ambient-process. Update package resources/test list/harness stage expectations and ledgers SOURCE_READY_AWAITING_REVIEW, Wave5 closed.",
    "Do not run Python, package, inference or write external roots. Run npm test, typecheck, build and git diff --check. No commit/staging."
  ]),
  output: "implementation/wave4-app-worker-source.md",
  outputMode: "file-only",
  acceptance: false,
  maxRuntimeMs: 21600000
});

let reviews = await runs.all([
  {
    key: "wave4-runtime-source-a07",
    agent: "oracle",
    task: contract("A07 independent source auditor") + " Inspect the complete diff from " + BASE + ", standalone component evidence " + prep[0].output + " and implementation " + implementation.output + ". Re-run npm test/typecheck/build/diff. Verify all I-001..I-008, real executable app-owned worker source/resource, exact standalone encoders, prepared-only authorization, durable output, immutable review/canonical path, 14-stage UI and migration. No Python/model/package/mutation. Pass source separately from empirical runtime.",
    outputSchema: reviewSchema,
    acceptance: false,
    maxRuntimeMs: 10800000
  },
  {
    key: "wave4-runtime-source-a64",
    agent: "oracle",
    task: contract("A64 independent source red team") + " Inspect the complete diff and implementation " + implementation.output + ". Attack token/envelope replay/cross binding/expiry, stale state, direct/free generation, worker/path/protocol traversal and symlink escape, caller-forged/tampered output and receipts, auto-load, download/API/proxy/cache writes, fake residency/telemetry, hard-coded continuity, history replacement, renderer primitive leakage, ambient process interference and Last Reel loss. Run source gates; no Python/model/package/mutation.",
    outputSchema: reviewSchema,
    acceptance: false,
    maxRuntimeMs: 10800000
  }
]);

function isBlocked(items) {
  for (let i = 0; i < items.length; i++) {
    if (!items[i] || !items[i].structuredOutput || items[i].structuredOutput.verdict !== "pass") return true;
  }
  return false;
}

if (isBlocked(reviews)) {
  const repair = await runs.run("wave4-runtime-final-repair", {
    agent: "worker",
    task: contract("A33/A34 sole final source repair") + " Repair every finding without reducing scope: " + JSON.stringify(reviews.map(function (x) { return x && x.structuredOutput ? x.structuredOutput : null; })) + ". Add exact regressions and pass npm test/typecheck/build/diff. No Python/model/package/external-root mutation/commit. Wave5 closed.",
    output: "implementation/wave4-app-worker-final-repair.md",
    outputMode: "file-only",
    acceptance: false,
    maxRuntimeMs: 18000000
  });
  const rereview = await runs.run("wave4-runtime-source-rereview", {
    agent: "oracle",
    task: contract("combined A07/A64 post-repair source gate") + " Freshly inspect the entire diff and " + repair.output + ". Reproduce all prior correctness/security/data/UI attacks and run full source gates. Do not launch Python/model/package or mutate. Pass only with no source blocker; empirical native execution remains the package gate.",
    outputSchema: reviewSchema,
    acceptance: false,
    maxRuntimeMs: 10800000
  });
  reviews = [rereview];
}

if (isBlocked(reviews)) {
  return { status: "BLOCKED_WAVE4_SOURCE", completedGreenThrough: 3, component: component, reviews: reviews.map(function (x) { return x && x.structuredOutput ? x.structuredOutput : null; }) };
}

const pack = await runs.run("wave4-runtime-package", {
  agent: "worker",
  task: contract("A04 exclusive packaged native FLUX.1 gate owner") + text([
    "Source passed; component result is " + JSON.stringify(component) + ". Inspect every plan/review and actual diff.",
    "If the candidate remains blocked, package the fail-closed app, write docs/release/wave4-gate.md with BLOCKED_EXTERNAL_RUNTIME, update ledgers, commit coherent source/evidence, no tag/Wave5, and return blocked. Never substitute or download.",
    "If candidate passes, take exclusive package/process/data lease. Record ambient operator process metadata and never stop/contact those processes. Cold-backup+manifest live %APPDATA%/Premiere316. Manifest exact standalone encoders, tokenizer/config/BPE, transformer, AE, official source, Python packages and app worker pre-run using full hashes for feasible files and explicit sampled+size+mtime for huge files; full-hash selected huge components once if practical. Check GPU total/free after ambient use and block before OOM risk.",
    "Run test/typecheck/build/package/security/ASAR/UI-resource/worker-resource/installer/shortcut gates. Run packaged zero-inference smoke and every current stage native capture at 100/150 plus mobile before generation; prove catalog/inspect does not spawn our worker.",
    "In a fresh isolated profile, use only visible packaged controls to establish one current approved prepared character fixture, authorize, and click Generate for a 512x512 draft. Produce exactly two genuine PNG iterations via two explicit clicks without intermediate release. Validate strict worker component load, same resident digest before warm generation, nontrivial decodable PNGs, distinct real media/sidecar hashes, durable profile files/receipts and honest measured/null telemetry. Sample Premiere316/backend/worker network connections; require zero external and 8188 traffic while ignoring ambient process traffic.",
    "Use visible Review A/B. Visually inspect both outputs, retain screenshots, present concrete continuity findings, type a genuine reason, confirm only defensible findings, reject one, and canonically approve the other after privileged fresh byte/receipt verification. Prove one-use token replay, stale and tamper denial without extra generations, append-only rejected+approved history, and protected Last Reel state.",
    "Copy bounded real PNGs/sidecars/receipts/screenshots and machine reports under screenshots/wave4-native. Click visible Release exactly once, verify only our child worker exits and ambient processes remain. Delete isolated profile after copying evidence. Prove live user data and external model/cache/runtime trees unchanged; restore live data on drift.",
    "On any import/CUDA/runtime/output failure, safely release only our worker, preserve truthful evidence, mark BLOCKED_EXTERNAL_RUNTIME and keep Wave5 closed. If all pass, write docs/release/wave4-gate.md, set I-001..I-008 PACKAGE_PASS_AWAITING_AUDIT, commit source/evidence as feat(wave4): package genuine native image gate, no tag/Wave5. Leave clean and return exact results."
  ]),
  outputSchema: packageSchema,
  acceptance: false,
  maxRuntimeMs: 36000000
});

if (!pack.structuredOutput || pack.structuredOutput.verdict !== "pass") {
  return { status: "BLOCKED_WAVE4_RUNTIME", completedGreenThrough: 3, component: component, package: pack.structuredOutput || null };
}

const p = pack.structuredOutput;
function auditTask(role, focus) {
  return contract(role) + " Wave4 package checkpoint " + JSON.stringify(p) + ". Independently inspect source/commit/package, docs/release/wave4-gate.md, genuine PNGs/sidecars/receipts, visible-control traces, process/network/component/data manifests and cleanup. Read-only; never generate/load/release/mutate. " + focus;
}

const audits = await runs.all([
  {
    key: "wave4-runtime-a07",
    agent: "oracle",
    task: auditTask("A07 native evidence auditor", "Re-run source gates; recompute package/worker/output hashes; verify zero-inference smoke, all-stage captures, exact cold/warm sticky execution, PNG decode, durable receipt, review/canonical history and visual evidence."),
    outputSchema: reviewSchema,
    acceptance: false,
    maxRuntimeMs: 10800000
  },
  {
    key: "wave4-runtime-a08",
    agent: "oracle",
    task: auditTask("A08 release/data auditor", "Verify ancestry/package/build/installer/shortcut, exact component/worker identities, live-data and external-root equality, ambient process preservation, child cleanup, leases/64 roles/concurrency five, no Wave4 tag and Wave5 closed."),
    outputSchema: reviewSchema,
    acceptance: false,
    maxRuntimeMs: 9000000
  },
  {
    key: "wave4-runtime-a64",
    agent: "oracle",
    task: auditTask("A64 native-image red team", "Veto imported/mock/placeholder output, seeded booleans, non-packaged/direct generation, component substitution, network/8188, ambient interference, fake residency/telemetry, auth/receipt/tamper bypass, stale/unconfirmed approval, inaccessible UI or protected-data drift. Visually inspect outputs."),
    outputSchema: reviewSchema,
    acceptance: false,
    maxRuntimeMs: 10800000
  }
]);

let auditsBlocked = false;
const auditValues = audits.map(function (x) {
  if (!x || !x.structuredOutput) {
    auditsBlocked = true;
    return null;
  }
  if (x.structuredOutput.verdict !== "pass") auditsBlocked = true;
  return x.structuredOutput;
});
if (auditsBlocked) return { status: "BLOCKED_WAVE4_AUDIT", completedGreenThrough: 3, package: p, audits: auditValues };

const final = await runs.run("wave4-runtime-finalize", {
  agent: "worker",
  task: contract("A01 Wave4 governance finalizer") + " All independent audits passed: " + JSON.stringify(auditValues) + ". Governance/evidence only. Verify clean package commit/build/artifacts/model-data evidence and no target tag. Mark I-001..I-008 DONE, Wave4 GREEN, currentWave5, Wave5 OPEN but not started with only dependency roots READY; Waves6-8 closed. Record released lease and 64 roles/concurrency five. Commit chore(wave4): attest native image gate and open wave5; create annotated tag wave4-" + String(p.buildId) + " without moving tags. Verify JSON/ancestry/package/media hashes, clean tree, our processes zero and ambient processes unchanged. Return exact result.",
  outputSchema: finalSchema,
  acceptance: false,
  maxRuntimeMs: 3600000
});

return {
  status: final.structuredOutput && final.structuredOutput.verdict === "pass" ? "WAVE_4_GREEN_WAVE_5_OPEN" : "BLOCKED_WAVE4_FINALIZATION",
  completedGreenThrough: final.structuredOutput && final.structuredOutput.verdict === "pass" ? 4 : 3,
  package: p,
  audits: auditValues,
  final: final.structuredOutput || null
};
