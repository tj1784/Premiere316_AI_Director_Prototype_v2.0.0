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
  storyboardFrameGenerationFingerprint,
  STORYBOARD_KREA_WORKFLOW_ID
} from "../server/storyboard-generation.js";
import { graphToApi } from "../server/comfy.js";

const project = JSON.parse(fs.readFileSync(new URL("../projects/harrowing_of_hell/project.json", import.meta.url), "utf8"));
const storyboard = JSON.parse(fs.readFileSync(new URL("../projects/harrowing_of_hell/production/storyboard.json", import.meta.url), "utf8"));
const attachedKreaWorkflow = fileURLToPath(new URL("../workflows/storyboard-krea2-reference-subgraphs.ui.json", import.meta.url));

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
    chapters: 10,
    scenes: 34,
    clips: 119,
    frames: 161,
    segments: 357,
    referenceBindings: 734,
    effectiveReferences: 987,
    runtimeFrames: 48960
  });
});

test("every effective image-guide reference pins an exact project asset version", () => {
  const assets = new Map((project.assets?.items || []).map((asset) => [asset.id, asset]));
  let checked = 0;
  for (const frame of Object.values(storyboard.frames)) {
    assert.ok(frame.references.length > 0, `${frame.id} must have effective references`);
    for (const reference of frame.references) {
      const asset = assets.get(reference.assetId);
      assert.ok(asset, `${reference.id} asset must exist`);
      const version = (asset.versions || []).find((item) => Number(item.v) === Number(reference.assetVersion));
      assert.ok(version, `${reference.id} version must exist`);
      assert.ok([version.file, ...(version.files || [])].includes(reference.sourceAssetFile), `${reference.id} filename must belong to the pinned version`);
      checked += 1;
    }
  }
  assert.equal(checked, 987);
});

test("every authored reference binding targets a real frame or segment", () => {
  let frameBindings = 0;
  let segmentBindings = 0;
  for (const binding of Object.values(storyboard.referenceBindings)) {
    if (binding.targetKind === "frame") {
      assert.ok(Object.hasOwn(storyboard.frames, binding.targetId), `${binding.id} frame target must exist`);
      frameBindings += 1;
    } else if (binding.targetKind === "segment") {
      assert.ok(Object.hasOwn(storyboard.segments, binding.targetId), `${binding.id} segment target must exist`);
      assert.equal(binding.authoredTargetKind, "frame");
      assert.match(binding.authoredTargetId, /^frame-segment-/);
      segmentBindings += 1;
    } else {
      assert.fail(`${binding.id} has unsupported target kind ${binding.targetKind}`);
    }
  }
  assert.equal(frameBindings, 725);
  assert.equal(segmentBindings, 9);
});

test("reference replacement is target-scoped, exact-version pinned, and de-duplicated", () => {
  const targetId = "frame-h01-s01-c01-first";
  const originalTargetCount = storyboard.frames[targetId].references.length;
  const authored = storyboard.frames[targetId].references.find((reference) => reference.assetId === "loc-inner-chamber-dark");
  assert.ok(authored, "fixture must contain the authored historical chamber reference");
  const otherTargetId = "frame-h01-s01-c02-first";
  const otherTargetBefore = structuredClone(storyboard.frames[otherTargetId].references);
  const result = replaceStoryboardTargetReferences(storyboard, project, {
    targetKind: "frame",
    targetId,
    references: [
      {
        id: authored.id,
        assetId: authored.assetId,
        assetVersion: authored.assetVersion,
        role: authored.role,
        cropRegion: authored.cropRegion,
        notes: authored.notes,
        pinnedActiveAtImport: authored.pinnedActiveAtImport
      },
      { assetId: "loc-inner-chamber-dark", assetVersion: 2, role: "style" },
      { assetId: "character-jesus-the-harrower-primary-appearance", assetVersion: 4, role: "identity" }
    ]
  });
  assert.equal(storyboard.frames[targetId].references.length, originalTargetCount, "input storyboard must not be mutated");
  assert.equal(result.references.length, 2, "duplicate asset IDs are collapsed deterministically");
  assert.equal(result.references[0].sourceAssetFile, "loc-chamber-dark.v1.png");
  assert.equal(result.references[0].assetVersionId, "loc-inner-chamber-dark:v1");
  assert.equal(result.references[0].id, authored.id, "unchanged authored binding ID must survive Apply");
  assert.equal(result.references[0].cropRegion, authored.cropRegion);
  assert.equal(result.references[0].notes, authored.notes);
  assert.equal(result.references[0].pinnedActiveAtImport, authored.pinnedActiveAtImport);
  assert.equal(result.storyboard.referenceBindings[authored.id].order, storyboard.referenceBindings[authored.id].order, "authored binding order must survive Apply");
  assert.equal(result.storyboard.frames[targetId].references.length, 2);
  assert.deepEqual(result.storyboard.frames[otherTargetId].references, otherTargetBefore, "unrelated frame references must be preserved");
});

test("reference replacement rejects unknown storyboard targets", () => {
  assert.throws(() => replaceStoryboardTargetReferences(storyboard, project, {
    targetKind: "frame",
    targetId: "missing-frame",
    references: []
  }), /target not found/);
});

test("reference replacement rejects prototype-chain target IDs", () => {
  assert.throws(() => replaceStoryboardTargetReferences(storyboard, project, {
    targetKind: "frame",
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

test("storyboard image guide compiler patches the attached Krea workflow deterministically", { skip: !fs.existsSync(attachedKreaWorkflow) && "Attached Krea workflow is not installed in the local BlokeyUI profile" }, () => {
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

test("all 161 image-guide prompts compile through the attached Krea workflow", { skip: !fs.existsSync(attachedKreaWorkflow) && "Attached Krea workflow is not installed in the local BlokeyUI profile" }, () => {
  const frameIds = Object.keys(storyboard.frames).sort();
  assert.equal(frameIds.length, 161);
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
