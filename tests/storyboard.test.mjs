import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  replaceStoryboardTargetReferences,
  storyboardSummary,
  validateStoryboard
} from "../server/storyboard.js";
import {
  assertLtxVideoPlanIsNotStillsGenerator,
  assertStillsApiPromptRejectsMinimax,
  assertStillsJobCompiledPrompt,
  buildStoryboardFrameWorkflowGraph,
  buildStoryboardVideoPlanWorkflowGraph,
  compileStoryboardVideoPlanPrompt,
  isForbiddenMinimaxStillsClass,
  KLEIN2_STILLS_WORKFLOW_ID,
  KREA2_CINEMATIC_STILL_WORKFLOW_ID,
  storyboardFrameGenerationFingerprint,
  STORYBOARD_KREA_WORKFLOW_ID,
  STORYBOARD_T2V_WORKFLOW_ID
} from "../server/storyboard-generation.js";
import {
  assertPromptStillsWorkflowId,
  GUIDE_FRAME_STILLS_WORKFLOW_ID,
  PROMPT_GENERATION_STILLS_WORKFLOW_IDS
} from "../server/prompt-generation.js";
import { graphToApi } from "../server/comfy.js";

const project = JSON.parse(fs.readFileSync(new URL("../projects/harrowing_of_hell/project.json", import.meta.url), "utf8"));
const storyboard = JSON.parse(fs.readFileSync(new URL("../projects/harrowing_of_hell/production/storyboard.json", import.meta.url), "utf8"));
const hasH06H09Import = Boolean(storyboard.imports?.h06_h09_ltx25_i2v_complete_v1);
const hasH10Import = Boolean(storyboard.imports?.h10_ltx25_i2v_complete_v1);
const expectedProductionCounts = hasH10Import
  ? { frames: 372, referenceBindings: 2828, effectiveReferences: 2898, videoPlanBindings: 678, frameBindings: 2150 }
  : hasH06H09Import
    ? { frames: 325, referenceBindings: 2639, effectiveReferences: 2639, videoPlanBindings: 678, frameBindings: 1961 }
    : { frames: 190, referenceBindings: 1871, effectiveReferences: 1871, videoPlanBindings: 678, frameBindings: 1193 };
const attachedKreaWorkflow = fileURLToPath(new URL("../workflows/storyboard-krea2-reference-subgraphs.ui.json", import.meta.url));
const attachedT2vWorkflow = fileURLToPath(new URL("../workflows/storyboard-ltx25-t2v-semantic-reference.ui.json", import.meta.url));

function workflowNodes(graph) {
  return [graph, ...(graph.definitions?.subgraphs || [])].flatMap((container) => container.nodes || []);
}

function stillsFrameFixture(id, purpose) {
  return {
    id,
    purpose,
    ownerKind: "clip",
    ownerId: "H01-S01-C01",
    prompt: "Begin exactly from the supplied frame. Jesus stands on the descent causeway.",
    negativePrompt: "text, captions, MiniMax H3 stills",
    seed: 7,
    references: [{
      id: `ref-${id}`,
      assetId: "character-jesus",
      assetVersion: 4,
      assetVersionId: "character-jesus:v4",
      sourceAssetFile: "char-jesus-main.v4.png",
      role: "identity",
      required: true,
      useMode: "direct_conditioning",
      order: 1
    }]
  };
}

// H10 is now production I2V. Keep the T2V compiler tests honest by adapting a
// clone into an explicit text-only semantic fixture instead of pretending the
// live H10 plan is still T2V or weakening the production mode guard.
function semanticT2vFixture(videoPlanId) {
  const fixture = structuredClone(storyboard);
  const plan = fixture.videoPlans[videoPlanId];
  const clip = fixture.clips[plan?.clipId];
  assert.ok(plan && clip, `Missing semantic T2V fixture plan ${videoPlanId}`);
  clip.generationMode = "t2v_with_semantic_references";
  delete clip.firstFrameId;
  delete clip.referenceMode;
  plan.generationMode = "t2v_with_semantic_references";
  plan.referenceMode = "semantic_reference_resolver";
  plan.workflowProfileId = "ltx-2.5-t2v-semantic-reference-resolver";
  plan.status = "ready";
  delete plan.firstFrameId;
  delete plan.firstFramePackage;
  delete plan.guideStrength;
  plan.globalPrompt = [
    `PREMIERE316 LTX-2.5 TEXT-TO-VIDEO WITH SEMANTIC REFERENCES — ${clip.id}`,
    "GENERATION MODE",
    "Generate directly from text. Declared assets are semantic identity and design references only; do not use any temporal first frame, last frame, prior shot, or timed storyboard image.",
    "TEMPORAL PROMPT RELAY\nApply each local prompt only during its authored contiguous frame interval.",
    `STORY BEAT: ${clip.beat}`,
    `CAMERA: ${clip.shotSizeLens}; ${clip.cameraMovement}`,
    `TRANSITION: ${clip.transition}`
  ].join("\n\n");
  plan.timelineData.global_prompt = plan.globalPrompt;

  const temporalKeys = [
    "frameId", "firstFrameId", "lastFrameId", "firstFrame", "lastFrame",
    "image", "imagePath", "inputImage", "endImage", "timedImage", "timedImages",
    "storyboardFrameId", "fileName", "imageFile", "projectMediaPath",
    "projectMediaSha256", "missingGuide", "frameStatus"
  ];
  for (const segmentId of plan.segmentIds) {
    const segment = fixture.segments[segmentId];
    segment.type = "text";
    for (const key of temporalKeys) delete segment[key];
    const timeline = plan.timelineData.segments.find((entry) => entry.id === segmentId);
    assert.ok(timeline, `Missing semantic T2V fixture timeline segment ${segmentId}`);
    timeline.type = "text";
    timeline.prompt = segment.prompt;
    for (const key of temporalKeys) delete timeline[key];
  }
  plan.localPrompts = plan.segmentIds.map((segmentId) => fixture.segments[segmentId].prompt).join(" | ");
  return fixture;
}

test("production storyboard package has the verified structure", () => {
  validateStoryboard(storyboard, project.slug);
  const summary = storyboardSummary(storyboard);
  assert.deepEqual({
    chapters: summary.chapters,
    scenes: summary.scenes,
    clips: summary.clips,
    frames: summary.frames,
    segments: summary.segments,
    referenceBindings: summary.referenceBindings,
    effectiveReferences: summary.effectiveReferences,
    runtimeFrames: summary.runtimeFrames
  }, {
    chapters: 11,
    scenes: 38,
    clips: 153,
    frames: expectedProductionCounts.frames,
    segments: 406,
    referenceBindings: expectedProductionCounts.referenceBindings,
    effectiveReferences: expectedProductionCounts.effectiveReferences,
    runtimeFrames: 57888
  });
});

test("H01 has exact segmented-I2V coverage and the 2m24s I2V master on C01", () => {
  const h01ClipIds = ["H01-S01-C01", "H01-S01-C02", "H01-S02-C01", "H01-S02-C02"];
  const h01Plans = h01ClipIds.map((clipId) => storyboard.videoPlans[storyboard.clips[clipId].videoPlanId]);
  assert.deepEqual(h01Plans.map((plan) => plan.segmentIds.length), [18, 3, 3, 3]);
  assert.ok(h01ClipIds.every((clipId) => storyboard.clips[clipId].generationMode === "i2v_segmented_first_frames"));
  assert.ok(h01Plans.every((plan) => plan.generationMode === "i2v_segmented_first_frames"));
  assert.ok(h01Plans.every((plan) => plan.referenceMode === "segment_first_frames"));
  assert.ok(h01Plans.flatMap((plan) => plan.segmentIds).every((segmentId) => storyboard.segments[segmentId].type === "image"));

  const c01Plan = storyboard.videoPlans["video-h01-s01-c01"];
  assert.deepEqual(c01Plan.segmentIds.map((segmentId) => storyboard.segments[segmentId].lengthFrames), Array.from({ length: 18 }, () => 192));
  assert.equal(storyboard.clips["H01-S01-C01"].durationFrames, 3456);
  assert.equal(c01Plan.firstFramePackage?.packageId, "h01_s01_c01_2m24s_ltx25_i2v_master");
  assert.match(c01Plan.globalPrompt, /144 seconds \(2:24\) across 18 authored segments/);
  assert.match(c01Plan.globalPrompt, /Empty hands throughout/);
  assert.match(c01Plan.globalPrompt, /No crown of thorns, halo disc, levitation, angels, sword, weapon, or duplicate Jesus/);
  assert.match(c01Plan.negativePrompt, /sword, weapon, scabbard, luminous blade, duplicate Jesus/);

  const c01FrameIds = c01Plan.segmentIds.map((segmentId) => storyboard.segments[segmentId].frameId);
  assert.deepEqual(c01FrameIds, [
    "frame-h01-s01-c01-first",
    "frame-segment-h01-s01-c01-02",
    "frame-segment-h01-s01-c01-03",
    "frame-segment-h01-s01-c01-04",
    "frame-segment-h01-s01-c01-05",
    "frame-segment-h01-s01-c01-06",
    "frame-segment-h01-s01-c01-07",
    "frame-segment-h01-s01-c01-08",
    "frame-segment-h01-s01-c01-09",
    "frame-segment-h01-s01-c01-10",
    "frame-segment-h01-s01-c01-11",
    "frame-segment-h01-s01-c01-12",
    "frame-segment-h01-s01-c01-13",
    "frame-segment-h01-s01-c01-14",
    "frame-segment-h01-s01-c01-15",
    "frame-segment-h01-s01-c01-16",
    "frame-segment-h01-s01-c01-17",
    "frame-segment-h01-s01-c01-18"
  ]);
  assert.deepEqual(c01FrameIds.map((frameId) => storyboard.frames[frameId].generatedFile), [
    "H01-S01-C01_first.v4.2m24s-i2v-master.png",
    "H01-S01-C01_seg02.v5.2m24s-i2v-master.png",
    "H01-S01-C01_seg03.v3.2m24s-i2v-master.png",
    "H01-S01-C01_seg04.v3.2m24s-i2v-master.png",
    "H01-S01-C01_seg05.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg06.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg07.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg08.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg09.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg10.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg11.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg12.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg13.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg14.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg15.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg16.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg17.v1.2m24s-i2v-master.png",
    "H01-S01-C01_seg18.v1.2m24s-i2v-master.png"
  ]);
  assert.deepEqual(c01FrameIds.map((frameId) => storyboard.frames[frameId].activeGeneratedVersion), [4, 5, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);

  const expectedReferenceFiles = [
    "char-jesus-main.v4.png",
    "loc-descent.v1.png",
    "atmo-smoke.v1.png",
    "atmo-frags.v1.png",
    "art-chains.v1.png"
  ];
  for (const [index, frameId] of c01FrameIds.entries()) {
    const frame = storyboard.frames[frameId];
    const segment = storyboard.segments[c01Plan.segmentIds[index]];
    const activeVersion = frame.generatedVersions.find((version) => version.v === frame.activeGeneratedVersion);
    assert.equal(frame.status, "generated");
    assert.equal(frame.prompt, segment.prompt);
    assert.match(frame.prompt, /Begin exactly from the supplied frame/i);
    assert.doesNotMatch(frame.prompt, /luminous golden sword|single right-hand sword|warm-gold point/i);
    assert.match(frame.negativePrompt, /sword/);
    assert.deepEqual(frame.references.map((reference) => reference.sourceAssetFile), expectedReferenceFiles);
    assert.ok(frame.references.every((reference) => !reference.assetId.includes("sword")));
    assert.equal(activeVersion.file, frame.generatedFile);
    assert.equal(activeVersion.prompt, frame.prompt);
    assert.ok((activeVersion.sourceReferenceAssets || []).every((reference) => !reference.assetId.includes("sword")));
    assert.ok(fs.existsSync(new URL(`../projects/harrowing_of_hell/${frame.generatedInputPath}`, import.meta.url)));
  }
});

test("every effective T2V reference resolves to an exact canonical package file", () => {
  const root = new URL("../projects/harrowing_of_hell/reference_assets/", import.meta.url);
  const index = JSON.parse(fs.readFileSync(new URL("asset_index.json", root), "utf8"));
  const canonical = new Set(index.assets.map((asset) => asset.canonical));
  let checked = 0;
  for (const plan of Object.values(storyboard.videoPlans)) {
    const bindings = Object.values(storyboard.referenceBindings)
      .filter((binding) => binding.targetKind === "video_plan" && binding.targetId === plan.id)
      .sort((left, right) => left.order - right.order);
    assert.deepEqual(new Set(bindings.map((binding) => binding.canonicalFile)), new Set(plan.referenceFiles), `${plan.id} bindings must match referenceFiles`);
    for (const reference of bindings) {
      assert.equal(reference.useMode, "semantic_reference");
      assert.ok(canonical.has(reference.canonicalFile), `${reference.id} canonical file must be indexed exactly`);
      assert.ok(fs.existsSync(new URL(reference.canonicalFile, root)), `${reference.id} canonical file must exist`);
      checked += 1;
    }
  }
  assert.equal(checked, 678);
});

test("every authored reference binding targets its real video plan or first frame", () => {
  const counts = { video_plan: 0, frame: 0 };
  for (const binding of Object.values(storyboard.referenceBindings)) {
    assert.ok(Object.hasOwn(counts, binding.targetKind), `${binding.id} target kind must be supported`);
    if (binding.targetKind === "video_plan") {
      assert.ok(Object.hasOwn(storyboard.videoPlans, binding.targetId), `${binding.id} video plan target must exist`);
    } else {
      assert.ok(Object.hasOwn(storyboard.frames, binding.targetId), `${binding.id} frame target must exist`);
    }
    counts[binding.targetKind] += 1;
  }
  assert.deepEqual(counts, {
    video_plan: expectedProductionCounts.videoPlanBindings,
    frame: expectedProductionCounts.frameBindings
  });
});

test("storyboard validation rejects a missing video-plan binding target", () => {
  const invalid = structuredClone(storyboard);
  const binding = Object.values(invalid.referenceBindings).find((reference) => reference.targetKind === "video_plan");
  binding.targetId = "video-missing-target";
  assert.throws(() => validateStoryboard(invalid, project.slug), /reference binding target not found/);
});

test("video-plan reference replacement is target-scoped, exact-version pinned, and de-duplicated", () => {
  const targetId = "video-h10-s32-c01";
  const authored = Object.values(storyboard.referenceBindings).find((reference) => reference.targetKind === "video_plan" && reference.targetId === targetId);
  assert.ok(authored, "fixture must contain an authored video-plan reference");
  const targetReferencesBefore = structuredClone(storyboard.videoPlans[targetId].referenceFiles);
  const otherTargetId = "video-h10-s32-c02";
  const otherTargetBefore = structuredClone(storyboard.videoPlans[otherTargetId].referenceFiles);
  const result = replaceStoryboardTargetReferences(storyboard, project, {
    targetKind: "video_plan",
    targetId,
    references: [
      {
        id: authored.id,
        assetId: authored.assetId,
        assetVersion: 3,
        canonicalFile: authored.canonicalFile,
        role: authored.role,
        cropRegion: authored.cropRegion,
        notes: authored.notes,
        useMode: "semantic_reference"
      },
      {
        assetId: authored.assetId,
        assetVersion: 3,
        canonicalFile: authored.canonicalFile,
        role: authored.role
      }
    ]
  });
  assert.deepEqual(storyboard.videoPlans[targetId].referenceFiles, targetReferencesBefore, "input storyboard must not be mutated");
  assert.equal(result.references.length, 1, "duplicate asset IDs are collapsed deterministically");
  assert.equal(result.references[0].sourceAssetFile, "char-jesus-main.v3.png");
  assert.equal(result.references[0].assetVersionId, `${authored.assetId}:v3`);
  assert.equal(result.references[0].id, authored.id, "unchanged authored binding ID must survive Apply");
  assert.equal(result.references[0].cropRegion, authored.cropRegion);
  assert.equal(result.references[0].notes, authored.notes);
  assert.equal(result.storyboard.referenceBindings[authored.id].order, storyboard.referenceBindings[authored.id].order, "authored binding order must survive Apply");
  assert.deepEqual(result.storyboard.videoPlans[targetId].referenceFiles, [authored.canonicalFile]);
  assert.deepEqual(result.storyboard.clips["H10-S32-C01"].referenceFiles, [authored.canonicalFile]);
  assert.deepEqual(result.storyboard.videoPlans[otherTargetId].referenceFiles, otherTargetBefore, "unrelated video-plan references must be preserved");
});

test("reference replacement rejects unknown storyboard targets", () => {
  assert.throws(() => replaceStoryboardTargetReferences(storyboard, project, {
    targetKind: "video_plan",
    targetId: "missing-video-plan",
    references: []
  }), /target not found/);
});

test("reference replacement rejects prototype-chain target IDs", () => {
  assert.throws(() => replaceStoryboardTargetReferences(storyboard, project, {
    targetKind: "video_plan",
    targetId: "__proto__",
    references: []
  }), /target not found/);
});

test("graph conversion preserves linked dynamic reference sockets beyond object_info", () => {
  const nodes = [1, 2, 3].map((id) => ({
    id,
    type: "LoadImage",
    mode: 0,
    inputs: [],
    outputs: [{ name: "IMAGE", type: "IMAGE", links: [100 + id] }],
    widgets_values: [`reference-${id}.png`]
  }));
  nodes.push({
    id: 4,
    type: "ImageConcatMulti",
    mode: 0,
    inputs: [1, 2, 3].map((id) => ({ name: `image_${id}`, type: "IMAGE,MASK", link: 100 + id })),
    outputs: [{ name: "output", type: "IMAGE", links: null }],
    widgets_values: [20, "right", true]
  });
  const links = [1, 2, 3].map((id) => [100 + id, id, 0, 4, id - 1, "IMAGE"]);
  const objectInfo = {
    LoadImage: { input: { required: { image: [["reference-1.png", "reference-2.png", "reference-3.png"], {}] } } },
    ImageConcatMulti: {
      input: {
        required: {
          inputcount: ["INT", {}],
          image_1: ["IMAGE", { forceInput: true }],
          direction: [["right", "down"], {}],
          match_image_size: ["BOOLEAN", {}]
        },
        optional: { image_2: ["IMAGE", { forceInput: true }] }
      }
    }
  };
  const converted = graphToApi({ nodes, links }, objectInfo);
  assert.deepEqual(converted.prompt["4"].inputs.image_3, ["3", 0]);
});

test("tracked T2V workflow builder resolves exact semantic references for LTX-2.5 Ingredients conditioning", {
  skip: !fs.existsSync(attachedT2vWorkflow) && "Tracked LTX-2.5 T2V workflow is missing"
}, () => {
  const videoPlanId = "video-h10-s33-c01";
  const semanticStoryboard = semanticT2vFixture(videoPlanId);
  const built = buildStoryboardVideoPlanWorkflowGraph(project, semanticStoryboard, videoPlanId, { requireRunnableAudio: true });
  const rebuilt = buildStoryboardVideoPlanWorkflowGraph(project, semanticStoryboard, videoPlanId, { requireRunnableAudio: true });
  assert.equal(built.workflowHash, rebuilt.workflowHash, "T2V workflow build must be deterministic");
  assert.equal(built.graph.extra.premiere316.workflowId, STORYBOARD_T2V_WORKFLOW_ID);
  assert.equal(built.graph.extra.premiere316.type, "storyboard-t2v-video-plan");
  assert.deepEqual(built.graph.extra.premiere316.temporalGuides, {
    firstFrame: false,
    lastFrame: false,
    timedImages: false
  });
  assert.equal(built.graph.extra.premiere316.semanticReferenceConditioning, "ltx-2.5-ingredients-iclora");
  assert.equal(
    built.graph.extra.premiere316.visualReferenceAdapter,
    "LTX\\2.5\\ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors"
  );
  assert.equal(built.graph.extra.premiere316.visualReferenceRuntimePatch, "compiled-api-v1");
  assert.equal(built.sourceWorkflowHash, "971d3e6fd2150853cc1de666c73042efb9c5e3bda07192e39f9354d62a735de3");
  assert.deepEqual(built.settings, {
    fps: 24,
    width: 768,
    height: 320,
    authoredFrames: 432,
    generationFrames: 433,
    decodedTrim: 1,
    durationSeconds: 18,
    seed: built.settings.seed,
    latentX2: true
  });

  const master = built.graph.nodes.find((node) => node.id === 5900);
  assert.deepEqual(master.widgets_values.slice(0, 6), [
    "LTX-2.5 Native T2V",
    18,
    24,
    "Custom (multiples of 32)",
    768,
    320
  ]);
  assert.equal(master.widgets_values[7], true);
  const promptNode = built.graph.nodes.find((node) => node.id === 5901);
  assert.equal(promptNode.widgets_values[0], semanticStoryboard.videoPlans[videoPlanId].globalPrompt);
  assert.equal(built.promptRelay.segmentCount, 3);
  assert.equal(built.promptRelay.segmentLengths, "144,144,144");
  assert.deepEqual(
    built.promptRelay.segments.map(({ id, start, length }) => ({ id, start, length })),
    [
      { id: "segment-h10-s33-c01-01", start: 0, length: 144 },
      { id: "segment-h10-s33-c01-02", start: 144, length: 144 },
      { id: "segment-h10-s33-c01-03", start: 288, length: 144 }
    ]
  );
  assert.doesNotMatch(built.promptRelay.globalPrompt, /ACTION TIMELINE/);
  assert.match(built.promptRelay.globalPrompt, /TEMPORAL PROMPT RELAY/);
  for (const segment of built.promptRelay.segments) {
    assert.equal(built.promptRelay.localPrompts.split(segment.prompt).length - 1, 1);
    assert.equal(built.promptRelay.globalPrompt.includes(segment.prompt), false);
  }
  const director = built.graph.nodes.find((node) => node.id === 5960);
  assert.equal(director.widgets_values[7], built.promptRelay.localPrompts);
  assert.equal(director.widgets_values[8], "144,144,144");
  assert.deepEqual(
    JSON.parse(director.widgets_values[6]).segments.map(({ id, start, length }) => ({ id, start, length })),
    built.promptRelay.segments.map(({ id, start, length }) => ({ id, start, length }))
  );
  const resolver = built.graph.nodes.find((node) => node.id === 5902);
  assert.equal(resolver.widgets_values[2], 9);
  assert.equal(resolver.widgets_values[3], true);
  assert.equal(resolver.widgets_values[5], "asset_index.json");
  assert.equal(resolver.widgets_values[6], semanticStoryboard.videoPlans[videoPlanId].referenceFiles.join("\n"));
  assert.deepEqual(built.references.map((reference) => reference.canonical), semanticStoryboard.videoPlans[videoPlanId].referenceFiles);
  const audioModeControl = built.graph.nodes.find((node) => node.id === 5904);
  assert.equal(audioModeControl.widgets_values[0], "Generated Audio");
  assert.equal(audioModeControl.title, "AUDIO MODE — Generated Audio");
  for (const nodeId of [5905, 5955, 5956]) {
    assert.equal(built.graph.nodes.find((node) => node.id === nodeId).widgets_values[0], false);
  }
  const customAudioLoader = built.graph.nodes.find((node) => node.id === 5923);
  const customAudioGate = built.graph.nodes.find((node) => node.id === 5964);
  const mixerCustomInput = built.graph.nodes
    .find((node) => node.id === 5924)
    .inputs.find((input) => input.name === "master_custom_track");
  assert.equal(customAudioLoader.mode, 0, "custom audio must remain structurally available behind the lazy gate");
  assert.equal(customAudioGate.type, "LazySwitchKJ");
  assert.equal(customAudioGate.mode, 0);
  assert.notEqual(mixerCustomInput.link, null);
  assert.deepEqual(
    built.graph.links.find((link) => link[0] === mixerCustomInput.link)?.slice(1, 4),
    [5964, 0, 5924],
    "mixer custom input must be fed by the lazy gate"
  );
  for (const [inputName, expectedOrigin] of [
    ["on_false", [5922, 0]],
    ["on_true", [5923, 0]],
    ["switch", [5904, 2]]
  ]) {
    const input = customAudioGate.inputs.find((candidate) => candidate.name === inputName);
    assert.ok(input?.link != null, `lazy custom-audio gate input ${inputName} must be linked`);
    assert.deepEqual(
      built.graph.links.find((link) => link[0] === input.link)?.slice(1, 3),
      expectedOrigin,
      `lazy custom-audio gate input ${inputName} must use the intended source`
    );
  }
  const finalVideo = built.graph.nodes.find((node) => node.id === 5928);
  assert.equal(finalVideo.widgets_values.frame_rate, 24);
  assert.equal(finalVideo.widgets_values.filename_prefix, "Premiere316/harrowing_of_hell/storyboard/H10-S33-C01");
  assert.equal(finalVideo.widgets_values.save_output, true);
  const resolverPreviewLinks = (resolver.outputs.find((output) => output.name === "selected_previews")?.links || []);
  const sequencerIds = new Set(built.graph.nodes.filter((node) => node.type === "DenoLTXSequencer").map((node) => node.id));
  assert.equal(
    built.graph.links.some((link) => resolverPreviewLinks.includes(link[0]) && sequencerIds.has(link[3])),
    false,
    "semantic reference previews must never become timed keyframes"
  );
  const instantiatedDefinitions = new Set(built.graph.nodes.map((node) => node.type));
  const unusedDefinitionNodeIds = new Set(
    (built.graph.definitions?.subgraphs || [])
      .filter((definition) => !instantiatedDefinitions.has(definition.id))
      .flatMap((definition) => definition.nodes || [])
      .map((node) => String(node.id))
  );
  assert.equal(
    built.executionGraph.nodes.some((node) => unusedDefinitionNodeIds.has(String(node.id))),
    false,
    "API execution graph must exclude nodes from uninstantiated legacy subgraphs"
  );
});

test("zero-reference pure T2V preserves explicit portrait dimensions and disables semantic conditioning", () => {
  const built = buildStoryboardVideoPlanWorkflowGraph(project, storyboard, "video-mv01-s01-c01");
  assert.equal(built.settings.width, 576);
  assert.equal(built.settings.height, 1024);
  assert.equal(built.settings.authoredFrames, 160);
  assert.equal(built.settings.generationFrames, 161);
  assert.equal(built.settings.latentX2, true);
  assert.deepEqual(built.references, []);
  const resolver = built.graph.nodes.find((node) => node.id === 5902);
  assert.equal(resolver.widgets_values[2], 0, "pure T2V must not infer references from prompt text");
  assert.equal(resolver.widgets_values[3], false, "zero-reference resolution does not need strict mention matching");
  assert.equal(resolver.widgets_values[6], "");
  assert.match(resolver.title, /PURE NATIVE T2V/);
  assert.equal(built.graph.extra.premiere316.semanticReferenceConditioning, "none");
  assert.equal(built.graph.extra.premiere316.visualReferenceAdapter, null);
  assert.equal(built.graph.extra.premiere316.visualReferenceRuntimePatch, null);
});

test("pure T2V does not excuse a declared required reference that cannot resolve", () => {
  const invalid = structuredClone(storyboard);
  const videoPlanId = "video-mv01-s01-c01";
  const missingReference = "characters/required-but-missing.png";
  invalid.videoPlans[videoPlanId].referenceFiles = [missingReference];
  invalid.videoPlans[videoPlanId].referenceCount = 1;
  invalid.clips["MV01-S01-C01"].referenceFiles = [missingReference];
  invalid.referenceBindings["ref-required-but-missing"] = {
    id: "ref-required-but-missing",
    targetKind: "video_plan",
    targetId: videoPlanId,
    canonicalFile: missingReference,
    sourceAssetFile: missingReference,
    role: "identity",
    required: true,
    order: 1,
    useMode: "semantic_reference"
  };
  assert.throws(
    () => buildStoryboardVideoPlanWorkflowGraph(project, invalid, videoPlanId),
    /requests unindexed canonical reference: characters\/required-but-missing\.png/
  );
});

test("compiled T2V prompt injects every canonical reference into the LTX-2.5 IC-LoRA sheet", async (t) => {
  let compiled;
  try {
    compiled = await compileStoryboardVideoPlanPrompt(project, semanticT2vFixture("video-h10-s33-c01"), "video-h10-s33-c01");
  } catch (error) {
    if (/fetch failed|ECONNREFUSED|active ComfyUI runtime/i.test(String(error?.message || error))) {
      t.skip("Live 8188 object_info is unavailable");
      return;
    }
    throw error;
  }
  assert.deepEqual(compiled.referenceConditioning, {
    expected: 6,
    resolved: 6,
    injected: 6,
    adapter: "LTX\\2.5\\ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors",
    model: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
    clip: "gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",
    videoVae: "LTX\\2.5\\ltx-2.5-video-vae-bf16.safetensors",
    audioVae: "LTX\\2.5\\ltx-2.5-audio-vae-bf16.safetensors",
    resolverNodeId: "5902",
    sheetNodeId: "5915",
    guideNodeId: "5919",
    promptRelayNodeId: "5960",
    segmentCount: 3,
    segmentLengths: "144,144,144"
  });
  assert.equal(compiled.apiPrompt["5914"].inputs.model[0], "5801");
  assert.equal(compiled.apiPrompt["5915"].inputs.reference_set[0], "5902");
  assert.equal(compiled.apiPrompt["5915"].inputs.frame_count, 433);
  assert.equal(compiled.apiPrompt["5919"].inputs.image[0], "5915");
  assert.equal(compiled.apiPrompt["5919"].inputs.vae[0], "5800");
  assert.deepEqual(compiled.apiPrompt["5960"].inputs.model, ["5914", 0]);
  assert.deepEqual(compiled.apiPrompt["5960"].inputs.optional_latent, ["5917", 0]);
  assert.equal(compiled.apiPrompt["5960"].inputs.local_prompts, compiled.promptRelay.localPrompts);
  assert.equal(compiled.apiPrompt["5960"].inputs.segment_lengths, "144,144,144");
  assert.equal(JSON.parse(compiled.apiPrompt["5960"].inputs.timeline_data).segments.length, 3);
  assert.deepEqual(compiled.apiPrompt["5919"].inputs.positive, ["5961", 0]);
  assert.deepEqual(compiled.apiPrompt["5919"].inputs.latent, ["5960", 2]);
  assert.deepEqual(compiled.apiPrompt["5941"].inputs.model, ["5960", 0]);
  assert.equal(compiled.apiPrompt["5921"].inputs.switch, true);
  assert.equal(compiled.apiPrompt["5928"].inputs.frame_rate, 24);
});

test("T2V Prompt Relay preflight rejects a gap, duration drift, and the reserved delimiter", () => {
  const gap = semanticT2vFixture("video-h10-s33-c01");
  gap.segments["segment-h10-s33-c01-02"].startFrame = 145;
  assert.throws(
    () => buildStoryboardVideoPlanWorkflowGraph(project, gap, "video-h10-s33-c01"),
    /not contiguous: expected frame 144, received 145/
  );

  const durationDrift = semanticT2vFixture("video-h10-s33-c01");
  durationDrift.segments["segment-h10-s33-c01-03"].lengthFrames = 143;
  assert.throws(
    () => buildStoryboardVideoPlanWorkflowGraph(project, durationDrift, "video-h10-s33-c01"),
    /cover 431 frames; expected 432/
  );

  const delimiter = semanticT2vFixture("video-h10-s33-c01");
  delimiter.segments["segment-h10-s33-c01-02"].prompt += " | forbidden split";
  assert.throws(
    () => buildStoryboardVideoPlanWorkflowGraph(project, delimiter, "video-h10-s33-c01"),
    /reserved \| delimiter/
  );
});

test("generation preflight refuses to invent required dialogue or replace an authoritative post-mix track", () => {
  const dialogueFixture = semanticT2vFixture("video-h10-s31-c01");
  assert.throws(
    () => buildStoryboardVideoPlanWorkflowGraph(project, dialogueFixture, "video-h10-s31-c01", { requireRunnableAudio: true }),
    /requires an exact clip-length dialogue track/
  );
  assert.throws(
    () => buildStoryboardVideoPlanWorkflowGraph(project, storyboard, "video-mv01-s01-c01", { requireRunnableAudio: true }),
    /requires authoritative external audio post-mix support/
  );
  const pendingDialogue = buildStoryboardVideoPlanWorkflowGraph(project, dialogueFixture, "video-h10-s31-c01");
  assert.equal(pendingDialogue.graph.nodes.find((node) => node.id === 5904).widgets_values[0], "Custom Replace");
  assert.equal(pendingDialogue.graph.extra.premiere316.audioRunnable, false);
  assert.match(pendingDialogue.graph.nodes.find((node) => node.id === 5904).title, /AUDIO BLOCKED/);
});

test("server exposes T2V download, push, generate, and queue contracts", () => {
  const indexSource = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  const queueSource = fs.readFileSync(new URL("../server/queue.js", import.meta.url), "utf8");
  assert.match(indexSource, /app\.get\("\/api\/projects\/:slug\/storyboard\/video-plans\/:videoPlanId\/workflow"/);
  assert.match(indexSource, /app\.post\("\/api\/projects\/:slug\/storyboard\/video-plans\/:videoPlanId\/workflow"/);
  assert.match(indexSource, /app\.post\("\/api\/projects\/:slug\/storyboard\/video-plans\/:videoPlanId\/generate"/);
  assert.match(queueSource, /generate_storyboard_video_plan/);
  assert.match(queueSource, /restoreStoryboardVideoPlanAfterCancellation/);
  assert.match(queueSource, /markStoryboardVideoPlanGenerationFailed/);
});

test("active storyboard image guide compiler patches the attached Krea workflow deterministically", {
  skip: Object.keys(storyboard.frames).length === 0
    ? "True T2V storyboard intentionally contains no image-guide frames"
    : (!fs.existsSync(attachedKreaWorkflow) && "Attached Krea workflow is not installed in the local BlokeyUI profile")
}, () => {
  const frameId = "frame-h01-s01-c01-first";
  const built = buildStoryboardFrameWorkflowGraph(project, storyboard, frameId);
  const rebuilt = buildStoryboardFrameWorkflowGraph(project, storyboard, frameId);
  assert.equal(built.graph.extra.premiere316.workflowId, STORYBOARD_KREA_WORKFLOW_ID);
  assert.equal(built.workflowHash, rebuilt.workflowHash, "workflow hash must not contain timestamps or other volatile data");
  assert.equal(built.filenamePrefix, "Premiere316/harrowing_of_hell/storyboard/H01-S01-C01_first");
  assert.deepEqual(built.resolution, { width: 1280, height: 720, ratio: "16:9" });
  const allNodes = workflowNodes(built.graph);
  const promptInput = allNodes.find((node) => node.id === 10042)?.widgets_values?.[1] || "";
  assert.match(promptInput, /PREMIERE316 STORYBOARD IMAGE GUIDE/);
  assert.match(promptInput, /Begin exactly from the supplied frame/);
  assert.match(promptInput, /heavy barbed iron chain/);
  assert.doesNotMatch(promptInput, /luminous golden sword|single right-hand sword|warm-gold point/i);
  assert.match(promptInput, /Avoid\/negative constraints/);
  const latent = allNodes.find((node) => node.id === 10053);
  assert.deepEqual(latent.widgets_values.slice(0, 3), [1280, 720, 1]);
  const sampler = allNodes.find((node) => node.id === 10056);
  assert.equal(sampler.widgets_values[0], built.seed);
  assert.equal(sampler.widgets_values[1], "fixed");
  const pixaromaStateNodes = built.executionGraph.nodes.filter((node) => ["PixaromaResolution", "PixaromaSeed"].includes(node.type));
  const convertedPixaromaState = graphToApi({ nodes: pixaromaStateNodes, links: [] }, {
    PixaromaResolution: { input: { required: {}, hidden: { ResolutionState: ["STRING", { default: "{}" }] } } },
    PixaromaSeed: { input: { required: {}, hidden: { SeedState: ["STRING", { default: "{}" }] } } }
  });
  assert.deepEqual(convertedPixaromaState.warnings, []);
  assert.deepEqual(JSON.parse(convertedPixaromaState.prompt["200"].inputs.ResolutionState), {
    mode: "custom",
    ratio: "16:9",
    w: 1280,
    h: 720,
    custom_w: 1280,
    custom_h: 720,
    custom_ratio_w: 1280,
    custom_ratio_h: 720,
    snap: 32
  });
  assert.equal(JSON.parse(convertedPixaromaState.prompt["204"].inputs.SeedState).runSeed, built.seed);
  const save = built.graph.nodes.find((node) => node.id === 199);
  assert.deepEqual(save.widgets_values, ["Premiere316/harrowing_of_hell/storyboard/H01-S01-C01_first", "save"]);
  const referenceNodes = allNodes.filter((node) => node.type === "LoadImage" && node.properties?.["premiere316.referenceId"]);
  const compositeNodes = allNodes.filter((node) => node.type === "ImageConcatMulti" && node.properties?.["premiere316.referenceComposite"]);
  assert.equal(referenceNodes.length, built.frame.references.length, "every exact storyboard reference must be present in the ComfyUI workflow");
  assert.equal(compositeNodes.length, 1, "the supplied 20-slot reference concatenation workflow must be retained");
  assert.equal(compositeNodes[0].inputs.filter((input) => input.link != null).length, built.frame.references.length);
  assert.deepEqual(referenceNodes.map((node) => node.widgets_values[0]), built.frame.references.map((reference) => `premiere316_storyboard_refs/harrowing_of_hell/assets/${reference.sourceAssetFile}`));
  const textGenerate = built.executionGraph.nodes.find((node) => node.id === 10040);
  const imageLinkId = textGenerate.inputs.find((input) => input.name === "image").link;
  const imageLink = built.executionGraph.links.find((link) => link[0] === imageLinkId);
  assert.equal(imageLink[1], compositeNodes[0].id, "TextGenerate must receive the complete reference contact sheet");
  const qwenEdit = built.executionGraph.nodes.find((node) => node.id === 10058);
  const qwenImageLink = built.executionGraph.links.find((link) => link[0] === qwenEdit.inputs.find((input) => input.name === "image1").link);
  assert.equal(qwenImageLink[1], compositeNodes[0].id, "Krea edit conditioning must receive the complete reference contact sheet");
  assert.equal(built.executionGraph.last_node_id, Math.max(...built.executionGraph.nodes.map((node) => Number(node.id) || 0)));
  assert.equal(built.executionGraph.last_link_id, Math.max(...built.executionGraph.links.map((link) => Number(link[0]) || 0)));
  const fingerprint = storyboardFrameGenerationFingerprint(built.frame, built.workflowHash);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
});

test("all legacy image-guide prompts compile through the attached Krea workflow", {
  skip: Object.keys(storyboard.frames).length === 0
    ? "True T2V storyboard intentionally contains no image-guide frames"
    : (!fs.existsSync(attachedKreaWorkflow) && "Attached Krea workflow is not installed in the local BlokeyUI profile")
}, () => {
  const frameIds = Object.keys(storyboard.frames).sort();
  assert.ok(frameIds.length > 0);
  for (const frameId of frameIds) {
    const built = buildStoryboardFrameWorkflowGraph(project, storyboard, frameId);
    assert.equal(built.graph.extra.premiere316.workflowId, STORYBOARD_KREA_WORKFLOW_ID, `${frameId} must use the attached Krea workflow`);
    assert.equal(built.graph.extra.premiere316.frameId, frameId);
    assert.equal(built.references.length, storyboard.frames[frameId].references.length, `${frameId} must include every effective reference`);
    assert.match(built.prompt, /PREMIERE316 STORYBOARD IMAGE GUIDE/);
    assert.ok(built.prompt.includes(storyboard.frames[frameId].prompt), `${frameId} must contain its authored image-generation prompt`);
    assert.ok(built.prompt.includes(storyboard.frames[frameId].negativePrompt), `${frameId} must contain its negative prompt`);
  }
});

test("first and last frames compile through Krea2 stills, never MiniMax H3 templates", {
  skip: !fs.existsSync(attachedKreaWorkflow) && "Attached Krea workflow is not installed in the local BlokeyUI profile"
}, () => {
  const fixtureProject = { slug: "harrowing_of_hell", settings: { width: 1280, height: 720 } };
  const fixture = {
    frames: {
      "frame-h01-s01-c01-first": stillsFrameFixture("frame-h01-s01-c01-first", "first_frame"),
      "frame-h01-s01-c01-last": stillsFrameFixture("frame-h01-s01-c01-last", "last_frame"),
      "frame-h01-s01-c01-guide": stillsFrameFixture("frame-h01-s01-c01-guide", "guide_frame")
    }
  };

  for (const frameId of Object.keys(fixture.frames)) {
    const built = buildStoryboardFrameWorkflowGraph(fixtureProject, fixture, frameId);
    assert.equal(built.graph.extra.premiere316.workflowId, STORYBOARD_KREA_WORKFLOW_ID);
    assert.equal(built.graph.extra.premiere316.type, "storyboard-image-guide");
    assert.equal(built.graph.extra.premiere316.sourceWorkflow, "storyboard-krea2-reference-subgraphs.ui.json");
    assert.notEqual(built.graph.extra.premiere316.workflowId, STORYBOARD_T2V_WORKFLOW_ID);
    assert.equal(workflowNodes(built.graph).some((node) => isForbiddenMinimaxStillsClass(node.type)), false);
    assertStillsApiPromptRejectsMinimax(built.graph);
    assertStillsApiPromptRejectsMinimax(built.executionGraph);

    const objectInfo = Object.fromEntries(
      built.executionGraph.nodes.map((node) => [node.type, { input: { required: {}, optional: {} } }])
    );
    const converted = graphToApi({ nodes: built.executionGraph.nodes, links: built.executionGraph.links }, objectInfo);
    assertStillsApiPromptRejectsMinimax(converted.prompt);
    assert.equal(
      Object.values(converted.prompt).some((node) => isForbiddenMinimaxStillsClass(node.class_type)),
      false
    );

    const poisoned = structuredClone(converted.prompt);
    poisoned["minimax-still"] = { class_type: "MiniMaxH3ImageToVideo", inputs: {} };
    assert.throws(
      () => assertStillsApiPromptRejectsMinimax(poisoned),
      /MiniMax image class_type/
    );
  }
});

test("stills compilers fail closed on MiniMax image class_type and spare audio-only MiniMax", () => {
  assert.equal(isForbiddenMinimaxStillsClass("MiniMaxH3ImageToVideo"), true);
  assert.equal(isForbiddenMinimaxStillsClass("MiniMaxH3ReferenceToVideo"), true);
  assert.equal(isForbiddenMinimaxStillsClass("EmptyMiniMaxH3LatentAV"), true);
  assert.equal(isForbiddenMinimaxStillsClass("MiniMaxH3SigmaShift"), true);
  assert.equal(isForbiddenMinimaxStillsClass("MiniMaxImage"), true);
  assert.equal(isForbiddenMinimaxStillsClass("MiniMaxMusic3TextEncode"), false);
  assert.equal(isForbiddenMinimaxStillsClass("EmptyMiniMaxMusic3LatentAudio"), false);
  assert.equal(isForbiddenMinimaxStillsClass("UNETLoader"), false);

  assert.throws(
    () => assertStillsApiPromptRejectsMinimax({ "9": { class_type: "MiniMaxH3ImageToVideo", inputs: {} } }),
    /MiniMax image class_type/
  );
  assert.throws(
    () => assertStillsApiPromptRejectsMinimax({ "12": { class_type: "MiniMaxH3ReferenceToVideo", inputs: {} } }),
    /MiniMax image class_type/
  );
  assert.throws(
    () => assertStillsApiPromptRejectsMinimax({
      nodes: [{ id: 77, type: "MiniMaxH3ImageToVideo", widgets_values: [] }]
    }),
    /MiniMax image class_type/
  );
  assert.throws(
    () => assertStillsApiPromptRejectsMinimax({
      nodes: [{ id: 1, type: "outer-subgraph" }],
      definitions: {
        subgraphs: [{
          id: "outer-subgraph",
          nodes: [],
          definitions: {
            subgraphs: [{
              id: "nested-h3",
              nodes: [{ id: 99, type: "MiniMaxH3ImageToVideo" }]
            }]
          }
        }]
      }
    }),
    /MiniMax image class_type/
  );
  assert.throws(
    () => assertStillsJobCompiledPrompt({
      apiPrompt: { "9": { class_type: "MiniMaxH3ImageToVideo", inputs: {} } }
    }),
    /MiniMax image class_type/
  );
  assert.doesNotThrow(() => assertStillsApiPromptRejectsMinimax({
    "3": { class_type: "MiniMaxMusic3TextEncode", inputs: {} },
    "4": { class_type: "EmptyMiniMaxMusic3LatentAudio", inputs: {} }
  }));
  assert.doesNotThrow(() => assertStillsApiPromptRejectsMinimax({
    "1": { class_type: "UNETLoader", inputs: { unet_name: "KREA 2\\krea2_turbo_bf16.safetensors" } }
  }));
  assert.doesNotThrow(() => assertStillsJobCompiledPrompt({
    apiPrompt: { mocked: "image" },
    graph: { nodes: [], extra: { premiere316: { outputKind: "image" } } }
  }));
});

test("guide-frame stills workflow ids are Krea2/Klein2 and never MiniMax", () => {
  assert.equal(GUIDE_FRAME_STILLS_WORKFLOW_ID, "krea2-cinematic-still-fp8");
  assert.equal(KREA2_CINEMATIC_STILL_WORKFLOW_ID, "krea2-cinematic-still-fp8");
  assert.equal(KLEIN2_STILLS_WORKFLOW_ID, "flux2-klein-9b-prop-fp8");
  assert.ok(PROMPT_GENERATION_STILLS_WORKFLOW_IDS.includes(STORYBOARD_KREA_WORKFLOW_ID));
  assert.ok(PROMPT_GENERATION_STILLS_WORKFLOW_IDS.includes("krea2-cinematic-still-fp8"));
  assert.ok(PROMPT_GENERATION_STILLS_WORKFLOW_IDS.includes("flux2-klein-9b-prop-fp8"));
  assert.ok(PROMPT_GENERATION_STILLS_WORKFLOW_IDS.every((id) => !/minimax/i.test(id)));
  assert.equal(assertPromptStillsWorkflowId("krea2-cinematic-still-fp8", "image"), "krea2-cinematic-still-fp8");
  assert.equal(assertPromptStillsWorkflowId(STORYBOARD_KREA_WORKFLOW_ID, "design"), STORYBOARD_KREA_WORKFLOW_ID);
  assert.equal(assertPromptStillsWorkflowId(KLEIN2_STILLS_WORKFLOW_ID, "image"), KLEIN2_STILLS_WORKFLOW_ID);
  assert.equal(assertPromptStillsWorkflowId("minimax-music-3", "audio"), "minimax-music-3");
  assert.throws(
    () => assertPromptStillsWorkflowId("minimax-h3-i2v", "image"),
    /cannot use MiniMax workflow/
  );
  assert.throws(
    () => assertPromptStillsWorkflowId("MiniMaxH3ImageToVideo", "design"),
    /cannot use MiniMax workflow/
  );
  assert.throws(
    () => assertPromptStillsWorkflowId("minimax-music-3", "image"),
    /cannot use MiniMax workflow/
  );
  assert.throws(
    () => assertPromptStillsWorkflowId(STORYBOARD_T2V_WORKFLOW_ID, "image"),
    /cannot generate stills/
  );
  assert.throws(
    () => assertPromptStillsWorkflowId("ci-flux2-p316-style-only-16x9-max", "image"),
    /must use Krea2 or Klein2/
  );
});

test("LTX video-plan compilation cannot be used as a stills generator", () => {
  const t2vGraph = {
    extra: {
      premiere316: {
        type: "storyboard-t2v-video-plan",
        workflowId: STORYBOARD_T2V_WORKFLOW_ID,
        temporalGuides: { firstFrame: false, lastFrame: false, timedImages: false }
      }
    }
  };
  assertLtxVideoPlanIsNotStillsGenerator(t2vGraph);

  const asStills = structuredClone(t2vGraph);
  asStills.extra.premiere316.type = "storyboard-image-guide";
  asStills.extra.premiere316.workflowId = STORYBOARD_KREA_WORKFLOW_ID;
  assert.throws(
    () => assertLtxVideoPlanIsNotStillsGenerator(asStills),
    /cannot be used as a stills or first-frame generator/
  );

  const temporal = structuredClone(t2vGraph);
  temporal.extra.premiere316.temporalGuides.firstFrame = true;
  assert.throws(
    () => assertLtxVideoPlanIsNotStillsGenerator(temporal),
    /cannot generate first-frame or last-frame stills/
  );
});
