import { engineById } from "./engines";
import type { Picture, Shot } from "./types";
export { defaultPromptCompilerRouting } from "./model-routing.ts";

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
  const scene = picture.scenes.find((sc) => sc.id === shot.sceneId);
  const who = picture.characters.map((c) => `${c.name}, ${c.look}`).join("; ");
  const place = picture.locations.map((l) => `${l.name}: ${l.description}`).join("; ");
  const t2iPrompt = [
    `${image} still, photoreal 35mm, ${picture.tone}.`,
    shot.description,
    `Camera: ${shot.camera} ${shot.lens}, ${shot.cameraMove}.`,
    `Face / emotion: ${shot.emotion}. ${shot.expression}.`,
    `Cast: ${who}.`,
    `Place: ${place}. ${scene?.slugline ?? ""}.`,
    "No text, no watermark, cinematic color, natural skin.",
  ].join(" ");
  const i2vPrompt = [
    `${video} image-to-video, ${shot.durationSec}s, 24fps, photoreal.`,
    `Human performance: ${shot.expression}. Emotion: ${shot.emotion}.`,
    `Camera move: ${shot.cameraMove}. ${shot.description}`,
    "Micro-expressions, realistic eye saccades, breath, cloth, rain if present.",
    "No morphing faces, no extra limbs, hold identity from the plate.",
  ].join(" ");
  const t2voicePrompt = shot.type === "closeup" ? `${shot.emotion}, close-mic, dry room, ${shot.expression}` : "";
  return { ...shot, t2iPrompt, i2vPrompt, t2voicePrompt };
}
