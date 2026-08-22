#!/usr/bin/env node
/**
 * Design LOTR-architecture voices for H02 V3, then clone the exact 24 spoken lines.
 * Dialogue text is never rewritten.
 */
import fs from "node:fs";
import path from "node:path";

const API = process.env.PREMIERE_API_URL || "http://127.0.0.1:8789";
const SLUG = "harrowing_of_hell";
const REPO = path.resolve(import.meta.dirname, "..");
const CUE_FILE = path.join(REPO, "projects", SLUG, "production", "h02-corrected-v3", "H02_V3_TTS_CUES.json");
const STATE_FILE = path.join(REPO, "projects", SLUG, "production", "h02-corrected-v3", "H02_V3_TTS_RUN_STATE.json");
const HEADERS = { "Content-Type": "application/json", Origin: API };

const VOICE_DESIGNS = {
  TORTURER: {
    auditionText: "I do not raise my voice. I weigh a man, I name his dust, and I offer him an ending that sounds like mercy. Speak once, first father, and the chain will loosen.",
    instruct: "TORTURER — LOTR TONAL ARCHITECTURE ONLY: SARUMAN (CHRISTOPHER LEE) MEETING BALROG DREAD. Mature male low dry baritone-bass. Precise diction, narrow pitch, deliberate judicial pacing. Cold calculating authority that believes itself righteous. Hard consonants land like decrees; dark vowels move slowly. Controlled low power, never a roar, growl, death-metal rasp, wet monster noise, trailer announcer, or celebrity imitation. Fear appears only as a held breath or a word clipped short."
  },
  ADAM: {
    auditionText: "I am worn thin by waiting. I will not pretend I am innocent. The word that keeps me was never mine to make.",
    instruct: "ADAM — LOTR TONAL ARCHITECTURE ONLY: ARAGORN (VIGGO MORTENSEN). Elderly weathered low baritone. Dry breath, chest fatigue, residual strength. Confession before courage. Intimate and human. Never a youthful hero, booming patriarch, self-pitying sob, victory speech, or celebrity imitation. Intelligible even when weak."
  },
  EVE: {
    auditionText: "Look at me. I will not let this darkness make strangers of us. I chose the first lie with my own will, and I will not choose another to escape my wound.",
    instruct: "EVE — LOTR TONAL ARCHITECTURE ONLY: GALADRIEL (CATE BLANCHETT). Mature female contralto. Warm lower register, clear diction, luminous presence without fragility. Intimacy becomes moral clarity. Never hysterical, girlish, operatic, breathy fantasy maiden, or a celebrity imitation."
  },
  MOSES: {
    auditionText: "Stand fast. These chains may close upon the hand, but they cannot close upon the promise. I speak as a witness, not as a man who needs to be believed.",
    instruct: "MOSES — LOTR TONAL ARCHITECTURE ONLY: ELROND (HUGO WEAVING). Older male baritone, firm middle register, unhurried, slight desert roughness. Quiet authority of a chained witness. Never sermon cadence, shouting prophecy, omniscient narrator, or celebrity imitation."
  },
  DAVID: {
    auditionText: "I will wait in the deep places. I will keep the same small melody in my breath, and I will not let the grave teach me a louder song than hope.",
    instruct: "DAVID — LOTR TONAL ARCHITECTURE ONLY: FRODO AT MOUNT DOOM, MATURED. Adult male warm lyrical baritone. Intimate breath, stable center pitch. Narrow psalmic speech leaning toward restrained chant. Never pop singing, Broadway vibrato, opera, choir, or celebrity imitation."
  },
  JOHN: {
    auditionText: "Be quiet and listen with me. I have heard this step before, when the water opened and the air itself seemed to know the one who came toward us from the river.",
    instruct: "JOHN — LOTR TONAL ARCHITECTURE ONLY: SAMWISE GAMGEE (SEAN ASTIN). Rugged adult male, spare grainy baritone, direct consonants, almost no decorative melody. Recognition adds certainty, not volume. Never preacher cadence, shout, mystical whisper, or celebrity imitation."
  }
};

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

async function waitForJob(jobId, label, timeoutMs = 15 * 60 * 1000) {
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

async function waitForVoiceSession(sessionId, label) {
  const started = Date.now();
  while (Date.now() - started < 20 * 60 * 1000) {
    const payload = await api(`/api/projects/${SLUG}/sound/voice-design`);
    const session = (payload.voiceDesign?.sessions || []).find((item) => item.id === sessionId);
    const auditions = session?.auditions || [];
    const done = auditions.filter((item) => item.status === "done");
    const failed = auditions.filter((item) => ["error", "failed", "cancelled"].includes(item.status));
    const pending = auditions.filter((item) => ["queued", "loading", "generating"].includes(item.status));
    process.stdout.write(`\r${label}: session ${session?.status || "?"} done=${done.length} pending=${pending.length} failed=${failed.length}   `);
    if (session && pending.length === 0 && (done.length > 0 || failed.length === auditions.length || ["done", "error", "failed"].includes(session.status))) {
      process.stdout.write("\n");
      return session;
    }
    await sleep(3000);
  }
  throw new Error(`${label}: voice design session timed out`);
}

function referenceDurationOk(durationSec) {
  return Number(durationSec) >= 7.95 && Number(durationSec) <= 15.05;
}

async function unloadVoiceDesign() {
  try {
    await api("/api/sound/qwen-voice-design/unload", { method: "POST", body: "{}" });
  } catch (error) {
    console.warn(`VoiceDesign unload: ${error.message}`);
  }
}

async function waitForVram(minGiB = 10) {
  const started = Date.now();
  while (Date.now() - started < 180000) {
    const health = await api("/api/health");
    const free = Number(health.gpu?.freeBytes || 0) / 1024 ** 3;
    process.stdout.write(`\rVRAM free ${free.toFixed(1)} GiB   `);
    if (free >= minGiB) {
      process.stdout.write("\n");
      return free;
    }
    await sleep(3000);
  }
  throw new Error(`Need ${minGiB} GiB free VRAM for Qwen3-TTS clone`);
}

async function designVoice(speaker, meta, existing) {
  if (existing?.sessionId && existing?.auditionId && existing?.nativeFile && referenceDurationOk(existing.durationSec)) {
    return existing;
  }
  if (existing?.sessionId && !existing.auditionId) {
    const session = await waitForVoiceSession(existing.sessionId, speaker);
    return selectBestAudition(speaker, session);
  }
  console.log(`\n== Voice design ${speaker} ==`);
  const created = await api(`/api/projects/${SLUG}/sound/voice-design/auditions`, {
    method: "POST",
    body: JSON.stringify({
      voiceName: meta.voiceName,
      characterId: meta.characterId,
      language: "English",
      instruct: VOICE_DESIGNS[speaker].instruct,
      auditionText: VOICE_DESIGNS[speaker].auditionText,
      auditionCount: 1,
      seed: 42,
      settings: { temperature: 0.9, topP: 0.8, topK: 20, repetitionPenalty: 1.05, maxNewTokens: 2048, create48kCopy: true }
    })
  });
  const sessionId = created.session?.id;
  if (created.job?.id) {
    try { await waitForJob(created.job.id, `${speaker} voice-design job`); } catch (error) {
      console.warn(String(error.message || error));
    }
  }
  const session = await waitForVoiceSession(sessionId, speaker);
  return selectBestAudition(speaker, session);
}

async function selectBestAudition(speaker, session) {
  const audition = (session.auditions || []).find((item) => item.status === "done" && item.quality?.passed !== false)
    || (session.auditions || []).find((item) => item.status === "done");
  if (!audition) throw new Error(`${speaker}: no completed voice-design audition`);
  try {
    await api(`/api/projects/${SLUG}/sound/voice-design/auditions/${audition.id}/select`, { method: "POST", body: "{}" });
  } catch (error) {
    console.warn(`${speaker}: select warning: ${error.message}`);
  }
  return {
    sessionId: session.id,
    auditionId: audition.id,
    nativeFile: audition.nativeFile,
    production48kFile: audition.production48kFile,
    transcript: session.auditionText,
    durationSec: audition.durationSec,
    sha256: audition.sha256
  };
}

async function registerAndClone(pkg, state) {
  const projectRoot = path.join(REPO, "projects", SLUG);
  for (const cue of pkg.cues) {
    if (state.cues[cue.cueId]?.generationId && state.cues[cue.cueId]?.status === "done") {
      console.log(`skip ${cue.cueId} already done`);
      continue;
    }
    const voice = state.voices[cue.speaker];
    if (!voice?.nativeFile) throw new Error(`${cue.cueId}: missing ${cue.speaker} voice reference`);
    const referencePath = path.join(projectRoot, voice.nativeFile);
    if (!fs.existsSync(referencePath)) throw new Error(`${cue.cueId}: missing reference WAV ${referencePath}`);
    const form = new FormData();
    if (voice.indexVoiceId) {
      form.append("voiceId", voice.indexVoiceId);
    } else {
      form.append("referenceAudio", new Blob([fs.readFileSync(referencePath)], { type: "audio/wav" }), path.basename(referencePath));
    }
    form.append("speaker", cue.speaker);
    form.append("name", `${cue.cueId} ${cue.speaker}`);
    form.append("voiceName", pkg.characters[cue.speaker].voiceName);
    form.append("text", cue.exactDialogue);
    form.append("style", cue.style || "");
    form.append("language", "EN");
    form.append("seed", String(pkg.seed));
    form.append("emotionWeight", cue.sung ? "0.56" : "0.54");
    form.append("durationFactor", cue.sung ? "1.12" : "1.10");
    console.log(`\n== Clone ${cue.cueId} ${cue.speaker} ==`);
    console.log(cue.exactDialogue);
    const created = await fetch(`${API}/api/projects/${SLUG}/sound/index-tts/generations`, {
      method: "POST",
      headers: { Origin: API },
      body: form
    });
    const text = await created.text();
    const body = text ? JSON.parse(text) : {};
    if (!created.ok) throw new Error(`${cue.cueId}: ${created.status} ${body.error || text.slice(0, 400)}`);
    state.cues[cue.cueId] = {
      generationId: body.generation?.id,
      jobId: body.job?.id,
      voiceId: body.voice?.id,
      engine: "IndexTTS-2.5",
      status: "queued"
    };
    if (body.voice?.id) state.voices[cue.speaker].indexVoiceId = body.voice.id;
    saveState(state);
    if (body.job?.id) await waitForJob(body.job.id, cue.cueId, 12 * 60 * 1000);
    state.cues[cue.cueId].status = "done";
    saveState(state);
  }
}

async function main() {
  const pkg = loadJson(CUE_FILE);
  if (!pkg?.cues?.length) throw new Error(`Cue file missing: ${CUE_FILE}`);
  const state = loadJson(STATE_FILE, { voices: {}, cues: {}, startedAt: new Date().toISOString() });
  console.log(`H02 V3 LOTR TTS: ${pkg.cues.length} locked lines, Qwen clone via ${API}`);
  for (const [speaker, meta] of Object.entries(pkg.characters)) {
    state.voices[speaker] = await designVoice(speaker, meta, state.voices[speaker]);
    saveState(state);
    console.log(`${speaker}: ${state.voices[speaker].nativeFile} (${state.voices[speaker].durationSec}s)`);
  }
  await unloadVoiceDesign();
  await registerAndClone(pkg, state);
  state.finishedAt = new Date().toISOString();
  saveState(state);
  console.log("\nAll H02 V3 dialogue clones queued/completed.");
  console.log(`State: ${STATE_FILE}`);
}

main().catch((error) => {
  console.error(`\nFAILED: ${error.message}`);
  process.exit(1);
});
