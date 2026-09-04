const ROOT = "D:/Projects/Premiere316_v3";
const BASE = "527046e0b4ee45031fde3b740a9fcfac1f21f534";
const A64 = "C:/Users/teeja/.pi/agent/sessions/--D--Projects-Premiere316_v3--/subagent-artifacts/370170dc-441c-4544-882c-35fb9d676647_oracle_0_output.md";
const schema = {
  type: "object", additionalProperties: false,
  required: ["auditor", "verdict", "blockerKind", "summary", "findings"],
  properties: {
    auditor: { type: "string" }, verdict: { type: "string", enum: ["pass", "blocked"] },
    blockerKind: { type: "string", enum: ["none", "code", "components", "external-runtime", "migration", "data", "security", "ui", "accessibility", "evidence", "packaging"] },
    summary: { type: "string" }, findings: { type: "array", items: { type: "string" }, maxItems: 80 }
  }
};
function t(lines) { return lines.join(" "); }
function c(role) {
  return t([
    "Work in " + ROOT + " from protected Wave3 base " + BASE + " plus current uncommitted Wave4 source diff. Role " + role + ".",
    "Preserve 64 logical roles, physical concurrency <=5, one writer, protected exe/tags/history/IDs/The Last Reel/premiere316-v302-c, secure Electron sandbox/contextIsolation/webSecurity, responsive 390px and 100-200% zoom.",
    "No cloud/auth/database/download/model conversion. Never mutate D:/AI/Models, installed flux/Flux2/Python/cache roots, live operator data, or ambient processes; never contact ComfyUI/8188. Source-only: no Python/model/CUDA/package. No auto-load. Wave5 closed."
  ]);
}
const plan = await runs.run("wave4-authority-architect", {
  agent: "oracle", acceptance: false, output: "plans/wave4-backend-authority-store.md", outputMode: "file-only", maxRuntimeMs: 7200000,
  task: c("A64/A32 security architect") + t([
    "Read the full diff, " + A64 + ", and prior implementation artifacts. Design the minimum complete backend-owned production-authority state machine that defeats forged/stale renderer snapshot authorization without pretending renderer localStorage is trusted.",
    "Required trust model: a separate visible Inventory action establishes an authority root. Renderer may submit untrusted raw canonical content only to a proposal endpoint; backend must ignore caller approval/readiness/graph claims, normalize and independently derive an immutable bounded projection (picture/screenplay boundary, exact asset spec version and bytes, refs, visual/cinematography roots, prompt and dependency fingerprints). Electron main shows that backend-derived projection in an explicit native Seal production authority dialog. Only native Confirm invokes an internal confirm unavailable to preload and appends a signed productionAuthority record. This explicit native confirmation is the trust anchor. Afterward approvePrepared, generate, and canonical approval accept only authority/root/receipt IDs and safe user controls—never a production snapshot/prompt/spec/dependency graph—and derive all privileged facts from backend ledger state.",
    "Specify UI/root persistence and invalidation for any production edit, rootless legacy migration, multiple assets, restart validation, stale authority denial, and bounded state. Also specify exact pure canonical proof digest binding for reason, output metadata, receipt, iteration, prepared root/seal, continuity list and signed record MAC. Identify concrete files/tests and any flaw that would still let a renderer mint authority without a native confirmation or use an old authority as current state. No mutation."
  ])
});
const writer = await runs.run("wave4-authority-writer", {
  agent: "worker", acceptance: false, output: "implementation/wave4-backend-authority-store.md", outputMode: "file-only", maxRuntimeMs: 21600000,
  task: c("A32/A33/A34 sole authority-store writer") + t([
    "Read AGENTS.md, design-ui, full diff, " + A64 + ", and architect plan " + plan.output + ". Implement it completely, replacing—not layering over—the renderer-snapshot prepared authority path.",
    "Add a visible touch-safe Seal production authority action in Inventory after Evaluate. Public renderer sealAuthority sends an untrusted candidate only to main; main calls internal backend proposeProductionAuthority, shows a native dialog with backend-derived complete relevant summary, then internal confirm only on native Confirm. Backend ignores caller status/readiness/graph/approval-root fields, validates structural canonical data, recomputes exact approved-spec/reference/visual/cinematography/prompt/dependency facts and constructs the authoritative immutable projection itself. Confirm appends chained-HMAC productionAuthority record containing this projection and returns authorityId/digest/createdAt. Cancel creates nothing. Persist authority id/digest on ProductionBreakdown through a pure apply helper.",
    "Every generic production edit/evaluate/reconcile/asset/reference/spec change must invalidate authority id and all prepared approval roots. Rootless/forged authority fields hydrate untrusted and must be verified through a narrow status call before enabling approval/generation, or fail closed visibly. A stale authority can never be refreshed implicitly. Re-sealing is explicit native user action.",
    "Change approvePrepared public input to authorityId plus preparedAssetId only. Backend loads productionAuthority, derives the READY_TO_PREPARE candidate from its stored projection, and native-confirmed internal approval creates preparedApproval; no production snapshot enters this route. Change Generate authorization to authorityId + preparedApprovalRootId + safe engine/seed controls only; backend loads both records, proves ancestry/currentness/digests and derives asset/spec/prompt/dependencies. Do not accept renderer prompt/production/fingerprints. Bind authority ID through seal, generation receipt and canonical proof. Renderer uses backend-returned iterationId/findings.",
    "Make backend authority currentness explicit: ledger tracks the latest nonsuperseded authority per picture and rejects old authority IDs once a newer explicit seal exists. Prepared roots under old authority fail. If current renderer state differs from stored authority, UI-level digest check disables Generate and requires explicit re-seal; backend still never trusts that check for privilege.",
    "Fix A64 pure canonical bindings. Implement one deterministic canonical JSON/SHA-256 algorithm shared or identically tested in backend/browser. approveCanonicalIteration must verify proof.reasonDigest equals the entered trimmed reason digest; outputDigest equals exact current iteration mediaUri/mediaSha256/sidecarSha256/width/height/byteLength; generationReceiptDigest equals a receipt digest persisted from backend; continuityDigest equals the exact backend-derived findings/confirmations; plus decision/record-MAC/authority/prepared/seal/asset/iteration/receipt identities. Store the proof. Direct review approve remains impossible. Add tests where each field is changed after proof and is rejected.",
    "Keep current exact full-hash component readiness, direct app-owned worker, signed crash-safe ledger, Review UI and secure bridge intact. Update channels/preload/protocol/client/main/backend, production types/persistence/inventory/workspaces/panel/stage/store and tests coherently. Avoid generic production mutation APIs. No test bypass or auto-confirm.",
    "Run npm test, typecheck, build, node syntax, orchestration JSON and git diff gates. Source only: no Python/model/package/commit/stage/external writes. Keep Wave4 SOURCE_READY_AWAITING_REVIEW and Wave5 closed."
  ])
});
const reviews = await runs.all([
  {
    key: "wave4-authority-a07", agent: "oracle", acceptance: false, outputSchema: schema, maxRuntimeMs: 10800000,
    task: c("A07 independent source gate") + " Inspect all diff and " + writer.output + ". Run every source gate. Trace visible Evaluate -> native Seal authority -> native Approve prepared -> native one-use Generate -> backend-derived Review -> native signed canonical proof. Confirm privileged routes after sealing accept IDs/controls only and old/rootless authorities fail. Verify worker/component/package/UI/migration/security source. No Python/model/package/mutation."
  },
  {
    key: "wave4-authority-a64", agent: "oracle", acceptance: false, outputSchema: schema, maxRuntimeMs: 10800000,
    task: c("A64 independent authority red team") + " Re-run the exact prior forged renderer attack against full diff and " + writer.output + ". Attempt to forge status/spec/prompt/dependencies at seal/approve/generate; bypass native confirms; call internal methods via preload; use old/cross-picture/rootless authority; mutate local production after seal; replay roots/tokens; and alter reason/output/receipt/continuity/proof after signed canonical response. Attack ledger restart/tamper and ensure no auto-load/network/8188 regression. Run source gates; no Python/model/package/mutation."
  }
]);
return { status: reviews.every(function (x) { return x && x.structuredOutput && x.structuredOutput.verdict === "pass"; }) ? "WAVE4_SOURCE_GREEN_READY_FOR_PACKAGE" : "BLOCKED_WAVE4_SOURCE", completedGreenThrough: 3, reviews: reviews.map(function (x) { return x && x.structuredOutput ? x.structuredOutput : null; }) };
