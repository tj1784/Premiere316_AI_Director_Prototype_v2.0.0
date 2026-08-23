import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const DEMO_FILE = fileURLToPath(new URL("../client/src/components/QwenTtsDemoWorkspace.tsx", import.meta.url));
const source = fs.readFileSync(DEMO_FILE, "utf8");

test("QwenTTS Demo mirrors the official Hugging Face Space modes", () => {
  assert.match(source, /huggingface\.co\/spaces\/Qwen\/Qwen3-TTS/);
  assert.match(source, /id: "voice-design"/);
  assert.match(source, /id: "voice-clone"/);
  assert.match(source, /id: "custom-voice"/);
  assert.match(source, /Voice Clone \(Base\)/);
  assert.match(source, /TTS \(CustomVoice\)/);
  assert.match(source, /Aiden/);
  assert.match(source, /Ryan/);
  assert.match(source, /Vivian/);
  assert.match(source, /1\.7B/);
});

test("QwenTTS Demo posts to local Voice Design, Base clone, and CustomVoice routes", () => {
  assert.match(source, /\/sound\/voice-design\/auditions/);
  assert.match(source, /\/sound\/qwen-tts\/generations/);
  assert.match(source, /\/sound\/qwen-custom-voice\/generations/);
  assert.match(source, /instruct: designInstruct\.trim\(\)/);
  assert.match(source, /body\.set\("referenceTranscript"/);
});
