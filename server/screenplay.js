const LM_STUDIO_URL = (process.env.LM_STUDIO_URL || "http://127.0.0.1:1234/v1").replace(/\/+$/, "");

export const SCREENPLAY_MODEL = "qwen3.6-40b-claude-4.6-opus-deckard-heretic-uncensored-thinking-neo-code-di-imatrix-max";

const SCREENPLAY_SYSTEM = `You are the senior screenwriter, film director, production designer, casting designer, cinematographer, sound designer, and AI asset supervisor inside Premiere316.

Write a production-ready cinematic screenplay package in clean Markdown. It must be useful both to human filmmakers and to an AI video-generation pipeline. Maintain identity, costume, location, lighting, prop, camera, and story continuity. Use vivid but filmable prose. Dialogue must be fully written, emotionally playable, and clearly attributed.

Return ONLY the finished Markdown document. Do not include analysis, hidden reasoning, apologies, or commentary outside the package.

Use this exact section architecture:
# [TITLE]
## A Cinematic Film Treatment & Script Package
# TABLE OF CONTENTS
# PROJECT OVERVIEW
## SYNOPSIS OF SCENE
# THE SCREENPLAY
(put the screenplay inside a fenced code block using professional sluglines, action, character cues, parentheticals, dialogue, transitions, and an ending)
# ASSET GENERATION PROMPTS
## 1. CHARACTER ASSETS
## 2. LOCATION ASSETS
## 3. ARTIFACT ASSETS
## 4. ATMOSPHERIC ASSETS
## 5. FIRST AND LAST FRAME SCENE IMAGES
# LOCATION DESIGN SPECIFICATIONS
# CHARACTER SPECIFICATIONS
# VOICE & AUDIO DIRECTION
## CHARACTER VOICES
## SOUND DESIGN ELEMENTS
# PRODUCTION NOTES
## Camera Direction
## Color Grading Strategy
## VFX Requirements
# END OF SCRIPT PACKAGE

Every recurring character needs a locked physical description, costume, movement quality, voice profile, primary appearance prompt, close-up prompt, and action prompt. Every important location and artifact needs generation prompts. Include exact first-frame and last-frame image prompts. Do not omit spoken dialogue, sound design, music direction, camera direction, or production dimensions.`;

const PATCH_START = "<SCREENPLAY_PATCHES>";
const PATCH_END = "</SCREENPLAY_PATCHES>";

function cleanModelText(value) {
  return String(value || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

async function callScreenplayModel(messages, {
  temperature = 0.72,
  topP = 0.9,
  maxTokens = 12000,
  timeoutMs = 20 * 60 * 1000
} = {}) {
  // Always use LM Studio's SSE transport for long model work. Node/Undici can
  // otherwise close a non-streaming request while it is still waiting for the
  // first response headers (roughly five minutes), even though our explicit
  // generation timeout is much longer. We can consume SSE internally without
  // exposing partial JSON to the caller.
  const result = await streamModel(messages, {
    signal: AbortSignal.timeout(timeoutMs),
    temperature,
    topP,
    maxTokens
  });
  const content = cleanModelText(result.content);
  if (!content) throw new Error("The screenplay model returned no final response.");
  return {
    content,
    usage: result.usage || null,
    finishReason: result.finishReason || null
  };
}

async function streamModel(messages, { signal, onDelta, temperature = 0.65, topP = 0.9, maxTokens = 12000 } = {}) {
  const response = await fetch(`${LM_STUDIO_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: SCREENPLAY_MODEL,
      messages,
      temperature,
      top_p: topP,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true }
    }),
    signal
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`LM Studio screenplay stream failed (${response.status}): ${detail.slice(0, 600)}`);
  }
  if (!response.body) throw new Error("LM Studio returned no streaming response body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let content = "";
  let reasoningCharacters = 0;
  let usage = null;
  let finishReason = null;
  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new Error(`LM Studio closed the screenplay stream after ${content.length.toLocaleString()} visible characters: ${error?.message || error}`);
    }
    const { done, value } = chunk;
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let json;
      try { json = JSON.parse(payload); } catch { continue; }
      if (json.usage) usage = json.usage;
      const choice = json.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const delta = choice?.delta || {};
      const reasoning = String(delta.reasoning_content || delta.reasoning || "");
      if (reasoning) reasoningCharacters += reasoning.length;
      const text = String(delta.content || "");
      if (text) {
        content += text;
        onDelta?.(text, { contentCharacters: content.length, reasoningCharacters });
      }
    }
    if (done) break;
  }
  return { content, usage, finishReason, reasoningCharacters };
}

function generationUserPrompt({ concept, runtimeMinutes = 10, genre, aspectRatio, rating, tone, additionalInstructions } = {}) {
  const minutes = Math.min(30, Math.max(1, Number(runtimeMinutes) || 10));
  const subject = String(concept || "").trim();
  if (!subject) throw new Error("A screenplay concept or story brief is required.");
  return {
    prompt: `Create the complete screenplay package from this brief:\n\n${subject}\n\nRuntime: ${minutes} minutes\nGenre: ${genre || "Cinematic Biblical Epic / Supernatural Drama"}\nAspect ratio: ${aspectRatio || "2.39:1"}\nIntended rating: ${rating || "PG-13"}\nTone: ${tone || "cinematic, dramatic, emotionally sincere, visually coherent"}\nAdditional requirements: ${String(additionalInstructions || "None").trim() || "None"}\n\nThe screenplay itself should approximately fill the requested runtime, followed by the complete asset and production package.`,
    settings: { concept: subject, runtimeMinutes: minutes, genre, aspectRatio, rating, tone, additionalInstructions }
  };
}

function applyScreenplayPatches(markdown, responseText) {
  const start = responseText.indexOf(PATCH_START);
  const end = responseText.indexOf(PATCH_END, start + PATCH_START.length);
  const visible = (start >= 0 ? responseText.slice(0, start) : responseText).trim();
  if (start < 0 || end < 0) return { markdown, visible, changed: false, patchWarning: "The model answered but did not provide an applicable screenplay patch." };
  let payload;
  try {
    payload = JSON.parse(responseText.slice(start + PATCH_START.length, end).trim());
  } catch (error) {
    return { markdown, visible, changed: false, patchWarning: `The model returned an invalid screenplay patch: ${error.message}` };
  }
  const changes = Array.isArray(payload?.changes) ? payload.changes.slice(0, 30) : [];
  let revised = markdown;
  let applied = 0;
  const missed = [];
  for (const [index, change] of changes.entries()) {
    const find = String(change?.find || "");
    const replacement = String(change?.replace ?? "");
    if (!find) continue;
    if (!revised.includes(find)) {
      missed.push(index + 1);
      continue;
    }
    revised = change?.replaceAll ? revised.split(find).join(replacement) : revised.replace(find, replacement);
    applied += 1;
  }
  return {
    markdown: revised,
    visible,
    changed: applied > 0,
    patchWarning: missed.length ? `${applied} correction(s) applied; ${missed.length} could not be matched exactly.` : null
  };
}

export async function streamScreenplayConversation({
  mode = "generate",
  message = "",
  currentMarkdown = "",
  history = [],
  settings = {}
} = {}, { signal, onEvent } = {}) {
  const existing = String(currentMarkdown || "").trim();
  const direction = String(message || "").trim();
  const recentDirections = (Array.isArray(history) ? history : [])
    .filter((item) => item?.role === "user" && String(item?.content || "").trim())
    .slice(-8)
    .map((item) => `- ${String(item.content).slice(0, 1200)}`)
    .join("\n");

  let messages;
  let streamMode = mode;
  let generatedSettings = settings;
  if (mode === "generate" || !existing) {
    const generated = generationUserPrompt(settings);
    generatedSettings = generated.settings;
    messages = [
      { role: "system", content: SCREENPLAY_SYSTEM },
      { role: "user", content: direction ? `${generated.prompt}\n\nThe director adds this live instruction: ${direction}` : generated.prompt }
    ];
    streamMode = "generate";
  } else if (mode === "steer") {
    messages = [
      { role: "system", content: SCREENPLAY_SYSTEM },
      { role: "user", content: `The director interrupted an in-progress draft to steer it. Rewrite and complete the entire package from the beginning, preserving useful completed material while obeying the new direction.\n\nNEW DIRECTION:\n${direction}\n\nPARTIAL DRAFT:\n${existing.slice(0, 85000)}` }
    ];
  } else {
    const patchSystem = `You are Premiere316's collaborative screenplay editor. Discuss the requested correction briefly and professionally, then emit exact machine-applicable changes to the supplied Markdown screenplay.

Your visible response must be concise and may explain what you changed. After it, output exactly:
${PATCH_START}
{"changes":[{"find":"exact verbatim text from the screenplay","replace":"complete replacement text","replaceAll":false}]}
${PATCH_END}

Rules:
- Use valid JSON inside the tags.
- Each find value must be an exact, contiguous, verbatim excerpt from the supplied screenplay and long enough to be unique.
- Keep patches focused; replace a complete paragraph, dialogue block, prompt, or section when necessary.
- Preserve everything the director did not ask to change.
- Never reveal hidden reasoning.
- If the user only asks a question and requests no change, respond normally and use {"changes":[]} in the patch block.`;
    messages = [
      { role: "system", content: patchSystem },
      { role: "user", content: `Prior director notes:\n${recentDirections || "None"}\n\nCURRENT SCREENPLAY MARKDOWN:\n${existing.slice(0, 90000)}\n\nNEW DIRECTOR MESSAGE:\n${direction}` }
    ];
    streamMode = "revise";
  }

  onEvent?.({ type: "status", phase: "thinking", model: SCREENPLAY_MODEL });
  let raw = "";
  let visible = "";
  let scan = "";
  let hidingPatch = false;
  let startedWriting = false;
  const streamed = await streamModel(messages, {
    signal,
    temperature: streamMode === "revise" ? 0.35 : 0.72,
    topP: streamMode === "revise" ? 0.85 : 0.9,
    maxTokens: streamMode === "revise" ? 3000 : 12000,
    onDelta(delta, progress) {
      raw += delta;
      if (!startedWriting) {
        startedWriting = true;
        onEvent?.({ type: "status", phase: streamMode === "revise" ? "editing" : "writing", model: SCREENPLAY_MODEL });
      }
      if (streamMode !== "revise") {
        visible += delta;
        onEvent?.({ type: "delta", content: delta, ...progress });
        return;
      }
      if (hidingPatch) return;
      scan += delta;
      const markerAt = scan.indexOf(PATCH_START);
      if (markerAt >= 0) {
        const show = scan.slice(0, markerAt);
        if (show) { visible += show; onEvent?.({ type: "delta", content: show, ...progress }); }
        scan = "";
        hidingPatch = true;
      } else if (scan.length > PATCH_START.length) {
        const show = scan.slice(0, -PATCH_START.length);
        scan = scan.slice(-PATCH_START.length);
        visible += show;
        onEvent?.({ type: "delta", content: show, ...progress });
      }
    }
  });
  if (streamMode === "revise" && !hidingPatch && scan) {
    visible += scan;
    onEvent?.({ type: "delta", content: scan });
  }

  if (streamMode === "revise") {
    const patched = applyScreenplayPatches(existing, raw);
    return { ...patched, response: patched.visible || visible.trim(), model: SCREENPLAY_MODEL, usage: streamed.usage, finishReason: streamed.finishReason, settings: generatedSettings, mode: streamMode };
  }
  const markdown = cleanModelText(raw);
  if (!markdown) throw new Error("The screenplay model returned no screenplay text.");
  return { markdown, response: markdown, changed: true, patchWarning: null, model: SCREENPLAY_MODEL, usage: streamed.usage, finishReason: streamed.finishReason, settings: generatedSettings, mode: streamMode };
}

export async function screenplayModelHealth(timeoutMs = 1800) {
  try {
    // LM Studio's OpenAI-compatible /v1/models endpoint can include every
    // installed model when JIT loading is enabled. Use the native endpoint so
    // "modelAvailable" means the pinned model is actually loaded and ready.
    const modelsUrl = new URL("/api/v0/models", LM_STUDIO_URL);
    const response = await fetch(modelsUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { online: false, modelAvailable: false, modelInstalled: false, model: SCREENPLAY_MODEL, url: LM_STUDIO_URL };
    const json = await response.json();
    const required = (json.data || []).find((item) => item.id === SCREENPLAY_MODEL) || null;
    return {
      online: true,
      modelAvailable: required?.state === "loaded",
      modelInstalled: Boolean(required),
      model: SCREENPLAY_MODEL,
      url: LM_STUDIO_URL
    };
  } catch {
    return { online: false, modelAvailable: false, modelInstalled: false, model: SCREENPLAY_MODEL, url: LM_STUDIO_URL };
  }
}

export async function generateScreenplayPackage({
  concept,
  runtimeMinutes = 10,
  genre = "Cinematic Biblical Epic / Supernatural Drama",
  aspectRatio = "2.39:1",
  rating = "PG-13",
  tone = "cinematic, dramatic, emotionally sincere, visually coherent",
  additionalInstructions = ""
} = {}) {
  const minutes = Math.min(30, Math.max(1, Number(runtimeMinutes) || 10));
  const subject = String(concept || "").trim();
  if (!subject) throw new Error("A screenplay concept or story brief is required.");

  const { prompt: user } = generationUserPrompt({ concept: subject, runtimeMinutes: minutes, genre, aspectRatio, rating, tone, additionalInstructions });

  const result = await callScreenplayModel([
    { role: "system", content: SCREENPLAY_SYSTEM },
    { role: "user", content: user }
  ]);
  return {
    markdown: result.content,
    model: SCREENPLAY_MODEL,
    usage: result.usage,
    finishReason: result.finishReason,
    settings: { concept: subject, runtimeMinutes: minutes, genre, aspectRatio, rating, tone, additionalInstructions }
  };
}

function parseJsonResponse(text) {
  const cleaned = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced || cleaned).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The screenplay model did not return a JSON shot plan.");
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new Error(`The screenplay model returned an invalid shot plan: ${error.message}`);
  }
}

function normalizeTextArray(value, fallback) {
  const values = Array.isArray(value) ? value : [];
  const cleaned = values.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8);
  return cleaned.length ? cleaned : [fallback];
}

export function normalizeShotPlan(value) {
  const source = Array.isArray(value?.shots) ? value.shots : [];
  if (!source.length) throw new Error("The screenplay model returned an empty shot plan.");
  const shots = source.slice(0, 60).map((shot, index) => {
    const globalPrompt = String(shot.globalPrompt || shot.videoPrompt || shot.prompt || "").trim();
    if (!globalPrompt) throw new Error(`Shot ${index + 1} is missing its video-generation prompt.`);
    const durationSec = Math.min(30, Math.max(2, Number(shot.durationSec) || 12));
    return {
      index: index + 1,
      name: String(shot.name || shot.title || `Shot ${String(index + 1).padStart(2, "0")}`).trim().slice(0, 100),
      scene: String(shot.scene || shot.slugline || "").trim(),
      durationSec,
      globalPrompt,
      motionPrompts: normalizeTextArray(shot.motionPrompts || shot.segments, globalPrompt),
      firstFramePrompt: String(shot.firstFramePrompt || "").trim(),
      lastFramePrompt: String(shot.lastFramePrompt || "").trim(),
      dialogue: String(shot.dialogue || "").trim(),
      audioDirection: String(shot.audioDirection || "").trim(),
      voiceDirection: String(shot.voiceDirection || "").trim()
    };
  });
  return {
    title: String(value?.title || "Screenplay Shot Plan").trim(),
    shots,
    totalDurationSec: shots.reduce((sum, shot) => sum + shot.durationSec, 0)
  };
}

function sectionBetween(markdown, startHeading, endHeading) {
  const start = markdown.search(startHeading);
  if (start < 0) return "";
  const tail = markdown.slice(start);
  const relativeEnd = endHeading ? tail.search(endHeading) : -1;
  return relativeEnd > 0 ? tail.slice(0, relativeEnd) : tail;
}

function planningSource(markdown) {
  // LM Studio is deliberately configured with a 16K context. The full production
  // package contains many repeated prose specifications; sending all of it plus a
  // large JSON answer can exceed that window. Preserve the actual screenplay and
  // voices verbatim, then compact each visual prompt to its identity-bearing core.
  const screenplay = sectionBetween(markdown, /^#\s+THE SCREENPLAY\s*$/mi, /^#\s+ASSET GENERATION PROMPTS\s*$/mi);
  const assetSection = sectionBetween(markdown, /^#\s+ASSET GENERATION PROMPTS\s*$/mi, /^#\s+LOCATION DESIGN SPECIFICATIONS\s*$/mi);
  const compactAssets = assetSection
    .split(/^###\s+/m)
    .slice(1)
    .map((piece) => {
      const name = piece.split(/\r?\n/)[0].trim();
      const prompts = [...piece.matchAll(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/gi)]
        .slice(0, 2)
        .map((match) => match[1].replace(/\s+/g, " ").trim().slice(0, 520));
      return `### ${name}\n${prompts.join("\n")}`;
    })
    .join("\n");
  const voices = sectionBetween(markdown, /^#\s+VOICE\s*&\s*AUDIO DIRECTION\s*$/mi, /^#\s+PRODUCTION NOTES\s*$/mi);
  const production = sectionBetween(markdown, /^#\s+PRODUCTION NOTES\s*$/mi, /^#\s+END OF SCRIPT PACKAGE\s*$/mi);
  const combined = [screenplay, "# COMPACT ASSET CONTINUITY", compactAssets, voices, production].filter(Boolean).join("\n\n");
  return combined.slice(0, 56000);
}

export async function createShotPlan(markdown, { targetShotSeconds = 15, maxShots = 40 } = {}) {
  const screenplay = String(markdown || "").trim();
  if (!screenplay) throw new Error("Save or generate a screenplay before building a shot plan.");
  const shotSeconds = Math.min(30, Math.max(6, Number(targetShotSeconds) || 15));
  const shotLimit = Math.min(60, Math.max(4, Number(maxShots) || 40));

  const system = `You are Premiere316's screenplay-to-video planning engine. Convert the supplied screenplay package into a concise, production-ordered LTX video shot plan. Return only valid JSON, with no Markdown and no commentary.

JSON schema:
{
  "title": "string",
  "shots": [
    {
      "name": "short unique shot name",
      "scene": "INT./EXT. slugline or sequence",
      "durationSec": 6-30,
      "globalPrompt": "detailed identity-locked continuous video prompt including subject, location, lighting, camera, motion, continuity, anatomy and no-written-elements instruction",
      "motionPrompts": ["2-8 ordered temporal action prompts that cover the complete shot"],
      "firstFramePrompt": "production-ready still-image prompt",
      "lastFramePrompt": "production-ready still-image prompt",
      "dialogue": "exact dialogue heard during this shot, or empty string",
      "audioDirection": "diegetic sound, score, ambience and synchronization",
      "voiceDirection": "speaker, delivery, emotion, accent and pacing, or empty string"
    }
  ]
}

Rules: preserve the screenplay's chronology and exact dialogue; keep character appearance, costumes, props, geography and lighting consistent; never exceed 30 seconds per shot; prefer approximately the requested shot duration; use enough shots to cover the story but never exceed the requested maximum; do not put captions, subtitles, title cards, logos, or visible text in visual prompts.`;

  const user = `Target duration per generated clip: approximately ${shotSeconds} seconds.
Maximum shots: ${shotLimit}.

SCREENPLAY PACKAGE (render-planning view; chronology and dialogue are verbatim):
${planningSource(screenplay)}`;
  const result = await callScreenplayModel([
    { role: "system", content: system },
    { role: "user", content: user }
  ], { temperature: 0.35, topP: 0.85, maxTokens: 7000 });
  return { ...normalizeShotPlan(parseJsonResponse(result.content)), model: SCREENPLAY_MODEL, usage: result.usage };
}
