import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureDirectoryMiddleware } from "./upload-dir.mjs";

test("recreates a removed multer destination immediately before an upload", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "p316-upload-parent-"));
  const uploadDir = path.join(parent, "removed-after-startup");
  const middleware = ensureDirectoryMiddleware(uploadDir);
  let nextValue = "not-called";
  middleware({}, {}, (error) => { nextValue = error || null; });
  try {
    assert.equal(nextValue, null);
    assert.equal(fs.statSync(uploadDir).isDirectory(), true);
    fs.rmSync(uploadDir, { recursive: true, force: true });
    middleware({}, {}, (error) => { nextValue = error || null; });
    assert.equal(nextValue, null);
    assert.equal(fs.statSync(uploadDir).isDirectory(), true);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
