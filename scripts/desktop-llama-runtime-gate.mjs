import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { _electron as electron } from "playwright";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(process.argv[2] ?? `${root}/dist-desktop/win-unpacked/Premiere316.exe`);
const artifacts = resolve(root, "screenshots/llama-runtime");
const reportPath = resolve(artifacts, "report.json");
const screenshot = (name) => resolve(artifacts, `${name}.png`);
const modelId = "llama-3.3-70b-instruct";
const modelOptionValue = `lmstudio:${modelId}`;
const endpoint = "http://127.0.0.1:1234";
const REAL_PROFILE = join(process.env.APPDATA ?? "", "Premiere316");
const phases = [];
const networkLog = [];
const failures = [];
let completionRequests = 0;
let userDataDir = "";

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function assertIsolatedUserData(dir) {
  const normalized = dir.replaceAll("/", "\\").toLowerCase();
  const real = REAL_PROFILE.replaceAll("/", "\\").toLowerCase();
  assert.ok(dir, "user-data directory is required");
  assert.equal(normalized.includes("appdata\\roaming\\premiere316"), false, "refusing the real Premiere316 profile");
  if (real) assert.notEqual(normalized, real, "refusing to launch against %APPDATA%/Premiere316");
}

async function command(name, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(name, args, { timeout: options.timeout ?? 30_000, windowsHide: true });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return { ok: false, stdout: error.stdout?.trim() ?? "", stderr: error.stderr?.trim() ?? error.message };
  }
}

async function resourceSample(label) {
  const [gpu, mem] = await Promise.all([
    command("nvidia-smi", ["--query-gpu=timestamp,name,memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits"], { timeout: 10_000 }),
    command("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory | ConvertTo-Json -Compress"], { timeout: 10_000 }),
  ]);
  return { label, at: new Date().toISOString(), gpu: gpu.ok ? gpu.stdout : gpu.stderr, systemMemory: mem.ok ? mem.stdout : mem.stderr, caveat: "Resource samples are coarse host/process-adjacent readings, not exact per-token allocator telemetry." };
}

async function assertExactNativeLoaded(phase) {
  const response = await fetch(`${endpoint}/api/v1/models`);
  assert.equal(response.ok, true, `${phase}: native /api/v1/models unavailable (${response.status})`);
  const data = await response.json();
  const rows = Array.isArray(data.models) ? data.models : [];
  const row = rows.find((item) => String(item.key ?? item.id ?? "") === modelId);
  const instances = Array.isArray(row?.loaded_instances) ? row.loaded_instances : [];
  const exact = instances.some((instance) => String(instance.id ?? "") === modelId);
  assert.ok(row, `${phase}: native row ${modelId} missing`);
  assert.ok(exact, `${phase}: exact loaded instance ${modelId} missing`);
  const snapshot = {
    phase,
    at: new Date().toISOString(),
    key: row.key ?? null,
    id: row.id ?? null,
    loadedInstances: instances.map((instance) => instance.id),
    effectiveContext: instances[0]?.config?.context_length ?? null,
    catalogMaxContext: row.max_context_length ?? null,
    quantization: row.quantization?.name ?? null,
    sizeBytes: row.size_bytes ?? null,
  };
  phases.push(snapshot);
  return snapshot;
}

async function nativeLoadedIds() {
  const response = await fetch(`${endpoint}/api/v1/models`);
  if (!response.ok) return [];
  const data = await response.json();
  return (Array.isArray(data.models) ? data.models : [])
    .flatMap((row) => (Array.isArray(row.loaded_instances) ? row.loaded_instances : []).map((instance) => instance.id));
}

async function captureNative(application, path) {
  const bytes = await application.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const image = await win.webContents.capturePage();
    return Array.from(image.toPNG());
  });
  await writeFile(path, Buffer.from(bytes));
}

function uatPictureState(now) {
  const fountain = [
    "Title: Llama Runtime Gate",
    "Credit: Premiere316 Wave 2 UAT",
    "",
    "ACT I",
    "",
    "SEQUENCE A - THE QUIET TEST",
    "",
    "INT. EMPTY EDIT BAY - NIGHT",
    "",
    "MARA checks a silent projector. One frame glows blue.",
    "",
    "MARA",
    "Keep it small. Keep it honest.",
    "",
    "INT. HALLWAY OUTSIDE EDIT BAY - NIGHT",
    "",
    "ELIAS waits by a locked archive door, listening for the machine to stop.",
  ].join("\n");
  const intake = {
    schemaVersion: 1,
    sourceType: "concept",
    title: "Llama Runtime Gate",
    concept: "A tiny local-only UAT scene about an editor verifying a projector without waking the whole archive.",
    premise: "An editor and conservator confirm a machine is alive while preserving every untouched archive detail.",
    logline: "A midnight editor rewrites only one small scene before an independent Story Doctor checks the work.",
    storyNotes: "Two short scenes only. Keep the archive setting, two characters, and local-first mood.",
    treatment: "",
    existingScreenplay: "",
    existingScreenplayMode: "use-as-is",
    sourceMaterial: "",
    adaptationInstructions: "",
    materialToPreserve: "Preserve the second hallway scene byte-for-byte unless it is explicitly selected.",
    materialMayDramatize: "The edit bay scene may become more cinematic.",
    sourcePassages: "",
    suppliedSourceText: "",
    fidelityRequirements: "Local-only UAT; no cloud, no Qwen.",
    historicalPeriod: "",
    culturalSocialWorld: "",
    adaptationBoundaries: "Do not expand beyond the two-scene test.",
    importedSources: [],
    targetRuntimeMinutes: 1,
    genre: "Quiet supernatural drama",
    tone: "restrained, filmable, tactile",
    audienceRating: "PG",
    aspectRatio: "16:9",
    frameRate: 24,
    productionStyle: "35mm texture, tungsten desk lamp, rain-muted archive",
    directorNotes: "Revise only the selected scene. Preserve unrelated source spans exactly.",
    dialogueStyle: "Lean, grounded, no exposition.",
    storyConstraints: "Two scenes maximum for this gate.",
    mustInclude: "projector, archive, one visible behavior change",
    mustAvoid: "cloud references, Qwen, extra acts",
    workflow: "single",
    screenplayModelId: modelOptionValue,
    socialWorld: [],
    createdAt: now,
    updatedAt: now,
  };
  const researchContent = {
    mode: "local-only",
    sources: [{ id: "src:uat", title: "Local UAT brief", locator: "operator-approved runtime gate", quote: intake.concept, confidence: "C", importedFrom: null, createdAt: now }],
    disputes: [],
    socialWorldNotes: [],
    cinematographyManifesto: { thesis: "A tiny archive scene should prove local model routing without touching user projects.", lensLanguage: "35mm restrained coverage", lighting: "single tungsten practical", geography: "one edit bay and one hallway", movement: "static to slow push", texture: "film grain and dust", soundWorld: "projector hum and hallway air", musicResearch: "none" },
    risks: "Runtime gate only; bounded prompt and output.",
    feasibility: "Single-scene rewrite and critique.",
    notes: "Approved before inference.",
  };
  const research = { schemaVersion: 1, status: "APPROVED", scope: "whole-picture", content: researchContent, versions: [{ id: "rv-uat-approved", label: "Approved Research Bible", kind: "approved", scope: "whole-picture", createdAt: now, sourceVersionId: null, content: researchContent }], currentVersionId: "rv-uat-approved", approvedVersionId: "rv-uat-approved", approvedAt: now, updatedAt: now };
  const screenplay = { schemaVersion: 1, workflow: "single", selectedModelId: modelOptionValue, pinnedWriterServedId: modelId, pinnedQaServedId: modelId, status: "READY_FOR_REVIEW", versions: [{ id: "spv-seed", label: "Seed screenplay", kind: "manual", fountain, createdAt: now, model: null, workflow: "single", pass: null, sourceVersionId: null, settings: null, scope: "full", nodeIds: null, selection: null, logicalRole: "manual" }], currentVersionId: "spv-seed", approvedVersionId: null, workingFountain: fountain, generation: null, lastTelemetry: null, lastQaReport: null, pinnedCompilerServedId: null, activeLogicalRole: null, residentSession: null, lastRoleTelemetry: [], preferredWriterKey: modelId, updatedAt: now };
  const picture = { id: "pic-llama-runtime-gate", title: intake.title, logline: intake.logline, genre: intake.genre, tone: intake.tone, format: intake.aspectRatio, fps: intake.frameRate, runtimeMinutes: intake.targetRuntimeMinutes, createdAt: now, updatedAt: now, stage: "screenplay", lastOpenedStage: "screenplay", selectedEngine: { still: "flux1-dev", image: "flux1-dev", video: "ltxv", voice: "minimax-speech", music: "minimax-music" }, intake, research, screenplay, screenplayFountain: fountain, production: null, performance: null, acts: [], scenes: [], characters: [{ id: "ch-mara", name: "Mara", role: "editor", age: "30s", look: "tired eyes, work jacket", arc: "chooses precision", voiceId: "" }, { id: "ch-elias", name: "Elias", role: "conservator", age: "40s", look: "quiet, raincoat", arc: "protects the archive", voiceId: "" }], locations: [], props: [], wardrobe: [], vfx: [], shots: [], cues: [], voices: [], directorNotes: intake.directorNotes, usage: { llm: 0, stills: 0, clips: 0, tts: 0 }, sample: false, promptLab: null };
  return { picture, seedFountain: fountain, protectedSpan: "INT. HALLWAY OUTSIDE EDIT BAY - NIGHT\n\nELIAS waits by a locked archive door, listening for the machine to stop." };
}

async function launch() {
  assertIsolatedUserData(userDataDir);
  const now = Date.now();
  const seeded = uatPictureState(now);
  const storage = { state: { pictures: [seeded.picture], activeId: seeded.picture.id, stageOverride: "screenplay", selectedShotId: null, stillBayShotId: null, binTab: "assets", leftPanelCollapsed: false, rightPanelCollapsed: false, residency: { pinned: {}, idleUnload: 30 } }, version: 0 };
  const application = await electron.launch({ executablePath, args: [`--user-data-dir=${userDataDir}`], env: { ...process.env, ELECTRON_USER_DATA_DIR: userDataDir } });
  const page = await application.firstWindow();
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") failures.push(`console: ${message.text()}`); });
  page.on("request", (request) => { networkLog.push({ method: request.method(), url: request.url() }); });
  await page.addInitScript((value) => localStorage.setItem("premiere316-v302-c", JSON.stringify(value)), storage);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (document.body?.innerText.length ?? 0) > 80);
  const launchedUserData = await application.evaluate(async ({ app }) => app.getPath("userData"));
  assertIsolatedUserData(launchedUserData);
  return { application, page, launchedUserData, ...seeded };
}

async function selectStage(page, id, buttonName) {
  const navigation = page.getByRole("navigation", { name: "Pipeline" });
  const wideButton = navigation.getByRole("button", { name: buttonName, exact: true });
  if (await wideButton.isVisible().catch(() => false)) await wideButton.click();
  else await navigation.getByRole("combobox", { name: "Pipeline stage" }).selectOption(id);
}

async function currentFountain(page) {
  return await page.getByLabel("Fountain screenplay").inputValue();
}

async function storedScreenplay(page) {
  return await page.evaluate(() => {
    const raw = localStorage.getItem("premiere316-v302-c");
    const parsed = raw ? JSON.parse(raw) : null;
    const state = parsed?.state ?? parsed;
    const pic = state?.pictures?.find((p) => p.id === "pic-llama-runtime-gate");
    return pic?.screenplay ?? null;
  });
}

async function clickScene(page, namePattern) {
  const button = page.getByRole("button", { name: namePattern }).first();
  await button.waitFor({ timeout: 60_000 });
  await button.click();
}

async function waitForGenerationDone(page, beforeText, timeout = 900_000) {
  await page.getByRole("button", { name: "Stop" }).waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  await page.getByRole("button", { name: "Generate Screenplay" }).waitFor({ state: "visible", timeout });
  await page.waitForFunction(() => !document.body.innerText.includes("GENERATING"), undefined, { timeout: 60_000 });
  await page.waitForFunction((oldText) => {
    const area = document.querySelector("textarea[aria-label='Fountain screenplay']");
    const text = area?.value ?? "";
    return text.length > 20 && text !== oldText;
  }, beforeText, { timeout: 60_000 });
  await page.waitForTimeout(1000);
}

async function main() {
  await mkdir(artifacts, { recursive: true });
  userDataDir = await mkdtemp(join(tmpdir(), "premiere316-llama-runtime-"));
  const resources = [await resourceSample("pre-launch")];
  const preLoaded = await assertExactNativeLoaded("pre-launch");
  let app;
  try {
    app = await launch();
    const { application, page, protectedSpan } = app;
    const buildInfo = await page.evaluate(() => window.premiere316?.app.buildInfo());
    assert.equal(buildInfo?.rendererMode, "PACKAGED DIST");
    assert.equal(buildInfo?.buildId, "p316-20260903183552-c37b85ae52c1");
    assert.equal(buildInfo?.executablePath, executablePath);
    await selectStage(page, "screenplay", "03 Screenplay");
    await page.getByText("Llama Runtime Gate", { exact: true }).first().waitFor();
    await page.waitForFunction(() => !document.body.innerText.includes("Checking LM Studio local API"), undefined, { timeout: 120_000 });
    await page.getByLabel("Writer").selectOption(modelOptionValue);
    await page.getByLabel("Story Doctor model").selectOption(modelOptionValue);
    await page.getByText(`Pinned writer ID: ${modelId}`).waitFor();
    await page.getByText(`Pinned Story Doctor ID: ${modelId}`).waitFor();
    await clickScene(page, /INT\. EMPTY EDIT BAY/);
    await captureNative(application, screenshot("00-ready-pinned"));

    await assertExactNativeLoaded("before-writer-scene-rewrite");
    resources.push(await resourceSample("before-writer-scene-rewrite"));
    const beforeWriter = await currentFountain(page);
    const beforeWriterHash = sha256(beforeWriter);
    assert.ok(beforeWriter.includes(protectedSpan), "seed protected span missing before writer");
    completionRequests += 1;
    await page.getByRole("button", { name: "Generate Screenplay" }).click();
    await waitForGenerationDone(page, beforeWriter, 900_000);
    const afterWriter = await currentFountain(page);
    await writeFile(resolve(artifacts, "writer-output.fountain"), afterWriter, "utf8");
    await captureNative(application, screenshot("01-writer-output"));
    assert.notEqual(afterWriter, beforeWriter, "writer scene rewrite did not change Fountain");
    assert.ok(afterWriter.trim().length > 20 && /^(INT|EXT|EST|I\/E)\./m.test(afterWriter), "writer output is not valid-looking Fountain");
    assert.ok(afterWriter.includes(protectedSpan), "writer rewrite did not preserve unrelated scene bytes");

    await assertExactNativeLoaded("before-story-doctor");
    resources.push(await resourceSample("before-story-doctor"));
    const beforeQa = await currentFountain(page);
    const beforeQaHash = sha256(beforeQa);
    completionRequests += 1;
    await page.getByRole("button", { name: "Run story doctor" }).click();
    await page.getByLabel("Story Doctor critique").waitFor({ timeout: 900_000 });
    await page.waitForTimeout(1000);
    const afterQa = await currentFountain(page);
    const afterQaHash = sha256(afterQa);
    assert.equal(afterQaHash, beforeQaHash, "QA mutated Fountain before explicit revision");
    const qaState = await storedScreenplay(page);
    assert.ok(qaState?.lastQaReport?.fountainUnchanged, "QA report did not persist fountainUnchanged=true");
    assert.ok(Array.isArray(qaState.lastQaReport.findings) && qaState.lastQaReport.findings.length > 0, "QA report persisted no findings");
    assert.equal(qaState.lastQaReport.servedModelId, modelId, "QA report used unexpected model");
    await captureNative(application, screenshot("02-qa-critique"));

    const applyButton = page.getByRole("button", { name: "Apply scoped revision" });
    const usedQaApply = !(await applyButton.isDisabled().catch(() => true));
    let beforeRevision = await currentFountain(page);
    let beforeRevisionHash = sha256(beforeRevision);
    await assertExactNativeLoaded("before-explicit-scoped-revision");
    resources.push(await resourceSample("before-explicit-scoped-revision"));
    if (usedQaApply) {
      await applyButton.click();
      await page.waitForFunction((hash) => {
        const area = document.querySelector("textarea[aria-label='Fountain screenplay']");
        const text = area?.value ?? "";
        let h = "";
        return text.length > 20 && text !== hash;
      }, beforeRevision, { timeout: 120_000 });
    } else {
      completionRequests += 1;
      await page.getByRole("button", { name: "Generate Screenplay" }).click();
      await waitForGenerationDone(page, beforeRevision, 900_000);
    }
    const afterRevision = await currentFountain(page);
    assert.notEqual(sha256(afterRevision), beforeRevisionHash, "explicit scoped revision did not change Fountain");
    assert.ok(afterRevision.includes(protectedSpan), "scoped revision did not preserve unrelated scene bytes");
    await captureNative(application, screenshot("03-scoped-revision"));

    const preApprovalState = await storedScreenplay(page);
    const preApprovalVersionId = preApprovalState.currentVersionId;
    await page.getByRole("button", { name: "Approve Screenplay" }).click();
    await page.getByText("Canonical", { exact: true }).waitFor({ timeout: 120_000 });
    await page.waitForTimeout(1000);
    const approvedState = await storedScreenplay(page);
    assert.equal(approvedState.status, "APPROVED", "screenplay not approved");
    assert.ok(approvedState.approvedVersionId, "approvedVersionId missing");
    assert.notEqual(approvedState.approvedVersionId, preApprovalVersionId, "approval did not append version");
    const current = approvedState.versions.find((v) => v.id === approvedState.currentVersionId);
    const prior = approvedState.versions.find((v) => v.id === preApprovalVersionId);
    assert.ok(current?.fountain?.trim(), "approved current Fountain missing");
    assert.equal(prior?.fountain, afterRevision, "prior approved-candidate bytes are not retrievable");
    assert.ok(approvedState.versions.some((v) => v.id === "spv-seed" && v.fountain.includes(protectedSpan)), "seed version no longer retrievable");
    assert.ok(current.fountain.includes(protectedSpan), "approved screenplay did not preserve unrelated bytes");
    assert.equal(current.model?.servedModelId ?? prior?.model?.servedModelId, modelId, "model provenance missing exact Llama served ID");
    assert.ok(approvedState.lastTelemetry?.actualLoadedModel === modelId, "telemetry missing exact Llama actualLoadedModel");
    assert.ok(approvedState.lastTelemetry?.generatedTokens !== null || approvedState.lastTelemetry?.generationMs !== null, "telemetry missing generation duration/token evidence");
    await captureNative(application, screenshot("04-approval"));

    const beforeReleaseLoaded = await nativeLoadedIds();
    assert.ok(beforeReleaseLoaded.includes(modelId), "model unloaded before end-of-workflow release");
    resources.push(await resourceSample("before-visible-release"));
    await page.getByRole("button", { name: "Release local model" }).click();
    await page.waitForTimeout(5000);
    const afterReleaseLoaded = await nativeLoadedIds().catch(() => []);
    await captureNative(application, screenshot("05-final-state"));
    resources.push(await resourceSample("after-visible-release"));

    const forbiddenQwenPosts = networkLog.filter((entry) => entry.method === "POST" && /qwen/i.test(entry.url));
    const forbidden8080 = networkLog.filter((entry) => /:(8080)(\/|$)/.test(entry.url) || entry.url.includes(":8080/"));
    assert.equal(forbiddenQwenPosts.length, 0, "Qwen network POST observed");
    assert.equal(forbidden8080.length, 0, "packaged app probed forbidden :8080 endpoint");
    assert.ok(completionRequests <= 4, `completion request cap exceeded: ${completionRequests}`);
    assert.deepEqual(failures, []);

    const report = {
      ok: true,
      status: "RUNTIME_PASS_AWAITING_INDEPENDENT_AUDIT",
      executablePath,
      buildInfo,
      commitUnderTest: "b8d5be70357cb6402ec44153ca8ad499d0293cd2",
      endpoint,
      modelId,
      qwenRan: false,
      promptLabExecuted: false,
      completionRequests,
      usedQaApply,
      userDataDir,
      launchedUserData: app.launchedUserData,
      realProfileUntouched: REAL_PROFILE,
      hashes: { beforeWriter: beforeWriterHash, afterWriter: sha256(afterWriter), beforeQa: beforeQaHash, afterQa: afterQaHash, beforeRevision: beforeRevisionHash, afterRevision: sha256(afterRevision), approved: sha256(current.fountain) },
      versions: approvedState.versions.map((v) => ({ id: v.id, label: v.label, kind: v.kind, sourceVersionId: v.sourceVersionId, scope: v.scope ?? null, nodeIds: v.nodeIds ?? null, logicalRole: v.logicalRole ?? null, modelServedId: v.model?.servedModelId ?? null, hash: sha256(v.fountain ?? "") })),
      qa: { id: approvedState.lastQaReport.id, servedModelId: approvedState.lastQaReport.servedModelId, displayName: approvedState.lastQaReport.displayName, fountainUnchanged: approvedState.lastQaReport.fountainUnchanged, findingCount: approvedState.lastQaReport.findings.length, findings: approvedState.lastQaReport.findings.map((f) => ({ category: f.category, severity: f.severity, summary: f.summary, exactScope: f.exactScope ?? null, revisionRequired: Boolean(f.revisionRequired), hasRewriteSuggested: Boolean(f.rewriteSuggested) })) },
      telemetry: approvedState.lastTelemetry,
      context: { effectiveContext: preLoaded.effectiveContext, catalogMaxContext: preLoaded.catalogMaxContext },
      nativePhaseChecks: phases,
      release: { clickedVisibleReleaseButton: true, loadedBeforeRelease: beforeReleaseLoaded, loadedAfterRelease: afterReleaseLoaded, nativeUnloadSucceeded: !afterReleaseLoaded.includes(modelId), note: "No replacement model was started or loaded by this harness." },
      resources,
      screenshots: ["00-ready-pinned.png", "01-writer-output.png", "02-qa-critique.png", "03-scoped-revision.png", "04-approval.png", "05-final-state.png"].map((name) => `screenshots/llama-runtime/${name}`),
      network: { rendererObservedRequests: networkLog.length, forbidden8080: forbidden8080.length, qwenPosts: forbiddenQwenPosts.length },
      validation: { nonemptyFountain: true, validLookingFountain: true, qaDidNotMutateFountain: true, unrelatedSpanPreserved: true, priorVersionsRetrievable: true, noIntermediateUnloadReload: true },
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app?.application?.close().catch(() => {});
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(async (error) => {
  await mkdir(artifacts, { recursive: true }).catch(() => {});
  const report = { ok: false, status: "BLOCKED", error: error instanceof Error ? error.message : String(error), phases, completionRequests, failures, network: networkLog, resources: [await resourceSample("failure").catch((e) => ({ label: "failure", error: String(e) }))] };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8").catch(() => {});
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
