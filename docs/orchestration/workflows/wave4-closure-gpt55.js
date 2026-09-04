const ROOT = "D:/Projects/Premiere316_v3";
const BASE = "527046e0b4ee45031fde3b740a9fcfac1f21f534";
const RUN = "C:/Users/teeja/.pi/agent/sessions/--D--Projects-Premiere316_v3--/subagent-artifacts/outputs/e0bf39c1-8cdb-4e24-b2aa-3fc089b5a394";

const reviewSchema = {
  type: "object", additionalProperties: false,
  required: ["auditor", "verdict", "blockerKind", "summary", "findings"],
  properties: {
    auditor: { type: "string" }, verdict: { type: "string", enum: ["pass", "blocked"] },
    blockerKind: { type: "string", enum: ["none", "code", "components", "external-runtime", "migration", "data", "security", "ui", "accessibility", "evidence", "packaging"] },
    summary: { type: "string" }, findings: { type: "array", items: { type: "string" }, maxItems: 70 }
  }
};
const packageSchema = {
  type: "object", additionalProperties: false,
  required: ["verdict", "blockerKind", "summary", "commit", "buildId", "report", "generatedArtifacts", "findings"],
  properties: {
    verdict: { type: "string", enum: ["pass", "blocked"] }, blockerKind: { type: "string", enum: ["none", "code", "components", "external-runtime", "data", "security", "ui", "accessibility", "evidence", "packaging"] },
    summary: { type: "string" }, commit: { type: ["string", "null"] }, buildId: { type: ["string", "null"] }, report: { type: ["string", "null"] },
    generatedArtifacts: { type: "array", items: { type: "string" }, maxItems: 40 }, findings: { type: "array", items: { type: "string" }, maxItems: 80 }
  }
};
const finalSchema = {
  type: "object", additionalProperties: false,
  required: ["verdict", "summary", "commit", "tag", "wave4", "wave5", "findings"],
  properties: {
    verdict: { type: "string", enum: ["pass", "blocked"] }, summary: { type: "string" }, commit: { type: ["string", "null"] }, tag: { type: ["string", "null"] },
    wave4: { type: "string", enum: ["GREEN", "BLOCKED"] }, wave5: { type: "string", enum: ["OPEN", "CLOSED"] }, findings: { type: "array", items: { type: "string" }, maxItems: 50 }
  }
};
function t(lines) { return lines.join(" "); }
function common(role) {
  return t([
    "Work in " + ROOT + " from protected Wave3 base " + BASE + " plus the current uncommitted Wave4 recovery diff. Role " + role + ".",
    "Preserve exact 64 logical roles and physical concurrency <=5; one writer. Preserve protected exe/tags/history/IDs/The Last Reel/premiere316-v302-c, secure Electron sandbox/context isolation/web security, responsive 390px and 100-200% zoom.",
    "Local-only: no cloud/auth/database/download/model conversion. Never modify D:/AI/Models, D:/Projects/flux, D:/Projects/Flux2, D:/_Cache/HuggingFace, installed Python/packages, or operator data. Never invoke/contact ComfyUI/8188. Never stop or attach to ambient LM Studio/ComfyUI/Python processes. No auto-load. Wave5 stays closed until every Wave4 package and A07/A08/A64 gate passes."
  ]);
}
function blocked(results) {
  for (let i = 0; i < results.length; i++) if (!results[i] || !results[i].structuredOutput || results[i].structuredOutput.verdict !== "pass") return true;
  return false;
}

const source = await runs.run("wave4-closure-source", {
  agent: "worker", acceptance: false, output: "implementation/wave4-closure-source.md", outputMode: "file-only", maxRuntimeMs: 21600000,
  task: common("A32/A33/A34 sole closure writer") + t([
    "Read AGENTS.md, design-ui skill, the full diff, " + RUN + "/plans/wave4-standalone-encoders.md, wave4-current-source-gaps.md, wave4-app-worker-contract.md, and implementation reports. Static A38 evidence proved a viable standalone candidate: T5 full SHA 6e480b09fae049a72d2a8c5fbccb8d3e92febeb233bbe9dfe7256958a9167635 with exact 24-layer T5-XXL schema; CLIP hash 660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd; BPE hash 924691ac288e54409236115652ad4aa250f48203de50a9e4722a6ecd48d6804a; FLUX hash 4610115bb0c89560703c892c59ac2742fa821e60ef5871b33493ba544683abd7; AE hash afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38. Its blocked verdict referred to older source; current source has an app worker and must now be repaired and reviewed empirically.",
    "Fix the remaining security boundary rather than documenting it: renderer-supplied APPROVED_PREPARED state alone cannot mint a generation token. Implement a main-mediated proposal/confirmation/seal protocol. Backend validates the bounded snapshot, derives prompt/spec/dependencies/config itself, freezes a proposal, and returns only a bounded human-readable summary. Electron main displays a real native confirmation dialog containing asset/spec/prompt/engine summary. Only an explicit native Confirm lets main call an internal backend confirm method unavailable through preload; backend then persists an HMAC-authenticated append-only prepared seal and mints one one-use/TTL token bound to that seal/current exact manifest/build. Cancel yields no seal/token. Do not add any auto-confirm/test bypass. Keep the renderer bridge incapable of calling propose-confirm internals or free generation.",
    "Persist the backend HMAC key under profile userData encrypted with Electron safeStorage; pass only the decrypted key to the backend process. HMAC every append-only prepared seal, generation receipt, rejection/canonical decision record; validate MAC and duplicate IDs on reload/restart. Never truncate old ledger entries. Use atomic profile-owned writes. Generation and approval must bind to the sealed prepared/spec/dependency/prompt/manifest/build record. Be honest in docs: the native user-confirmed seal is backend-owned; the initial local project proposal is renderer-originated and thoroughly validated, not magically trusted.",
    "Replace generic renderer image.verifyOutput with a narrow canonical-approval call. On visible Review approval, main must show a native summary confirmation; only main's internal confirm invokes backend. Backend freshly verifies HMAC generation receipt and seal, durable real PNG/sidecar bytes/hashes/path, exact output binding, nonempty reviewer-entered reason, provided continuity findings and explicit confirmations; then appends a signed canonical decision and returns its ID. Renderer stores that ID in append-only review history. Rejection remains append-only and may also be backend-recorded, but cannot approve. No hard-coded confirmations/reasons.",
    "Repair worker correctness. Never import/use flux.util load helpers or any download/repo-ID weight loader. Instantiate official flux.model.Flux and flux.modules.autoencoder.AutoEncoder with exact locally-audited flux-dev params, construct on meta, load exact P316_MODEL_FLUX/P316_MODEL_AE safetensors directly with strict missing/unexpected/tensor-count/schema checks and assign to CUDA. Instantiate T5EncoderModel and CLIPTextModel directly, load standalone state strictly, and load the OpenCLIP tokenizer module by exact tokenizer.py path/hash 90d743e462d051f4c921e652e0aa8af06c40ee7ac38dfdc7bb5ede6381024734 (22680 bytes) plus exact BPE rather than importing the package root. Include exact T5 tokenizer_config b971dce1d2805c2a66da8657156e7114a30501c6ba602fc947c8bf607a3ead2d and special map 4720c0fddbe4c5991334f85ad7073d9bd0a294a8ba4641a2f8dab614ca825949 identities.",
    "Fix the sampling call: flux.sampling.prepare expects callable encoders, not precomputed tensors. Use audited wrappers or construct its exact inputs, preserving official 20-step guidance-3.5 schedule. Fix CLIP constructor, delete CPU state dictionaries before subsequent loads, preserve IDs on every error, and ensure ping while loaded returns the same authoritative full component/session digest. First job must truthfully report residentBeforeJob=false and actual modelLoadMs; second same-process job true and zero/actual load; use telemetry field names modelLoadMs/inferenceMs/totalMs/peakVramBytes/peakSystemRamBytes/residentBeforeJob/residentAfterJob. Never hard-code residency truth.",
    "Exact readiness must compare full expected hashes, not size-only claims. Cache full digests in-process keyed by real path/size/mtime; verify tokenizer files and official source revision. Runtime worker rehashes exact files before first load. Add current free-VRAM check before cold load, including ambient usage, but do not double-count our already-resident worker before warm generation. Unsupported FLUX2/Klein/Krea remain disabled.",
    "Harden durable storage: traversal/symlink-safe profile roots, atomic unique writes, remove pending files, content-addressed media, append-only signed receipts/decisions, and no canonical approval primitive outside the signed backend path. Add no legacy StillBay/benchmark/direct route.",
    "Add deterministic tests for forged/replayed/expired/cross-asset tokens; renderer inability to internal-confirm; cancel path; tampered/forged/reordered ledgers/MAC/key; restart verification; direct route absence; exact hash readiness; worker direct loaders/no repo loaders; prepare callable correctness; honest cold/warm telemetry; worker JSONL IDs; path/symlink/output tamper; signed canonical approval and reject-then-approve denial; fake continuity; no auto-confirm/load/network/8188; migration/UI/focus/touch/14 stages. Static tests may inspect Python source but this source phase must not run Python/model/CUDA/package.",
    "Run npm test, npm run typecheck, npm run build, JSON parses and git diff --check. Update ledgers only to SOURCE_READY_AWAITING_REVIEW, Wave5 closed. No commit/stage/package/external mutation."
  ])
});

let reviews = await runs.all([
  {
    key: "wave4-closure-a07-source", agent: "oracle", acceptance: false, outputSchema: reviewSchema, maxRuntimeMs: 10800000,
    task: common("A07 independent source auditor") + " Read the complete diff and " + source.output + ". Re-run test/typecheck/build/diff/JSON gates. Verify exact components/worker direct-load and sampling correctness, main-only native-confirmed backend seal, safeStorage HMAC append-only durable ledgers, exact readiness, one-use generation, signed canonical approval, 14-stage UI, migrations and package resources. Attack semantics, not just test names. No Python/model/package/source mutation. Separate source pass from empirical runtime."
  },
  {
    key: "wave4-closure-a64-source", agent: "oracle", acceptance: false, outputSchema: reviewSchema, maxRuntimeMs: 10800000,
    task: common("A64 independent source red team") + " Read the complete diff and " + source.output + ". Re-run source gates. Try arbitrary renderer invoke, forged proposal/snapshot/prompt/spec/dependencies, internal confirm exposure, native-dialog bypass, cancel/replay/expiry/cross-use, forged/reordered/truncated HMAC ledgers, restart/tampered PNG/sidecar/receipt, symlink/traversal, fake continuity/reason/canonical decision, worker repo/download/fallback import, callable/sampling bugs, fake sticky telemetry, auto-load, network/8188, ambient-process and protected-data regressions. No Python/model/package/source mutation."
  }
]);

if (blocked(reviews)) {
  const repair = await runs.run("wave4-closure-source-repair", {
    agent: "worker", acceptance: false, output: "implementation/wave4-closure-final-repair.md", outputMode: "file-only", maxRuntimeMs: 21600000,
    task: common("sole conditional source repair writer") + " Repair every finding exactly without weakening scope or tests: " + JSON.stringify(reviews.map(function (x) { return x && x.structuredOutput ? x.structuredOutput : null; })) + ". Source-only: no Python/model/package/external mutation/commit. Run all source gates and keep Wave5 closed."
  });
  reviews = await runs.all([
    {
      key: "wave4-closure-a07-rereview", agent: "oracle", acceptance: false, outputSchema: reviewSchema, maxRuntimeMs: 10800000,
      task: common("A07 post-repair source gate") + " Freshly inspect the entire diff and " + repair.output + ". Reproduce every A07/A64 finding and run all source gates. No Python/model/package/mutation. Pass only with no source blocker."
    },
    {
      key: "wave4-closure-a64-rereview", agent: "oracle", acceptance: false, outputSchema: reviewSchema, maxRuntimeMs: 10800000,
      task: common("A64 post-repair red-team gate") + " Freshly attack the entire diff and " + repair.output + " across renderer authority, native confirmation, HMAC ledgers, canonical approval, worker exact loading/sampling/residency, paths, no-network/no-auto-load and protected data. Run source gates; no Python/model/package/mutation."
    }
  ]);
}
if (blocked(reviews)) return { status: "BLOCKED_WAVE4_SOURCE", completedGreenThrough: 3, reviews: reviews.map(function (x) { return x && x.structuredOutput ? x.structuredOutput : null; }) };

const pack = await runs.run("wave4-closure-package", {
  agent: "worker", acceptance: false, outputSchema: packageSchema, maxRuntimeMs: 43200000,
  task: common("A04 exclusive package/runtime/data lease owner") + t([
    "Source gates passed. Read all current evidence/reviews and perform the genuine protected packaged Wave4 gate. Do not substitute, mock, download, waive or touch ambient operator processes.",
    "Take exclusive lease; record git/data/model/cache/runtime/ambient-process/network/GPU baselines. Cold-backup and cryptographically manifest live %APPDATA%/Premiere316. Use an isolated package-UAT profile. Run test/typecheck/build/package/security/ASAR/resources/installer/shortcut gates. Verify the packaged worker and exact source/component identities. First do zero-inference packaged smoke, all 14 stages at 100/150, mobile, keyboard/focus/touch, and prove browsing/catalog/Review causes no worker/model load.",
    "Package phase may run the app-owned Python worker only through visible packaged controls after an approved prepared fixture. Before model load run harmless syntax/import/component compatibility probes in isolated app-owned caches; never import a model during source-like probes. Check free VRAM after ambient allocations; block before unsafe load. Prove process tree contains only Premiere316's allowlisted Python worker and sample its network connections for zero external/8188 traffic; ambient process traffic is excluded by PID and left untouched.",
    "Use visible Generate, handle the real native confirmation dialog through Windows UI automation with screenshots, never bypass it. Generate exactly two genuine 512x512 FLUX.1 images through two separately confirmed one-use authorizations without release between. Prove full exact components, official app worker, same resident session/component digest, first residentBeforeJob false, second true, honest measured/null telemetry, distinct nontrivial decodable PNGs and real media/sidecar hashes under isolated profile. Replay/stale/cancel/tamper checks must create no extra images.",
    "Visually inspect both outputs. In visible Review A/B enter a concrete human reason and explicit finding confirmations, reject one append-only, choose the defensible other, handle real native canonical-confirm dialog, and obtain signed backend canonical decision after fresh durable verification. Prove forged/replayed receipts/seals/decisions, file tamper and reject-then-approve fail. Capture native webContents screenshots and bounded PNG/sidecar/signed ledger/process/network/telemetry reports under screenshots/wave4-native.",
    "Use visible Release exactly once; verify only Premiere316's worker exits and ambient processes are unchanged. Remove isolated UAT profile after bounded evidence copy. Prove live user data and D:/AI/Models, installed runtime/cache/package roots are byte/metadata identical; restore live data if any drift.",
    "If source/runtime/import/CUDA/output/UI/data proof fails, stop only our worker, preserve truthful evidence, write docs/release/wave4-gate.md as BLOCKED_EXTERNAL_RUNTIME or precise blocker, keep Wave5 closed, commit a coherent blocked checkpoint if safe, no Wave4 tag, and return blocked. If all passes, write complete wave4-gate, set I-001..I-008 PACKAGE_PASS_AWAITING_AUDIT, commit feat(wave4): package genuine native image gate, no tag/Wave5, leave clean, return exact IDs/hashes."
  ])
});
if (!pack.structuredOutput || pack.structuredOutput.verdict !== "pass") return { status: "BLOCKED_WAVE4_RUNTIME", completedGreenThrough: 3, package: pack.structuredOutput || null };

const p = pack.structuredOutput;
function audit(role, focus) { return common(role) + " Independently audit package checkpoint " + JSON.stringify(p) + ". Read-only: never load/generate/release/mutate. Recompute evidence directly, visually inspect real outputs/screenshots, and " + focus; }
const audits = await runs.all([
  { key: "wave4-closure-a07-runtime", agent: "oracle", acceptance: false, outputSchema: reviewSchema, maxRuntimeMs: 10800000, task: audit("A07 native evidence auditor", "verify source/package/resource hashes, zero-inference smoke, 28 native captures, genuine cold/warm exact FLUX execution, sticky telemetry, distinct PNGs, signed prepared/generation/canonical ledgers and visible reject/approve path.") },
  { key: "wave4-closure-a08-runtime", agent: "oracle", acceptance: false, outputSchema: reviewSchema, maxRuntimeMs: 9000000, task: audit("A08 release/data auditor", "verify ancestry/build/exe/asar/installer/shortcut, live-data and external-root equality, ambient preservation, Premiere316 process/network cleanup, leases/64 roles/concurrency, no tag and Wave5 closed.") },
  { key: "wave4-closure-a64-runtime", agent: "oracle", acceptance: false, outputSchema: reviewSchema, maxRuntimeMs: 10800000, task: audit("A64 runtime red team", "veto mock/imported/placeholder output, direct/non-visible run, confirmation bypass, component substitution/download/network/8188, fake residency/telemetry, receipt/seal/tamper/continuity bypass, inaccessible UI and protected-data drift.") }
]);
if (blocked(audits)) return { status: "BLOCKED_WAVE4_AUDIT", completedGreenThrough: 3, package: p, audits: audits.map(function (x) { return x && x.structuredOutput ? x.structuredOutput : null; }) };

const av = audits.map(function (x) { return x.structuredOutput; });
const final = await runs.run("wave4-closure-finalize", {
  agent: "worker", acceptance: false, outputSchema: finalSchema, maxRuntimeMs: 3600000,
  task: common("A01 governance finalizer") + " All audits passed: " + JSON.stringify(av) + ". Evidence/governance only. Verify package commit/build/media/ledgers and clean state. Mark I-001..I-008 DONE; Wave4 GREEN; currentWave5; Wave5 OPEN not started with only dependency roots READY; Waves6-8 closed. Release lease, record 64 roles/concurrency. Commit chore(wave4): attest native image gate and open wave5; create annotated immutable tag wave4-" + String(p.buildId) + ". Verify ancestry/JSON/hashes/zero app workers/ambient unchanged and return exact result."
});
return { status: final.structuredOutput && final.structuredOutput.verdict === "pass" ? "WAVE_4_GREEN_WAVE_5_OPEN" : "BLOCKED_WAVE4_FINALIZATION", completedGreenThrough: final.structuredOutput && final.structuredOutput.verdict === "pass" ? 4 : 3, package: p, audits: av, final: final.structuredOutput || null };
