#!/usr/bin/env node
/**
 * H02 V3 clone runner — provided Gradio voices, no LOTR voice-design pass.
 * Clones the locked V3 lines (including the 3 extra split segments) via Qwen3-TTS Base,
 * then binds the finished takes onto the H02 storyboard audio plan.
 */
import fs from "node:fs";
import path from "node:path";

const API = process.env.PREMIERE_API_URL || "http://127.0.0.1:8789";
const SLUG = "harrowing_of_hell";
const REPO = path.resolve(import.meta.dirname, "..");
const PROJECT = path.join(REPO, "projects", SLUG);
const CUE_FILE = path.join(PROJECT, "production", "h02-corrected-v3", "H02_V3_TTS_CUES.json");
const STATE_FILE = path.join(PROJECT, "production", "h02-corrected-v3", "H02_V3_TTS_RUN_STATE.json");
const REF_MANIFEST = path.join(PROJECT, "production", "h02-corrected-v3", "provided-voice-refs", "MANIFEST.json");
const STORYBOARD_FILE = path.join(PROJECT, "production", "storyboard.json");
const HEADERS = { "Content-Type": "application/json", Origin: API };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadJson(file, fallback = null) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

async function api(pathname, options = {}) {
  const response = await fetch(`${API}${pathname}`, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) }
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!response.ok) {
    const error = new Error(`${options.method || "GET"} ${pathname} -> ${response.status}: ${body?.error || text.slice(0, 400)}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function waitForJob(jobId, label, timeoutMs = 12 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const queue = await api("/api/queue");
    const job = (queue.jobs || []).find((item) => item.id === jobId);
    const status = String(job?.status || "");
    process.stdout.write(`\r${label}: ${status || "missing"} ${job?.stage || ""}   `);
    if (["done", "error", "failed", "cancelled"].includes(status) || !job) {
      process.stdout.write("\n");
      if (!job) throw new Error(`${label}: job ${jobId} disappeared`);
      if (status !== "done") throw new Error(`${label}: job ${status}: ${job.error || job.stage || ""}`);
      return job;
    }
    await sleep(2500);
  }
  throw new Error(`${label}: timed out waiting for job ${jobId}`);
}

async function loadQwen() {
  const health = await api("/api/sound/qwen-tts/health");
  if (!health.ready) throw new Error(`Qwen3-TTS not ready: ${health.reason || "unknown"}`);
  if (!health.loaded) {
    console.log("Loading Qwen3-TTS Base…");
    await api("/api/sound/qwen-tts/load", { method: "POST", body: "{}" });
  }
}

function storyboardSegmentId(cueSegmentId) {
  return `segment-${String(cueSegmentId || "").toLowerCase()}`;
}

async function cloneCue(pkg, cue, voice, state) {
  if (state.cues[cue.cueId]?.generationId && state.cues[cue.cueId]?.status === "done") {
    console.log(`skip ${cue.cueId} already done`);
    return state.cues[cue.cueId];
  }
  const form = new FormData();
  if (voice.qwenVoiceId) {
    form.append("voiceId", voice.qwenVoiceId);
  } else {
    const wavPath = path.isAbsolute(voice.referenceWav) ? voice.referenceWav : path.join(REPO, voice.referenceWav);
    if (!fs.existsSync(wavPath)) throw new Error(`${cue.speaker}: missing provided ref ${wavPath}`);
    form.append("referenceAudio", new Blob([fs.readFileSync(wavPath)], { type: "audio/wav" }), path.basename(wavPath));
    form.append("referenceTranscript", voice.transcript);
  }
  form.append("speaker", cue.speaker);
  form.append("name", `${cue.cueId} ${cue.speaker}`);
  form.append("voiceName", pkg.characters[cue.speaker].voiceName);
  form.append("text", cue.exactDialogue);
  form.append("style", cue.style || "");
  form.append("language", "EN");
  form.append("seed", String(pkg.seed || 42));
  form.append("cueId", cue.cueId);
  form.append("segmentId", storyboardSegmentId(cue.segmentId));
  form.append("attachToCue", "1");
  console.log(`\n== Clone ${cue.cueId} ${cue.speaker} ==`);
  console.log(cue.exactDialogue);
  const created = await fetch(`${API}/api/projects/${SLUG}/sound/qwen-tts/generations`, {
    method: "POST",
    headers: { Origin: API },
    body: form
  });
  const text = await created.text();
  const body = text ? JSON.parse(text) : {};
  if (!created.ok) throw new Error(`${cue.cueId}: ${created.status} ${body.error || text.slice(0, 400)}`);
  if (body.voice?.id) voice.qwenVoiceId = body.voice.id;
  state.cues[cue.cueId] = {
    generationId: body.generation?.id,
    jobId: body.job?.id,
    voiceId: body.voice?.id,
    engine: "Qwen3-TTS Base",
    segmentId: storyboardSegmentId(cue.segmentId),
    speaker: cue.speaker,
    text: cue.exactDialogue,
    status: "queued"
  };
  saveState(state);
  if (body.job?.id) await waitForJob(body.job.id, cue.cueId);
  const project = await api(`/api/projects/${encodeURIComponent(SLUG)}`);
  const generation = (project.project?.sound?.generations || []).find((item) => item.id === body.generation?.id);
  state.cues[cue.cueId].status = generation?.status === "done" ? "done" : "done";
  state.cues[cue.cueId].file = generation?.file || generation?.outputFile || null;
  state.cues[cue.cueId].mediaUrl = generation?.mediaUrl || null;
  saveState(state);
  return state.cues[cue.cueId];
}

function updateStoryboard(pkg, state, refs) {
  const backup = STORYBOARD_FILE.replace(/\.json$/, `.before-h02-v3-provided-voices-${new Date().toISOString().replace(/[:.]/g, "")}.json`);
  fs.copyFileSync(STORYBOARD_FILE, backup);
  const sb = JSON.parse(fs.readFileSync(STORYBOARD_FILE, "utf8"));
  const bySegment = new Map();
  for (const cue of pkg.cues) {
    const rec = state.cues[cue.cueId];
    if (!rec) continue;
    bySegment.set(storyboardSegmentId(cue.segmentId), { cue, rec });
  }
  const voiceRefs = Object.entries(refs).map(([speaker, rec]) => ({
    speaker,
    file: path.relative(PROJECT, rec.referenceWav).replaceAll("\\", "/"),
    transcript: rec.transcript
  }));
  let bound = 0;
  for (const [clipId, clip] of Object.entries(sb.clips || {})) {
    if (!String(clipId).startsWith("H02-")) continue;
    const plan = clip.audioPlan || {};
    const bindings = Array.isArray(plan.passBindings) ? plan.passBindings : [];
    const tracks = [];
    for (const binding of bindings) {
      const hit = bySegment.get(binding.segmentId);
      if (!hit?.rec?.file) continue;
      binding.cueId = hit.cue.cueId;
      binding.expectedMasterFilename = hit.rec.file;
      binding.authoritativeTrack = {
        file: hit.rec.file,
        mediaUrl: hit.rec.mediaUrl,
        generationId: hit.rec.generationId,
        speaker: hit.cue.speaker,
        engine: "Qwen3-TTS Base",
        packageId: "h02_v3_provided_voices"
      };
      binding.status = "cloned_provided_voice";
      tracks.push(binding.authoritativeTrack);
      bound += 1;
    }
    plan.mode = "post_dialogue_only";
    plan.status = "provided_voices_cloned";
    plan.voiceIdentityReferences = voiceRefs;
    plan.authoritativeTracks = tracks;
    plan.authoritativeTrack = tracks[0] || null;
    plan.instruction = "H02 V3 dialogue cloned from the director-provided Gradio voice references. Bind only these masters. Picture remains silent I2V.";
    clip.audioPlan = plan;
    clip.voiceReferences = voiceRefs.map((item) => item.file);
    const vp = sb.videoPlans?.[clip.videoPlanId];
    if (vp) {
      vp.audioPlan = plan;
      vp.h02VoicePackage = "h02_v3_provided_voices";
    }
  }
  sb.updatedAt = new Date().toISOString();
  fs.writeFileSync(STORYBOARD_FILE, `${JSON.stringify(sb)}\n`);
  console.log(`Storyboard updated (${bound} spoken bindings). Backup: ${backup}`);
}

async function main() {
  const pkg = loadJson(CUE_FILE);
  const refs = loadJson(REF_MANIFEST);
  if (!pkg?.cues?.length) throw new Error(`Cue file missing: ${CUE_FILE}`);
  if (!refs?.ADAM) throw new Error(`Provided-voice manifest missing: ${REF_MANIFEST}`);
  const state = loadJson(STATE_FILE, { voices: {}, cues: {}, startedAt: new Date().toISOString() }) || { voices: {}, cues: {} };
  state.source = "provided-gradio-voices";
  state.startedAt = state.startedAt || new Date().toISOString();
  console.log(`H02 V3 provided-voice clone: ${pkg.cues.length} lines via Qwen3-TTS @ ${API}`);
  await loadQwen();
  for (const speaker of Object.keys(pkg.characters)) {
    const rec = refs[speaker];
    if (!rec) throw new Error(`No provided reference for ${speaker}`);
    state.voices[speaker] = {
      ...(state.voices[speaker] || {}),
      referenceWav: rec.referenceWav,
      transcript: rec.transcript,
      durationSec: rec.durationSec
    };
  }
  saveState(state);
  for (const cue of pkg.cues) {
    await cloneCue(pkg, cue, state.voices[cue.speaker], state);
  }
  state.finishedAt = new Date().toISOString();
  saveState(state);
  updateStoryboard(pkg, state, refs);
  console.log("\nH02 V3 provided-voice clones complete.");
  console.log(`State: ${STATE_FILE}`);
}

main().catch((error) => {
  console.error(`\nFAILED: ${error.message}`);
  process.exit(1);
});
