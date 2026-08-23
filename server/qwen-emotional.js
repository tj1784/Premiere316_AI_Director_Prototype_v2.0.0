import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const PRESET_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "client", "src", "data", "qwen-emotional-presets.json");

let cached = null;
export function qwenEmotionalPresets() {
  if (cached) return cached;
  cached = JSON.parse(fs.readFileSync(PRESET_PATH, "utf8"));
  return cached;
}

export function qwenEmotionalPresetNames() {
  return Object.keys(qwenEmotionalPresets()).sort();
}

export function mixQwenEmotions({
  primaryEmotion = "neutral",
  secondaryEmotion = "none",
  tertiaryEmotion = "none",
  emotionIntensity = 1,
  temperature = 0.9,
  topP = 0.8,
  repetitionPenalty = 1.05
} = {}) {
  const presets = qwenEmotionalPresets();
  const mix = [primaryEmotion, secondaryEmotion, tertiaryEmotion]
    .map((name) => String(name || "none").trim().toLowerCase())
    .filter((name) => name && name !== "none" && presets[name]);
  const names = mix.length ? mix : ["neutral"];
  const intensity = Math.max(0, Math.min(2, Number(emotionIntensity) || 0));
  const totals = names.reduce((acc, name) => {
    const preset = presets[name];
    acc.temp += Number(preset.temp) || 0;
    acc.rep += Number(preset.rep_pen) || 0;
    acc.topP += Number(preset.top_p) || 0;
    return acc;
  }, { temp: 0, rep: 0, topP: 0 });
  const count = names.length;
  return {
    emotions: names,
    intensity,
    temperature: clamp(Number(temperature) + (totals.temp / count) * intensity, 0.1, 2),
    topP: clamp(Number(topP) + (totals.topP / count) * intensity, 0.1, 1),
    repetitionPenalty: clamp(Number(repetitionPenalty) + (totals.rep / count) * intensity, 1, 2)
  };
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}
