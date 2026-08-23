import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { dbToLinear } from "../client/src/preview-gain.js";
import {
  announceLoadedAllowed,
  createWorkflowPickerState,
  mergeWorkflowSources,
  nextRequestId
} from "../shared/comfy-workflow-state.js";
import {
  classifyMediaName,
  preflightDroppedFile,
  summarizeImportJob,
  VIDEO_EXTENSIONS
} from "../shared/media-types.js";
import { DEFAULT_TAKE_FILTER, filterTakes, normalizeTakeFilter } from "../shared/take-filters.js";
import { listWorkflows, readWorkflowGraph } from "../server/aaa-workflow.js";

test("take filter defaults to Active and latest is one take per selected segment", () => {
  assert.equal(DEFAULT_TAKE_FILTER, "active");
  assert.equal(normalizeTakeFilter("nope"), "active");
  const items = [
    { id: "a1", segmentId: "seg-a", isActiveTake: true, takeNumber: 1, editorialIndex: 1, name: "A1" },
    { id: "a3", segmentId: "seg-a", isActiveTake: false, isLatestTake: true, takeNumber: 3, editorialIndex: 1, name: "A3" },
    { id: "b2", segmentId: "seg-b", isActiveTake: true, isLatestTake: true, takeNumber: 2, editorialIndex: 2, name: "B2" },
    { id: "loose", segmentId: "", isActiveTake: false, takeNumber: 9, name: "Loose" }
  ];
  assert.deepEqual(filterTakes(items, { takeFilter: "active" }).map((item) => item.id), ["a1", "b2"]);
  assert.deepEqual(filterTakes(items, { takeFilter: "latest", selectedSegmentId: "seg-a" }).map((item) => item.id), ["a3"]);
  assert.deepEqual(filterTakes(items, { takeFilter: "all", selectedSegmentId: "seg-a" }).map((item) => item.id), ["a3", "a1"]);
  assert.ok(!filterTakes(items, { takeFilter: "latest", selectedSegmentId: "seg-a" }).some((item) => item.id === "loose"));
});

test("every advertised drop extension has a deterministic classification", () => {
  assert.equal(classifyMediaName("clip.mp4"), "video");
  assert.equal(classifyMediaName("clip.avi"), "video");
  assert.equal(classifyMediaName("tone.wav"), "audio");
  assert.equal(classifyMediaName("still.png"), "image");
  assert.equal(classifyMediaName("notes.txt"), "unsupported");
  assert.ok(VIDEO_EXTENSIONS.includes(".avi"));
  const image = preflightDroppedFile({ name: "ref.png", size: 2048 });
  assert.equal(image.status, "unsupported");
  assert.match(image.reason, /not imported into the sequence bin/i);
  const huge = preflightDroppedFile({ name: "big.mp4", size: 900 * 1024 * 1024 });
  assert.equal(huge.status, "oversized");
});

test("mixed import tallies add up exactly", () => {
  const results = [
    { status: "imported" },
    { status: "imported" },
    { status: "unsupported" },
    { status: "oversized" },
    { status: "failed" },
    { status: "duplicate" }
  ];
  const summary = summarizeImportJob(results);
  assert.equal(summary.scanned, 6);
  assert.equal(summary.imported, 2);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.failed, 3);
  assert.equal(summary.accounted, 6);
  assert.equal(summary.balanced, true);
});

test("preview gain is not clamped at unity", () => {
  assert.ok(Math.abs(dbToLinear(0) - 1) < 1e-9);
  assert.ok(Math.abs(dbToLinear(12) - 3.98107170553) < 1e-6);
  assert.ok(dbToLinear(12) > 1);
  assert.ok(Math.abs(dbToLinear(-6) - 0.50118723362) < 1e-6);
});

test("Comfy picker does not announce a load without a matching ACK", () => {
  const state = { ...createWorkflowPickerState(), loadingKey: "lib:a.json", requestId: 2 };
  assert.equal(announceLoadedAllowed(state, { ok: true, workflowKey: "lib:b.json" }), false);
  assert.equal(announceLoadedAllowed(state, { ok: true, workflowKey: "lib:a.json" }), true);
  assert.equal(nextRequestId(state), 3);
  const merged = mergeWorkflowSources([
    { source: "catalog", error: "HTTP 500", status: 500, items: [] },
    { source: "package", items: [{ key: "pkg:one", label: "One" }] }
  ]);
  assert.equal(merged.listStatus, "partial");
  assert.equal(merged.items.length, 1);
});

test("packaged workflow inventory is present without the local BlokeyUI library", () => {
  const library = listWorkflows();
  assert.ok(library.items.some((item) => item.source === "package"));
  assert.ok(library.items.some((item) => item.rel === "ltx-director-i2v.ui.json"));
  const graph = readWorkflowGraph({ id: "ltx-director-i2v" });
  assert.equal(graph.source, "package");
  assert.ok(graph.hash);
  assert.ok(graph.graph);
});

test("ambiguous packaged workflow ids fail closed", () => {
  assert.throws(() => readWorkflowGraph({ id: "storyboard" }), /Ambiguous workflow/i);
});

test("Comfy workspace keeps selected, loading, and loaded state distinct", () => {
  const source = fs.readFileSync(new URL("../client/src/components/ComfyUIWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /selectedKey/);
  assert.match(source, /loadingKey/);
  assert.match(source, /loadedKey/);
  assert.match(source, /comfy-workflow-state/);
  assert.match(source, /Not loaded/);
  assert.match(source, /Reload selected/);
  assert.match(source, /requestId !== pickerRef.current.requestId/);
});
