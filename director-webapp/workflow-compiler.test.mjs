import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { graphToApi } from "../server/comfy.js";
import {
  buildSegmentJobs,
  flattenWorkflow,
  ltxFrameCount,
  patchPrompt,
  premiere316ReferenceDiagnostics,
  premiere316SemanticReferencePayload,
  validatePrompt,
  workspaceForClient,
  workspaceFromWorkflow
} from "./workflow-compiler.mjs";

const sourcePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "workflows",
  "director-presets",
  "harrowing-of-hell-ltx25-director.ui.json"
);
const sourceText = fs.readFileSync(sourcePath, "utf8");
const sourceGraph = JSON.parse(sourceText);
const premiere316SourcePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "workflows",
  "director-presets",
  "ltx25-premiere316-segmented-i2v.ui.json"
);

test("flattens the supplied Director subgraph without UUID execution nodes", () => {
  const flat = flattenWorkflow(sourceGraph);
  assert.equal(flat.nodes.length, 30);
  assert.equal(flat.links.length, 56);
  assert.equal(flat.nodes.some((node) => node.type === "034a1968-3257-4d14-b129-4f2156c94742"), false);
  assert.equal(flat.nodes.some((node) => node.type === "LTXDirector"), true);
});

test("the named LTX2.5_Premiere316 workflow exposes the fixed compiler seam and leaves output 94 raw", () => {
  const graph = JSON.parse(fs.readFileSync(premiere316SourcePath, "utf8"));
  const flat = flattenWorkflow(graph);
  const byId = new Map(flat.nodes.map((node) => [String(node.id), node]));
  assert.equal(byId.get("46")?.type, "BlokeyLtxDirector");
  assert.equal(byId.get("8")?.type, "BlokeyLtxDirectorGuide");
  assert.equal(byId.get("58")?.type, "BlokeyLtxDirectorGuide");
  assert.equal(byId.get("2000")?.type, "LTX2.5_Premiere316");
  assert.equal(byId.get("200")?.type, "Premiere316AssetResolver");
  assert.equal(byId.get("201")?.type, "Premiere316ReferenceSheetBuilder");
  assert.equal(byId.get("202")?.type, "RepeatImageBatch");
  assert.equal(byId.get("203")?.type, "LTXICLoRALoaderModelOnly");
  assert.equal(byId.get("204")?.type, "LTXAddVideoICLoRAGuide");
  assert.equal(byId.get("94")?.type, "VHS_VideoCombine");
  assert.equal(flat.nodes.some((node) => node.type === "LTX2.5_Premiere316Trim"), false);
});

test("preserves the packaged timeline truth and builds its segment job", () => {
  const workspace = workspaceFromWorkflow(sourceGraph, sourceText);
  assert.equal(workspace.settings.frameRate, 24);
  assert.equal(workspace.timeline.segments.length, 1);
  assert.equal(buildSegmentJobs(workspace).length, 1);
  assert.equal(workspace.stats.durationFrames, 251);
});

test("aligns requested Premiere frames to the LTX 8n+1 generation grid", () => {
  assert.deepEqual(
    [1, 48, 72, 96, 120, 168, 336].map((frames) => [frames, ltxFrameCount(frames)]),
    [[1, 1], [48, 49], [72, 73], [96, 97], [120, 121], [168, 169], [336, 337]]
  );
});

function fourSegmentWorkspace() {
  return {
    settings: { frameRate: 24, guideStrength: "1.00" },
    timeline: {
      global_prompt: "global prompt remains unchanged",
      normalStartFrame: 0,
      normalDurationFrames: 360,
      segments: [
        { id: "segment-01", type: "image", start: 0, length: 72, prompt: "prompt 01", imageFile: "frame-01.png", storyboardFrameId: "frame-01", guideStrength: 0.6 },
        { id: "segment-02", type: "image", start: 72, length: 72, prompt: "prompt 02", imageFile: "frame-02.png", storyboardFrameId: "frame-02", guideStrength: 0.7 },
        { id: "segment-03", type: "image", start: 144, length: 48, prompt: "prompt 03", imageFile: "frame-03.png", storyboardFrameId: "frame-03", guideStrength: 0.9 },
        { id: "segment-04", type: "image", start: 192, length: 168, prompt: "prompt 04", imageFile: "frame-04.png", storyboardFrameId: "frame-04", guideStrength: 1 }
      ],
      motionSegments: [],
      audioSegments: []
    }
  };
}

function hybridPremiere316Workspace() {
  const value = fourSegmentWorkspace();
  value.settings = {
    ...value.settings,
    customWidth: 1152,
    customHeight: 480,
    resizeMethod: "crop",
    divisibleBy: 32,
    imageCompression: 18,
    outputPrefix: "Premiere316/test/hybrid",
    negativePrompt: "negative"
  };
  value.timeline.segments[0].useNextAsLastFrame = true;
  value.premiere = {
    source: "storyboard",
    projectSlug: "test-project",
    clipId: "clip-01",
    videoPlanId: "plan-01",
    generationMode: "i2v_segmented_first_frames",
    expectedReferenceCount: 2,
    referenceCount: 2,
    semanticAssetRoot: "Premiere316/test-project/semantic/plan-01",
    semanticReferences: [
      {
        id: "ref-identity",
        frameId: "frame-01",
        role: "character",
        declaredRole: "character",
        imageFile: "Premiere316/test-project/semantic/plan-01/identity/01_jesus.png",
        resolverReference: "identity/01_jesus.png",
        required: true,
        canonicalFile: "characters/jesus.png",
        sha256: "a".repeat(64),
        bytes: 100,
        order: 1
      },
      {
        id: "ref-location",
        frameId: "frame-01",
        role: "location",
        imageFile: "Premiere316/test-project/semantic/plan-01/location/02_abyss.png",
        resolverReference: "location/02_abyss.png",
        required: true,
        canonicalFile: "locations/abyss.png",
        sha256: "b".repeat(64),
        bytes: 200,
        order: 2
      }
    ]
  };
  return value;
}

function hybridDirectorPrompt() {
  return {
    3: { class_type: "VAELoader", inputs: { vae_name: "video_vae.safetensors" } },
    5: { class_type: "LTXVConditioning", inputs: {} },
    7: { class_type: "SamplerCustomAdvanced", inputs: { guider: ["9", 0], latent_image: ["8", 2] } },
    8: {
      class_type: "BlokeyLtxDirectorGuide",
      inputs: {
        positive: ["5", 0],
        negative: ["5", 1],
        vae: ["3", 0],
        latent: ["46", 2],
        guide_data: ["46", 4],
        ic_lora_name: "None",
        ic_lora_strength: 0
      }
    },
    9: { class_type: "CFGGuider", inputs: { model: ["46", 0], positive: ["8", 0], negative: ["8", 1] } },
    46: { class_type: "BlokeyLtxDirector", inputs: { model: ["95", 0] } },
    49: { class_type: "CFGGuider", inputs: { model: ["46", 0], positive: ["58", 0], negative: ["58", 1] } },
    50: { class_type: "SamplerCustomAdvanced", inputs: { guider: ["49", 0], latent_image: ["58", 2] } },
    52: { class_type: "LatentUpscale", inputs: { samples: ["7", 1] } },
    55: { class_type: "LTXVCropGuides", inputs: { positive: ["8", 0], negative: ["8", 1] } },
    58: {
      class_type: "BlokeyLtxDirectorGuide",
      inputs: {
        positive: ["55", 0],
        negative: ["55", 1],
        vae: ["3", 0],
        latent: ["52", 0],
        guide_data: ["46", 4],
        ic_lora_name: "None",
        ic_lora_strength: 0
      }
    },
    94: { class_type: "VHS_VideoCombine", inputs: { images: ["50", 1] } },
    95: { class_type: "UNETLoader", inputs: { unet_name: "ltx25.safetensors" } }
  };
}

test("builds four independent jobs with exact segment identity and frame counts", () => {
  const jobs = buildSegmentJobs(fourSegmentWorkspace());
  assert.equal(jobs.length, 4);
  assert.deepEqual(jobs.map((job) => job.sourceSegmentId), ["segment-01", "segment-02", "segment-03", "segment-04"]);
  assert.deepEqual(jobs.map((job) => job.requestedFrames), [72, 72, 48, 168]);
  assert.deepEqual(jobs.map((job) => job.generationFrames), [73, 73, 49, 169]);
  assert.deepEqual(jobs.map((job) => [job.sourceSegmentIndex, job.sourceSegmentTotal]), [[1, 4], [2, 4], [3, 4], [4, 4]]);
  assert.deepEqual(jobs.map((job) => [job.queueIndex, job.queueTotal]), [[1, 4], [2, 4], [3, 4], [4, 4]]);
  assert.deepEqual(jobs.map((job) => job.timeline.segments.map((segment) => segment.id)), [
    ["segment-01"],
    ["segment-02"],
    ["segment-03"],
    ["segment-04"]
  ]);
  assert.deepEqual(jobs.map((job) => job.localPrompts), ["prompt 01", "prompt 02", "prompt 03", "prompt 04"]);
  assert.ok(jobs.every((job) => job.usePreviousAsFirstFrame === false && job.useNextAsLastFrame === false));
});

test("injects exact Premiere316 semantic references through the real Ingredients branch while temporal guides stay separate", () => {
  const workspace = hybridPremiere316Workspace();
  const [job] = buildSegmentJobs(workspace, "segment-01");
  const originalRawOutputImages = structuredClone(hybridDirectorPrompt()["94"].inputs.images);
  const { prompt, referenceConditioning } = patchPrompt(hybridDirectorPrompt(), workspace, job);
  const timeline = JSON.parse(prompt["46"].inputs.timeline_data);

  assert.deepEqual(timeline.segments.map((segment) => [segment.imageFile, segment.isEndFrame]), [
    ["frame-01.png", false],
    ["frame-02.png", true]
  ], "first/last temporal guides remain in timeline guide_data rather than the semantic sheet");
  assert.deepEqual(timeline.generationProfile, {
    id: "LTX2.5_Premiere316",
    lengthModel: "auto_ltx_8n_plus_1",
    requestedFrames: 72,
    generationFrames: 73,
    editorialTrimFrames: 1,
    fps: 24
  });
  assert.equal(timeline.semanticReferenceContract.layout, "adaptive");
  assert.deepEqual(timeline.semanticReferences.map((reference) => [reference.role, reference.resolverReference]), [
    ["identity", "identity/01_jesus.png"],
    ["location", "location/02_abyss.png"]
  ]);

  assert.deepEqual(prompt["2000"].inputs, {
    length_source: "frames",
    requested_frames: 72,
    requested_duration_seconds: 3,
    frame_rate: 24
  });
  assert.deepEqual(prompt["46"].inputs.duration_frames, ["2000", 0]);
  assert.deepEqual(prompt["46"].inputs.end_frame, ["2000", 0]);
  assert.deepEqual(prompt["46"].inputs.duration_seconds, ["2000", 3]);
  assert.deepEqual(prompt["94"].inputs.images, originalRawOutputImages, "workflow output remains raw generation length for the server finalizer to trim once");
  assert.equal(Object.values(prompt).some((node) => node.class_type === "LTX2.5_Premiere316Trim"), false);

  assert.equal(prompt["200"].class_type, "Premiere316AssetResolver");
  assert.equal(prompt["200"].inputs.prompt, "");
  assert.equal(prompt["200"].inputs.asset_root, "Premiere316/test-project/semantic/plan-01");
  assert.equal(prompt["200"].inputs.max_references, 9);
  assert.equal(prompt["200"].inputs.strict_mode, true);
  assert.equal(prompt["200"].inputs.explicit_references, "identity/01_jesus.png\nlocation/02_abyss.png");
  assert.deepEqual(prompt["201"].inputs, {
    reference_set: ["200", 1],
    width: 768,
    height: 768,
    frame_count: ["2000", 1]
  });
  assert.deepEqual(prompt["202"].inputs, { image: ["201", 0], amount: ["2000", 1] });
  assert.equal(prompt["203"].inputs.lora_name, "LTX\\2.5\\ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors");
  assert.deepEqual(prompt["203"].inputs.model, ["95", 0]);
  assert.deepEqual(prompt["46"].inputs.model, ["203", 0]);
  assert.deepEqual(prompt["204"].inputs.image, ["202", 0]);
  assert.deepEqual(prompt["204"].inputs.positive, ["8", 0]);
  assert.deepEqual(prompt["204"].inputs.negative, ["8", 1]);
  assert.deepEqual(prompt["204"].inputs.latent, ["8", 2]);
  assert.deepEqual(prompt["204"].inputs.latent_downscale_factor, ["203", 1]);
  assert.deepEqual(prompt["9"].inputs, { model: ["46", 0], positive: ["204", 0], negative: ["204", 1] });
  assert.deepEqual(prompt["7"].inputs.latent_image, ["204", 2]);
  assert.deepEqual(prompt["55"].inputs.positive, ["204", 0]);
  assert.deepEqual(prompt["55"].inputs.negative, ["204", 1]);
  assert.ok([prompt["8"], prompt["58"]].every((guide) => (
    guide.inputs.ic_lora_name === "None"
    && guide.inputs.ic_lora_strength === 0
    && guide.inputs.guide_data[0] === "46"
    && guide.inputs.guide_data[1] === 4
  )));

  assert.equal(referenceConditioning.requestedFrames, 72);
  assert.equal(referenceConditioning.generationFrames, 73);
  assert.equal(referenceConditioning.editorialTrimFrames, 1);
  assert.equal(referenceConditioning.trimOwner, "server-finalizer");
  assert.equal(referenceConditioning.semantic.expectedCount, 2);
  assert.equal(referenceConditioning.semantic.stagedCount, 2);
  assert.equal(referenceConditioning.semantic.injectedCount, 2);
  assert.equal(referenceConditioning.semantic.consumed, true);
  assert.equal(referenceConditioning.semantic.computedLayout, "2x1");
  assert.equal(referenceConditioning.semantic.highStageMode, "latent-refinement-from-conditioned-low-stage");
  assert.equal(referenceConditioning.semantic.highGuides[0].latentRefinesConditionedLowStage, true);
  assert.deepEqual(referenceConditioning.semantic.cfgStages.map((stage) => stage.nodeId), ["9"]);
});

test("Premiere316 semantic preflight fails closed for count, staging, and downstream-model mismatches", () => {
  const countMismatch = hybridPremiere316Workspace();
  countMismatch.premiere.semanticReferences.push({
    ...structuredClone(countMismatch.premiere.semanticReferences[1]),
    order: 3
  });
  countMismatch.premiere.expectedReferenceCount = 3;
  assert.throws(
    () => patchPrompt(hybridDirectorPrompt(), countMismatch, buildSegmentJobs(countMismatch, "segment-01")[0]),
    /expected 3, staged 2/
  );

  const missingResolverPath = hybridPremiere316Workspace();
  delete missingResolverPath.premiere.semanticReferences[0].resolverReference;
  assert.throws(
    () => patchPrompt(hybridDirectorPrompt(), missingResolverPath, buildSegmentJobs(missingResolverPath, "segment-01")[0]),
    /has no staged resolver path/
  );

  const workspace = hybridPremiere316Workspace();
  const job = buildSegmentJobs(workspace, "segment-01")[0];
  const compiled = patchPrompt(hybridDirectorPrompt(), workspace, job);
  compiled.prompt["9"].inputs.model = ["95", 0];
  const semantic = {
    ...premiere316SemanticReferencePayload(workspace, job),
    requestedFrames: 72,
    generationFrames: 73,
    fps: 24
  };
  assert.throws(
    () => premiere316ReferenceDiagnostics(compiled.prompt, "46", semantic),
    /CFGGuider 9 does not consume the IC-LoRA-patched model/
  );
});

test("Premiere316 auto length remains authoritative when a segmented plan explicitly expects zero semantic references", () => {
  const workspace = hybridPremiere316Workspace();
  workspace.premiere.expectedReferenceCount = 0;
  workspace.premiere.referenceCount = 0;
  workspace.premiere.semanticAssetRoot = "";
  workspace.premiere.semanticReferences = [];
  const job = buildSegmentJobs(workspace, "segment-01")[0];
  const sourcePrompt = hybridDirectorPrompt();
  sourcePrompt["203"] = {
    class_type: "LTXICLoRALoaderModelOnly",
    inputs: {
      model: ["95", 0],
      lora_name: "LTX\\2.5\\ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors",
      strength_model: 1
    }
  };
  sourcePrompt["204"] = {
    class_type: "LTXAddVideoICLoRAGuide",
    inputs: {
      positive: ["8", 0],
      negative: ["8", 1],
      vae: ["3", 0],
      latent: ["8", 2],
      image: ["202", 0],
      latent_downscale_factor: ["203", 1]
    }
  };
  sourcePrompt["46"].inputs.model = ["203", 0];
  sourcePrompt["8"].inputs.model = ["203", 0];
  sourcePrompt["58"].inputs.model = ["203", 0];
  sourcePrompt["9"].inputs = { model: ["8", 3], positive: ["204", 0], negative: ["204", 1] };
  sourcePrompt["7"].inputs.latent_image = ["204", 2];
  sourcePrompt["55"].inputs.positive = ["204", 0];
  sourcePrompt["55"].inputs.negative = ["204", 1];
  sourcePrompt["49"].inputs.model = ["58", 3];
  const { prompt, referenceConditioning } = patchPrompt(sourcePrompt, workspace, job);
  assert.deepEqual(prompt["46"].inputs.duration_frames, ["2000", 0]);
  assert.equal(prompt["2000"].inputs.requested_frames, 72);
  assert.deepEqual(prompt["46"].inputs.model, ["95", 0]);
  assert.deepEqual(prompt["8"].inputs.model, ["95", 0]);
  assert.deepEqual(prompt["58"].inputs.model, ["95", 0]);
  assert.deepEqual(prompt["9"].inputs, { model: ["8", 3], positive: ["8", 0], negative: ["8", 1] });
  assert.deepEqual(prompt["7"].inputs.latent_image, ["8", 2]);
  assert.deepEqual(prompt["55"].inputs.positive, ["8", 0]);
  assert.deepEqual(prompt["55"].inputs.negative, ["8", 1]);
  assert.equal(prompt["203"].inputs.strength_model, 1, "the loader may remain in the prompt only when it is unreachable");
  assert.equal(referenceConditioning.generationFrames, 73);
  assert.equal(referenceConditioning.semantic.expectedCount, 0);
  assert.equal(referenceConditioning.semantic.injectedCount, 0);
  assert.equal(referenceConditioning.semantic.status, "not-required");
  assert.ok(referenceConditioning.semantic.bypassedIngredients.guideModelDependencies.every((entry) => entry.loaderNodeIds.length === 0));
  assert.ok(referenceConditioning.semantic.bypassedIngredients.activeDependencies.every((entry) => (
    entry.loaderNodeIds.length === 0 && entry.addGuideNodeIds.length === 0
  )), "no CFGGuider or sampler ancestry may retain loader203/addGuide204");
});

test("builds exactly one independently identified job for selected-segment tuning", () => {
  const [job] = buildSegmentJobs(fourSegmentWorkspace(), "segment-03");
  assert.equal(job.sourceSegmentId, "segment-03");
  assert.equal(job.sourceSegmentIndex, 3);
  assert.equal(job.sourceSegmentTotal, 4);
  assert.equal(job.queueIndex, 1);
  assert.equal(job.queueTotal, 1);
  assert.equal(job.requestedFrames, 48);
  assert.equal(job.generationFrames, 49);
  assert.equal(job.index, 3, "selected output prefix must retain its timeline position");
  assert.equal(job.timeline.segments.length, 1);
  assert.equal(job.timeline.segments[0].id, "segment-03");
});

test("optionally uses the previous image at frame zero and the next image only as the final guide", () => {
  const value = fourSegmentWorkspace();
  value.timeline.segments[1].usePreviousAsFirstFrame = true;
  value.timeline.segments[1].useNextAsLastFrame = true;
  const [job] = buildSegmentJobs(value, "segment-02");
  assert.equal(job.sourceSegmentId, "segment-02");
  assert.equal(job.firstFrameSourceSegmentId, "segment-01");
  assert.equal(job.lastFrameSourceSegmentId, "segment-03");
  assert.equal(job.localPrompts, "prompt 02", "adjacent guides must not add or replace prompt text");
  assert.equal(job.segmentLengths, "73", "the next-frame guide must not add a prompt-relay segment");
  assert.equal(job.guideStrength, "0.70,0.90", "the selected segment keeps its authored first-guide strength");
  assert.equal(job.timeline.segments.length, 2);
  const [first, last] = job.timeline.segments;
  assert.equal(first.id, "segment-02", "the generated job remains owned by the selected source segment");
  assert.equal(first.imageFile, "frame-01.png");
  assert.equal(first.prompt, "prompt 02");
  assert.equal(first.start, 0);
  assert.equal(first.isEndFrame, false);
  assert.equal(first.guideSourceSegmentId, "segment-01");
  assert.equal(last.imageFile, "frame-03.png");
  assert.equal(last.prompt, "");
  assert.equal(last.start, 0);
  assert.equal(last.length, 73);
  assert.equal(last.isEndFrame, true);
  assert.equal(last.boundaryGuideOnly, true);
  assert.equal(last.guideSourceSegmentId, "segment-03");
});

test("compiles adjacent frame guides into LTX Director without changing the selected prompt relay", () => {
  const value = fourSegmentWorkspace();
  value.settings = {
    ...value.settings,
    customWidth: 1152,
    customHeight: 480,
    resizeMethod: "crop",
    divisibleBy: 32,
    imageCompression: 18,
    outputPrefix: "test/scene",
    negativePrompt: "negative"
  };
  value.timeline.segments[1].usePreviousAsFirstFrame = true;
  value.timeline.segments[1].useNextAsLastFrame = true;
  const [job] = buildSegmentJobs(value, "segment-02");
  const apiPrompt = {
    46: { class_type: "LTXDirector", inputs: {} },
    94: { class_type: "VHS_VideoCombine", inputs: {} }
  };
  const { prompt } = patchPrompt(apiPrompt, value, job);
  const timelineData = JSON.parse(prompt["46"].inputs.timeline_data);
  assert.equal(prompt["46"].inputs.local_prompts, "prompt 02");
  assert.equal(prompt["46"].inputs.segment_lengths, "73");
  assert.equal(prompt["46"].inputs.duration_frames, 73);
  assert.equal(prompt["94"].inputs.filename_prefix, "test/scene/segment_002");
  assert.deepEqual(timelineData.segments.map((segment) => [segment.imageFile, segment.isEndFrame]), [
    ["frame-01.png", false],
    ["frame-03.png", true]
  ]);
});

test("patches all four payloads with only their matching prompt, guide, and stable output ordinal", () => {
  const value = fourSegmentWorkspace();
  value.settings = {
    ...value.settings,
    customWidth: 1152,
    customHeight: 480,
    resizeMethod: "maintain aspect ratio",
    divisibleBy: 32,
    imageCompression: 18,
    useCustomAudio: false,
    useCustomMotion: false,
    inpaintAudio: false,
    overrideAudio: false,
    negativePrompt: "negative",
    outputPrefix: "Premiere316/test/H01-S01-C01"
  };
  const basePrompt = {
    46: { class_type: "LTXDirector", inputs: {} },
    94: { class_type: "VHS_VideoCombine", inputs: {} }
  };
  const expectedPrompts = ["prompt 01", "prompt 02", "prompt 03", "prompt 04"];
  const expectedImages = ["frame-01.png", "frame-02.png", "frame-03.png", "frame-04.png"];
  const expectedLengths = ["73", "73", "49", "169"];
  const payloads = buildSegmentJobs(value).map((job) => patchPrompt(basePrompt, value, job).prompt);

  payloads.forEach((prompt, index) => {
    const director = prompt["46"].inputs;
    const timeline = JSON.parse(director.timeline_data);
    assert.equal(director.local_prompts, expectedPrompts[index]);
    assert.equal(director.segment_lengths, expectedLengths[index]);
    assert.equal(timeline.segments.length, 1);
    assert.equal(timeline.segments[0].id, `segment-0${index + 1}`);
    assert.equal(timeline.segments[0].prompt, expectedPrompts[index]);
    assert.equal(timeline.segments[0].imageFile, expectedImages[index]);
    assert.equal(prompt["94"].inputs.filename_prefix, `Premiere316/test/H01-S01-C01/segment_00${index + 1}`);
  });
  assert.equal(new Set(payloads.map((prompt) => prompt["46"].inputs.local_prompts)).size, 4);
});

test("refuses impossible adjacent-frame selections and invalid single-segment requests", () => {
  const firstBoundary = fourSegmentWorkspace();
  firstBoundary.timeline.segments[0].usePreviousAsFirstFrame = true;
  assert.throws(() => buildSegmentJobs(firstBoundary, "segment-01"), /start of the timeline/);

  const lastBoundary = fourSegmentWorkspace();
  lastBoundary.timeline.segments[3].useNextAsLastFrame = true;
  assert.throws(() => buildSegmentJobs(lastBoundary, "segment-04"), /end of the timeline/);

  const missingAdjacent = fourSegmentWorkspace();
  missingAdjacent.timeline.segments[1].useNextAsLastFrame = true;
  missingAdjacent.timeline.segments[2].missingGuide = true;
  assert.throws(() => buildSegmentJobs(missingAdjacent, "segment-02"), /segment-03.*no approved image guide/);

  assert.throws(() => buildSegmentJobs(fourSegmentWorkspace(), "does-not-exist"), /Timeline segment not found/);
});

test("client normalization clears stale disabled boundary flags while preserving valid neighbor choices", () => {
  const value = fourSegmentWorkspace();
  value.timeline.segments[0].usePreviousAsFirstFrame = true;
  value.timeline.segments[1].usePreviousAsFirstFrame = true;
  value.timeline.segments[1].useNextAsLastFrame = true;
  value.timeline.segments[3].useNextAsLastFrame = true;
  const normalized = workspaceForClient(value);
  assert.equal(normalized.timeline.segments[0].usePreviousAsFirstFrame, false);
  assert.equal(normalized.timeline.segments[1].usePreviousAsFirstFrame, true);
  assert.equal(normalized.timeline.segments[1].useNextAsLastFrame, true);
  assert.equal(normalized.timeline.segments[3].useNextAsLastFrame, false);

  value.timeline.segments[2].missingGuide = true;
  value.timeline.segments[1].useNextAsLastFrame = true;
  assert.equal(workspaceForClient(value).timeline.segments[1].useNextAsLastFrame, false);
});

test("compiles and validates against live ComfyUI when 8188 is available", async (context) => {
  let objectInfo;
  try {
    const response = await fetch("http://127.0.0.1:8188/object_info", { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(String(response.status));
    objectInfo = await response.json();
  } catch {
    context.skip("ComfyUI 8188 is not available");
    return;
  }

  const workspace = workspaceFromWorkflow(sourceGraph, sourceText);
  const converted = graphToApi(flattenWorkflow(sourceGraph), objectInfo);
  assert.deepEqual(converted.warnings, []);
  const { prompt } = patchPrompt(converted.prompt, workspace, buildSegmentJobs(workspace)[0]);
  assert.equal(Object.keys(prompt).length, 30);
  assert.deepEqual(validatePrompt(prompt, objectInfo), []);
  assert.equal(prompt["46"].inputs.frame_rate, 50);
  assert.equal(prompt["46"].inputs.global_prompt, workspace.timeline.global_prompt);
  assert.equal(prompt["94"].class_type, "VHS_VideoCombine");
  assert.equal(prompt["132"].inputs.width, workspace.settings.customWidth);
  assert.equal(prompt["132"].inputs.height, workspace.settings.customHeight);
});
