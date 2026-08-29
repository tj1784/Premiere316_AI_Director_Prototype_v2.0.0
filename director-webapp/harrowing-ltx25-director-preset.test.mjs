import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  HARROWING_AAA_I2V_GENERATE_OPTION,
  HARROWING_AAA_I2V_WORKFLOW,
  HARROWING_LTX25_DIRECTOR_GENERATE_OPTION,
  HARROWING_LTX25_DIRECTOR_WORKFLOW,
  LTX25_MUSIC_VIDEO_24GB_60S_WORKFLOW,
  LTX25_PREMIERE316_SEGMENTED_I2V_WORKFLOW,
  PREMIERE_GENERATE_OPTIONS,
  isHarrowingLtx25DirectorGenerate
} from "./premiere-api-delegation.mjs";
import {
  directorWorkflowFileForWorkspace,
  HARROWING_AAA_I2V_PACKAGE_FILE,
  HARROWING_LTX25_DIRECTOR_PACKAGE_FILE,
  LTX25_MUSIC_VIDEO_24GB_60S_PACKAGE_FILE,
  LTX25_PREMIERE316_SEGMENTED_I2V_PACKAGE_FILE,
  loadDirectorWorkflowSource,
  workflowFileWithLocalCompatibility
} from "./director-workflow-source.mjs";

test("every code-referenced Director workflow has a clean-clone package source", () => {
  const genericOption = PREMIERE_GENERATE_OPTIONS.find((option) => option.id === "ltx25_premiere316_i2v");
  const contracts = [
    [HARROWING_AAA_I2V_WORKFLOW, HARROWING_AAA_I2V_PACKAGE_FILE, HARROWING_AAA_I2V_GENERATE_OPTION],
    [HARROWING_LTX25_DIRECTOR_WORKFLOW, HARROWING_LTX25_DIRECTOR_PACKAGE_FILE, HARROWING_LTX25_DIRECTOR_GENERATE_OPTION],
    [LTX25_PREMIERE316_SEGMENTED_I2V_WORKFLOW, LTX25_PREMIERE316_SEGMENTED_I2V_PACKAGE_FILE, genericOption],
    [LTX25_MUSIC_VIDEO_24GB_60S_WORKFLOW, LTX25_MUSIC_VIDEO_24GB_60S_PACKAGE_FILE, null]
  ];

  for (const [relative, file, option] of contracts) {
    assert.equal(path.relative(path.resolve(import.meta.dirname, ".."), file).replaceAll("\\", "/"), relative);
    assert.equal(fs.existsSync(file), true, `Packaged workflow missing: ${file}`);
    const graph = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.ok(Array.isArray(graph.nodes));
    assert.ok(Array.isArray(graph.links));
    if (option) {
      assert.equal(option.directorWorkflow, relative);
      assert.equal(option.catalogWorkflow, relative);
    }
  }

  const missingLocal = path.join(import.meta.dirname, "definitely-missing-local-workflow.json");
  assert.equal(
    workflowFileWithLocalCompatibility({ localFile: missingLocal, packageFile: HARROWING_AAA_I2V_PACKAGE_FILE }),
    HARROWING_AAA_I2V_PACKAGE_FILE
  );
});

test("Harrowing LTX2.5 Director option loads its exact packaged graph", () => {
  assert.equal(
    HARROWING_LTX25_DIRECTOR_WORKFLOW,
    "workflows/director-presets/harrowing-of-hell-ltx25-director.ui.json"
  );
  assert.equal(
    HARROWING_LTX25_DIRECTOR_GENERATE_OPTION.directorWorkflow,
    HARROWING_LTX25_DIRECTOR_WORKFLOW
  );
  assert.equal(
    HARROWING_LTX25_DIRECTOR_GENERATE_OPTION.catalogWorkflow,
    HARROWING_LTX25_DIRECTOR_WORKFLOW
  );

  const workspace = {
    premiere: { generateOptionId: HARROWING_LTX25_DIRECTOR_GENERATE_OPTION.id }
  };
  const defaultGraph = { nodes: [{ id: "generic-default" }], links: [] };
  assert.equal(isHarrowingLtx25DirectorGenerate(workspace), true);
  assert.equal(
    directorWorkflowFileForWorkspace(workspace, "generic-default.json"),
    HARROWING_LTX25_DIRECTOR_PACKAGE_FILE
  );

  const loaded = loadDirectorWorkflowSource(workspace, {
    defaultFile: "generic-default.json",
    defaultGraph,
    defaultText: JSON.stringify(defaultGraph)
  });
  const onDisk = fs.readFileSync(HARROWING_LTX25_DIRECTOR_PACKAGE_FILE);
  assert.equal(loaded.optionId, HARROWING_LTX25_DIRECTOR_GENERATE_OPTION.id);
  assert.equal(loaded.source, "generate-option");
  assert.equal(path.normalize(loaded.file), path.normalize(HARROWING_LTX25_DIRECTOR_PACKAGE_FILE));
  assert.notStrictEqual(loaded.graph, defaultGraph);
  assert.ok(loaded.graph.nodes.some((node) => node.type === "LTXDirector"));
  assert.equal(
    loaded.sha256,
    crypto.createHash("sha256").update(onDisk).digest("hex")
  );

  const fallback = loadDirectorWorkflowSource(
    { premiere: { generateOptionId: "ltx25_premiere316_i2v" } },
    {
      defaultFile: "generic-default.json",
      defaultGraph,
      defaultText: JSON.stringify(defaultGraph)
    }
  );
  assert.equal(fallback.source, "default");
  assert.strictEqual(fallback.graph, defaultGraph);
});

test("packaged Harrowing LTX2.5 Director graph has no local execution residue", () => {
  const text = fs.readFileSync(HARROWING_LTX25_DIRECTOR_PACKAGE_FILE, "utf8");
  const graph = JSON.parse(text);

  assert.equal(graph.nodes.length, 30);
  assert.equal(graph.links.length, 56);
  assert.doesNotMatch(text, /myqcloud/i);
  assert.doesNotMatch(text, /\/data\/ComfyUI\/personal/i);
  assert.doesNotMatch(text, /ltxdirector_00001/i);
  assert.doesNotMatch(text, /waveformPeaks/);
  assert.doesNotMatch(text, /\.wav\b/i);
  assert.doesNotMatch(text, /imageB64/);

  const output = graph.nodes.find((node) => node.id === 94);
  assert.equal(output?.type, "VHS_VideoCombine");
  assert.equal(Object.hasOwn(output.widgets_values, "videopreview"), false);
  assert.equal(Object.hasOwn(graph.extra || {}, "anomalous_hashes"), false);

  const director = graph.nodes.find((node) => node.id === 46);
  assert.equal(director?.type, "LTXDirector");
  const propertyTimeline = JSON.parse(director.properties.timeline_data);
  const widgetTimeline = JSON.parse(director.widgets_values[6]);
  assert.deepEqual(widgetTimeline, propertyTimeline);
  assert.deepEqual(propertyTimeline.audioSegments, []);
  assert.equal(propertyTimeline.segments.length, 1);
  assert.equal(propertyTimeline.segments[0].imageFile, "whatdreamscost/harrowing_of_hell.png");
  assert.equal(Object.hasOwn(propertyTimeline.segments[0], "imageB64"), false);

  const modelWidgets = new Map(
    graph.nodes
      .filter((node) => [3, 4, 57, 84, 95].includes(node.id))
      .map((node) => [node.id, node.widgets_values])
  );
  assert.deepEqual(modelWidgets.get(3), [
    "LTX23_video_vae_bf16.safetensors",
    "main_device",
    "bf16"
  ]);
  assert.deepEqual(modelWidgets.get(4), [
    "LTX23_audio_vae_bf16.safetensors",
    "main_device",
    "bf16"
  ]);
  assert.deepEqual(modelWidgets.get(57), [
    "LTX\\2.3\\Director\\ltx-2.3-spatial-upscaler-x2-1.1.safetensors"
  ]);
  assert.deepEqual(modelWidgets.get(84), [
    "gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",
    "ltx-2.3_text_projection_bf16.safetensors",
    "ltxv",
    "default"
  ]);
  assert.deepEqual(modelWidgets.get(95), [
    "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
    "default"
  ]);
});
