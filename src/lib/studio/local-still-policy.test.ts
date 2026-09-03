import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./local-still.server.ts", import.meta.url), "utf8");

describe("native still runtime policy", () => {
  it("forces transformer and hub resolution offline", () => {
    assert.match(source, /HF_HUB_OFFLINE:\s*"1"/);
    assert.match(source, /TRANSFORMERS_OFFLINE:\s*"1"/);
    assert.doesNotMatch(source, /HF_HUB_OFFLINE:\s*"0"/);
    assert.doesNotMatch(source, /TRANSFORMERS_OFFLINE:\s*"0"/);
  });

  it("records actual local cache paths rather than network identifiers", () => {
    assert.match(source, /localCacheComponent/);
    assert.match(source, /snapshots/);
    assert.doesNotMatch(source, /path:\s*[`"]huggingface:\/\//);
    assert.match(source, /path: rendererSafeRuntimePath\(identity\.basePath\)/);
    assert.match(source, /path: rendererSafeRuntimePath\(component\.path\)/);
    assert.match(source, /hf-cache\\\\/);
  });

  it("verifies residency with a post-generation ping", () => {
    assert.match(source, /const after = await callWorker\(\{ method: "ping" \}/);
    assert.match(source, /residentAfterJob = after\.ok === true && after\.loaded === identity\.modelName/);
    assert.doesNotMatch(source, /residentAfterJob = capabilities\.controls\.keepResident\.supported/);
  });

  it("fails closed when audited CUDA weight files exceed installed GPU memory", () => {
    assert.match(source, /requirePlausibleGpuMemory\(identity\)/);
    assert.match(source, /component\.role === "text_encoder" \|\| component\.role === "vae"/);
    assert.match(source, /MEMORY RISK: the native worker places at least/);
    assert.match(source, /--query-gpu=memory\.total/);
  });
});
