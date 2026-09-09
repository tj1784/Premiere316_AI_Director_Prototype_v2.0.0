import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { requiredFreeGpuMemoryBytes } from "./local-still.server.ts";

const source = readFileSync(new URL("./local-still.server.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../../../desktop/workers/flux1_jsonl_worker.py", import.meta.url), "utf8");
const flux2Worker = readFileSync(new URL("../../../desktop/workers/flux2_jsonl_worker.py", import.meta.url), "utf8");
const backend = readFileSync(new URL("../../../desktop/backend.mjs", import.meta.url), "utf8");
const contract = readFileSync(new URL("./native-still-contract.ts", import.meta.url), "utf8");
const waveStatus = readFileSync(new URL("../../../docs/orchestration/wave-status.json", import.meta.url), "utf8");

describe("native still runtime policy", () => {
  it("keeps orchestration wave status valid JSON", () => {
    assert.equal(JSON.parse(waveStatus).schemaVersion, 1);
  });
  it("forces offline isolated app-profile roots before any Python launch", () => {
    assert.match(source, /HF_HUB_OFFLINE: "1"/);
    assert.match(source, /TRANSFORMERS_OFFLINE: "1"/);
    assert.match(source, /P316_OUTPUT_ROOT/);
    assert.match(source, /P316_CACHE_ROOT/);
    assert.match(source, /P316_PACKAGED_APP !== "1"/);
    assert.doesNotMatch(source, /D:\\_Temp\\Premiere316\\stills-out/);
    assert.match(source, /FLUX2_ROOT/);
    assert.doesNotMatch(source, /BLOKEY\.env|blokey-studio/);
  });

  it("binds FLUX.1 to standalone encoder files and exact approved identities", () => {
    for (const expected of [
      "t5xxl_fp16.safetensors@6e480b09fae049a72d2a8c5fbccb8d3e92febeb233bbe9dfe7256958a9167635",
      "clip_l.safetensors@660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd",
      "open_clip:bpe_simple_vocab_16e6@924691ac288e54409236115652ad4aa250f48203de50a9e4722a6ecd48d6804a",
      "black-forest-labs/flux@802fb4713906133fcbd0d8dc5351620ca4773036",
    ]) assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(source, /FLUX_MODEL: EXACT_COMPONENTS\.flux\.path/);
    assert.match(source, /FLUX_AE: EXACT_COMPONENTS\.ae\.path/);
    assert.match(worker, /_assert_official_flux_env_bindings\(\)/);
    assert.match(worker, /\("FLUX_MODEL", "P316_MODEL_FLUX"\)/);
    assert.match(worker, /\("FLUX_AE", "P316_MODEL_AE"\)/);
    assert.match(worker, /all\(key\.startswith\("text_model\."\) for key in clip_state\)/);
    assert.match(worker, /key\.removeprefix\("text_model\."\)/);
    assert.match(worker, /_strict_load_state\(clip, normalized_clip_state, 196, "CLIP-L"\)/);
    assert.match(worker, /flow = Flux\(flux_params\)\.eval\(\)\.to\(dtype=dtype\)/);
    assert.match(worker, /ae = AutoEncoder\(ae_params\)\.eval\(\)/);
    assert.doesNotMatch(source, /openai\/clip-vit-large-patch14/);
    assert.doesNotMatch(source, /localCacheComponent/);
    assert.match(source, /renameSync\(pendingPath, finalPath\)/);
    assert.match(source, /cleanupPendingOutput\(pendingPath\)/);
  });

  it("keeps JSONL worker methods strict and free of download/Comfy markers", () => {
    assert.equal(existsSync(join(process.cwd(), "desktop", "workers", "flux1_jsonl_worker.py")), true);
    assert.equal(existsSync(join(process.cwd(), "desktop", "workers", "flux2_jsonl_worker.py")), true);
    assert.match(worker, /PROTOCOL_VERSION = "premiere316\.flux1-jsonl\.v1"/);
    assert.match(flux2Worker, /PROTOCOL_VERSION = "premiere316\.flux2-jsonl\.v1"/);
    assert.match(worker, /method == "ping"/);
    assert.match(worker, /method == "generate"/);
    assert.match(worker, /method == "release"/);
    assert.match(worker, /Unsupported FLUX\.1 JSONL keys/);
    assert.match(flux2Worker, /Unsupported FLUX\.2 JSONL keys/);
    assert.match(worker, /failed_id = json\.loads\(line\)\.get\("id"\)/);
    assert.match(flux2Worker, /local_files_only=True/);
    assert.doesNotMatch(contract, /engineId: string;\n  engineName: string;\n  out: string;\n  width:[\s\S]*refs: string\[\]/);
    assert.doesNotMatch(worker, /from_pretrained|hf_hub_download|snapshot_download|8188|ComfyUI|Flux2/i);
    assert.doesNotMatch(flux2Worker, /hf_hub_download|snapshot_download|8188|ComfyUI|BLOKEY|OpenRouterAPIClient/i);
  });

  it("derives privileged prompt authorization from sealed backend authority, not renderer parameters", () => {
    assert.match(backend, /function preparedPrompt\(prepared, asset\)/);
    assert.match(backend, /promptIngredients/);
    assert.match(backend, /prompt: prepared\.prompt/);
    assert.match(backend, /requireCurrentAuthority\(params\?\.authorityId\)/);
    assert.match(backend, /requireAuthorityPrepared\(authority, preparedAssetId/);
    assert.doesNotMatch(backend, /const prompt = String\(params\.prompt/);
    assert.doesNotMatch(backend, /params\.prompt[\s\S]{0,120}approved/);
  });

  it("fails closed when audited CUDA weight files exceed installed GPU memory", () => {
    assert.match(source, /requirePlausibleGpuMemory\(identity,/);
    assert.match(source, /cudaRoles.includes\(component.role\)/);
    assert.equal(requiredFreeGpuMemoryBytes(26_283_332_608, false), 26_283_332_608 + 2 * 1024 ** 3);
    assert.equal(requiredFreeGpuMemoryBytes(26_283_332_608, true), 2 * 1024 ** 3);
    assert.match(source, /--query-gpu=memory\.total/);
  });
});
