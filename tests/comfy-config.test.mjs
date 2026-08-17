import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  isBundledComfyUrl,
  normalizeComfyUrl,
  readSavedComfyUrl,
  resolveConfiguredComfyUrl,
  saveConfiguredComfyUrl
} from "../server/comfy-config.js";

test("ComfyUI addresses accept an IP with a fixed port and normalize trailing slashes", () => {
  assert.equal(normalizeComfyUrl("127.0.0.1:8188"), "http://127.0.0.1:8188");
  assert.equal(normalizeComfyUrl("http://192.168.1.25:8190/"), "http://192.168.1.25:8190");
  assert.equal(normalizeComfyUrl("localhost"), "http://localhost:8188");
});

test("ComfyUI addresses reject unsupported schemes and embedded credentials", () => {
  assert.throws(() => normalizeComfyUrl("ftp://127.0.0.1:8188"), /http:\/\/ or https:\/\//);
  assert.throws(() => normalizeComfyUrl("http://user:secret@127.0.0.1:8188"), /username or password/);
});

test("bundled engine recognition is consistent across local host forms", () => {
  assert.equal(isBundledComfyUrl("http://127.0.0.1:8190"), true);
  assert.equal(isBundledComfyUrl("http://localhost:8190/"), true);
  assert.equal(isBundledComfyUrl("http://[::1]:8190"), true);
  assert.equal(isBundledComfyUrl("https://127.0.0.1:8190"), false);
  assert.equal(isBundledComfyUrl("http://127.0.0.1:8190/proxy"), false);
  assert.equal(isBundledComfyUrl("http://127.0.0.1:8188"), false);
  assert.equal(isBundledComfyUrl("http://192.168.1.25:8190"), false);
});

test("saved ComfyUI address persists and takes precedence on the next process start", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "premiere316-comfy-config-"));
  const filePath = path.join(directory, "premiere316.local.json");
  const previous = process.env.COMFY_URL;
  try {
    const saved = saveConfiguredComfyUrl("10.20.30.40:8188", filePath);
    assert.equal(saved, "http://10.20.30.40:8188");
    assert.equal(readSavedComfyUrl(filePath), saved);
    assert.equal(resolveConfiguredComfyUrl({ filePath, env: { COMFY_URL: "http://127.0.0.1:8190" } }), saved);
  } finally {
    if (previous === undefined) delete process.env.COMFY_URL;
    else process.env.COMFY_URL = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
