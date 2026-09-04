const ROOT = "D:/Projects/Premiere316_v3";
const BASE = "527046e0b4ee45031fde3b740a9fcfac1f21f534";
const PRIOR = "C:/Users/teeja/.pi/agent/sessions/--D--Projects-Premiere316_v3--/subagent-artifacts/outputs/d4973ad3-6a9d-469f-bc11-cea546322aa1";
const schema = {
  type: "object", additionalProperties: false,
  required: ["auditor", "verdict", "blockerKind", "summary", "findings"],
  properties: {
    auditor: { type: "string" }, verdict: { type: "string", enum: ["pass", "blocked"] },
    blockerKind: { type: "string", enum: ["none", "code", "components", "external-runtime", "migration", "data", "security", "ui", "accessibility", "evidence", "packaging"] },
    summary: { type: "string" }, findings: { type: "array", items: { type: "string" }, maxItems: 70 }
  }
};
function text(lines) { return lines.join(" "); }
function base(role) {
  return text([
    "TARGET " + ROOT + " protected Wave3 base " + BASE + " plus current uncommitted Wave4 diff. Act as " + role + ".",
    "Preserve exactly 64 logical roles, physical concurrency <=5, one writer, protected exe/tags/history/IDs/The Last Reel/premiere316-v302-c, secure Electron contextIsolation/sandbox/webSecurity, responsive 390px and 100-200% zoom.",
    "No cloud/auth/database/download/model conversion. Do not mutate D:/AI/Models, installed flux/Flux2/Python/cache roots, operator data, or ambient processes. Never contact ComfyUI/8188. Source phase only: no Python/model/CUDA/package. No auto-load. Wave5 closed."
  ]);
}
const writer = await runs.run("wave4-root-path-writer", {
  agent: "worker", acceptance: false, output: "implementation/wave4-prepared-root-path.md", outputMode: "file-only", maxRuntimeMs: 21600000,
  task: base("A32/A33/A34 sole source repair writer") + text([
    "Read AGENTS.md, design-ui, full diff, " + PRIOR + "/implementation/wave4-closure-final-repair.md, and the A07/A64 rereview findings in workflow d4973ad3-6a9d-469f-bc11-cea546322aa1. Fix the three blockers completely; do not just add another required field.",
    "Implement the real prepared-approval root creation path. prepareAssetRecords must produce BLOCKED or READY_TO_PREPARE, never auto-assert APPROVED_PREPARED. The Inventory Prepared Assets panel must expose a visible per-asset Approve prepared action after Evaluate. It calls a narrow public desktop approvePrepared method. Electron main calls backend image.proposePreparedApproval, displays a native dialog with backend-derived asset/spec/prompt/dependency summary, and only native Confirm calls internal image.confirmPreparedApproval. Backend validates READY_TO_PREPARE against canonical spec version, references, exact dependency fingerprints and nonstale graph, freezes the proposal, projects final APPROVED_PREPARED plus backend approvedAt, appends a chained-HMAC preparedApproval record, and returns rootId/approvedAt/digest. Renderer applies those exact returned values to the prepared record via a pure function. Cancel returns no root/state change. No auto-confirm/test bypass.",
    "Add preparedApprovalRootId/approval digest fields to PreparedAssetRecord with additive hydration. Rootless legacy APPROVED_PREPARED records migrate to READY_TO_PREPARE with approvedAt null; never silently bless them. Re-evaluation clears a root unless the implementation can prove all canonical inputs and root binding unchanged. Generate reads the root from the prepared record and sends no caller-selectable root; backend authorization recomputes the exact projected approval digest and requires matching valid preparedApproval ledger record. Add tests proving missing/forged/cross-asset/stale/replayed/canceled roots fail and the visible Evaluate -> Approve prepared -> Generate path can succeed semantically.",
    "Fix canonical authority. The exported pure approveCanonicalIteration must require a structured backend canonical proof, not optional receipt/decision strings, and reject direct approve through reviewGeneratedIteration. Proof must bind decisionId, signed-record MAC, generation receipt, prepared root/seal, asset/prepared/iteration IDs, reason digest, continuity digest and output digest. Store proof in append-only iteration/review state. Backend returns proof from the actual signed canonicalDecision ledger record. No renderer-only path may mark APPROVED without this proof; future privileged reads remain backend-verifiable.",
    "Backend must derive the complete continuity checklist from the sealed approved asset data and actual generation receipt, not renderer messages. Assign iterationId in backend before returning generation. Store exact expected findings in the receipt: explicit approved identity/continuity locks requiring visible confirmation, missing-required-reference blocker if applicable, actual provenance blocker if absent, or a no-lock warning. Return these findings with generated output and persist on GeneratedIteration. Review renders those backend-derived findings. Canonical request sends only finding IDs/confirmation booleans plus reason; backend requires exact ID set, rebuilds messages/severities from receipt, rejects omitted/added/duplicate IDs and unconfirmed blockers, and signs the canonical proof. Use a backend proposal + native main confirmation + internal confirm for canonical approval too.",
    "Make chained ledger writes crash-safe using same-directory temp + fsync/close + rename for full logical JSONL ledger and signed tail checkpoint; a crash between files may fail closed but must never accept truncation/reorder. Preserve all entries and duplicate/canonical replay checks.",
    "Update channels/preload/protocol/client/main/backend/types/persistence/inventory/panel/stage/image-iteration tests coherently. Keep exact full-hash readiness and current direct worker fixes intact. Add desktop tests for internal methods absent from preload, native main mediation source, prepared root lifecycle, canonical proof requirement, backend-derived continuity completeness, ledger atomicity/tamper/restart. Update package test list. Run npm test, typecheck, build, node checks, JSON parse and git diff --check. No commit/stage/package/external mutation; Wave4 SOURCE_READY_AWAITING_REVIEW and Wave5 closed."
  ])
});
const reviews = await runs.all([
  {
    key: "wave4-root-path-a07", agent: "oracle", acceptance: false, outputSchema: schema, maxRuntimeMs: 10800000,
    task: base("A07 independent post-repair source auditor") + " Inspect full diff and " + writer.output + ". Run test/typecheck/build/diff/node/JSON gates. Trace an actual rootless migrated asset through visible Evaluate, native-confirmed Approve prepared, stored root, native-confirmed one-use Generate, backend-derived iteration/checklist, native-confirmed signed canonical proof and renderer append. Verify exact component/worker/package-resource source remains intact. No Python/model/package/mutation."
  },
  {
    key: "wave4-root-path-a64", agent: "oracle", acceptance: false, outputSchema: schema, maxRuntimeMs: 10800000,
    task: base("A64 independent source red team") + " Inspect full diff and " + writer.output + ". Run source gates. Attack forged renderer snapshots, public/internal confirmation boundaries, root creation/cancel/replay/cross/stale states, rootless legacy migration, caller-selected roots, direct pure canonical approval, forged proof/MAC/cross receipt, omitted/invented/duplicate continuity findings, reason/output tamper, chained-ledger crash/truncation/reorder, auto-load/network/8188/path/worker regressions. No Python/model/package/mutation."
  }
]);
return {
  status: reviews.every(function (x) { return x && x.structuredOutput && x.structuredOutput.verdict === "pass"; }) ? "WAVE4_SOURCE_GREEN_READY_FOR_PACKAGE" : "BLOCKED_WAVE4_SOURCE",
  completedGreenThrough: 3,
  reviews: reviews.map(function (x) { return x && x.structuredOutput ? x.structuredOutput : null; })
};
