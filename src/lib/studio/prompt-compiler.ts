import { engineById } from "./engines.ts";
import type { Picture, Shot } from "./types";
export { defaultPromptCompilerRouting } from "./model-routing.ts";
import type { CanonicalShotSpec } from "../performance/types.ts";
import type { PictureResearchBible } from "../research/bible.ts";
import { defaultVideoSettings, videoEngineFromSelection, type CompiledMediaTarget, type SeedPolicy } from "./generation-config.ts";

export type EnginePromptPackage = {
  schemaVersion: 1;
  compiler: "deterministic-llama-default";
  engineTarget: CompiledMediaTarget;
  enginePrompt: string;
  negativePrompt: string;
  shotSummary: string;
  cameraTimeline: string;
  actionTimeline: string;
  continuityLocks: string[];
  referenceAssets: string[];
  seedPolicy: SeedPolicy;
  durationSec: number;
  fps: number;
  resolution: { width: number; height: number; aspectRatio: string };
  engineSettings: Record<string, string | number | boolean | null>;
  validationWarnings: string[];
  provenance: {
    pictureId: string;
    shotId: string;
    sceneId: string;
    compiledAt: number;
    researchVersionId: string | null;
    screenplayVersionId: string | null;
    canonicalSpecVersion: number | null;
  };
};

export type CompilePromptInput = {
  picture: Picture;
  shot: Shot;
  canonical?: CanonicalShotSpec | null;
  research?: PictureResearchBible | null;
  now?: number;
  seed?: number | null;
  target?: "still" | "video";
};

export function totalDuration(picture: Picture) {
  return picture.shots.reduce((n, s) => n + s.durationSec, 0);
}

export function shotStarts(picture: Picture) {
  let t = 0;
  return picture.shots.map((s) => {
    const start = t;
    t += s.durationSec;
    return { id: s.id, start, end: t };
  });
}

export function fountainFrom(picture: Picture) {
  const lines = [`Title: ${picture.title}`, `Credit: written by Premiere316`, `Draft date: V3.02`, ""];
  for (const scene of picture.scenes) {
    lines.push(scene.slugline, "");
    const beat = picture.characters[0];
    lines.push(scene.summary, "");
    if (beat) {
      lines.push(beat.name.toUpperCase(), scene.emotionalBeat, "");
    }
  }
  return lines.join("\n");
}

export function compilePicture(picture: Picture): Picture {
  const image = engineById(picture.selectedEngine.image)?.name ?? "FLUX";
  const video = engineById(picture.selectedEngine.video)?.name ?? "LTX-2";
  const shots = picture.shots.map((s) => compileShot(picture, s, image, video));
  return { ...picture, shots };
}

function compileShot(picture: Picture, shot: Shot, image: string, video: string): Shot {
  const pkgStill = compileEnginePromptPackage({ picture, shot, target: "still" });
  const pkgVideo = compileEnginePromptPackage({ picture, shot, target: "video" });
  return {
    ...shot,
    t2iPrompt: (picture.nativeFilm?.writer ? picture.nativeFilm.imagePrompts?.[shot.id] : undefined) ?? pkgStill.enginePrompt,
    i2vPrompt: (picture.nativeFilm?.writer ? picture.nativeFilm.prompts?.[shot.id] : undefined) ?? pkgVideo.enginePrompt,
    t2voicePrompt: shot.type === "closeup" ? `${shot.emotion}, close-mic, dry room, ${shot.expression}` : shot.t2voicePrompt,
  };
}

export function compileEnginePromptPackage(input: CompilePromptInput): EnginePromptPackage {
  const now = input.now ?? Date.now();
  const { picture, shot } = input;
  const scene = picture.scenes.find((item) => item.id === shot.sceneId);
  const canonical = input.canonical ?? picture.performance?.shots.find((item) => item.shotId === shot.id || item.legacy?.id === shot.id) ?? null;
  const research = input.research ?? picture.research ?? null;
  const videoEngine = videoEngineFromSelection(picture.selectedEngine.video);
  const stillTarget: CompiledMediaTarget = /flux2/i.test(picture.selectedEngine.image) ? "flux2-dev" : "flux1-dev";
  const target = input.target === "video" ? (videoEngine === "minimax-h3" ? "minimax-h3" : "ltx-2.5") : stillTarget;
  const settings = defaultVideoSettings(videoEngine, shot.durationSec);
  const locks = unique([
    ...(canonical?.continuity.hardLocks ?? []),
    ...(picture.production?.assets ?? []).flatMap((asset) => asset.canonicalSpec.continuityLocks ?? []),
    shot.emotion,
    shot.expression,
  ].filter(Boolean));
  const references = unique([
    ...(canonical?.references.characterReference ?? []),
    ...(canonical?.references.location ?? []),
    ...(canonical?.references.wardrobe ?? []),
    ...(picture.production?.assets ?? []).flatMap((asset) => asset.references.filter((item) => item.preferred).map((item) => item.id)),
  ]);
  const camera = canonical
    ? `${canonical.camera.style ?? shot.camera} ${canonical.framing.lens ?? shot.lens}, ${canonical.camera.movementPath ?? shot.cameraMove}`
    : `${shot.camera} ${shot.lens}, ${shot.cameraMove}`;
  const action = canonical?.subject.actions?.join("; ") || shot.description;
  const who = picture.characters.map((character) => `${character.name}, ${character.look}`).join("; ");
  const place = picture.locations.map((location) => `${location.name}: ${location.description}`).join("; ");
  const researchNote = research?.approvedVersionId ? `Approved research ${research.approvedVersionId}.` : "Research not approved.";
  const dialogue = scene?.emotionalBeat ?? "";
  const negative = unique([
    ...(canonical?.negatives ?? []),
    "morphing faces",
    "extra limbs",
    "identity drift",
    "watermark",
    "text overlay",
  ]).join(", ");
  const stillPrompt = [
    `${engineById(picture.selectedEngine.image)?.name ?? "FLUX"} still, photoreal 35mm, ${picture.tone}.`,
    action,
    `Camera: ${camera}.`,
    `Face / emotion: ${shot.emotion}. ${shot.expression}.`,
    who ? `Cast: ${who}.` : "",
    place ? `Place: ${place}. ${scene?.slugline ?? ""}.` : scene?.slugline ?? "",
    locks.length ? `Continuity locks: ${locks.join("; ")}.` : "",
    researchNote,
    "No text, no watermark, cinematic color, natural skin.",
  ].filter(Boolean).join(" ");
  const videoPrompt = [
    `${engineById(picture.selectedEngine.video)?.name ?? "LTX-2"} ${shot.stillUrl ? "image-to-video" : "text-to-video"}, ${settings.durationSec}s, ${settings.fps}fps, photoreal.`,
    `Human performance: ${shot.expression}. Emotion: ${shot.emotion}.`,
    `Camera timeline: ${camera}.`,
    `Action timeline: ${action}.`,
    dialogue ? `Dialogue/intent: ${dialogue}.` : "",
    locks.length ? `Hold identity/continuity: ${locks.join("; ")}.` : "",
    "Micro-expressions, realistic eye saccades, breath, cloth.",
    "No morphing faces, no extra limbs, hold identity.",
  ].filter(Boolean).join(" ");
  const warnings: string[] = [];
  if (!research?.approvedVersionId) warnings.push("Compiled without an approved research snapshot.");
  if (!canonical) warnings.push("Compiled from legacy shot fields; CanonicalShotSpec was absent.");
  if (input.target === "video" && !shot.stillUrl) warnings.push("I2V preferred but no still plate is bound; T2V prompt was used.");
  if (shot.durationSec < 6) warnings.push("Shot duration is below the 6s performance floor.");
  return {
    schemaVersion: 1,
    compiler: "deterministic-llama-default",
    engineTarget: target,
    enginePrompt: input.target === "video" ? videoPrompt : stillPrompt,
    negativePrompt: negative,
    shotSummary: `${shot.type} · ${shot.durationSec}s · ${scene?.slugline ?? shot.sceneId} · ${action}`.slice(0, 400),
    cameraTimeline: camera,
    actionTimeline: action,
    continuityLocks: locks,
    referenceAssets: references,
    seedPolicy: { mode: input.seed == null ? "randomize" : "locked", seed: input.seed ?? null },
    durationSec: settings.durationSec,
    fps: settings.fps,
    resolution: { width: input.target === "video" ? settings.width : 512, height: input.target === "video" ? settings.height : 512, aspectRatio: picture.format || "16:9" },
    engineSettings: {
      motionIntensity: settings.motionIntensity,
      intendedEngine: canonical?.intendedEngine ?? picture.selectedEngine.video,
      llamaDefaultCompiler: true,
      qwenOptional: true,
    },
    validationWarnings: warnings,
    provenance: {
      pictureId: picture.id,
      shotId: shot.id,
      sceneId: shot.sceneId,
      compiledAt: now,
      researchVersionId: research?.approvedVersionId ?? null,
      screenplayVersionId: picture.screenplay?.currentVersionId ?? picture.screenplay?.approvedVersionId ?? null,
      canonicalSpecVersion: canonical?.version ?? null,
    },
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
