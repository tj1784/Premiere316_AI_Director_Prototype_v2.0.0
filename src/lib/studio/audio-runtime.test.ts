import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { audioEngineStatuses, musicEngineFromSelection, musicRuntimeBlock, voiceEngineFromSelection, voiceRuntimeBlock } from "./audio-runtime.ts";
import { AUDIO_GENERATION_OPTIONS } from "./audio-generation-catalog.ts";

describe("audio runtime availability", () => {
  it("prefers Qwen3-TTS and fail-closes every voice/score engine", () => {
    assert.equal(voiceEngineFromSelection("qwen3-tts"), "qwen3-tts");
    assert.equal(voiceEngineFromSelection("voxcpm"), "voxcpm2");
    assert.match(voiceRuntimeBlock("qwen3-tts"), /fail-closed/);
    const statuses = audioEngineStatuses();
    assert.equal(statuses.length, 8);
    assert.equal(statuses.every((item) => item.status === "fail-closed"), true);
    assert.equal(statuses.every((item) => /no verified local worker/.test(item.detail)), true);
  });

  it("preserves every catalog selection and names the selected engine in unavailable messages", () => {
    for (const option of AUDIO_GENERATION_OPTIONS) {
      const engineId = option.slot === "voice" ? voiceEngineFromSelection(option.id) : musicEngineFromSelection(option.id);
      assert.equal(engineId, option.id);
      const reason = option.slot === "voice" ? voiceRuntimeBlock(voiceEngineFromSelection(option.id)) : musicRuntimeBlock(musicEngineFromSelection(option.id));
      assert.ok(reason.includes(option.name));
      assert.match(reason, /no engine is substituted/);
    }
  });
});
