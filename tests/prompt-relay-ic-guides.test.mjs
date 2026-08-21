import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = path.join(root, "BlokeyUI", "python_embeded", "python.exe");
const relayModule = path.join(
  root,
  "BlokeyUI",
  "ComfyUI",
  "custom_nodes",
  "WhatDreamsCost-ComfyUI",
  "prompt_relay.py"
);

test("Prompt Relay leaves appended Ingredients guide-query rows globally conditioned", (t) => {
  if (!fs.existsSync(python) || !fs.existsSync(relayModule)) {
    t.skip("BlokeyUI embedded Python or Prompt Relay module is unavailable");
    return;
  }
  const script = String.raw`
import importlib.util
import sys
import torch

spec = importlib.util.spec_from_file_location("premiere316_prompt_relay_test", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

segments = [{
    "local_token_idx": torch.arange(2, 4),
    "midpoint": 1,
    "window": 0,
    "sigma": 0.1,
    "strength": 1.0,
}]
for extra_options in (
    {"grid_sizes": [3, 1, 2], "cond_or_uncond": [0], "promptrelay_attn_type": "attn2"},
    {"cond_or_uncond": [0], "promptrelay_attn_type": "attn2"},
):
    mask_fn = module.create_mask_fn(segments, 2, 3)
    mask = mask_fn(
        8,
        10,
        torch.float32,
        torch.device("cpu"),
        extra_options,
    )
    assert tuple(mask.shape) == (8, 10)
    assert torch.count_nonzero(mask[:6]).item() > 0
    assert torch.count_nonzero(mask[6:]).item() == 0
print("ok")
`;
  const result = spawnSync(python, ["-c", script, relayModule], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /ok/);
});
