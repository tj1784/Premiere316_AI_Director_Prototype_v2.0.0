import test from "node:test";
import assert from "node:assert/strict";
import { parseNativeStillProgress, requiredFreeGpuMemoryBytes, verifiedTextEncoding } from "./local-still.server.ts";

test("only known, bounded FLUX.2 phase lines become live progress", () => {
  const prefix = "[FLUX.2 2026-09-08 22:10:00] ";
  for (const message of ["Loading the Mistral text encoder into CPU/system RAM.", "Loading FLUX.2 transformer weights into GPU VRAM.", "Encoding the complete 8500-character prompt on CPU; no truncation.", "Encoding 1 attached reference image(s) for conditioning.", "Sampling the image on GPU: 50 denoising steps, guidance 4.0.", "Image saved. Total generation time: 123.5 seconds."]) {
    assert.equal(parseNativeStillProgress(prefix + message), message);
  }
  for (const line of ["Traceback: private path", prefix + "arbitrary stderr", prefix + "x".repeat(1000), prefix + "Loading the Mistral text encoder into CPU/system RAM.\nsecret", "[other] Loading the Mistral text encoder into CPU/system RAM."]) assert.equal(parseNativeStillProgress(line), null);
});

test("cold model requires its weights while a confirmed loaded model requires only working reserve", () => {
  const gib = 1024 ** 3;
  assert.equal(requiredFreeGpuMemoryBytes(60 * gib, false), 62 * gib);
  assert.equal(requiredFreeGpuMemoryBytes(60 * gib, true), 2 * gib);
  const freeWithResidentModel = 8 * gib;
  assert.ok(requiredFreeGpuMemoryBytes(60 * gib, true) < freeWithResidentModel);
  assert.ok(requiredFreeGpuMemoryBytes(60 * gib, false) > freeWithResidentModel);
});

test("forwards KREA batch encoding and actual sampling steps while keeping tracebacks private", () => {
  for (const message of ["Loading Qwen3-VL-4B text encoder into GPU VRAM.", "Encoding prompt 2/15 on GPU; no truncation.", "Prompt 2/15 encoded in 1.7 seconds.", "Text encoder unload confirmed. All saved prompt encodings are ready.", "Sampling KREA.2 RAW at 1024x1024: 52 steps, CFG 3.5.", "Sampling step 17/52 completed."]) assert.equal(parseNativeStillProgress(`[KREA.2 2026-09-08 18:40:00] ${message}`), message);
  assert.equal(parseNativeStillProgress("[KREA.2 2026-09-08 18:40:00] Traceback private-path"), null);
});

test("persists only bounded actual CUDA cache proof and rejects a missing or CPU proof", () => {
  const proof = { device: "cuda", cached: true, cacheKey: "a".repeat(64), cacheSha256: "b".repeat(64), contextLength: 1462, encodeMs: 1500, privatePath: "not-for-renderer" };
  const actual = verifiedTextEncoding(proof);
  assert.equal(actual.contextLength, 1462);
  assert.equal("privatePath" in actual, false);
  for (const invalid of [null, { ...proof, device: "cpu" }, { ...proof, cached: false }, { ...proof, cacheSha256: "unverified" }, { ...proof, contextLength: 0 }, { ...proof, encodeMs: NaN }]) assert.throws(() => verifiedTextEncoding(invalid), /proof/);
});
