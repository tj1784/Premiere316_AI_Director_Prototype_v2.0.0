import { engineById, ENGINES } from "./engines";
import { fountainFrom, shotStarts } from "./prompt-compiler";
import { MODEL_ROOT, type Picture } from "./types";
import { movieBibleIndex } from "./movie-bible";
import { resolveRenderContext } from "./render-context";
import { measuredSpeechAudit } from "./speech-review";
import { compileEnginePromptPackage } from "./prompt-compiler";
import { readyTextFile, type ReadyFile, formatTimecode } from "../utils";

export function buildFountain(picture: Picture): ReadyFile {
  return readyTextFile(
    `${slug(picture.title)}.fountain`,
    picture.screenplay.workingFountain || picture.screenplayFountain || fountainFrom(picture),
  );
}

export function buildShotList(picture: Picture): ReadyFile {
  const starts = shotStarts(picture);
  const header = "shot,scene,type,start,end,dur,camera,emotion,t2i,i2v";
  const rows = picture.shots.map((s) => {
    const span = starts.find((x) => x.id === s.id);
    const scene = picture.scenes.find((sc) => sc.id === s.sceneId);
    const cells = [
      s.id,
      scene?.slugline ?? "",
      s.type,
      formatTimecode(span?.start ?? 0, picture.fps),
      formatTimecode(span?.end ?? 0, picture.fps),
      String(s.durationSec),
      s.cameraMove,
      s.emotion,
      quote(s.t2iPrompt),
      quote(s.i2vPrompt),
    ];
    return cells.join(",");
  });
  return readyTextFile(
    `${slug(picture.title)}-shots.csv`,
    [header, ...rows].join("\n"),
    "text/csv",
  );
}

export function buildEdl(picture: Picture): ReadyFile {
  const starts = shotStarts(picture);
  const lines = [`TITLE: ${picture.title}`, "FCM: NON-DROP FRAME", ""];
  picture.shots.forEach((s, i) => {
    const span = starts.find((x) => x.id === s.id)!;
    const recIn = formatTimecode(span.start, picture.fps);
    const recOut = formatTimecode(span.end, picture.fps);
    const srcOut = formatTimecode(s.durationSec, picture.fps);
    lines.push(
      `${String(i + 1).padStart(3, "0")}  AX       V     C        00:00:00:00 ${srcOut} ${recIn} ${recOut}`,
      `* FROM CLIP NAME: ${s.id} ${s.description}`,
      "",
    );
  });
  return readyTextFile(`${slug(picture.title)}.edl`, lines.join("\n"));
}

export function buildCueSheet(picture: Picture): ReadyFile {
  const body = picture.cues
    .map(
      (c) =>
        `${c.name}\n  ${formatTimecode(c.startSec)}–${formatTimecode(c.startSec + c.durationSec)}  ${c.durationSec}s\n  ${c.mood}\n  ${c.instruments}\n  Music3: ${c.minimaxPrompt}\n  SFX: ${c.sfx}\n`,
    )
    .join("\n");
  return readyTextFile(
    `${slug(picture.title)}-cues.txt`,
    `CUE SHEET — ${picture.title}\n\n${body}\n\nSOURCE-BOUND CUES\n${(picture.audio?.cues ?? []).map((c) => `${c.id} · ${c.name} · ${c.kind}\n${c.startSec}s + ${c.durationSec}s; tail ${c.tailSec ?? 0}s\n${c.notes}\nInstrumentation: ${c.instrumentation}\nPerspective: ${c.perspective ?? "unspecified"}\nMix: ${c.mixPriority ?? "unspecified"}\nSync: ${c.syncLandmarks ?? "unspecified"}\nMotif: ${JSON.stringify(c.motif ?? null)}\nVocal policy: ${c.vocalPolicy ?? "unspecified"}\nDestination: ${c.destination ?? "unspecified"}\n`).join("\n")}`,
  );
}

export function buildPromptPack(picture: Picture): ReadyFile {
  const image = engineById(picture.selectedEngine.image)?.name ?? picture.selectedEngine.image;
  const video = engineById(picture.selectedEngine.video)?.name ?? picture.selectedEngine.video;
  const parts = picture.shots.map((s) =>
    [
      `## ${s.id}  ${s.type}  ${s.durationSec}s`,
      s.description,
      "",
      `T2I [${image}]`,
      s.t2iPrompt,
      "",
      `I2V [${video}]`,
      safeCompiledPreview(picture, s).compiledPreview?.enginePrompt ??
        `BLOCKED: ${safeCompiledPreview(picture, s).error}`,
      "",
      s.t2voicePrompt ? `VOICE\n${s.t2voicePrompt}\n` : "",
    ].join("\n"),
  );
  return readyTextFile(
    `${slug(picture.title)}-prompts.md`,
    `# Prompt pack — ${picture.title}\n\n${parts.join("\n---\n\n")}`,
  );
}

export function buildProjectJson(picture: Picture): ReadyFile {
  return readyTextFile(
    `${slug(picture.title)}.premiere316.json`,
    JSON.stringify(
      {
        app: "Premiere316",
        version: "4.0.0",
        modelRoot: MODEL_ROOT,
        engines: ENGINES.map((e) => ({ id: e.id, repo: `${e.org}/${e.repo}` })),
        picture,
      },
      null,
      2,
    ),
    "application/json",
  );
}

export function buildAllExports(picture: Picture): ReadyFile[] {
  return [
    buildBibleManifest(picture),
    buildFountain(picture),
    buildShotList(picture),
    buildEdl(picture),
    buildPromptPack(picture),
    buildCueSheet(picture),
    buildProjectJson(picture),
  ];
}

export function buildBibleManifest(picture: Picture): ReadyFile {
  return readyTextFile(
    `${slug(picture.title)}-bible-manifest.json`,
    JSON.stringify(
      {
        schemaVersion: 1,
        pictureId: picture.id,
        exportedAt: new Date().toISOString(),
        scope: "Authored source and prompt package; not a rendered movie or media-quality approval",
        registry: movieBibleIndex(picture),
        bible: picture.movieBible ?? null,
        continuity: picture.shotContinuity ?? null,
        soundCues: picture.audio?.cues ?? [],
        measuredSpeech: measuredSpeechAudit(picture),
        globalAndLocal: picture.renderContext ?? null,
        shots: picture.shots.map((shot) => ({
          shotId: shot.id,
          sceneId: shot.sceneId,
          renderContext: resolveRenderContext(picture, shot),
          storedImagePrompt: shot.t2iPrompt,
          storedVideoPrompt: shot.i2vPrompt,
          ...safeCompiledPreview(picture, shot),
        })),
        authoringRun: picture.bibleRun ?? null,
        approvedScreenplayVersion: picture.screenplay.approvedVersionId,
        selectedEngines: picture.selectedEngine,
        mediaReview:
          "See canonical iteration and take review receipts in the project export. Prompt compilation does not approve media.",
      },
      null,
      2,
    ),
    "application/json",
  );
}

function safeCompiledPreview(picture: Picture, shot: Picture["shots"][number]) {
  try {
    return {
      status: "compiled-preview",
      compiledPreview: compileEnginePromptPackage({ picture, shot, target: "video" }),
      error: null,
    };
  } catch (error) {
    return {
      status: "blocked",
      compiledPreview: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function slug(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "picture"
  );
}

function quote(s: string) {
  return `"${s.replaceAll('"', '""')}"`;
}
