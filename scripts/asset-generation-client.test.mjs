import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createProductionBreakdown } from "../src/lib/production/breakdown.ts";
import { approveInventoryAssetSpec, prepareAssetRecords, applyProductionAuthority, applyPreparedApproval } from "../src/lib/production/inventory.ts";
import { assetPromptContext } from "../src/lib/studio/asset-prompt-context.ts";
import { makePictureIntake } from "../src/lib/studio/picture-intake.ts";
import { makePictureScreenplay } from "../src/lib/studio/screenplay.ts";
import { makeVisualDevelopmentState, approveVisualRecord } from "../src/lib/visual-development.ts";
import { makeCinematographyState, approveCinematographyPlan } from "../src/lib/cinematography.ts";
import { sanitizeProductionBreakdown } from "../src/lib/production/persistence.ts";

// Exercise the actual browser orchestration with only the network/model boundary replaced.
const bundle = await build({
  entryPoints: [new URL("../src/lib/studio/asset-generation-client.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "model-boundary", setup(builder) {
    builder.onResolve({ filter: /movie-plan-(client|api)\.ts$/ }, (args) => ({ path: args.path, namespace: "model-boundary" }));
    builder.onLoad({ filter: /.*/, namespace: "model-boundary" }, () => ({ contents: `
      export const releaseMoviePlanWriterForImages = (...args) => globalThis.__assetGenerationTest.release(...args);
      export const countAssetPromptTokens = (...args) => globalThis.__assetGenerationTest.count(...args);
      export const writeAssetPromptsOnServer = () => { throw new Error('Unexpected writer call'); };
      export const findAssetReferencesOnServer = () => { throw new Error('Unexpected reference call'); };
    ` }));
  } }],
});
const { generateAssetDrafts, hasCurrentImage, assetImageDimensions } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function fixture() {
  const fountain = "EXT. RED SEA - NIGHT\n\nMoses holds his staff beside a pillar of fire.";
  const intake = makePictureIntake(1);
  const p = {
    id: "picture-test", intake, selectedEngine: { image: "flux2" },
    screenplay: { ...makePictureScreenplay(intake.workflow, null, 1), currentVersionId: "v1", workingFountain: fountain },
    visualDevelopment: { ...makeVisualDevelopmentState(1), approvals: [{ id: "visual-approved" }] },
    cinematography: { ...makeCinematographyState(1), approvals: [{ id: "cine-approved" }] },
    productFlow: { reviewInternalPhases: true, servedModelId: "stale-flow-model" },
  };
  let record = createProductionBreakdown({ pictureId: p.id, versionId: "v1", status: "APPROVED", fountain, scenes: [{ id: "SCENE-001", slugline: "EXT. RED SEA - NIGHT" }], socialWorld: [] }, [
    { id: "req-moses", category: "character", name: "Moses", description: "Maroon robe", sceneIds: ["SCENE-001"] },
    { id: "req-staff", category: "prop", name: "Staff", description: "Wooden staff", sceneIds: ["SCENE-001"] },
  ], 1);
  for (const asset of record.assets) record = approveInventoryAssetSpec(record, asset.id, 2);
  record = prepareAssetRecords(record, ["visual-approved"], ["cine-approved"], 3);
  record = seal(record, "1");
  p.production = record;
  addPrompts(p);
  return p;
}
function seal(record, digit) {
  const authority = { authorityId: `authority:${digit.repeat(32)}`, digest: digit.repeat(64), createdAt: 4 };
  record = applyProductionAuthority(record, authority);
  for (const prepared of record.preparedAssets) record = applyPreparedApproval(record, { preparedAssetId: prepared.id, rootId: `preparedApproval:${prepared.id}:${digit}`, digest: digit.repeat(64), authorityId: authority.authorityId, approvedAt: 5 });
  return record;
}
function addPrompts(p) {
  p.assetImagePrompts = {};
  p.assetPromptSources = {};
  for (const asset of p.production.assets) {
    const prompt = `Model prompt for ${asset.name}`;
    p.assetImagePrompts[asset.id] = prompt;
    p.assetPromptSources[asset.id] = { prompt, modelId: "actual-prompt-writer", tokenCount: 1100, contextHash: assetPromptContext(p, asset).hash, sceneIds: asset.requiredSceneIds, sourceQuote: "Moses holds his staff beside a pillar of fire.", generatedAt: 6 };
  }
}
function harness(p, { badPrompt, offload = true } = {}) {
  const events = [];
  let proposal;
  globalThis.__assetGenerationTest = {
    count: async ({ data }) => { events.push(`count:${data.prompt}`); return { count: data.prompt === badPrompt ? 4 : 1100 }; },
    release: async (id) => { events.push(`release:${id}`); return { released: offload }; },
  };
  globalThis.window = { premiere316: { image: {
    recoverDrafts: async () => ({ ok: true, results: [] }),
    authorityStatus: async () => ({ ok: true, ...p.production.productionAuthority, status: "CURRENT" }),
    prepareDrafts: async ({ rawCanonical }) => {
      events.push("seal"); proposal = rawCanonical;
      const authority = { authorityId: `authority:${"2".repeat(32)}`, digest: "2".repeat(64), createdAt: 7 };
      return { ok: true, authority, approvals: rawCanonical.preparedAssets.filter((item) => item.status === "READY_TO_PREPARE").map((item) => ({ preparedAssetId: item.id, rootId: `preparedApproval:${item.id}:2`, digest: "2".repeat(64), approvedAt: 8 })) };
    },
    manifests: async () => { events.push("manifests"); return [{ adapterId: "flux2", modelVariant: "flux2-dev", status: "READY", controls: { controls: {} } }]; },
    generateDraft: async (input) => { events.push(`generate:${input.preparedAssetId}`); return { ok: false, error: "Test stop at GPU boundary" }; },
  } } };
  return { events, get proposal() { return proposal; }, publish: () => events.push("save") };
}

test("validates and saves every queued prompt, then confirms actual writer offload before image-memory checks", async () => {
  const p = fixture(); const h = harness(p);
  await assert.rejects(generateAssetDrafts(p, h.publish, () => {}), /Test stop at GPU boundary/);
  assert.deepEqual(h.events.slice(0, 5), ["count:Model prompt for Moses", "count:Model prompt for Staff", "save", "release:actual-prompt-writer", "manifests"]);
  assert.equal(h.proposal, undefined, "unchanged authority must remain valid");
});

test("restart hydration restores backend-verified authority and roots before generation without resealing", async () => {
  const p = fixture();
  const authority = { ...p.production.productionAuthority };
  p.production = sanitizeProductionBreakdown(p.production);
  assert.equal(p.production.productionAuthority.status, "INVALID");
  const h = harness(p);
  const approvals = p.production.preparedAssets.map((prepared) => ({ preparedAssetId: prepared.id, rootId: prepared.preparedApprovalRootId, digest: prepared.preparedApprovalDigest, approvedAt: prepared.approvedAt }));
  globalThis.window.premiere316.image.recoverDrafts = async (input) => {
    assert.equal(input.rawCanonical.productionAuthority.status, "INVALID");
    h.events.push("recover");
    return { ok: true, results: [], authority, approvals };
  };
  let restored;
  await assert.rejects(generateAssetDrafts(p, (next) => { restored = next; h.publish(); }, () => {}), /Test stop at GPU boundary/);
  assert.equal(h.events[0], "recover");
  assert.equal(h.proposal, undefined);
  assert.equal(restored.production.productionAuthority.status, "CURRENT");
  assert.equal(restored.production.productionAuthority.authorityId, authority.authorityId);
  assert.equal(restored.production.preparedAssets[0].preparedApprovalRootId, approvals[0].rootId);
});

test("a short later prompt stops the entire queue before offload or any image generation", async () => {
  const p = fixture(); const h = harness(p, { badPrompt: "Model prompt for Staff" });
  await assert.rejects(generateAssetDrafts(p, h.publish, () => {}), /required 1024/);
  assert.equal(h.events.length, 2);
});

test("new references reseal even if the old backend authority still reports CURRENT", async () => {
  const p = fixture();
  p.production.assets[0].references.push({ id: "new-robe", name: "Robe", uri: `media://stills/reference-${"a".repeat(64)}.png`, mediaType: "image/png", preferred: true, uploadedAt: 9, provenance: { sourceType: "user", screenplayVersionId: "v1", sceneIds: ["SCENE-001"], createdAt: 9 } });
  addPrompts(p); const h = harness(p);
  await assert.rejects(generateAssetDrafts(p, h.publish, () => {}), /Test stop at GPU boundary/);
  assert.deepEqual(h.proposal.preparedAssets[0].referenceIds, ["new-robe"]);
  assert.equal(h.proposal.assets[0].references[0].uri, p.production.assets[0].references[0].uri);
  assert.ok(h.events.indexOf("seal") < h.events.indexOf("release:actual-prompt-writer"));
});

test("same prompt and engine cannot reuse an image generated without the now-attached reference", async () => {
  const p = fixture(); const asset = p.production.assets[0];
  asset.references.push({ id: "robe", name: "Robe", uri: `media://stills/reference-${"a".repeat(64)}.png` });
  addPrompts(p);
  for (const item of p.production.assets) item.iterations.push({ id: `old:${item.id}`, mediaUri: "old.png", ...assetImageDimensions(item, "flux2"), execution: { engineId: "flux2", prompt: p.assetImagePrompts[item.id], references: [] } });
  const h = harness(p);
  await assert.rejects(generateAssetDrafts(p, h.publish, () => {}, undefined, true), /Test stop at GPU boundary/);
  assert.ok(h.events.includes(`generate:prepared:${asset.id}`));
  assert.equal(h.events.filter((event) => event.startsWith("count:")).length, 1);
});

test("unconfirmed writer offload blocks manifests and GPU generation", async () => {
  const p = fixture(); const h = harness(p, { offload: false });
  await assert.rejects(generateAssetDrafts(p, h.publish, () => {}), /offload was not confirmed/);
  assert.ok(!h.events.includes("manifests"));
});

test("KREA encodes the whole saved queue after writer offload, then generates using the same values", async () => {
  const p = fixture(); p.selectedEngine.image = "krea-2"; addPrompts(p); const h = harness(p);
  let batch;
  globalThis.window.premiere316.image.manifests = async () => { h.events.push("manifests"); return [{ adapterId: "krea-2", modelVariant: "krea2-raw", status: "READY", controls: { controls: {} } }]; };
  globalThis.window.premiere316.image.encodeDraftPrompts = async (input) => { batch = input; h.events.push("encode"); return { ok: true, promptCount: input.prompts.length, cachedPromptCount: input.prompts.length, encoderReleased: true, textEncoderDevice: "cuda", encodeMs: 10 }; };
  globalThis.window.premiere316.image.generateDraft = async (input) => { h.events.push("generate"); assert.deepEqual(input.values, batch.prompts[0].values); assert.equal(input.promptOverride, batch.prompts[0].prompt); return { ok: false, error: "Test stop at GPU boundary" }; };
  await assert.rejects(generateAssetDrafts(p, h.publish, () => {}), /Test stop at GPU boundary/);
  assert.equal(batch.prompts.length, 2);
  assert.equal(batch.prompts[0].values.width, 1536);
  assert.equal(batch.prompts[1].values.width, 512);
  assert.ok(h.events.indexOf("encode") > h.events.indexOf("release:actual-prompt-writer"));
  assert.ok(h.events.indexOf("generate") > h.events.indexOf("encode"));
});

test("KREA current image binds dimensions and prompt research while rejecting claimed pixel conditioning", () => {
  const p = fixture(); const asset = p.production.assets[0]; const uri = `media://stills/reference-${"a".repeat(64)}.png`;
  asset.references = [{ id: "robe", uri }];
  const iteration = { mediaUri: "image.png", width: 1536, height: 1024, execution: { engineId: "krea-2", prompt: "sheet", references: [], promptReferences: [{ id: uri, fingerprint: "a".repeat(64) }], conditioningMode: "text-only" } };
  asset.iterations = [iteration];
  assert.equal(hasCurrentImage(asset, "krea-2", "sheet"), true);
  iteration.width = 512; assert.equal(hasCurrentImage(asset, "krea-2", "sheet"), false);
  iteration.width = 1536; iteration.execution.references = [{ id: uri }]; assert.equal(hasCurrentImage(asset, "krea-2", "sheet"), false);
});

test("internal visual and camera approvals preserve the model prompt's creative context", () => {
  const p = fixture();
  p.visualDevelopment.boards = [{ id: "look", title: "Firelit crossing", intent: "Readable night faces", palette: ["maroon"], motifs: ["fire"], referenceSlots: [], status: "DRAFT", approvedVersionId: null }];
  p.cinematography.shotPlans = [{ id: "camera", sceneId: "SCENE-001", framing: "Wide", lens: "35mm", movement: "Static", geography: "Preserve screen direction", lighting: "Pillar of fire", texture: "Natural cloth", motif: "Fire", status: "DRAFT", approvedVersionId: null, sourceFingerprints: [] }];
  const asset = p.production.assets[0];
  const before = assetPromptContext(p, asset).hash;
  p.visualDevelopment = approveVisualRecord(p.visualDevelopment, "board", "look", 10);
  p.cinematography = approveCinematographyPlan(p.cinematography, "camera", 10);
  assert.equal(p.cinematography.shotPlans[0].status, "APPROVED");
  assert.equal(p.visualDevelopment.boards[0].status, "APPROVED");
  assert.equal(assetPromptContext(p, asset).hash, before);
});
