import { createServerFn } from "@tanstack/react-start";
import { parseJsonLoose } from "@/lib/utils";
import type { PictureDraft } from "@/lib/studio/apply-draft";
import type { StillExposeInput } from "@/lib/desktop/protocol.ts";

function key() {
  return process.env.XAI_API_KEY;
}

async function chat(system: string, user: string, maxTokens = 4000) {
  const apiKey = key();
  if (!apiKey) return { ok: false as const, error: "AI is not available in this environment." };
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "grok-4.5",
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) return { ok: false as const, error: `Director error ${res.status}` };
  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  return { ok: true as const, text: body.choices[0]?.message.content ?? "" };
}

export const writePicture = createServerFn({ method: "POST" })
  .validator((input: { title: string; logline: string; genre: string; tone: string; runtimeMinutes: number; notes: string }) => input)
  .handler(async ({ data }) => {
    const result = await chat(
      `You are a film director writing a short picture. Return ONLY JSON with keys: title, logline, genre, tone, directorNotes, acts[{number,name}], scenes[{slugline,summary,emotionalBeat,durationSec,act}], characters[{name,role,age,look,arc,voiceId}], locations[{name,description,lighting}], props[{name,description}], wardrobe[{name,description}], vfx[{name,description}], shots[{sceneIndex,type,description,durationSec,camera,lens,cameraMove,emotion,expression}]. Shots 6-15 seconds. Types: establishing, coverage, closeup, insert. 8-14 shots. Photoreal, human faces with specific expressions.`,
      JSON.stringify(data),
    );
    if (!result.ok) return result;
    try {
      const draft = parseJsonLoose<PictureDraft>(result.text);
      return { ok: true as const, draft };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Bad draft" };
    }
  });

export const polishPrompts = createServerFn({ method: "POST" })
  .validator((input: { title: string; tone: string; shots: { id: string; description: string; emotion: string; expression: string; cameraMove: string; durationSec: number }[] }) => input)
  .handler(async ({ data }) => {
    const result = await chat(
      `Polish T2I and I2V prompts. Return JSON { shots: [{ id, t2iPrompt, i2vPrompt, t2voicePrompt }] }. I2V is 10-15s human performance with facial micro-expression. No Comfy.`,
      JSON.stringify(data),
      3000,
    );
    if (!result.ok) return result;
    try {
      return { ok: true as const, ...parseJsonLoose<{ shots: { id: string; t2iPrompt: string; i2vPrompt: string; t2voicePrompt: string }[] }>(result.text) };
    } catch {
      return { ok: false as const, error: "Prompt pack failed." };
    }
  });

export const generateStill = createServerFn({ method: "POST" })
  .validator(
    (input: StillExposeInput) => ({
      prompt: input.prompt,
      engineId: input.engineId ?? "",
      engineName: input.engineName ?? "",
      references: (input.references ?? []).filter((u) => typeof u === "string" && u.startsWith("data:image/")).slice(0, 3),
      selectedBasePath: input.selectedBasePath ?? "",
      values: input.values ?? {},
    }),
  )
  .handler(async ({ data }) => {
    const { exposeLocalStill } = await import("@/lib/studio/local-still.server.ts");
    return exposeLocalStill({
      prompt: data.prompt,
      engineId: data.engineId,
      engineName: data.engineName,
      references: data.references,
      selectedBasePath: data.selectedBasePath,
      values: data.values,
    });
  });

export const wakeLocalEngine = createServerFn({ method: "POST" }).handler(async () => {
  const { ensureLocalEngine } = await import("@/lib/studio/local-still.server.ts");
  return ensureLocalEngine();
});

export const startClip = createServerFn({ method: "POST" })
  .validator((input: { prompt: string; imageUrl?: string; duration: number }) => input)
  .handler(async ({ data }) => {
    const apiKey = key();
    if (!apiKey) return { ok: false as const, error: "AI is not available." };
    const res = await fetch("https://api.x.ai/v1/videos/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "grok-imagine-video",
        prompt: data.prompt,
        duration: Math.min(15, Math.max(10, data.duration || 10)),
        image_url: data.imageUrl,
      }),
    });
    if (!res.ok) return { ok: false as const, error: `Clip failed ${res.status}` };
    const body = (await res.json()) as { id?: string; request_id?: string; url?: string };
    return { ok: true as const, id: body.id || body.request_id || "", url: body.url };
  });

export const pollClip = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const apiKey = key();
    if (!apiKey) return { ok: false as const, error: "AI is not available." };
    const res = await fetch(`https://api.x.ai/v1/videos/generations/${data.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { ok: false as const, error: `Poll failed ${res.status}` };
    const body = (await res.json()) as { status?: string; url?: string; video_url?: string };
    return { ok: true as const, status: body.status ?? "unknown", url: body.url || body.video_url };
  });

export const speakLine = createServerFn({ method: "POST" })
  .validator((input: { text: string; voiceId: string }) => input)
  .handler(async ({ data }) => {
    const apiKey = key();
    if (!apiKey) return { ok: false as const, error: "AI is not available." };
    const res = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ text: data.text, voice_id: data.voiceId || "eve" }),
    });
    if (!res.ok) return { ok: false as const, error: `Voice failed ${res.status}` };
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    return { ok: true as const, audioDataUrl: `data:audio/mpeg;base64,${b64}` };
  });

export const writeScore = createServerFn({ method: "POST" })
  .validator(
    (input: {
      title: string;
      tone: string;
      runtimeSec: number;
      scenes: { slugline: string; emotionalBeat: string; durationSec: number }[];
    }) => input,
  )
  .handler(async ({ data }) => {
    const result = await chat(
      `Write an original MiniMax Music3 cue sheet. Return JSON { cues: [{ id, name, startSec, durationSec, mood, instruments, minimaxPrompt, sfx }] }. No licensed songs.`,
      JSON.stringify(data),
      2500,
    );
    if (!result.ok) return result;
    try {
      return { ok: true as const, ...parseJsonLoose<{ cues: { id: string; name: string; startSec: number; durationSec: number; mood: string; instruments: string; minimaxPrompt: string; sfx: string }[] }>(result.text) };
    } catch {
      return { ok: false as const, error: "Score failed." };
    }
  });

export const askDirector = createServerFn({ method: "POST" })
  .validator((input: { context: string; question: string }) => input)
  .handler(async ({ data }) => {
    return chat(`You are the picture's director. Be specific, brief, cinematic.`, `${data.context}\n\n${data.question}`, 800);
  });
