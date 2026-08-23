#!/usr/bin/env node
/** Reclone H02 Torturer lines with the same provided voice + angry IndexTTS emotion. */
import fs from "node:fs";
import path from "node:path";

const API = process.env.PREMIERE_API_URL || "http://127.0.0.1:8789";
const SLUG = "harrowing_of_hell";
const REPO = path.resolve(import.meta.dirname, "..");
const PROJECT = path.join(REPO, "projects", SLUG);
const CUE_FILE = path.join(PROJECT, "production", "h02-corrected-v3", "H02_V3_TTS_CUES.json");
const STATE_FILE = path.join(PROJECT, "production", "h02-corrected-v3", "H02_V3_TTS_RUN_STATE.json");
const REF_WAV = path.join(PROJECT, "production", "h02-corrected-v3", "provided-voice-refs", "torturer_ref_12s.wav");
const STORYBOARD_FILE = path.join(PROJECT, "production", "storyboard.json");

// happy, angry, sad, afraid, disgust, melancholy, surprise, calm
const ANGRY_VECTOR = [0.00, 0.64, 0.00, 0.05, 0.16, 0.03, 0.00, 0.12];
const EMOTION_WEIGHT = 0.78;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const cues = pkg.cues.filter((cue) => cue.speaker === "TORTURER");
  if (!fs.existsSync(REF_WAV)) throw new Error(`Missing ${REF_WAV}`);
  console.log(`Recloning ${cues.length} Torturer lines with angry emotion ${ANGRY_VECTOR.join(",")} w=${EMOTION_WEIGHT}`);

  let voiceId = null;
  for (const cue of cues) {
    const form = new FormData();
    if (voiceId) {
      form.append("voiceId", voiceId);
    } else {
      form.append("referenceAudio", new Blob([fs.readFileSync(REF_WAV)], { type: "audio/wav" }), "torturer_ref_12s.wav");
    }
    form.append("speaker", "TORTURER");
    form.append("name", `${cue.cueId} TORTURER angry`);
    form.append("voiceName", "H02 V3 Torturer · provided + anger");
    form.append("text", cue.exactDialogue);
    form.append("style", "Angry, sharp, commanding contempt. Heat in the consonants. Not polite. Not a roar.");
    form.append("language", "EN");
    form.append("seed", String(pkg.seed || 42));
    form.append("emotionWeight", String(EMOTION_WEIGHT));
    form.append("emotionVector", JSON.stringify(ANGRY_VECTOR));
    form.append("durationFactor", "1.08");
    console.log(`\n== ${cue.cueId} ==\n${cue.exactDialogue}`);
    const created = await fetch(`${API}/api/projects/${SLUG}/sound/index-tts/generations`, {
      method: "POST",
      headers: { Origin: API },
      body: form
    });
    const body = JSON.parse(await created.text());
    if (!created.ok) throw new Error(`${cue.cueId}: ${created.status} ${body.error || ""}`);
    if (body.voice?.id) voiceId = body.voice.id;
    if (body.job?.id) await waitForJob(body.job.id, cue.cueId);
    const project = await api(`/api/projects/${encodeURIComponent(SLUG)}`);
    const generation = (project.project?.sound?.generations || []).find((item) => item.id === body.generation?.id);
    state.cues[cue.cueId] = {
      ...(state.cues[cue.cueId] || {}),
      generationId: body.generation?.id,
      jobId: body.job?.id,
      voiceId,
      engine: "IndexTTS-2.5",
      emotionVector: ANGRY_VECTOR,
      emotionWeight: EMOTION_WEIGHT,
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
        engine: "IndexTTS-2.5",
        packageId: "h02_v3_provided_voices_torturer_anger"
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
  console.log(`\nRebound ${bound} Torturer storyboard tracks.`);
}

main().catch((error) => {
  console.error(`\nFAILED: ${error.message}`);
  process.exit(1);
});
