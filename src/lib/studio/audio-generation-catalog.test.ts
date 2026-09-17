import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUDIO_GENERATION_OPTIONS, TTS_AUDIO_SUITE_URL, audioGenerationOption } from "./audio-generation-catalog.ts";

describe("audio generation catalog", () => {
  it("keeps songs, sound, and speech distinct and uses one shared TTS pack", () => {
    assert.deepEqual(AUDIO_GENERATION_OPTIONS.filter((option) => option.group === "songs").map((option) => option.id), ["minimax-music3", "yue2", "ace-step-1.5"]);
    assert.equal(audioGenerationOption("stable-audio-3")?.group, "sound");
    for (const id of ["qwen3-tts", "qwen3-tts-base", "index-tts"]) {
      assert.equal(audioGenerationOption(id)?.setupUrl, TTS_AUDIO_SUITE_URL);
      assert.equal(audioGenerationOption(id)?.slot, "voice");
    }
    assert.notEqual(audioGenerationOption("voxcpm2")?.setupUrl, TTS_AUDIO_SUITE_URL);
  });

  it("keeps YuE2's non-commercial condition visible and includes the Medium reprompt dependency", () => {
    assert.match(audioGenerationOption("yue2")!.license.label, /non-commercial/);
    assert.match(audioGenerationOption("yue2")!.license.detail, /paid LMS/);
    assert.ok(audioGenerationOption("stable-audio-3")!.files.includes("models/text_encoders/qwen3.5_2b_bf16.safetensors"));
    assert.match(audioGenerationOption("minimax-music3")!.license.detail, /display MiniMax-Music3/);
  });
});
