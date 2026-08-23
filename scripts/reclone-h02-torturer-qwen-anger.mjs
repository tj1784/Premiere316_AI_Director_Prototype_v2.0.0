#!/usr/bin/env node
/** Reclone H02 Torturer on the same Qwen voice with [angry] markup + instruct. */
import fs from "node:fs";
import path from "node:path";

const API = process.env.PREMIERE_API_URL || "http://127.0.0.1:8789";
const SLUG = "harrowing_of_hell";
const REPO = path.resolve(import.meta.dirname, "..");
const PROJECT = path.join(REPO, "projects", SLUG);
const CUE_FILE = path.join(PROJECT, "production", "h02-corrected-v3", "H02_V3_TTS_CUES.json");
const STATE_FILE = path.join(PROJECT, "production", "h02-corrected-v3", "H02_V3_TTS_RUN_STATE.json");
const STORYBOARD_FILE = path.join(PROJECT, "production", "storyboard.json");
const ANGRY_INSTRUCT = "Angry, contemptuous, commanding. Heat and bite in the voice. Not polite. Not a roar. Intelligible English.";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function angryText(dialogue) {
  return `[angry] ${dialogue}`;
}

async function api(pathname, options = {}) {
  const response = await fetch(`${API}${pathname}`, {
    ...options,
    headers: { Origin: API, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${options.method || "GET"} ${pathname} -> ${response.status}: ${body.error || text.slice(0, 400)}`);
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
      if (!job) throw new Error(`${label}: job disappeared`);
      if (status !== "done") throw new Error(`${label}: ${status}: ${job.error || job.stage || ""}`);
      return job;
    }
    await sleep(2500);
  }
  throw new Error(`${label}: timed out`);
}

function storyboardSegmentId(cueSegmentId) {
  return `segment-${String(cueSegmentId || "").toLowerCase()}`;
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(CUE_FILE, "utf8"));
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const voiceId = state.voices?.TORTURER?.qwenVoiceId;
  if (!voiceId) throw new Error("Missing saved Torturer Qwen voiceId");
  const cues = pkg.cues.filter((cue) => cue.speaker === "TORTURER");
  console.log(`Qwen anger pass: ${cues.length} Torturer lines on ${voiceId}`);

  for (const cue of cues) {
    const form = new FormData();
    form.append("voiceId", voiceId);
    form.append("speaker", "TORTURER");
    form.append("name", `${cue.cueId} TORTURER angry`);
    form.append("voiceName", pkg.characters.TORTURER.voiceName);
    form.append("text", angryText(cue.exactDialogue));
    form.append("style", ANGRY_INSTRUCT);
    form.append("language", "EN");
    form.append("seed", String((pkg.seed || 42) + 7));
    form.append("temperature", "1.05");
    form.append("cueId", cue.cueId);
    form.append("segmentId", storyboardSegmentId(cue.segmentId));
    form.append("attachToCue", "1");
    console.log(`\n== ${cue.cueId} ==\n${angryText(cue.exactDialogue)}`);
    const created = await fetch(`${API}/api/projects/${SLUG}/sound/qwen-tts/generations`, {
      method: "POST",
      headers: { Origin: API },
      body: form
    });
    const body = JSON.parse(await created.text());
    if (!created.ok) throw new Error(`${cue.cueId}: ${created.status} ${body.error || ""}`);
    if (body.job?.id) await waitForJob(body.job.id, cue.cueId);
    const project = await api(`/api/projects/${encodeURIComponent(SLUG)}`);
    const generation = (project.project?.sound?.generations || []).find((item) => item.id === body.generation?.id);
    state.cues[cue.cueId] = {
      ...(state.cues[cue.cueId] || {}),
      generationId: body.generation?.id,
      jobId: body.job?.id,
      voiceId,
      engine: "Qwen3-TTS Base",
      emotion: "angry",
      segmentId: storyboardSegmentId(cue.segmentId),
      speaker: "TORTURER",
      text: cue.exactDialogue,
      status: "done",
      file: generation?.file || generation?.outputFile || null,
      mediaUrl: generation?.mediaUrl || null
    };
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  }

  const sb = JSON.parse(fs.readFileSync(STORYBOARD_FILE, "utf8"));
  const bySegment = new Map(cues.map((cue) => [storyboardSegmentId(cue.segmentId), { cue, rec: state.cues[cue.cueId] }]));
  let bound = 0;
  for (const [clipId, clip] of Object.entries(sb.clips || {})) {
    if (!String(clipId).startsWith("H02-")) continue;
    const plan = clip.audioPlan || {};
    for (const binding of plan.passBindings || []) {
      const hit = bySegment.get(binding.segmentId);
      if (!hit?.rec?.file) continue;
      binding.cueId = hit.cue.cueId;
      binding.expectedMasterFilename = hit.rec.file;
      binding.authoritativeTrack = {
        file: hit.rec.file,
        mediaUrl: hit.rec.mediaUrl,
        generationId: hit.rec.generationId,
        speaker: "TORTURER",
        engine: "Qwen3-TTS Base",
        packageId: "h02_v3_provided_voices_torturer_angry"
      };
      binding.status = "cloned_provided_voice_angry";
      bound += 1;
    }
    plan.authoritativeTracks = (plan.passBindings || []).map((item) => item.authoritativeTrack).filter(Boolean);
    plan.authoritativeTrack = plan.authoritativeTracks[0] || null;
    clip.audioPlan = plan;
    const vp = sb.videoPlans?.[clip.videoPlanId];
    if (vp) vp.audioPlan = plan;
  }
  sb.updatedAt = new Date().toISOString();
  fs.writeFileSync(STORYBOARD_FILE, `${JSON.stringify(sb)}\n`);
  console.log(`\nRebound ${bound} angry Torturer tracks.`);
}

main().catch((error) => {
  console.error(`\nFAILED: ${error.message}`);
  process.exit(1);
});
