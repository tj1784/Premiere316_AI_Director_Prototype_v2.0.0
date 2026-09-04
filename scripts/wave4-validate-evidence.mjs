import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractFile } from "@electron/asar";

const evidenceRoot = "screenshots/wave4-native";
const checkpointReady = process.argv.includes("--checkpoint-ready");
const checks = [];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const load = (relative) => JSON.parse(readFileSync(relative, "utf8"));
const check = (name, ok, detail = null) => checks.push({ name, ok: Boolean(ok), detail });

const report = load(`${evidenceRoot}/report.json`);
const summary = load(`${evidenceRoot}/summary-report.json`);
const packageHashes = load(`${evidenceRoot}/package/package-hashes.json`);
const identity = load(`${evidenceRoot}/package/source-build-identity.json`);
const resources = load(`${evidenceRoot}/package/runtime-resources-manifest.json`);
const smoke = load(`${evidenceRoot}/premiere316-desktop-smoke.json`);
const stage = load(`${evidenceRoot}/stage-visual/report.json`);
const live = load(`${evidenceRoot}/live-data-compare.json`);
const components = load(`${evidenceRoot}/exact-component-hashes-compare.json`);
const external = load(`${evidenceRoot}/external-roots-after-summary.json`);
const processes = load(`${evidenceRoot}/process-preservation.json`);
const cleanup = load(`${evidenceRoot}/isolated-profile-cleanup.json`);
const wave = load("docs/orchestration/wave-status.json");
const tasks = load("docs/orchestration/task-status.json");
const roster = load("docs/orchestration/agent-roster-state.json");

check("UAT report is successful", report.ok === true && report.error === null, { error: report.error });
check("current package build ID", packageHashes.buildInfo.buildId === "p316-20260904124249-f8c5609e32d4", packageHashes.buildInfo);
for (const [relative, expected] of Object.entries(packageHashes.files)) {
  const bytes = readFileSync(relative);
  check(`package hash: ${relative}`, bytes.length === expected.bytes && sha256(bytes) === expected.sha256, {
    actualBytes: bytes.length,
    actualSha256: sha256(bytes),
    expected,
  });
}
check("source/build identities agree", identity.sourceMatchesDesktop && identity.sourceMatchesPackaged && identity.buildInfoIdentical && identity.sourceHash === packageHashes.buildInfo.rendererSourceHash, identity);

const resourceRows = resources.files.map((item) => {
  const bytes = readFileSync(join("dist-desktop/win-unpacked/resources", item.relative));
  return { relative: item.relative, bytes: bytes.length, sha256: sha256(bytes) };
});
check("packaged resources manifest", resourceRows.length === resources.count && sha256(Buffer.from(JSON.stringify(resourceRows))) === resources.manifestSha256 && resourceRows.every((item, index) => item.bytes === resources.files[index].bytes && item.sha256 === resources.files[index].sha256), {
  count: resourceRows.length,
  bytes: resourceRows.reduce((sum, item) => sum + item.bytes, 0),
  manifestSha256: sha256(Buffer.from(JSON.stringify(resourceRows))),
});

const asarPath = "dist-desktop/win-unpacked/resources/app.asar";
check("packaged authority-review preload is exact", Buffer.compare(extractFile(asarPath, "desktop/authority-review-preload.cjs"), readFileSync("desktop/authority-review-preload.cjs")) === 0);
const authorityReviewPreload = readFileSync("desktop/authority-review-preload.cjs", "utf8");
check("authority review has Escape, focus trap, and Cancel default", /event\.key === "Escape"/.test(authorityReviewPreload) && /document\.addEventListener\("keydown", trapFocus\)/.test(authorityReviewPreload) && /cancel\.focus\(\)/.test(authorityReviewPreload));

const uatSource = readFileSync("scripts/wave4-native-uat.mjs", "utf8");
check("UAT has no generated reference fixture", !uatSource.includes("setInputFiles") && !uatSource.includes("onePixel") && !existsSync(`${evidenceRoot}/reference.png`));
check("UAT binds visible exterior-night lock before acknowledgement", uatSource.includes("visible exterior night sky") && uatSource.includes("inspectNightImages") && uatSource.includes("darkPixelRatio"));

const generatedNames = readdirSync(`${evidenceRoot}/generated`);
const pngNames = generatedNames.filter((name) => name.endsWith(".png"));
const pendingNames = generatedNames.filter((name) => /\.(pending|tmp)\.png$/i.test(name));
check("exactly two final PNGs and no pending/temp media", pngNames.length === 2 && pendingNames.length === 0, { pngNames, pendingNames });
const imageRows = pngNames.map((name) => {
  const bytes = readFileSync(`${evidenceRoot}/generated/${name}`);
  const sidecarName = name.replace(/\.png$/, ".provenance.json");
  const sidecarBytes = readFileSync(`${evidenceRoot}/generated/${sidecarName}`);
  const provenance = JSON.parse(sidecarBytes.toString("utf8"));
  return {
    name,
    sha256: sha256(bytes),
    bytes: bytes.length,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    sidecarSha256: sha256(sidecarBytes),
    provenance,
  };
});
check("both generated images are genuine 512x512 and reference-free", imageRows.every((item) => item.bytes > 100_000 && item.width === 512 && item.height === 512 && Array.isArray(item.provenance.references) && item.provenance.references.length === 0 && /visible exterior night sky/i.test(item.provenance.prompt)), imageRows.map((item) => ({ name: item.name, sha256: item.sha256, bytes: item.bytes, width: item.width, height: item.height, seed: item.provenance.seed, references: item.provenance.references })));
check("generated hashes match UAT report", new Set(imageRows.map((item) => item.sha256)).size === 2 && report.generated.every((item) => imageRows.some((candidate) => candidate.sha256 === item.sha256 && candidate.bytes === item.bytes && candidate.sidecarSha256 === item.sidecarSha256)));

const ledgerEntries = readFileSync(`${evidenceRoot}/generated/security-ledger.v1.jsonl`, "utf8").trim().split(/\r?\n/).map(JSON.parse);
const tail = load(`${evidenceRoot}/generated/security-ledger.v1.jsonl.tail.json`);
const expectedKinds = { productionAuthority: 1, preparedApproval: 1, preparedSeal: 2, generationReceipt: 2, rejectionDecision: 1, canonicalDecision: 1 };
const actualKinds = Object.fromEntries([...new Set(ledgerEntries.map((entry) => entry.kind))].map((kind) => [kind, ledgerEntries.filter((entry) => entry.kind === kind).length]));
check("ledger shape, sequence, links, uniqueness, and tail", ledgerEntries.length === 8 && JSON.stringify(actualKinds) === JSON.stringify(expectedKinds) && ledgerEntries.every((entry, index) => entry.seq === index + 1 && (index === 0 ? entry.prevMac === null : entry.prevMac === ledgerEntries[index - 1].mac)) && new Set(ledgerEntries.map((entry) => entry.id)).size === ledgerEntries.length && tail.count === 8 && tail.headMac === ledgerEntries.at(-1).mac, { actualKinds, tail });
const receipts = ledgerEntries.filter((entry) => entry.kind === "generationReceipt");
const rejection = ledgerEntries.find((entry) => entry.kind === "rejectionDecision");
const canonical = ledgerEntries.find((entry) => entry.kind === "canonicalDecision");
const canonicalReceipt = receipts.find((entry) => entry.id === canonical?.payload?.receiptId);
check("receipt outputs bind both preserved images", receipts.length === 2 && receipts.every((entry) => imageRows.some((item) => item.sha256 === entry.payload.output.mediaSha256 && item.bytes === entry.payload.output.byteLength)));
check("separate one-use seals/tokens with one worker/component identity", new Set(receipts.map((entry) => entry.payload.sealId)).size === 2 && new Set(receipts.map((entry) => entry.payload.tokenDigest)).size === 2 && new Set(receipts.map((entry) => entry.payload.workerIdentityDigest)).size === 1 && new Set(receipts.map((entry) => entry.payload.componentDigest)).size === 1);
check("canonical and rejection bind distinct receipts", Boolean(canonicalReceipt && rejection && canonical && rejection.payload.receiptId !== canonical.payload.receiptId));
check("canonical confirmation is visually scoped and true", canonical?.payload?.continuityFindings?.length === 1 && canonical.payload.continuityFindings[0].message.includes("visible exterior night sky") && canonical.payload.continuityFindings[0].confirmed === true && canonical.payload.reason.includes("exterior dark night sky"), canonical?.payload);

const chronological = [...imageRows].sort((a, b) => a.provenance.generatedAt.localeCompare(b.provenance.generatedAt));
check("cold/warm same-process telemetry", chronological[0].provenance.telemetry.residentBeforeJob === false && chronological[0].provenance.telemetry.modelLoadMs > 0 && chronological[1].provenance.telemetry.residentBeforeJob === true && chronological[1].provenance.telemetry.modelLoadMs === 0 && chronological[0].provenance.seed !== chronological[1].provenance.seed && summary.residency.sameWorkerPid === true && summary.residency.firstWorkerTcpConnections.length === 0 && summary.residency.secondWorkerTcpConnections.length === 0 && summary.residency.workerCountAfterVisibleRelease === 0 && summary.residency.workerCountAfterRestart === 0, summary.residency);
check("conservative night metrics passed", report.assertions.visibleNightMetrics.length === 2 && report.assertions.visibleNightMetrics.every((item) => item.meanIntensity < 100 && item.darkPixelRatio > 0.55), report.assertions.visibleNightMetrics);

check("packaged smoke passed", smoke.ok === true && smoke.consoleErrors.length === 0 && smoke.network.completionPosts === 0 && smoke.stageNavigation.length === 14, smoke);
check("28/28 native stage captures passed", stage.ok === true && stage.stages.length === 14 && stage.screenshots.length === 28 && stage.violations.length === 0 && stage.consoleErrors.length === 0 && stage.pageErrors.length === 0, { ok: stage.ok, stages: stage.stages.length, captures: stage.screenshots.length, violations: stage.violations });
check("protected live profile byte-identical", live.byteIdentical === true && live.differences.length === 0 && live.beforeCount === live.afterCount, live);
check("exact selected external component hashes identical", components.allIdentical === true && components.comparisons.every((item) => item.identical), { count: components.comparisons.length });
check("external roots counts and bytes identical", external.every((item) => item.metadataIdentical), external.map((item) => ({ root: item.root, identical: item.metadataIdentical })));
check("ambient processes preserved and no residual app worker", processes.preservedAll === true && processes.baselineAmbientCount === 7 && processes.residualCount === 0, { pids: processes.preserved.map((item) => item.processId), residual: processes.premiere316OrWorkerResidual });
check("isolated profiles cleaned", cleanup.remainingCount === 0, cleanup);

const wave4 = wave.gates.find((item) => item.wave === 4);
const wave5 = wave.gates.find((item) => item.wave === 5);
const expectedWave4Status = checkpointReady ? "GREEN" : "PACKAGE_PASS_AWAITING_A07_A08_A64_REAUDIT";
const expectedTaskStatus = checkpointReady ? "GREEN" : "PACKAGE_PASS_AWAITING_REAUDIT";
const expectedSummaryVerdict = checkpointReady ? "green_audited_checkpoint" : "package_pass_awaiting_independent_reaudits";
check(`Wave 4 ${checkpointReady ? "checkpoint-ready" : "pending re-audit"} and Wave 5 closed`, wave4.status === expectedWave4Status && wave5.status === "BLOCKED_BY_PREVIOUS_GATE", { wave4: wave4.status, wave5: wave5.status });
check(`Wave 4 tasks ${checkpointReady ? "GREEN" : "pending re-audit"}`, tasks.tasks.filter((item) => item.wave === 4).length === 8 && tasks.tasks.filter((item) => item.wave === 4).every((item) => item.status === expectedTaskStatus));
check("summary verdict matches validation mode", summary.verdict === expectedSummaryVerdict, { expectedSummaryVerdict, actual: summary.verdict });
check("64 logical roles preserved", roster.logicalAgentCount === 64 && roster.captains.length === 6 && Object.values(roster.captainAssignments).flat().length === 54 && roster.directAuditors.length === 3);
check("Wave 4 tag absent before checkpoint creation", !readdirSync(".git/refs/tags", { recursive: true }).some((name) => String(name).includes("wave4-p316-20260904124249-f8c5609e32d4")));

const result = {
  generatedAt: new Date().toISOString(),
  mode: checkpointReady ? "checkpoint-ready" : "pre-audit",
  buildId: packageHashes.buildInfo.buildId,
  passed: checks.filter((item) => item.ok).length,
  failed: checks.filter((item) => !item.ok).length,
  allPassed: checks.every((item) => item.ok),
  checks,
};
writeFileSync(`${evidenceRoot}/final-validation.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ buildId: result.buildId, passed: result.passed, failed: result.failed, allPassed: result.allPassed, failures: checks.filter((item) => !item.ok) }, null, 2));
if (!result.allPassed) process.exitCode = 1;
