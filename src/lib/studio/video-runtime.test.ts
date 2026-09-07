import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { inspectVideoAdapter } from "./video-runtime.server.ts";
import { videoRuntimeBlock } from "./video-runtime.ts";

describe("Wave 5 video runtime honesty", () => {
  it("fail-closes MiniMax H3 and LTX 2.5 instead of claiming Comfy or stills as video", () => {
    const h3 = inspectVideoAdapter("minimax-h3");
    const ltx = inspectVideoAdapter("ltx-2");
    assert.equal(h3.status, "ADAPTER_UNAVAILABLE");
    assert.equal(ltx.status, "ADAPTER_UNAVAILABLE");
    assert.equal(h3.officialRuntime, false);
    assert.match(h3.disabledReason, /fail-closed/i);
    assert.match(ltx.disabledReason, /non-Comfy|fail-closed/i);
    assert.doesNotMatch(h3.disabledReason, /8188 is ready/i);
    assert.match(videoRuntimeBlock("ltx-2"), /LTX 2.5/);
    assert.equal(existsSync("desktop/workers/minimax_h3_jsonl_worker.py"), true);
    assert.equal(existsSync("desktop/workers/ltx25_jsonl_worker.py"), true);
  });
});
