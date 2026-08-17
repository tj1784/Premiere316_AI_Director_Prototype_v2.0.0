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
  buildStoryboardFrameWorkflowGraph,
  buildStoryboardVideoPlanWorkflowGraph,
  compileStoryboardVideoPlanPrompt,
  storyboardFrameGenerationFingerprint,
  STORYBOARD_KREA_WORKFLOW_ID,
  STORYBOARD_T2V_WORKFLOW_ID
} from "../server/storyboard-generation.js";
import { graphToApi } from "../server/comfy.js";

const project = JSON.parse(fs.readFileSync(new URL("../projects/harrowing_of_hell/project.json", import.meta.url), "utf8"));
const storyboard = JSON.parse(fs.readFileSync(new URL("../projects/harrowing_of_hell/production/storyboard.json", import.meta.url), "utf8"));
const attachedKreaWorkflow = fileURLToPath(new URL("../workflows/storyboard-krea2-reference-subgraphs.ui.json", import.meta.url));
const attachedT2vWorkflow = fileURLToPath(new URL("../workflows/storyboard-ltx25-t2v-semantic-reference.ui.json", import.meta.url));

function workflowNodes(graph) {
  return [graph, ...(graph.definitions?.subgraphs || [])].flatMap((container) => container.nodes || []);
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
    frames: 0,
    segments: 392,
    referenceBindings: 678,
    effectiveReferences: 678,
    runtimeFrames: 54792
  });
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

test("every authored reference binding targets a real video plan", () => {
  let videoPlanBindings = 0;
  for (const binding of Object.values(storyboard.referenceBindings)) {
    assert.equal(binding.targetKind, "video_plan");
    assert.ok(Object.hasOwn(storyboard.videoPlans, binding.targetId), `${binding.id} video plan target must exist`);
    videoPlanBindings += 1;
  }
  assert.equal(videoPlanBindings, 678);
});

test("storyboard validation rejects a missing video-plan binding target", () => {
  const invalid = structuredClone(storyboard);
  const binding = Object.values(invalid.referenceBindings)[0];
  binding.targetId = "video-missing-target";
  assert.throws(() => validateStoryboard(invalid, project.slug), /reference binding target not found/);
});

test("video-plan reference replacement is target-scoped, exact-version pinned, and de-duplicated", () => {
  const targetId = "video-h01-s01-c01";
  const authored = Object.values(storyboard.referenceBindings).find((reference) => reference.targetId === targetId);
  assert.ok(authored, "fixture must contain an authored video-plan reference");
  const otherTargetId = "video-h01-s01-c02";
  const otherTargetBefore = structuredClone(storyboard.videoPlans[otherTargetId].referenceFiles);
  const result = replaceStoryboardTargetReferences(storyboard, project, {
    targetKind: "video_plan",
    targetId,
    references: [
      {
        id: authored.id,
        assetId: authored.assetId,
        assetVersion: 4,
        canonicalFile: authored.canonicalFile,
        role: authored.role,
        cropRegion: authored.cropRegion,
        notes: authored.notes,
        useMode: "semantic_reference"
      },
      {
        assetId: authored.assetId,
        assetVersion: 4,
        canonicalFile: authored.canonicalFile,
        role: authored.role
      }
    ]
  });
  assert.equal(storyboard.videoPlans[targetId].referenceFiles.length, 4, "input storyboard must not be mutated");
  assert.equal(result.references.length, 1, "duplicate asset IDs are collapsed deterministically");
  assert.equal(result.references[0].sourceAssetFile, "char-jesus-main.v4.png");
  assert.equal(result.references[0].assetVersionId, `${authored.assetId}:v4`);
  assert.equal(result.references[0].id, authored.id, "unchanged authored binding ID must survive Apply");
  assert.equal(result.references[0].cropRegion, authored.cropRegion);
  assert.equal(result.references[0].notes, authored.notes);
  assert.equal(result.storyboard.referenceBindings[authored.id].order, storyboard.referenceBindings[authored.id].order, "authored binding order must survive Apply");
  assert.deepEqual(result.storyboard.videoPlans[targetId].referenceFiles, [authored.canonicalFile]);
  assert.deepEqual(result.storyboard.clips["H01-S01-C01"].referenceFiles, [authored.canonicalFile]);
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
  const videoPlanId = "video-h01-s01-c01";
  const built = buildStoryboardVideoPlanWorkflowGraph(project, storyboard, videoPlanId, { requireRunnableAudio: true });
  const rebuilt = buildStoryboardVideoPlanWorkflowGraph(project, storyboard, videoPlanId, { requireRunnableAudio: true });
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
    authoredFrames: 360,
    generationFrames: 361,
    decodedTrim: 1,
    durationSeconds: 15,
    seed: built.settings.seed,
    latentX2: true
  });

  const master = built.graph.nodes.find((node) => node.id === 5900);
  assert.deepEqual(master.widgets_values.slice(0, 6), [
    "LTX-2.5 Native T2V",
    15,
    24,
    "Custom (multiples of 32)",
    768,
    320
  ]);
  assert.equal(master.widgets_values[7], true);
  const promptNode = built.graph.nodes.find((node) => node.id === 5901);
  assert.equal(promptNode.widgets_values[0], storyboard.videoPlans[videoPlanId].globalPrompt);
  const resolver = built.graph.nodes.find((node) => node.id === 5902);
  assert.equal(resolver.widgets_values[2], 9);
  assert.equal(resolver.widgets_values[3], true);
  assert.equal(resolver.widgets_values[5], "asset_index.json");
  assert.equal(resolver.widgets_values[6], storyboard.videoPlans[videoPlanId].referenceFiles.join("\n"));
  assert.deepEqual(built.references.map((reference) => reference.canonical), storyboard.videoPlans[videoPlanId].referenceFiles);
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
  assert.equal(finalVideo.widgets_values.filename_prefix, "Premiere316/harrowing_of_hell/storyboard/H01-S01-C01");
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
    compiled = await compileStoryboardVideoPlanPrompt(project, storyboard, "video-h01-s01-c01");
  } catch (error) {
    if (/fetch failed|ECONNREFUSED|active ComfyUI runtime/i.test(String(error?.message || error))) {
      t.skip("Live 8188 object_info is unavailable");
      return;
    }
    throw error;
  }
  assert.deepEqual(compiled.referenceConditioning, {
    expected: 4,
    resolved: 4,
    injected: 4,
    adapter: "LTX\\2.5\\ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors",
    model: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
    clip: "gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",
    videoVae: "LTX\\2.5\\ltx-2.5-video-vae-bf16.safetensors",
    audioVae: "LTX\\2.5\\ltx-2.5-audio-vae-bf16.safetensors",
    resolverNodeId: "5902",
    sheetNodeId: "5915",
    guideNodeId: "5919"
  });
  assert.equal(compiled.apiPrompt["5914"].inputs.model[0], "5801");
  assert.equal(compiled.apiPrompt["5915"].inputs.reference_set[0], "5902");
  assert.equal(compiled.apiPrompt["5915"].inputs.frame_count, 361);
  assert.equal(compiled.apiPrompt["5919"].inputs.image[0], "5915");
  assert.equal(compiled.apiPrompt["5919"].inputs.vae[0], "5800");
  assert.equal(compiled.apiPrompt["5921"].inputs.switch, true);
  assert.equal(compiled.apiPrompt["5928"].inputs.frame_rate, 24);
});

test("generation preflight refuses to invent required dialogue or replace an authoritative post-mix track", () => {
  assert.throws(
    () => buildStoryboardVideoPlanWorkflowGraph(project, storyboard, "video-h01-s02-c01", { requireRunnableAudio: true }),
    /requires an exact clip-length dialogue track/
  );
  assert.throws(
    () => buildStoryboardVideoPlanWorkflowGraph(project, storyboard, "video-mv01-s01-c01", { requireRunnableAudio: true }),
    /requires authoritative external audio post-mix support/
  );
  const pendingDialogue = buildStoryboardVideoPlanWorkflowGraph(project, storyboard, "video-h01-s02-c01");
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

test("legacy storyboard image guide compiler patches the attached Krea workflow deterministically", {
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
  assert.deepEqual(built.resolution, { width: 1280, height: 544, ratio: "2.39:1" });
  const allNodes = workflowNodes(built.graph);
  const promptInput = allNodes.find((node) => node.id === 10042)?.widgets_values?.[1] || "";
  assert.match(promptInput, /PREMIERE316 STORYBOARD IMAGE GUIDE/);
  assert.match(promptInput, /A last heartbeat ends/);
  assert.match(promptInput, /Avoid\/negative constraints/);
  const latent = allNodes.find((node) => node.id === 10053);
  assert.deepEqual(latent.widgets_values.slice(0, 3), [1280, 544, 1]);
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
    ratio: "2.39:1",
    w: 1280,
    h: 544,
    custom_w: 1280,
    custom_h: 544,
    custom_ratio_w: 239,
    custom_ratio_h: 100,
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
