import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compileHellPromptOnly,
  directorSegmentOutputPrefix,
  hellPromptFromWorkspace,
  stageHellSegmentImage,
  stageHellSegmentImages
} from "../server/hell-comfy-push.js";

test("H01 segment jobs retain their approved project media binding", () => {
  const jobs = hellPromptFromWorkspace({ mode: "segments" }, {
    premiere: { projectSlug: "harrowing_of_hell", clipId: "H01-S02-C01" },
    settings: { frameRate: 24, negativePrompt: "authoritative ZIP negative" },
    timeline: {
      global_prompt: "global",
      segments: [{
        id: "segment-h01-s02-c01-01",
        prompt: "local",
        length: 120,
        imageFile: "Premiere316/harrowing_of_hell/storyboard/H01-S02-C01_first.png",
        projectMediaPath: "media/storyboard/H01-S02-C01_first.v2.h01-i2v-v2.png"
      }]
    }
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].projectSlug, "harrowing_of_hell");
  assert.equal(jobs[0].clipId, "H01-S02-C01");
  assert.equal(jobs[0].segmentNumber, 1);
  assert.equal(jobs[0].negativePrompt, "authoritative ZIP negative");
  assert.equal(jobs[0].projectMediaPath, "media/storyboard/H01-S02-C01_first.v2.h01-i2v-v2.png");
  assert.equal(jobs[0].imageFile, "Premiere316/harrowing_of_hell/storyboard/H01-S02-C01_first.png");
});

test("segment dialogue direction is appended only to its assigned H03+ job", () => {
  const jobs = hellPromptFromWorkspace({ mode: "segments" }, {
    premiere: { projectSlug: "harrowing_of_hell", clipId: "H03-S06-C03" },
    settings: { frameRate: 24 },
    timeline: {
      global_prompt: "AUDIO / DIALOGUE CONTRACT\nOnly quoted segment dialogue may be spoken.",
      segments: [
        { id: "seg01", prompt: "opening motion", length: 144 },
        { id: "seg02", prompt: "middle motion", length: 120, dialogueDirection: "Jesus said, \"Adam.\"" },
        { id: "seg03", prompt: "closing motion", length: 144, dialogueDirection: "Then Adam replied, \"I remember Your voice.\"" }
      ]
    }
  });

  assert.equal(jobs.length, 3);
  assert.doesNotMatch(jobs[0].text, /SEGMENT DIALOGUE DIRECTION/);
  assert.match(jobs[1].text, /middle motion\n\nSEGMENT DIALOGUE DIRECTION\nJesus said, "Adam\."$/);
  assert.match(jobs[2].text, /closing motion\n\nSEGMENT DIALOGUE DIRECTION\nThen Adam replied, "I remember Your voice\."$/);
  assert.equal((jobs.map((job) => job.text).join("\n").match(/Jesus said, "Adam\."/g) || []).length, 1);
  assert.equal((jobs.map((job) => job.text).join("\n").match(/Then Adam replied/g) || []).length, 1);
});

test("Director output prefixes route each render back to its Premiere segment", async () => {
  const filenamePrefix = directorSegmentOutputPrefix({
    projectSlug: "harrowing_of_hell",
    clipId: "H02-S03-C01",
    segmentNumber: 2
  });
  const built = await compileHellPromptOnly("segment prompt", {
    imageFile: "H02-S03-C01_seg02.png",
    seconds: 6,
    negativePrompt: "ZIP shared negative",
    filenamePrefix
  });

  assert.equal(filenamePrefix, "Premiere316/harrowing_of_hell/director/H02-S03-C01/segment_02_");
  assert.equal(built.prompt["75"].inputs.filename_prefix, filenamePrefix);
  assert.equal(built.prompt["398:373"].inputs.text, "ZIP shared negative");
  assert.equal(built.nodes.output, "75");
  assert.equal(built.nodes.negative, "398:373");
});

test("approved versioned first frames are staged under the workflow LoadImage basename", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-hell-stage-"));
  try {
    const source = path.join(tempRoot, "projects", "harrowing_of_hell", "media", "storyboard", "H01-S02-C01_first.v2.png");
    const inputRoot = path.join(tempRoot, "comfy-input");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, "approved-frame-v2");

    const staged = stageHellSegmentImage({
      segment: { id: "segment-h01-s02-c01-01" },
      projectSlug: "harrowing_of_hell",
      projectMediaPath: "media/storyboard/H01-S02-C01_first.v2.png",
      projectMediaBytes: Buffer.byteLength("approved-frame-v2"),
      projectMediaSha256: crypto.createHash("sha256").update("approved-frame-v2").digest("hex"),
      imageFile: "Premiere316/harrowing_of_hell/storyboard/H01-S02-C01_first.png"
    }, { packageRoot: tempRoot, inputRoot });

    assert.equal(staged.imageName, "H01-S02-C01_first.png");
    assert.equal(fs.readFileSync(staged.destination, "utf8"), "approved-frame-v2");
    assert.deepEqual(stageHellSegmentImages([{
      segment: { id: "segment-h01-s02-c01-01" },
      projectSlug: "harrowing_of_hell",
      projectMediaPath: "media/storyboard/H01-S02-C01_first.v2.png",
      imageFile: "H01-S02-C01_first.png"
    }], { packageRoot: tempRoot, inputRoot }).map((item) => item.imageName), ["H01-S02-C01_first.png"]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("staging falls back to verified project media when imageFile is blank", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-hell-stage-"));
  try {
    const source = path.join(tempRoot, "projects", "harrowing_of_hell", "media", "storyboard", "canonical_start_frames", "H02-S04-C02_CANONICAL_START.png");
    const inputRoot = path.join(tempRoot, "comfy-input");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, "canonical-start");

    const staged = stageHellSegmentImage({
      segment: { id: "segment-h02-s04-c02-seg02" },
      projectSlug: "harrowing_of_hell",
      projectMediaPath: "media/storyboard/canonical_start_frames/H02-S04-C02_CANONICAL_START.png",
      projectMediaBytes: Buffer.byteLength("canonical-start"),
      projectMediaSha256: crypto.createHash("sha256").update("canonical-start").digest("hex"),
      imageFile: ""
    }, { packageRoot: tempRoot, inputRoot });

    assert.equal(staged.imageName, "H02-S04-C02_CANONICAL_START.png");
    assert.equal(fs.readFileSync(staged.destination, "utf8"), "canonical-start");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("staging rejects project-media traversal", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-hell-stage-"));
  try {
    assert.throws(() => stageHellSegmentImage({
      segment: { id: "segment-h01-s02-c01-01" },
      projectSlug: "harrowing_of_hell",
      projectMediaPath: "../outside.png",
      imageFile: "H01-S02-C01_first.png"
    }, { packageRoot: tempRoot, inputRoot: path.join(tempRoot, "comfy-input") }), /escapes its allowed root/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("staging rejects a changed approved first-frame source", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-hell-stage-"));
  try {
    const source = path.join(tempRoot, "projects", "harrowing_of_hell", "media", "storyboard", "H02-S03-C01_first.png");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, "changed-frame");
    assert.throws(() => stageHellSegmentImage({
      segment: { id: "segment-h02-s03-c01-01" },
      projectSlug: "harrowing_of_hell",
      projectMediaPath: "media/storyboard/H02-S03-C01_first.png",
      projectMediaBytes: Buffer.byteLength("changed-frame"),
      projectMediaSha256: "0".repeat(64),
      imageFile: "H02-S03-C01_first.png"
    }, { packageRoot: tempRoot, inputRoot: path.join(tempRoot, "comfy-input") }), /source hash changed/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("the shared C01 workflow keeps each remaining segment's authored duration", async () => {
  const built = await compileHellPromptOnly("segment prompt", {
    imageFile: "H01-S01-C02_seg02.png",
    seconds: 4
  });

  assert.equal(built.nodeCount, 50);
  assert.equal(built.prompt["395"].inputs.image, "H01-S01-C02_seg02.png");
  assert.equal(built.prompt["398:362"].inputs.value, 4);
  assert.equal(built.seconds, 4);
});
