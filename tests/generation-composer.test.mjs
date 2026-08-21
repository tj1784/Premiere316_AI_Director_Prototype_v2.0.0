import test from "node:test";
import assert from "node:assert/strict";

import {
  GENERATION_OUTPUT_KINDS,
  STORYBOARD_KREA_GENERATION_WORKFLOW_ID,
  STORYBOARD_LTX25_GENERATION_WORKFLOW_ID,
  buildSyntheticImageStoryboardInput,
  buildSyntheticVideoPlanInput,
  getGenerationWorkflowCatalog,
  preflightGenerationRequest,
  prepareGenerationCreate
} from "../server/generation-composer.js";
import { validateStoryboard } from "../server/storyboard.js";
import { buildStoryboardFrameWorkflowGraph } from "../server/storyboard-generation.js";

function manifestAsset(id, {
  activeVersion = 1,
  versions,
  file = `${id}.v${activeVersion}.png`,
  mediaType = "image",
  sha256 = "a".repeat(64),
  bytes = 1000
} = {}) {
  const builtVersions = versions || [{
    v: activeVersion,
    file,
    files: [file],
    mediaType,
    fileHashes: [{ file, sha256, bytes }]
  }];
  return {
    id,
    name: id.replaceAll("-", " "),
    status: "generated",
    mediaType,
    activeVersion,
    versions: builtVersions
  };
}

function fixtureProject(items = [
  manifestAsset("character-adam", { sha256: "1".repeat(64) }),
  manifestAsset("character-eve", { sha256: "2".repeat(64) }),
  manifestAsset("location-dungeon", { sha256: "3".repeat(64) })
]) {
  return {
    slug: "composer_test",
    settings: { width: 1920, height: 800, fps: 24, aspectRatio: "2.39:1" },
    assets: { schemaVersion: 1, items }
  };
}

function pin(assetId, order, role = "identity", assetVersion = 1, extra = {}) {
  return { mentionId: `m-${order}`, display: `@${assetId}`, assetId, assetVersion, role, order, ...extra };
}

function request(overrides = {}) {
  return {
    schemaVersion: 1,
    outputKind: "video",
    workflowId: STORYBOARD_LTX25_GENERATION_WORKFLOW_ID,
    promptText: "@Adam dancing with @Eve in the @Dungeon",
    references: [],
    unresolvedMentions: [],
    options: { durationSec: 5, fps: 24, width: 768, height: 320 },
    ...overrides
  };
}

test("catalog exposes every requested output kind and honest readiness hooks", () => {
  const catalog = getGenerationWorkflowCatalog({
    readinessByWorkflow: {
      [STORYBOARD_KREA_GENERATION_WORKFLOW_ID]: { ready: true, availableNow: true, reason: "tested" },
      "qwen3-tts-voice-design-1.7b": { ready: false, availableNow: false, reason: "weights missing" }
    }
  });
  const covered = new Set(catalog.flatMap((item) => item.outputKinds));
  assert.deepEqual([...GENERATION_OUTPUT_KINDS].sort(), [...covered].sort());
  assert.equal(catalog.find((item) => item.id === STORYBOARD_KREA_GENERATION_WORKFLOW_ID).readiness.ready, true);
  const voice = catalog.find((item) => item.id === "qwen3-tts-voice-design-1.7b");
  assert.equal(voice.readiness.reason, "weights missing");
  assert.equal(voice.ready, false);
  assert.ok(voice.supportedOutputModes.includes("voice-design"));
  assert.deepEqual(catalog.find((item) => item.id === STORYBOARD_KREA_GENERATION_WORKFLOW_ID).referenceMediaTypes, ["image"]);
  const embedded = catalog.find((item) => item.id === "ltx-2.3-native-audio");
  assert.equal(embedded.creatable, false);
  assert.match(embedded.blockReason, /no standalone generation compiler/i);
  assert.equal(catalog.find((item) => item.id === "premiere316-title-card").readiness.ready, true);
});

test("preflight rejects workflow/output mismatch and explicit runtime blockers", () => {
  const project = fixtureProject();
  const mismatch = preflightGenerationRequest(project, request({ outputKind: "voice" }));
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.some((error) => error.code === "workflow_output_mismatch"));

  const blocked = preflightGenerationRequest(project, request(), {
    readinessByWorkflow: { [STORYBOARD_LTX25_GENERATION_WORKFLOW_ID]: { ready: false, reason: "missing LTX nodes" } }
  });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.errors.some((error) => error.code === "workflow_not_ready" && /missing LTX nodes/.test(error.message)));
});

test("display text is never used to infer ambiguous assets", () => {
  const project = fixtureProject([
    manifestAsset("character-adam"),
    manifestAsset("voice-adam", { file: "voice-adam.v1.mp3", mediaType: "audio" })
  ]);
  const result = preflightGenerationRequest(project, request({
    promptText: "@Adam sleeps",
    references: [],
    unresolvedMentions: []
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.resolvedReferences, []);
  assert.equal(result.resolvedReferences.some((reference) => reference.assetId.includes("adam")), false);

  const unresolved = preflightGenerationRequest(project, request({
    promptText: "@Adam sleeps",
    unresolvedMentions: [{ display: "@Adam", candidates: ["character-adam", "voice-adam"] }]
  }));
  assert.equal(unresolved.ok, false);
  assert.ok(unresolved.errors.some((error) => error.code === "unresolved_mentions"));
});

test("exact pins resolve immutable server manifest data and ignore client file/hash claims", () => {
  const project = fixtureProject();
  const result = preflightGenerationRequest(project, request({
    references: [pin("character-adam", 1, "character", 1, {
      file: "C:/client/forged.png",
      projectMediaPath: "../../outside.png",
      sha256: "f".repeat(64),
      bytes: 999999
    })]
  }));
  assert.equal(result.ok, true);
  assert.equal(result.resolvedReferences[0].role, "identity");
  assert.equal(result.resolvedReferences[0].file, "character-adam.v1.png");
  assert.equal(result.resolvedReferences[0].projectMediaPath, "media/assets/character-adam.v1.png");
  assert.equal(result.resolvedReferences[0].sha256, "1".repeat(64));
  assert.equal(result.resolvedReferences[0].bytes, 1000);
  assert.equal(Object.isFrozen(result.resolvedReferences[0]), true);
  assert.throws(() => { result.resolvedReferences[0].file = "changed.png"; }, TypeError);
});

test("identical pins dedupe while distinct pins preserve explicit order", () => {
  const project = fixtureProject();
  const result = preflightGenerationRequest(project, request({
    references: [
      pin("character-eve", 2),
      pin("character-adam", 1),
      pin("character-adam", 1)
    ]
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.resolvedReferences.map((reference) => reference.assetId), ["character-adam", "character-eve"]);
  assert.deepEqual(result.resolvedReferences.map((reference) => reference.order), [1, 2]);
  assert.ok(result.warnings.some((warning) => warning.code === "duplicate_reference_deduped"));
});

test("stale, missing, unverifiable and wrong-media versions fail closed", () => {
  const v1 = {
    v: 1,
    file: "adam.v1.png",
    files: ["adam.v1.png"],
    mediaType: "image",
    fileHashes: [{ file: "adam.v1.png", sha256: "1".repeat(64), bytes: 10 }]
  };
  const staleProject = fixtureProject([manifestAsset("character-adam", { activeVersion: 2, versions: [v1] })]);
  const stale = preflightGenerationRequest(staleProject, request({ references: [pin("character-adam", 1)] }));
  assert.ok(stale.errors.some((error) => error.code === "stale_asset_version"));

  const missing = preflightGenerationRequest(staleProject, request({ references: [pin("character-adam", 1, "identity", 2)] }));
  assert.ok(missing.errors.some((error) => error.code === "missing_asset_version"));

  const noHashAsset = manifestAsset("character-adam");
  noHashAsset.versions[0].fileHashes = [];
  const noHash = preflightGenerationRequest(fixtureProject([noHashAsset]), request({ references: [pin("character-adam", 1)] }));
  assert.ok(noHash.errors.some((error) => error.code === "unverifiable_asset_file"));

  const voice = manifestAsset("voice-adam", { file: "voice-adam.v1.mp3", mediaType: "audio" });
  const wrongMedia = preflightGenerationRequest(fixtureProject([voice]), request({ references: [pin("voice-adam", 1)] }));
  assert.ok(wrongMedia.errors.some((error) => error.code === "unsupported_reference_media"));
});

test("reference limits and unique explicit order are enforced", () => {
  const manyAssets = Array.from({ length: 21 }, (_, index) => manifestAsset(`character-${index + 1}`, {
    sha256: (index + 1).toString(16).padStart(64, "0")
  }));
  const project = fixtureProject(manyAssets);
  const tooMany = preflightGenerationRequest(project, request({
    outputKind: "image",
    workflowId: STORYBOARD_KREA_GENERATION_WORKFLOW_ID,
    references: manyAssets.map((asset, index) => pin(asset.id, index + 1)),
    options: { aspectRatio: "16:9" }
  }));
  assert.ok(tooMany.errors.some((error) => error.code === "too_many_references" && error.details.maximum === 20));

  const duplicateOrder = preflightGenerationRequest(fixtureProject(), request({
    references: [pin("character-adam", 1), pin("character-eve", 1)]
  }));
  assert.ok(duplicateOrder.errors.some((error) => error.code === "duplicate_reference_order"));

  const noImageReference = preflightGenerationRequest(fixtureProject(), request({
    outputKind: "image",
    workflowId: STORYBOARD_KREA_GENERATION_WORKFLOW_ID,
    references: [],
    options: { aspectRatio: "16:9" }
  }));
  assert.ok(noImageReference.errors.some((error) => error.code === "too_few_references"));

  const voiceRole = preflightGenerationRequest(fixtureProject(), request({
    references: [pin("character-adam", 1, "voice")]
  }));
  assert.ok(voiceRole.errors.some((error) => error.code === "invalid_reference_role"));

  const noReferenceAdapter = preflightGenerationRequest(fixtureProject(), request({
    outputKind: "image",
    workflowId: "krea2-cinematic-still-fp8",
    references: [pin("character-adam", 1, "identity")],
    options: {}
  }));
  assert.ok(noReferenceAdapter.errors.some((error) => error.code === "unsupported_reference_role"));
});

test("output-specific options validate and normalize without claiming unsupported controls", () => {
  const project = fixtureProject();
  const dialogue = preflightGenerationRequest(project, request({
    outputKind: "dialogue",
    workflowId: "qwen3-tts-voice-design-1.7b",
    references: [],
    options: {}
  }));
  assert.ok(dialogue.errors.some((error) => error.code === "missing_dialogue_text"));

  const validDialogue = preflightGenerationRequest(project, request({
    outputKind: "dialogue",
    workflowId: "qwen3-tts-voice-design-1.7b",
    references: [],
    options: { sampleText: "Adam, wake up.", seed: 42 }
  }));
  assert.equal(validDialogue.ok, true);
  assert.deepEqual(validDialogue.request.options, { sampleText: "Adam, wake up.", seed: 42 });

  const badFrames = preflightGenerationRequest(project, request({ options: { durationSec: 5.1, fps: 24, width: 770, height: 320, camera: "handheld" } }));
  assert.ok(badFrames.errors.some((error) => error.code === "invalid_frame_contract"));
  assert.ok(badFrames.errors.some((error) => error.code === "invalid_option" && error.path === "options.width"));
  assert.ok(badFrames.errors.some((error) => error.code === "unknown_option" && error.path === "options.camera"));

  const music = preflightGenerationRequest(project, request({
    outputKind: "audio",
    workflowId: "ace-step-1.5-xl-turbo",
    references: [],
    options: { durationSec: 30, bpm: 92, seed: 7 }
  }));
  assert.equal(music.ok, true);
  assert.deepEqual(music.request.options, { durationSec: 30, bpm: 92, seed: 7 });
});

test("fingerprint is stable and drifts with prompt, options and active version bytes", () => {
  const project = fixtureProject();
  const baseRequest = request({ references: [pin("character-adam", 1)] });
  const first = preflightGenerationRequest(project, baseRequest);
  const reorderedOptions = preflightGenerationRequest(project, request({
    references: [pin("character-adam", 1)],
    options: { height: 320, width: 768, fps: 24, durationSec: 5 }
  }));
  assert.equal(first.fingerprint, reorderedOptions.fingerprint);
  assert.notEqual(first.fingerprint, preflightGenerationRequest(project, { ...baseRequest, promptText: "Adam runs" }).fingerprint);
  assert.notEqual(first.fingerprint, preflightGenerationRequest(project, request({
    references: [pin("character-adam", 1)],
    options: { durationSec: 6, fps: 24, width: 768, height: 320 }
  })).fingerprint);

  const v2 = manifestAsset("character-adam", {
    activeVersion: 2,
    file: "character-adam.v2.png",
    sha256: "9".repeat(64)
  });
  const changedBytes = preflightGenerationRequest(fixtureProject([v2]), request({ references: [pin("character-adam", 1, "identity", 2)] }));
  assert.equal(changedBytes.ok, true);
  assert.notEqual(first.fingerprint, changedBytes.fingerprint);
});

test("synthetic image input validates and is accepted by the current reference-conditioned graph builder", () => {
  const project = fixtureProject();
  const preflight = preflightGenerationRequest(project, request({
    outputKind: "image",
    workflowId: STORYBOARD_KREA_GENERATION_WORKFLOW_ID,
    references: [pin("character-adam", 1)],
    options: { aspectRatio: "16:9", negativePrompt: "duplicate limbs", seed: 55 }
  }));
  assert.equal(preflight.ok, true);
  const synthetic = buildSyntheticImageStoryboardInput(project, preflight);
  assert.equal(validateStoryboard(synthetic.storyboard, project.slug), synthetic.storyboard);
  assert.equal(synthetic.materializationRequired, false);
  assert.equal(synthetic.project.settings.width, 1280);
  assert.equal(synthetic.project.settings.height, 720);
  const referenceId = synthetic.storyboard.frames[synthetic.frameId].references[0].id;
  const built = buildStoryboardFrameWorkflowGraph(
    synthetic.project,
    synthetic.storyboard,
    synthetic.frameId,
    { uploadedReferences: new Map([[referenceId, "Premiere316/composer_test/assets/character-adam.v1.png"]]) }
  );
  assert.equal(built.references.length, 1);
  assert.equal(built.resolution.ratio, "16:9");
  assert.match(built.prompt, /@Adam dancing/);
});

test("synthetic T2V input validates and carries a one-segment 8n+1 plan plus exact materialization manifest", () => {
  const project = fixtureProject();
  const preflight = preflightGenerationRequest(project, request({
    references: [
      pin("character-adam", 1, "identity"),
      pin("character-eve", 2, "identity"),
      pin("location-dungeon", 3, "location")
    ]
  }));
  assert.equal(preflight.ok, true);
  const synthetic = buildSyntheticVideoPlanInput(project, preflight);
  assert.equal(validateStoryboard(synthetic.storyboard, project.slug), synthetic.storyboard);
  assert.equal(synthetic.materializationRequired, true);
  assert.equal(synthetic.referencePackage.files.length, 3);
  assert.equal(synthetic.referencePackage.assetIndex.assets.length, 3);
  assert.ok(synthetic.referencePackage.files.every((file) => file.sourceProjectMediaPath.startsWith("media/assets/")));
  assert.ok(synthetic.referencePackage.files.every((file) => !/^[a-z]:[\\/]/i.test(file.sourceProjectMediaPath)));
  const plan = synthetic.storyboard.videoPlans[synthetic.videoPlanId];
  const clip = synthetic.storyboard.clips[synthetic.clipId];
  const segment = synthetic.storyboard.segments[synthetic.segmentId];
  assert.equal(plan.segmentIds.length, 1);
  assert.equal(segment.type, "text");
  assert.equal(segment.startFrame, 0);
  assert.equal(segment.lengthFrames, 120);
  assert.equal(plan.requestedFrames, 120);
  assert.equal(plan.generationFrames, 121);
  assert.equal(clip.trimDecodedFrames, 1);
  assert.deepEqual(plan.referenceFiles, Object.values(synthetic.storyboard.referenceBindings).map((binding) => binding.canonicalFile));
});

test("prepare create is pure, deterministic by default id and exposes no generation side effects", () => {
  const project = fixtureProject();
  const prepared = prepareGenerationCreate(project, request(), { now: "2026-08-20T12:00:00.000Z" });
  assert.equal(prepared.preflight.ok, true);
  assert.equal(prepared.generation.status, "validated");
  assert.equal(prepared.generation.createdAt, "2026-08-20T12:00:00.000Z");
  assert.equal(prepared.generation.id, `generation-${prepared.preflight.fingerprint.slice(0, 20)}`);
  assert.equal(Object.hasOwn(prepared.generation, "promptId"), false);
  assert.equal(Object.isFrozen(prepared.generation), true);
});
