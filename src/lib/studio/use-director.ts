import { useState } from "react";
import { toast } from "sonner";
import {
  askDirector,
  polishPrompts,
  pollClip,
  speakLine,
  startClip,
  writePicture,
  writeScore,
} from "@/lib/ai/director";
import { desktopExposeStill } from "@/lib/desktop/client";
import { applyDraft } from "./apply-draft";
import { compilePicture } from "./prompt-compiler";
import { useActivePicture, useStudio } from "./store";
import { USAGE_CAPS } from "./types";
import { uid } from "../utils";
import type { NativeGenerationValues } from "./engine-controls.ts";

export function useDirector() {
  const picture = useActivePicture();
  const bumpUsage = useStudio((s) => s.bumpUsage);
  const replaceActive = useStudio((s) => s.replaceActive);
  const patchActive = useStudio((s) => s.patchActive);
  const setStage = useStudio((s) => s.setStage);
  const [busy, setBusy] = useState<string | null>(null);

  async function compose() {
    if (!picture) return;
    if (!bumpUsage("llm")) {
      toast.error(`Director cap reached (${USAGE_CAPS.llm}).`);
      return;
    }
    setBusy("compose");
    try {
      const result = await writePicture({
        data: {
          title: picture.title,
          logline: picture.logline,
          genre: picture.genre,
          tone: picture.tone,
          runtimeMinutes: picture.runtimeMinutes,
          notes: picture.directorNotes,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      replaceActive(applyDraft(picture, result.draft));
      setStage("screenplay");
      toast.success("Screenplay is on the page.");
    } finally {
      setBusy(null);
    }
  }

  async function inventory() {
    if (!picture) return;
    patchActive({ stage: "inventory" });
    setStage("inventory");
  }

  async function prompts() {
    if (!picture) return;
    if (!bumpUsage("llm")) {
      toast.error(`Director cap reached (${USAGE_CAPS.llm}).`);
      return;
    }
    setBusy("prompts");
    try {
      const result = await polishPrompts({
        data: {
          title: picture.title,
          tone: picture.tone,
          shots: picture.shots.map((s) => ({
            id: s.id,
            description: s.description,
            emotion: s.emotion,
            expression: s.expression,
            cameraMove: s.cameraMove,
            durationSec: s.durationSec,
          })),
        },
      });
      if (!result.ok) {
        patchActive(compilePicture({ ...picture, stage: "prompts" }));
        setStage("prompts");
        toast.message("Compiled locally.");
        return;
      }
      const shots = picture.shots.map((s) => {
        const p = result.shots.find((x) => x.id === s.id);
        return p ? { ...s, ...p } : s;
      });
      patchActive({ shots, stage: "prompts" });
      setStage("prompts");
      toast.success("Prompt pack is compiled.");
    } finally {
      setBusy(null);
    }
  }

  async function exposeStill(input: {
    shotId: string;
    engineId: string;
    engineName: string;
    prompt: string;
    references: string[];
    selectedBasePath: string;
    values: NativeGenerationValues;
  }) {
    if (!picture) return false;
    const shot = picture.shots.find((s) => s.id === input.shotId);
    if (!shot) return false;
    const used = picture.usage.stills;
    if (used >= USAGE_CAPS.stills) {
      toast.error(`Still cap reached (${USAGE_CAPS.stills}).`);
      return false;
    }
    setBusy(`still:${input.shotId}`);
    try {
      const result = await desktopExposeStill({
        prompt: input.prompt.trim() || shot.t2iPrompt || shot.description,
        engineId: input.engineId,
        engineName: input.engineName,
        references: input.references.slice(0, 3),
        selectedBasePath: input.selectedBasePath,
        values: input.values,
      });
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      if (!bumpUsage("stills")) {
        toast.error(`Still cap reached (${USAGE_CAPS.stills}).`);
        return false;
      }
      patchActive({
        shots: picture.shots.map((s) => (s.id === input.shotId ? { ...s, stillUrl: result.url, t2iPrompt: input.prompt.trim() } : s)),
      });
      toast.success("Plate in from the local bay.");
      return result;
    } finally {
      setBusy(null);
    }
  }

  async function animate(shotId: string) {
    if (!picture) return;
    const shot = picture.shots.find((s) => s.id === shotId);
    if (!shot) return;
    if (!shot.stillUrl) {
      toast.message("Expose a still first — I2V needs a plate.");
      return;
    }
    if (shot.stillUrl.startsWith("/")) {
      toast.message("Sample plates stay local. Generate a still, then roll I2V.");
      return;
    }
    if (!bumpUsage("clips")) {
      toast.error(`Clip cap reached (${USAGE_CAPS.clips}).`);
      return;
    }
    setBusy(`clip:${shotId}`);
    try {
      const started = await startClip({
        data: { prompt: shot.i2vPrompt || shot.description, imageUrl: shot.stillUrl, duration: shot.durationSec },
      });
      if (!started.ok) {
        toast.error(started.error);
        return;
      }
      if (started.url) {
        patchActive({
          shots: picture.shots.map((s) => (s.id === shotId ? { ...s, videoUrl: started.url } : s)),
        });
        toast.success("Clip in.");
        return;
      }
      if (!started.id) {
        toast.error("No clip id.");
        return;
      }
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const polled = await pollClip({ data: { id: started.id } });
        if (!polled.ok) continue;
        if (polled.url) {
          patchActive({
            shots: picture.shots.map((s) => (s.id === shotId ? { ...s, videoUrl: polled.url } : s)),
          });
          toast.success("Clip in.");
          return;
        }
      }
      toast.error("Clip timed out.");
    } finally {
      setBusy(null);
    }
  }

  async function speak(voiceId: string, text: string, character: string) {
    if (!picture) return;
    if (!bumpUsage("tts")) {
      toast.error(`Voice cap reached (${USAGE_CAPS.tts}).`);
      return;
    }
    setBusy("tts");
    try {
      const result = await speakLine({ data: { text, voiceId } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      patchActive({
        voices: [
          ...picture.voices.filter((v) => v.character !== character || v.text !== text),
          { id: uid("vo"), character, text, voiceId, audioDataUrl: result.audioDataUrl },
        ],
      });
      toast.success("Take in.");
    } finally {
      setBusy(null);
    }
  }

  async function score() {
    if (!picture) return;
    if (!bumpUsage("llm")) {
      toast.error(`Director cap reached (${USAGE_CAPS.llm}).`);
      return;
    }
    setBusy("score");
    try {
      const result = await writeScore({
        data: {
          title: picture.title,
          tone: picture.tone,
          runtimeSec: picture.shots.reduce((n, s) => n + s.durationSec, 0),
          scenes: picture.scenes.map((s) => ({
            slugline: s.slugline,
            emotionalBeat: s.emotionalBeat,
            durationSec: s.durationSec,
          })),
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const cues = result.cues.map((c) => ({ ...c, id: c.id || uid("cue") }));
      patchActive({ cues, stage: "score" });
      setStage("score");
      toast.success("Cue sheet is up.");
    } finally {
      setBusy(null);
    }
  }

  async function ask(question: string) {
    if (!picture || !question.trim()) return "";
    if (!bumpUsage("llm")) {
      toast.error(`Director cap reached (${USAGE_CAPS.llm}).`);
      return "";
    }
    setBusy("ask");
    try {
      const result = await askDirector({
        data: {
          context: [picture.title, picture.logline, picture.directorNotes, picture.scenes.map((s) => s.slugline).join(" · ")].join(
            "\n",
          ),
          question,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return "";
      }
      return result.text;
    } finally {
      setBusy(null);
    }
  }

  return { busy, compose, inventory, prompts, exposeStill, animate, speak, score, ask };
}
