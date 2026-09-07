import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { audioEngineStatuses, voiceEngineFromSelection, voiceRuntimeBlock } from "./audio-runtime.ts";

describe("Wave 6 audio runtime honesty", () => {
  it("prefers Qwen3-TTS and fail-closes every voice/score engine", () => {
    assert.equal(voiceEngineFromSelection("qwen3-tts"), "qwen3-tts");
    assert.equal(voiceEngineFromSelection("voxcpm"), "voxcpm2");
    assert.match(voiceRuntimeBlock("qwen3-tts"), /fail-closed/);
    const statuses = audioEngineStatuses();
    assert.equal(statuses.length, 3);
    assert.equal(statuses.every((item) => item.status === "fail-closed"), true);
    assert.equal(statuses.some((item) => /8188|elevenlabs|openai audio/i.test(item.detail)), true);
  });
});
