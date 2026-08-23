import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mixQwenEmotions, qwenEmotionalPresetNames } from "../server/qwen-emotional.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("ComfyUI-Qwen-TTS registers the Emotional Voice Clone node", () => {
  const init = fs.readFileSync(path.join(ROOT, "BlokeyUI/ComfyUI/custom_nodes/ComfyUI-Qwen-TTS/__init__.py"), "utf8");
  const node = fs.readFileSync(path.join(ROOT, "BlokeyUI/ComfyUI/custom_nodes/ComfyUI-Qwen-TTS/qwen3_emotional_clone.py"), "utf8");
  assert.match(init, /qwen3_emotional_clone/);
  assert.match(init, /EMOTIONAL_MAPPINGS/);
  assert.match(node, /FB_Qwen3TTSEmotionalVoiceClone/);
  assert.match(node, /primary_emotion/);
  assert.match(node, /secondary_emotion/);
  assert.match(node, /emotion_intensity/);
});

test("Qwen emotional mix matches Dawizzer sampling math", () => {
  const names = qwenEmotionalPresetNames();
  assert.ok(names.includes("furious"));
  assert.ok(names.includes("contemptuous"));
  const mix = mixQwenEmotions({
    primaryEmotion: "furious",
    secondaryEmotion: "contemptuous",
    emotionIntensity: 1.3,
    temperature: 0.9,
    topP: 0.8,
    repetitionPenalty: 1.05
  });
  assert.deepEqual(mix.emotions, ["furious", "contemptuous"]);
  assert.ok(mix.temperature > 1.2);
  assert.ok(mix.repetitionPenalty > 1.1);
});
